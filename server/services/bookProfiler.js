const crypto = require('crypto');
const { db } = require('../database/init');
const ollama = require('./ollamaClient');

/**
 * A reader's profile of each book: how hard it is, who it is for, what it
 * assumes and what it covers. The library chat orders reading paths by it.
 *
 * Nothing else in the catalog says how hard a book is, and half the books
 * have no description, so the model reads the opening pages — table of
 * contents, preface, "who this book is for" — which say more about a book's
 * level than its title does.
 */

const MODEL = process.env.PROFILE_MODEL || ollama.model;

// Bump when the prompt or the input changes. Stored with each profile, so
// the background sweep re-profiles whatever an older model or prompt made.
const PROMPT_VERSION = 1;
const PROFILE_KEY = `${MODEL}#profile-v${PROMPT_VERSION}`;

const OPENING_PAGES = 15;
const OPENING_CHARS = 6000;
const PAGE_CHARS = 1500;

const KINDS = ['intro', 'tutorial', 'practical', 'reference', 'cookbook', 'deep-dive', 'internals', 'other'];

// Subjects the user reads for work come first in the sweep; a novel can wait.
const LEISURE_TAGS = [
  'fiction', 'self-help', 'psychology', 'philosophy', 'history', 'health',
  'cooking', 'art', 'writing', 'productivity', 'career', 'education'
];

const SCHEMA = {
  type: 'object',
  properties: {
    level: { type: 'integer', minimum: 1, maximum: 5 },
    audience: { type: 'string' },
    prerequisites: { type: 'array', items: { type: 'string' } },
    topics: { type: 'array', items: { type: 'string' } },
    kind: { type: 'string', enum: KINDS },
    summary: { type: 'string' }
  },
  required: ['level', 'audience', 'prerequisites', 'topics', 'kind', 'summary']
};

const SYSTEM = `You catalogue books for a personal library. From a book's details and its opening pages, judge how demanding it is for a reader new to its subject.

level, 1 to 5, relative to the book's own subject:
1 = first contact: assumes nothing; a gentle introduction ("first steps", "Первое знакомство", "for absolute beginners").
2 = beginner: teaches the basics, assumes general computer or reading literacy.
3 = intermediate: assumes working knowledge; practical depth ("for those who want to become a professional", "Для тех, кто хочет стать профессионалом" is 3 or 4).
4 = advanced: for experienced practitioners; tuning, design at scale, administration, optimisation.
5 = expert: internals, source-level or research ("internals", "изнутри", "under the hood").
For non-technical books use the same scale: a popular book is 1-2, a textbook 3, an academic monograph 5.

kind: intro, tutorial (step by step), practical (applied, by example), reference, cookbook (recipes), deep-dive, internals, or other.
audience: who it is written for, a few words.
prerequisites: what a reader should already know, 0-4 short noun phrases.
topics: 3-8 short noun phrases for what it covers.
Write audience, prerequisites, topics and summary in English, whatever the book's language. summary is one sentence.
Judge from the evidence; a title alone rarely settles the level, the contents and preface usually do.`;

class BookProfiler {
  constructor() {
    this.initializeTable();
  }

  initializeTable() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS book_profiles (
        book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
        level INTEGER,
        audience TEXT,
        prerequisites TEXT,
        topics TEXT,
        kind TEXT,
        summary TEXT,
        model_name TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  /** The opening pages, trimmed: where the contents and preface are. */
  openingText(bookId) {
    const pages = db.prepare(`
      SELECT content FROM book_pages
      WHERE book_id = ? AND content IS NOT NULL
      ORDER BY page_number LIMIT ?
    `).all(Number(bookId), OPENING_PAGES);

    let text = '';
    for (const { content } of pages) {
      const page = content.replace(/\s+/g, ' ').trim();
      // Covers, blank versos and copyright pages say nothing about level.
      if (page.length < 80) continue;
      text += page.slice(0, PAGE_CHARS) + '\n';
      if (text.length >= OPENING_CHARS) break;
    }
    return text.slice(0, OPENING_CHARS).trim();
  }

  buildPrompt(book, tags = [], opening = '') {
    const lines = [
      `Title: ${book.title || 'unknown'}`,
      book.author && `Author: ${book.author}`,
      book.publication_year && `Year: ${book.publication_year}`,
      book.page_count && `Pages: ${book.page_count}`,
      book.language && `Language: ${book.language}`,
      tags.length && `Subjects: ${tags.join(', ')}`,
      book.description && `Description: ${book.description}`,
      opening && `Opening pages:\n${opening}`
    ];
    return lines.filter(Boolean).join('\n');
  }

  /** Model output, checked: a profile either makes sense or is not stored. */
  normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const level = Math.round(Number(raw.level));
    if (!(level >= 1 && level <= 5)) return null;

    const list = (value, max) => (Array.isArray(value) ? value : [])
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, max);

