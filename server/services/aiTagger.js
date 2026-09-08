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

// Hiding a book is a visible mistake, so a flag needs two models to agree.
const ADULT_MODEL = process.env.OLLAMA_MODEL || 'gemma3:4b';
const ADULT_VERIFY_MODEL = process.env.OLLAMA_VERIFY_MODEL || 'qwen3.6:35b-a3b';

const ADULT_SCHEMA = {
  type: 'object',
  properties: {
    adult: { type: 'boolean' },
    why: { type: 'string' }
  },
  required: ['adult']
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
  constructor() {
    // Books tried this run. A book the model cannot classify stays untagged,
    // and the untagged query always returns the same rows in id order, so
    // without this the sweep re-processes the same handful forever once it
    // reaches a run of books it cannot tag. Cleared on restart, which retries
    // them — worth doing after a vocabulary or prompt change.
    this.attempted = new Set();

    // Same problem on the adult sweep: a book with nothing readable is left
    // unassessed on purpose, so it would be picked up again every pass.
    this.unassessable = new Set();
  }

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

  /**
   * Is this sexually explicit material?
   *
   * Asked separately from tagging rather than folded into the same reply: the
   * tag prompt was tuned carefully and giving the model a second, unrelated
   * job alongside it risks the tags getting worse to answer a question that
   * costs a second on its own.
   *
   * The wording draws the line at explicit material rather than subject
   * matter, because a book that discusses sex clinically or academically is
   * not what anyone means by hiding adult content.
   */
  /*
   * A title on its own is not evidence. Asked to judge title-only books the
   * model invented a reason for every one it flagged: a Power BI book called
   * "extremedax" was "extreme content", a finance book "moneyiseverything" was
   * "often associated with sexual themes", and "Укус питона" — Python's Bite,
   * a programming book — became "a dangerous, predatory encounter". Ten books,
   * ten false positives, none of them with anything to read.
   *
   * Half the library has no description, and the erotica actually in it has
   * none at all, so a description is not enough to gate on either. What every
   * book does have is its own indexed pages, and those say plainly what the
   * book is. Page one is usually a cover, so this starts a little way in and
   * takes pages with real text on them.
   */
  evidenceFor(book) {
    if (book.description && book.description.trim().length >= 80) {
      return { text: book.description.trim().slice(0, 900), source: 'description' };
    }

    /*
     * Sampled across the book rather than from the front. The front of the
     * erotica in this library is a contents page and a wall of review quotes,
     * which reads like any other book's front matter; a quarter and a half of
     * the way in is the book itself.
     */
    const pages = db.prepare(
      `SELECT content, page_number FROM book_pages
        WHERE book_id = ? AND word_count > 60
        ORDER BY page_number`
    ).all(book.id);

    if (!pages.length) return null;

    const picks = [...new Set([0.25, 0.5, 0.75].map(
      (at) => Math.min(pages.length - 1, Math.floor(pages.length * at))
    ))].map((i) => pages[i]);

    const text = picks
      .map((p) => p.content.replace(/\s+/g, ' ').trim())
      .join('\n\n');

    return text.length >= 200
      ? { text: text.slice(0, 2400), source: 'pages' }
      : null;
  }

  async assessAdult(book) {
    const evidence = this.evidenceFor(book);
    if (!evidence) return { adult: false, why: '', insufficientEvidence: true };

    const label = evidence.source === 'description' ? 'Description' : 'Opening pages';

    const prompt =
      `Book:\nTitle: ${book.title || 'Unknown'}` +
      `${book.author ? `\nAuthor: ${book.author}` : ''}` +
      `${book.publisher ? `\nPublisher: ${book.publisher}` : ''}\n` +
      `${label}:\n"""\n${evidence.text}\n"""\n\n` +
      `Is this book sexually explicit adult material — erotica, or an explicit ` +
      `sex manual — such that someone would want it hidden from a shared screen?\n\n` +
      `Judge only from the text above. Infer nothing from the title: words like ` +
      `"extreme", "bite", "pleasure" or "desire" mean nothing on their own.\n` +
      `Answer true if the text is sexually explicit, or gives explicit ` +
      `practical instruction in sex — a how-to for sex, sex toys or fetish ` +
      `practice is adult material even when its tone is friendly and matter ` +
      `of fact.\n` +
      `Answer false for anything non-sexual, and for books that discuss sex, ` +
      `relationships, anatomy, health or gender academically, clinically or ` +
      `sociologically without explicit content.\n\n` +
      `Reply as JSON: {"adult": true, "why": "under ten words"}`;

    /*
     * Both models have to say yes. Alone, the small one occasionally returns
     * a true whose own stated reason contradicts it — a Git book flagged over
     * the word "merge", a corporate responsibility book flagged with the
     * reason "focuses on corporate responsibility, not sexual content". The
     * larger model does not make those, and asking both costs a second.
     *
     * Generous token budget on both: at 120 the reply ran out mid-sentence on
     * seven books in a hundred and sixty, and an unparseable reply is a book
     * that never gets judged.
     */
    const [first, second] = await Promise.all([
      ollama.generateJSON(prompt, ADULT_SCHEMA, { model: ADULT_MODEL, maxTokens: 300 }),
      ollama.generateJSON(prompt, ADULT_SCHEMA, { model: ADULT_VERIFY_MODEL, maxTokens: 300 })
    ]);

    if (!first && !second) return null;                 // no usable answer

    const agreed = Boolean(first?.adult) && Boolean(second?.adult);
    return { adult: agreed, why: first?.why || second?.why || '' };
  }

  /**
   * Record an assessment. Only ever raises the flag, never lowers it: a
   * judgement the user has already made — by ticking the box, or by any other
   * means — outranks the model's, and disagreements here are genuine. On the
   * relationship titles in one publisher's bundle the model said no where a
   * person might well say yes.
   */
  recordAdult(bookId, isAdult) {
    if (isAdult) {
      db.prepare('UPDATE books SET is_adult = 1, adult_checked = 1 WHERE id = ?').run(bookId);
    } else {
      db.prepare('UPDATE books SET adult_checked = 1 WHERE id = ?').run(bookId);
    }
  }

  static ASSESSABLE = 'adult_checked = 0 AND needs_review = 0';

  /*
   * Books never assessed. Whether there is enough text to judge one is
   * decided per book by evidenceFor(); a book with nothing readable is left
   * unassessed rather than marked checked, so it becomes eligible by itself
   * once indexing or enrichment gives it something to read.
   */
  unassessedBooks(limit) {
    const rows = db.prepare(
      `SELECT * FROM books WHERE ${AiTagger.ASSESSABLE} ORDER BY id LIMIT ?`
    ).all(limit * 4);

    return rows.filter((b) => !this.unassessable.has(b.id)).slice(0, limit);
  }

  countUnassessed() {
    const total = db.prepare(
      `SELECT COUNT(*) AS count FROM books WHERE ${AiTagger.ASSESSABLE}`
    ).get().count;

    return Math.max(0, total - this.unassessable.size);
  }

  /** Assess a batch, returning what it flagged so a caller can report it. */
  async assessUnassessed(limit = 25, onFlag) {
    const books = this.unassessedBooks(limit);
    const result = { assessed: 0, flagged: 0 };
    let failures = 0;

    for (const book of books) {
      const verdict = await this.assessAdult(book);

      // A truncated or unparseable reply is one bad answer, not a dead model,
      // and stopping on the first one ended an entire pass mid-library.
      if (!verdict) {
        if (++failures >= 3) break;
        continue;
      }
      failures = 0;

      if (verdict.insufficientEvidence) {      // nothing to read yet
        this.unassessable.add(book.id);
        continue;
      }

      this.recordAdult(book.id, verdict.adult);
      result.assessed++;

      if (verdict.adult && !book.is_adult) {
        result.flagged++;
        if (onFlag) onFlag({ book, why: verdict.why });
      }
    }

    return result;
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

  /** Books with no tags yet that have not already been tried this run. */
  untaggedBooks(limit) {
    const rows = db.prepare(`
      SELECT b.* FROM books b
      LEFT JOIN book_tags bt ON bt.book_id = b.id
      WHERE bt.book_id IS NULL
        AND b.needs_review = 0
      ORDER BY b.id
    `).all();

    const fresh = [];
    for (const book of rows) {
      if (this.attempted.has(book.id)) continue;
      fresh.push(book);
      if (fresh.length >= limit) break;
    }

    return fresh;
  }

  /** How many books are still worth attempting. */
  countTaggable() {
    return db.prepare(`
      SELECT b.id FROM books b
      LEFT JOIN book_tags bt ON bt.book_id = b.id
      WHERE bt.book_id IS NULL AND b.needs_review = 0
    `).all().filter((row) => !this.attempted.has(row.id)).length;
  }

  /** Forget what has been tried, so everything is reconsidered. */
  resetAttempts() {
    this.attempted.clear();
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
      this.attempted.add(book.id);

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
      untagged: this.countUntagged(),
      taggable: this.countTaggable()
    };
  }
}

module.exports = new AiTagger();
