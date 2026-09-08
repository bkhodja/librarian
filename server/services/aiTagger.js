/**
 * Subject tagging with a local model.
 *
 * Runs against Ollama on the user's own machine, so tagging the whole library
 * costs nothing and works offline. When Ollama is not running it falls back to
 * the keyword tagger, which is worse but never blocks the library.
 */

const { db } = require('../database/init');
const ollama = require('./ollamaClient');
const vocabulary = require('./tagVocabulary');
const keywordTagger = require('./autoTagger');

const MAX_TAGS = Number(process.env.AI_TAGGER_MAX_TAGS) || 3;

// Enough of the book to judge its subject. The title and description carry
// most of the signal; a slice of the opening text settles the rest.
const CONTENT_CHARS = 1500;

const SCHEMA = {
  type: 'object',
  properties: {
    tags: { type: 'array', items: { type: 'string' } }
  },
  required: ['tags']
};

const SYSTEM = `You classify books by subject using a fixed list of tags.

Rules:
- Choose ONLY from the list given. Never invent a tag.
- Tag what the book is substantially about, not what it mentions in passing.
- Precision matters more than coverage. Most books need 1 or 2 tags.
- Do not pad the list to reach the maximum. If only one tag fits, return one.
- If you are unsure about a tag, leave it out.
- Return the tag name only. The list shows "name — meaning"; the meaning is
  there to help you choose and must never appear in your answer.`;

class AiTagger {
  /** Assemble the evidence available for one book. */
  describeBook(book) {
    const parts = [`Title: ${book.title || 'Unknown'}`];

    if (book.author) parts.push(`Author: ${book.author}`);
    if (book.publisher) parts.push(`Publisher: ${book.publisher}`);
    if (book.description) parts.push(`Description: ${book.description.slice(0, 800)}`);

    // A page of the book itself, when it has been indexed.
    if (!book.description) {
      try {
        const page = db.prepare(
          'SELECT content FROM book_pages WHERE book_id = ? AND content IS NOT NULL ORDER BY page_number LIMIT 1'
        ).get(book.id);
        if (page?.content) {
          parts.push(`Excerpt: ${page.content.replace(/\s+/g, ' ').slice(0, CONTENT_CHARS)}`);
        }
      } catch {
        // book_pages may not be populated for this book; the title still works.
      }
    }

    return parts.join('\n');
  }

  buildPrompt(book) {
    return `${this.describeBook(book)}

Available tags:
${vocabulary.asPromptList()}

What is this book substantially about? Give between 1 and ${MAX_TAGS} tags,
using as few as accurately describe it.
Reply as JSON: {"tags": ["tag1"]}`;
  }

  /**
   * Suggest tags for one book. Returns { tags, source } — source is 'ai' or
   * 'keywords' so callers can tell how the tags were arrived at.
   */
  async suggest(book) {
    const reply = await ollama.generateJSON(this.buildPrompt(book), SCHEMA, {
      system: SYSTEM,
      maxTokens: 96
    });

    if (reply && Array.isArray(reply.tags)) {
      // The model invents tags whatever the prompt says, so membership is
      // enforced here rather than trusted.
      const tags = [];
      for (const raw of reply.tags) {
        const tag = vocabulary.canonicalize(raw);
        if (tag && !tags.includes(tag)) tags.push(tag);
      }

      if (tags.length > 0) return { tags: tags.slice(0, MAX_TAGS), source: 'ai' };
    }

    return { tags: await this.keywordFallback(book), source: 'keywords' };
  }

  /** Keyword matching, for when Ollama is unavailable or returns nothing usable. */
  async keywordFallback(book) {
    try {
      const suggestions = await keywordTagger.generateSuggestions(book.id);
      const names = (suggestions?.suggestions || [])
        .map((s) => vocabulary.canonicalize(s.tag || s.name || s))
        .filter(Boolean);
      return [...new Set(names)].slice(0, MAX_TAGS);
    } catch {
      return [];
    }
  }

  /** Replace a book's tags with the given set, creating tags as needed. */
  applyTags(bookId, tags) {
    if (!Array.isArray(tags) || tags.length === 0) return 0;

    const findTag = db.prepare('SELECT id FROM tags WHERE name = ?');
    const insertTag = db.prepare('INSERT INTO tags (name) VALUES (?)');
    const link = db.prepare('INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?, ?)');

    const write = db.transaction((names) => {
      let applied = 0;
      for (const name of names) {
        const existing = findTag.get(name);
        const tagId = existing ? existing.id : insertTag.run(name).lastInsertRowid;
        link.run(bookId, tagId);
        applied++;
      }
      return applied;
    });

    return write(tags);
  }

