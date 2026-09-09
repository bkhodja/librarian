/**
 * How does my library explain X?
 *
 * A chatbot can explain decorators. What it cannot do is tell you how the
 * eight books on your own shelf explain them, which one gets to the point,
 * and which one you should actually open. That needs the shelf, and the shelf
 * is already indexed page by page.
 *
 * So: find the books that genuinely cover the topic, pull the single best
 * passage out of each, and put them side by side with the page numbers. The
 * model's only job is to characterise each passage in a line. Everything the
 * reader is shown as text from a book is text from a book — retrieved, never
 * generated — and the passages appear with the model switched off entirely.
 */

const { db } = require('../database/init');
const ollama = require('./ollamaClient');
const { toMatchQuery, toTerms } = require('./ftsQuery');
const duplicates = require('./duplicateDetector');

// How deep to look before deciding which books cover the topic. A book that
// discusses it across thirty pages is a better answer than one that mentions
// it once, and that only shows up if enough of the tail is read.
const CANDIDATE_PAGES = Number(process.env.COMPARE_CANDIDATE_PAGES) || 600;
const DEFAULT_BOOKS = Number(process.env.COMPARE_BOOKS) || 6;
const PASSAGE_CHARS = Number(process.env.COMPARE_PASSAGE_CHARS) || 1600;

const ANGLE_SCHEMA = {
  type: 'object',
  properties: {
    angle: { type: 'string' },
    quote: { type: 'string' }
  },
  required: ['angle']
};

const CONTRAST_SCHEMA = {
  type: 'object',
  properties: { contrast: { type: 'string' } },
  required: ['contrast']
};

const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();

