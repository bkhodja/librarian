/**
 * Answering questions about a book from its own pages.
 *
 * The library already holds a page-level full-text index, so the retrieval
 * half of this is a query rather than a new pipeline: find the pages that
 * discuss the question, then let the local model read those pages and answer
 * from them. Nothing is sent anywhere, and the answer cites the pages it came
 * from so it can be checked against the book.
 */

const { db } = require('../database/init');
const ollama = require('./ollamaClient');

const MAX_PAGES = Number(process.env.QA_MAX_PAGES) || 6;
const PAGE_CHARS = Number(process.env.QA_PAGE_CHARS) || 1800;

const SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    pages: { type: 'array', items: { type: 'integer' } },
    grounded: { type: 'boolean' }
  },
  required: ['answer', 'grounded']
};

/**
 * FTS5 treats punctuation and bare words as operators, so a question typed as
 * prose has to be reduced to terms before it can be matched.
 */
function toMatchQuery(question) {
  const stop = new Set([
    'what', 'when', 'where', 'which', 'who', 'why', 'how', 'does', 'do', 'did',
    'is', 'are', 'was', 'were', 'the', 'a', 'an', 'of', 'in', 'on', 'for', 'to',
    'and', 'or', 'this', 'that', 'it', 'about', 'say', 'says', 'book', 'tell',
    'me', 'explain', 'describe', 'can', 'you', 'i', 'with', 'from', 'as', 'at'
  ]);

  const terms = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));

  if (terms.length === 0) return null;

  // OR rather than AND: a page discussing most of the question is still the
  // page wanted, and FTS5 ranks the fuller matches higher anyway.
  return terms.map((t) => `"${t}"`).join(' OR ');
}

class BookQA {
  /**
   * Ids arrive from the URL as strings. book_pages.book_id has integer
   * affinity so a string coerces there, but pages_fts.book_id is an FTS5
   * UNINDEXED column with no affinity at all, where '123' matches nothing and
   * the search silently returns no pages.
   */
  toId(bookId) {
    return Number(bookId);
  }

  hasPages(bookId) {
    return Boolean(db.prepare(
      'SELECT 1 FROM book_pages WHERE book_id = ? AND content IS NOT NULL LIMIT 1'
    ).get(this.toId(bookId)));
  }

  /** The pages of one book that best match the question. */
  retrieve(bookId, question, limit = MAX_PAGES) {
    const match = toMatchQuery(question);
    if (!match) return [];

    try {
      return db.prepare(`
        SELECT page_number, content
        FROM pages_fts
        WHERE book_id = ? AND pages_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(this.toId(bookId), match, limit);
    } catch (error) {
      console.error(`Page retrieval failed for book ${bookId}: ${error.message}`);
      return [];
    }
  }

  async ask(bookId, question) {
    const book = db.prepare('SELECT id, title, author FROM books WHERE id = ?').get(this.toId(bookId));
    if (!book) throw new Error(`Book ${bookId} not found`);

    if (!this.hasPages(bookId)) {
      return {
        answer: null,
        reason: 'This book\'s pages have not been indexed, so there is nothing to read.',
        pages: []
      };
    }

    const pages = this.retrieve(bookId, question);
    if (pages.length === 0) {
      return {
        answer: null,
        reason: 'Nothing in this book matches that question.',
        pages: []
      };
    }

    const excerpts = pages
      .map((p) => `[page ${p.page_number}]\n${p.content.replace(/\s+/g, ' ').slice(0, PAGE_CHARS)}`)
      .join('\n\n');

    const result = await ollama.generateJSON(
      `Passages from "${book.title}"${book.author ? ` by ${book.author}` : ''}:\n\n${excerpts}\n\n` +
      `Question: ${question}\n\n` +
      `Answer using only these passages. Cite the page numbers you used.\n` +
      `If the passages do not answer the question, say so plainly and set ` +
      `grounded to false rather than answering from general knowledge.\n\n` +
      `Reply as JSON: {"answer": "...", "pages": [12, 34], "grounded": true}`,
      SCHEMA,
      { maxTokens: 500, temperature: 0.2 }
    );

    if (!result?.answer) {
      return {
        answer: null,
        reason: 'The local model is not available.',
        pages: pages.map((p) => p.page_number)
      };
    }

    return {
      answer: result.answer.trim(),
      grounded: result.grounded !== false,
      // Only pages actually retrieved, so a hallucinated citation cannot point
      // the reader at a page the model never saw.
      pages: (result.pages || [])
        .filter((n) => pages.some((p) => p.page_number === n))
        .slice(0, MAX_PAGES),
      searched: pages.map((p) => p.page_number)
    };
  }
}

module.exports = new BookQA();