  /** Suggest and store in one step. */
  async tagBook(bookId) {
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
    if (!book) throw new Error(`Book ${bookId} not found`);

    const { tags, source } = await this.suggest(book);
    const applied = this.applyTags(bookId, tags);

    return { bookId, title: book.title, tags, source, applied };
  }

  /** Books that have no tags yet, oldest first. */
  untaggedBooks(limit) {
    return db.prepare(`
      SELECT b.* FROM books b
      LEFT JOIN book_tags bt ON bt.book_id = b.id
      WHERE bt.book_id IS NULL
        AND b.needs_review = 0
      ORDER BY b.id
      LIMIT ?
    `).all(limit);
  }

  countUntagged() {
    return db.prepare(`
      SELECT COUNT(*) AS count FROM books b
      LEFT JOIN book_tags bt ON bt.book_id = b.id
      WHERE bt.book_id IS NULL AND b.needs_review = 0
    `).get().count;
  }

  /**
   * Tag a batch of untagged books. Sequential on purpose: Ollama serialises
   * requests to one model anyway, and running the machine flat out while the
   * user is reading is not worth the few seconds saved.
   */
  async tagUntagged(limit = 25, onProgress) {
    const books = this.untaggedBooks(limit);
    const results = { tagged: 0, skipped: 0, bySource: { ai: 0, keywords: 0 } };

    for (const book of books) {
      try {
        const { tags, source } = await this.suggest(book);

        if (tags.length === 0) {
          results.skipped++;
          continue;
        }

        this.applyTags(book.id, tags);
        results.tagged++;
        results.bySource[source]++;

        if (onProgress) onProgress({ book, tags, source });
      } catch (error) {
        console.error(`Tagging failed for book ${book.id}: ${error.message}`);
        results.skipped++;
      }
    }

    return results;
  }

  /** Clear a book's tags and derive them again. */
  async retagBook(bookId) {
    db.prepare('DELETE FROM book_tags WHERE book_id = ?').run(bookId);
    return this.tagBook(bookId);
  }

  /**
   * Fold existing tags onto the controlled vocabulary and drop what is left
   * over. Tags predating the vocabulary are spelled differently for the same
   * thing ("C#" beside "csharp", "AI" beside "llm"), which splits a subject
   * across two filter entries, and the old keyword tagger also stored file
   * properties such as "Searchable PDF" as if they were subjects.
   */
  normalizeExistingTags() {
    const tags = db.prepare('SELECT id, name FROM tags').all();
    const result = { merged: 0, removed: 0, kept: 0 };

    const findByName = db.prepare('SELECT id FROM tags WHERE name = ?');
    const insertTag = db.prepare('INSERT INTO tags (name) VALUES (?)');
    const relink = db.prepare('INSERT OR IGNORE INTO book_tags (book_id, tag_id) SELECT book_id, ? FROM book_tags WHERE tag_id = ?');
    const dropLinks = db.prepare('DELETE FROM book_tags WHERE tag_id = ?');
    const dropTag = db.prepare('DELETE FROM tags WHERE id = ?');

    const run = db.transaction(() => {
      for (const tag of tags) {
        if (vocabulary.TAG_SET.has(tag.name)) {
          result.kept++;
          continue;
        }

        const canonical = vocabulary.canonicalize(tag.name);

        if (!canonical) {
          // Not a subject at all — a file property or a one-off.
          dropLinks.run(tag.id);
          dropTag.run(tag.id);
          result.removed++;
          continue;
        }

        const target = findByName.get(canonical)
          || { id: insertTag.run(canonical).lastInsertRowid };

        relink.run(target.id, tag.id);
        dropLinks.run(tag.id);
        dropTag.run(tag.id);
        result.merged++;
      }
    });

    run();
    return result;
  }

  /** Remove tags that no book carries. */
  pruneOrphanTags() {
    const { changes } = db.prepare(`
      DELETE FROM tags
      WHERE id NOT IN (SELECT DISTINCT tag_id FROM book_tags)
    `).run();
    return changes;
  }

  async status() {
    const available = await ollama.isAvailable();
    return {
      available,
      model: ollama.model,
      host: ollama.host,
      vocabularySize: vocabulary.TAGS.length,
      untagged: this.countUntagged()
    };
  }
}

module.exports = new AiTagger();