class CrossBookCompare {
  /**
   * Candidate pages across the whole library.
   *
   * The filtering happens here in JavaScript rather than as a join, because
   * pages_fts.book_id is an UNINDEXED column with no type affinity — it has
   * already cost this codebase one silent empty-result bug, and a few hundred
   * rows are not worth risking a second.
   */
  candidates(topic) {
    const match = toMatchQuery(topic);
    if (!match) return [];

    try {
      return db.prepare(`
        SELECT book_id, page_number, content
        FROM pages_fts
        WHERE pages_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(match, CANDIDATE_PAGES);
    } catch (error) {
      console.error(`Cross-book retrieval failed: ${error.message}`);
      return [];
    }
  }

  /** Which books cover this topic, best first. */
  rank(topic, { limit = DEFAULT_BOOKS, tag = null, language = null, includeAdult = false } = {}) {
    const pages = this.candidates(topic);
    if (pages.length === 0) return [];

    const books = new Map();

    pages.forEach((page, position) => {
      const id = Number(page.book_id);
      const existing = books.get(id);

      if (existing) {
        existing.matches++;
      } else {
        books.set(id, {
          bookId: id,
          matches: 1,
          bestPosition: position,
          page: page.page_number,
          content: page.content
        });
      }
    });

    const ids = [...books.keys()];
    if (ids.length === 0) return [];

    const rows = db.prepare(
      `SELECT id, title, author, language, file_path, is_adult, page_count
         FROM books WHERE id IN (${ids.map(() => '?').join(',')})`
    ).all(...ids);

    const meta = new Map(rows.map((r) => [r.id, r]));

    const tagged = tag
      ? new Set(db.prepare(
          `SELECT bt.book_id AS id FROM book_tags bt
             JOIN tags t ON t.id = bt.tag_id WHERE t.name = ?`
        ).all(tag).map((r) => r.id))
      : null;

    return [...books.values()]
      .map((entry) => ({ ...entry, book: meta.get(entry.bookId) }))
      .filter(({ book }) => {
        if (!book) return false;
        if (!includeAdult && book.is_adult) return false;
        if (language && book.language !== language) return false;
        if (tagged && !tagged.has(book.id)) return false;
        return true;
      })
      /*
       * Breadth first, then position. A book with forty matching pages is
       * teaching the topic; a book whose single best page happens to rank
       * highest may only be mentioning it in passing. Where two books cover
       * it equally, the one whose best page ranked higher wins.
       */
      .sort((a, b) => (b.matches - a.matches) || (a.bestPosition - b.bestPosition))
      .filter(this.distinctTitles())
      .slice(0, limit);
  }

  /*
   * Six slots, six different books. The library holds the same title more
   * than once often enough — "Learning Python" and "Lutz Mark - Learning
   * Python, 6th Edition" are one book — and a comparison that fills two
   * columns with the same text has wasted a third of the screen. The same
   * similarity used by duplicate detection decides it, at a lower threshold,
   * because here a false pairing costs one book on a list rather than a
   * merge.
   */
  distinctTitles(threshold = 0.75) {
    const kept = [];

    return ({ book }) => {
      const title = duplicates.normalizeTitle(book.title || '');
      if (!title) return true;

      const seen = kept.some((other) =>
        duplicates.similarity(title, other) >= threshold ||
        (title.length > 12 && other.length > 12 &&
          (title.includes(other) || other.includes(title))));

      if (seen) return false;
      kept.push(title);
      return true;
    };
  }

  /**
   * Ask the model what this book's angle on the topic is.
   *
   * It is given one passage and asked for one line about it, which is close
   * to the smallest job a 4B model can be given. The quote it picks is
   * checked against the passage and dropped if it is not there, so a quotation
   * mark on this screen always means the book said it.
   */
  async characterise(topic, entry, insist = false) {
    const passage = normalize(entry.content).slice(0, PASSAGE_CHARS);

    const result = await ollama.generateJSON(
      `Passage from "${entry.book.title}"${entry.book.author ? ` by ${entry.book.author}` : ''}, page ${entry.page}:\n\n` +
      `"""\n${passage}\n"""\n\n` +
      `Topic: ${topic}\n\n` +
      `In one sentence, how does this passage approach the topic? Say what ` +
      `kind of treatment it is — worked example, formal definition, analogy, ` +
      `reference material, war story — and what it emphasises. Do not ` +
      `summarise the topic itself; describe this book's handling of it.\n` +
      `Then copy one short sentence from the passage, word for word, that ` +
      `best shows that treatment.\n` +
      (insist ? `Write a full sentence of at least fifteen words. "Worked ` +
        `example" on its own is a label, not an answer.\n` : '') +
      `\nReply as JSON: {"angle": "one sentence", "quote": "copied word for word"}`,
      ANGLE_SCHEMA,
      { maxTokens: 220, temperature: insist ? 0.4 : 0.2 }
    );

    if (!result) return { angle: null, quote: null };

    /*
     * Asked how a book treats a topic, the model sometimes answers "worked
     * example" and stops. That is a category, not a comparison, and six of
     * them side by side tell the reader nothing. One nudge is usually enough;
     * whatever comes back second is kept either way.
     */
    if (!insist && normalize(result.angle).length < 45) {
      const retry = await this.characterise(topic, entry, true);
      if (retry.angle && retry.angle.length > normalize(result.angle).length) return retry;
    }

    // Word for word, or not at all.
    const haystack = normalize(entry.content).toLowerCase();
    const quote = normalize(result.quote);
    const verified = quote.length >= 20 &&
      haystack.includes(quote.toLowerCase()) &&
      this.legible(quote);

    return {
      angle: normalize(result.angle) || null,
      quote: verified ? quote : null
    };
  }

  /*
   * Not every sentence on a page is a sentence. OCR on a page of equations
   * produces runs of mojibake — one book offered "餅餅 髮髮가? = 餅餅 髮髮" as
   * its best line — and because that really is what the page says, the
   * word-for-word check passes it happily. A quote is meant to be the line
   * worth reading, so it has to be mostly readable words.
   */
  legible(text) {
    const readable = (text.match(/[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}0-9\s.,;:'"()-]/gu) || []).length;
    return readable / text.length >= 0.85;
  }

  /**
   * One paragraph on how the treatments differ.
   *
   * Written from the per-book characterisations rather than from the books,
   * so it inherits their grounding and cannot reach past them. Skipped
   * entirely when fewer than two books have been characterised, because
   * there is nothing to contrast.
   */
  async contrast(topic, entries) {
    const described = entries.filter((e) => e.angle);
    if (described.length < 2) return null;

    const list = described
      .map((e, i) => `${i + 1}. "${e.title}"${e.author ? ` by ${e.author}` : ''} — ${e.angle}`)
      .join('\n');

    const result = await ollama.generateJSON(
      `These books each cover "${topic}":\n\n${list}\n\n` +
      `In two or three sentences, how do their treatments differ, and which ` +
      `would suit someone meeting the topic for the first time? Refer to the ` +
      `books by title. Use only what is written above.\n\n` +
      `Reply as JSON: {"contrast": "..."}`,
      CONTRAST_SCHEMA,
      { maxTokens: 300, temperature: 0.3 }
    );

    return result?.contrast ? normalize(result.contrast) : null;
  }

  /** An excerpt for display, wound back to a sentence boundary where possible. */
  excerpt(content, topic, length = 420) {
    const text = normalize(content);
    const terms = toTerms(topic);

    // Start where the topic is actually discussed rather than at the top of
    // the page, which is often the tail of the previous paragraph.
    let start = 0;
    for (const term of terms) {
      const at = text.toLowerCase().indexOf(term);
      if (at > -1) { start = Math.max(0, at - 120); break; }
    }

    if (start > 0) {
      const boundary = text.slice(start, start + 200).search(/[.!?]\s+[A-ZА-Я]/);
      if (boundary > -1) start += boundary + 2;
    }

    const slice = text.slice(start, start + length);
    return (start > 0 ? '…' : '') + slice + (start + length < text.length ? '…' : '');
  }

  /**
   * The comparison. Retrieval alone is useful, so this returns the passages
   * whether or not the model is running, and says which it was.
   */
  async compare(topic, options = {}) {
    const ranked = this.rank(topic, options);

    if (ranked.length === 0) {
      return { topic, books: [], contrast: null, modelUsed: false };
    }

    const modelUp = await ollama.isAvailable();

    const books = [];
    for (const entry of ranked) {
      const described = modelUp
        ? await this.characterise(topic, entry)
        : { angle: null, quote: null };

      books.push({
        id: entry.book.id,
        title: entry.book.title,
        author: entry.book.author,
        language: entry.book.language,
        filePath: entry.book.file_path,
        pageCount: entry.book.page_count,
        page: entry.page,
        matches: entry.matches,
        excerpt: this.excerpt(entry.content, topic),
        angle: described.angle,
        quote: described.quote
      });
    }

    return {
      topic,
      books,
      contrast: modelUp ? await this.contrast(topic, books) : null,
      modelUsed: modelUp
    };
  }
}

module.exports = new CrossBookCompare();
