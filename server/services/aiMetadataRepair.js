/**
 * Metadata repairs that need judgement rather than a pattern.
 *
 * The regex extractors and the ISBN lookups have taken the library as far as
 * they can. What is left needs reading: a filename with its spaces stripped is
 * only a title if you know where the words end, and an author is only on the
 * front matter if you can tell a name from a publisher's address block. Both
 * run on the local model, so this costs nothing and works offline.
 */

const { db } = require('../database/init');
const ollama = require('./ollamaClient');
const quality = require('./metadataQuality');

const PRIMARY_MODEL = process.env.OLLAMA_MODEL || 'gemma3:4b';
// A different model checks the segmentation. Any second model does; this one
// is a mixture-of-experts, so it is quick despite its size.
const SECOND_OPINION = process.env.OLLAMA_VERIFY_MODEL || 'qwen3.6:35b-a3b';

const TITLE_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' } },
  required: ['title']
};

const AUTHOR_SCHEMA = {
  type: 'object',
  properties: { author: { type: ['string', 'null'] } },
  required: ['author']
};

/** A single run-together word long enough that it must be a stripped filename. */
const isSlug = (title) =>
  Boolean(title) && title.split(/\s+/).some((w) => w.length > 18 && /^[a-z]+$/i.test(w));

class AiMetadataRepair {
  segmentPrompt(title) {
    return `Insert spaces into this run-together string so it reads as words:
"${title}"

This is pure segmentation. Copy every letter and digit exactly, in the same
order. Add nothing: no extra words, no subtitle, no punctuation beyond what
separating the words needs. You may change capitalisation.
If it cannot be split into ordinary words, return it unchanged.

Reply as JSON: {"title": "..."}`;
  }

  /**
   * Restore the spacing in a title that came from a filename.
   *
   * Two guards, because the failures here are confident ones. Comparing
   * letters catches invention and translation — "ProgrNaPythonvPrimer" came
   * back as "Programming in Python: A Primer", which is a guess, and
   * "aiforcreativeproduction" as "A Guide for Creative Production", which
   * misreads "ai" as "a". But that check passes anything with the right
   * letters in the wrong places, and one model split the same title as
   * "a if or creative production".
   *
   * So a second model has to agree. Where they disagree it is because one of
   * them is wrong — "power business solutions" against "power bi solutions" —
   * and the title is left alone. A recognisably broken title is easier to live
   * with, and to spot, than a plausible wrong one.
   */
  async repairTitle(book) {
    if (!isSlug(book.title)) return null;

    const prompt = this.segmentPrompt(book.title);
    const [first, second] = await Promise.all([
      ollama.generateJSON(prompt, TITLE_SCHEMA, { model: PRIMARY_MODEL, maxTokens: 64 }),
      ollama.generateJSON(prompt, TITLE_SCHEMA, { model: SECOND_OPINION, maxTokens: 64 })
    ]);

    const proposed = quality.cleanTitle(first?.title);
    if (!proposed || !quality.isPlausibleTitle(proposed)) return null;

    // Same letters, in the same order.
    const letters = (value) => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (letters(proposed) !== letters(book.title)) return null;

    // Same words, from a second model.
    const words = (value) => (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (words(proposed) !== words(second?.title)) return null;

    // And it has to actually be a change.
    if (words(proposed) === words(book.title)) return null;

    return proposed;
  }

  /** The opening pages of a book, which is where the author is named. */
  frontMatter(bookId, chars = 1500) {
    try {
      const pages = db.prepare(`
        SELECT content FROM book_pages
        WHERE book_id = ? AND content IS NOT NULL
        ORDER BY page_number
        LIMIT 3
      `).all(bookId);

      const text = pages.map((p) => p.content).join('\n').replace(/\s+/g, ' ').trim();
      return text.length > 40 ? text.slice(0, chars) : null;
    } catch {
      return null;
    }
  }

  /**
   * Read the author off the front matter. The same quality check the rest of
   * the pipeline uses is applied to the answer, so a publisher or a city list
   * is rejected here exactly as it would be from the regex extractor.
   */
  async repairAuthor(book) {
    if (quality.isPlausibleAuthor(book.author, { title: book.title })) return null;

    const text = this.frontMatter(book.id);
    if (!text) return null;

    const result = await ollama.generateJSON(
      `Front matter of a book titled "${book.title || 'unknown'}":\n\n${text}\n\n` +
      `Who wrote it? Give the author's name only — not the publisher, translator, ` +
      `editor or series. Answer null if the text does not name an author. Do not guess.\n` +
      `Reply as JSON: {"author": "..."}`,
      AUTHOR_SCHEMA,
      { maxTokens: 48 }
    );

    return quality.cleanAuthor(result?.author, { title: book.title });
  }

  booksWithSlugTitles() {
    return db.prepare('SELECT id, title FROM books').all().filter((b) => isSlug(b.title));
  }

  booksMissingAuthor() {
    return db.prepare(`
      SELECT b.id, b.title, b.author FROM books b
      WHERE EXISTS (SELECT 1 FROM book_pages p WHERE p.book_id = b.id AND p.content IS NOT NULL)
    `).all().filter((b) => !quality.isPlausibleAuthor(b.author, { title: b.title }));
  }

  async run({ limit = Infinity, onProgress } = {}) {
    const stats = { titles: 0, authors: 0, titleRejected: 0, authorRejected: 0 };

    const updateTitle = db.prepare('UPDATE books SET title = ? WHERE id = ?');
    const updateAuthor = db.prepare('UPDATE books SET author = ? WHERE id = ?');

    for (const book of this.booksWithSlugTitles().slice(0, limit)) {
      const title = await this.repairTitle(book);
      if (!title) { stats.titleRejected++; continue; }

      updateTitle.run(title, book.id);
      stats.titles++;
      if (onProgress) onProgress({ kind: 'title', from: book.title, to: title });
    }

    for (const book of this.booksMissingAuthor().slice(0, limit)) {
      const author = await this.repairAuthor(book);
      if (!author) { stats.authorRejected++; continue; }

      updateAuthor.run(author, book.id);
      stats.authors++;
      if (onProgress) onProgress({ kind: 'author', title: book.title, to: author });
    }

    return stats;
  }
}

module.exports = new AiMetadataRepair();
module.exports.isSlug = isSlug;