    return {
      level,
      audience: String(raw.audience || '').trim().slice(0, 200),
      prerequisites: list(raw.prerequisites, 4),
      topics: list(raw.topics, 8),
      kind: KINDS.includes(raw.kind) ? raw.kind : 'other',
      summary: String(raw.summary || '').trim().slice(0, 400)
    };
  }

  /**
   * Profile one book. Returns the profile, or null when the model gave nothing
   * usable; that is recorded too (with no level), so a book the model cannot
   * read is not retried on every pass. Throws when Ollama is unreachable, so
   * a stopped server never marks books as failed.
   */
  async profileBook(bookId) {
    const book = db.prepare(`
      SELECT id, title, author, publication_year, page_count, language, description
      FROM books WHERE id = ?
    `).get(Number(bookId));
    if (!book) return null;

    const tags = db.prepare(`
      SELECT t.name FROM book_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.book_id = ?
    `).all(book.id).map((t) => t.name);

    const prompt = this.buildPrompt(book, tags, this.openingText(book.id));

    if (!(await ollama.isAvailable())) throw new Error('Ollama is not reachable');
    const profile = this.normalize(await ollama.generateJSON(prompt, SCHEMA, {
      model: MODEL,
      system: SYSTEM,
      maxTokens: 400
    }));

    this.save(book.id, profile, crypto.createHash('sha1').update(prompt).digest('hex'));
    return profile;
  }

  save(bookId, profile, inputHash) {
    db.prepare(`
      INSERT OR REPLACE INTO book_profiles
        (book_id, level, audience, prerequisites, topics, kind, summary, model_name, input_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      bookId,
      profile?.level ?? null,
      profile?.audience ?? null,
      profile ? JSON.stringify(profile.prerequisites) : null,
      profile ? JSON.stringify(profile.topics) : null,
      profile?.kind ?? null,
      profile?.summary ?? null,
      PROFILE_KEY,
      inputHash
    );
  }

  /**
   * Books with no profile from the current model and prompt. Books being
   * read come first, then work subjects, then the rest.
   */
  pendingBooks(limit = -1) {
    const leisure = LEISURE_TAGS.map(() => '?').join(', ');
    return db.prepare(`
      SELECT b.id FROM books b
      LEFT JOIN book_profiles p ON p.book_id = b.id
      WHERE p.book_id IS NULL OR p.model_name != ?
      ORDER BY
        EXISTS (SELECT 1 FROM reading_progress rp WHERE rp.book_id = b.id) DESC,
        EXISTS (
          SELECT 1 FROM book_tags bt JOIN tags t ON t.id = bt.tag_id
          WHERE bt.book_id = b.id AND t.name NOT IN (${leisure})
        ) DESC,
        b.id
      LIMIT ?
    `).all(PROFILE_KEY, ...LEISURE_TAGS, limit);
  }

  countPending() {
    return db.prepare(`
      SELECT COUNT(*) AS n FROM books b
      LEFT JOIN book_profiles p ON p.book_id = b.id
      WHERE p.book_id IS NULL OR p.model_name != ?
    `).get(PROFILE_KEY).n;
  }

  /** How many books have a usable profile from the current model and prompt. */
  countProfiled() {
    return db.prepare(
      'SELECT COUNT(*) AS n FROM book_profiles WHERE model_name = ? AND level IS NOT NULL'
    ).get(PROFILE_KEY).n;
  }

  /** Stored profiles for the given books, by id, parsed. */
  profilesFor(bookIds) {
    if (bookIds.length === 0) return new Map();
    const rows = db.prepare(`
      SELECT * FROM book_profiles
      WHERE level IS NOT NULL AND book_id IN (${bookIds.map(() => '?').join(', ')})
    `).all(...bookIds.map(Number));

    return new Map(rows.map((row) => [row.book_id, {
      level: row.level,
      audience: row.audience,
      prerequisites: JSON.parse(row.prerequisites || '[]'),
      topics: JSON.parse(row.topics || '[]'),
      kind: row.kind,
      summary: row.summary
    }]));
  }
}

module.exports = new BookProfiler();
module.exports.PROFILE_KEY = PROFILE_KEY;
module.exports.KINDS = KINDS;
