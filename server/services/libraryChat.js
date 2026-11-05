const { db } = require('../database/init');
const ollama = require('./ollamaClient');
const embeddingService = require('./embeddingService');
const bookProfiler = require('./bookProfiler');
const duplicateDetector = require('./duplicateDetector');
const { toTerms } = require('./ftsQuery');

/**
 * Ask the Library: a conversation about the books on this machine.
 *
 * Each turn runs in three steps. The model first restates the question as
 * searches (in English and Russian, since most of the library is Russian).
 * Those searches find candidate books by meaning and by words. The model then
 * answers from compact cards for those books only — level, audience,
 * prerequisites, reading status — and cites them as [[book:ID]], which the
 * panel turns into links. A citation of any book not on the cards is removed.
 */

const MODEL = process.env.CHAT_MODEL || ollama.model;

const CANDIDATES = 25;
const PER_SEARCH = 40;
const HISTORY_MESSAGES = 10;
const STALLED_DAYS = 30;

const INTENTS = ['reading-path', 'recommend', 'find', 'about-book', 'library-stats', 'other'];

const UNDERSTAND_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: INTENTS },
    searchQueries: { type: 'array', items: { type: 'string' } },
    bookIds: { type: 'array', items: { type: 'integer' } }
  },
  required: ['intent', 'searchQueries', 'bookIds']
};

const UNDERSTAND_SYSTEM = `You turn a reader's message to their personal library assistant into searches over the library catalog.
intent: reading-path (what to read, in what order), recommend (suggest books), find (does the library have X), about-book (a question about specific books), library-stats (counts, what subjects the library holds), other.
searchQueries: 1-4 short topic phrases to look up, without filler words. The library is mostly Russian and English: give the main topic in both languages (e.g. "PostgreSQL", "Постгрес СУБД"). For a follow-up ("what next?", "something shorter"), search for the topic of the conversation.
bookIds: ids of books from earlier in the conversation that the message refers to, otherwise [].`;

const ANSWER_SYSTEM = `You are the reading guide for the user's personal library. You can only recommend books from the cards below — they are the books on the user's shelf that match the question. Never invent books, and never recommend a book that is not on a card.

Cite a book by writing its tag exactly as on its card, e.g. [[book:123]]. Every book you mention must be cited this way; the reader clicks the tag to open the book. Do not write the title next to the tag — the tag shows it.

Level is 1 (first contact) to 5 (internals/expert). When asked how to learn a subject, give a reading path: start with the easiest suitable book and move up step by step, saying in a line why each book comes next (what it adds, what it assumes). Choose 3-6 books; leave out weak matches rather than padding the list. When two cards are the same book, cite only one.
Use the reader's status: skip finished books (say they are done), suggest continuing a book in progress, and if they have read the basics, start them further along.
A card marked "level unknown" has no profile yet; judge from its title and description and say the level is a guess.
If no card fits, say plainly that the library has nothing on it.
Answer in the language of the user's message. Be concise: short paragraphs or a numbered list in Markdown, no tables.`;

class LibraryChat {
  constructor() {
    this.initializeTables();
  }

  initializeTables() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        book_ids TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id);
    `);
  }

  // ---- Conversations -------------------------------------------------------

  createConversation(firstMessage) {
    const title = firstMessage.replace(/\s+/g, ' ').trim();
    const { lastInsertRowid } = db.prepare('INSERT INTO chat_conversations (title) VALUES (?)')
      .run(title.length > 80 ? `${title.slice(0, 77)}…` : title);
    return Number(lastInsertRowid);
  }

  listConversations() {
    return db.prepare(`
      SELECT id, title, created_at, updated_at FROM chat_conversations
      ORDER BY updated_at DESC, id DESC
    `).all();
  }

  getConversation(id) {
    const conversation = db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(Number(id));
    if (!conversation) return null;

    const messages = db.prepare(`
      SELECT id, role, content, book_ids, created_at FROM chat_messages
      WHERE conversation_id = ? ORDER BY id
    `).all(conversation.id).map((m) => ({ ...m, book_ids: JSON.parse(m.book_ids || '[]') }));

    const cited = [...new Set(messages.flatMap((m) => m.book_ids))];
    return { ...conversation, messages, books: this.bookCards(cited) };
  }

  deleteConversation(id) {
    return db.prepare('DELETE FROM chat_conversations WHERE id = ?').run(Number(id)).changes > 0;
  }

  addMessage(conversationId, role, content, bookIds = []) {
    db.prepare(`
      INSERT INTO chat_messages (conversation_id, role, content, book_ids) VALUES (?, ?, ?, ?)
    `).run(conversationId, role, content, JSON.stringify(bookIds));
    db.prepare('UPDATE chat_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(conversationId);
  }

  history(conversationId) {
    return db.prepare(`
      SELECT role, content, book_ids FROM chat_messages
      WHERE conversation_id = ? ORDER BY id DESC LIMIT ?
    `).all(conversationId, HISTORY_MESSAGES).reverse()
      .map((m) => ({ ...m, book_ids: JSON.parse(m.book_ids || '[]') }));
  }

  // ---- Step 1: understand --------------------------------------------------

  async understand(message, history) {
    const context = history
      .map((m) => `${m.role}: ${m.content.slice(0, 600)}`)
      .join('\n');
    const reply = await ollama.chat([
      { role: 'system', content: UNDERSTAND_SYSTEM },
      { role: 'user', content: (context ? `Conversation so far:\n${context}\n\n` : '') + `Message: ${message}` }
    ], { model: MODEL, format: UNDERSTAND_SCHEMA, maxTokens: 200 });

    const queries = (reply?.searchQueries || [])
      .map((q) => String(q).trim())
      .filter(Boolean)
      .slice(0, 4);

    return {
      intent: INTENTS.includes(reply?.intent) ? reply.intent : 'other',
      // Without the model's restatement, search for the message itself.
      searchQueries: queries.length ? queries : [message],
      bookIds: (reply?.bookIds || []).map(Number).filter(Number.isInteger)
    };
  }

  // ---- Step 2: retrieve ----------------------------------------------------

  /**
   * Books whose title, author or description contain the query's words.
   * In JavaScript rather than SQL: LIKE folds case for ASCII only, and most
   * titles here are Cyrillic. Five thousand rows take a few milliseconds.
   */
  keywordSearch(query, limit = PER_SEARCH) {
    // A crude stem, so "PostgreSQL" finds "Postgres" and "обучение" finds
    // "обучения": Russian inflects every noun.
    const terms = [...new Set(toTerms(query).map((t) =>
      (t.length > 5 ? t.slice(0, Math.max(5, t.length - 3)) : t)))];
    if (terms.length === 0) return [];

    if (!this.catalog || Date.now() - this.catalogAt > 60000) {
      this.catalog = db.prepare('SELECT id, title, author, description FROM books').all()
        .map((b) => ({
          id: b.id,
          head: `${b.title || ''} ${b.author || ''}`.toLowerCase(),
          body: (b.description || '').toLowerCase()
        }));
      this.catalogAt = Date.now();
    }

    return this.catalog
      .map((b) => ({
        id: b.id,
        score: terms.reduce((sum, t) => sum + (b.head.includes(t) ? 2 : 0) + (b.body.includes(t) ? 1 : 0), 0)
      }))
      .filter((b) => b.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Candidates from every search, fused by rank (reciprocal rank fusion), so
   * a book found near the top by meaning and by words beats one found by
   * either alone. Books the conversation is about are kept whatever their rank.
   */
  async retrieve(searchQueries, pinnedIds = []) {
    const scores = new Map();
    const add = (id, rank) => scores.set(id, (scores.get(id) || 0) + 1 / (60 + rank));

    for (const query of searchQueries) {
      try {
        const semantic = await embeddingService.semanticSearch(query, { limit: PER_SEARCH, minSimilarity: 0.3 });
        semantic.forEach((b, rank) => add(b.id, rank));
      } catch (error) {
        console.error(`Library chat: semantic search failed: ${error.message}`);
      }
      this.keywordSearch(query).forEach((b, rank) => add(b.id, rank));
    }

    for (const id of pinnedIds) scores.set(id, (scores.get(id) || 0) + 1);

    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    // Ask for extra: collapsing copies shrinks the list.
    const cards = this.bookCards(ranked.slice(0, CANDIDATES * 2));
    return this.collapseCopies(cards).slice(0, CANDIDATES);
  }

  /** Everything the answer needs about each book, in the order given. */
  bookCards(ids) {
    ids = ids.map(Number).filter(Number.isInteger);
    if (ids.length === 0) return [];

    const marks = ids.map(() => '?').join(', ');
    const books = db.prepare(`
      SELECT b.id, b.title, b.author, b.publication_year, b.page_count, b.language,
             b.description, b.thumbnail_path, b.file_path, b.file_hash, b.file_size,
             rp.percentage, rp.finished_reading, rp.last_read, rp.current_page
      FROM books b LEFT JOIN reading_progress rp ON rp.book_id = b.id
      WHERE b.id IN (${marks})
    `).all(...ids);

    const tags = new Map();
    for (const row of db.prepare(`
      SELECT bt.book_id, t.name FROM book_tags bt JOIN tags t ON t.id = bt.tag_id
      WHERE bt.book_id IN (${marks})
    `).all(...ids)) {
      tags.set(row.book_id, [...(tags.get(row.book_id) || []), row.name]);
    }

    const profiles = bookProfiler.profilesFor(ids);
    const byId = new Map(books.map((b) => [b.id, {
      id: b.id,
      title: b.title,
      author: b.author,
      year: b.publication_year,
      pages: b.page_count,
      language: b.language,
      description: b.description,
      thumbnail_path: b.thumbnail_path,
      file_path: b.file_path,
      file_hash: b.file_hash,
      file_size: b.file_size,
      tags: tags.get(b.id) || [],
      profile: profiles.get(b.id) || null,
      status: this.readingStatus(b),
      copies: []
    }]));

    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  /** finished / reading N% / stalled N% / unread, from reading_progress. */
  readingStatus(row, now = Date.now()) {
    if (row.finished_reading || row.percentage >= 95) return { state: 'finished' };
    if (!row.percentage && !row.current_page) return { state: 'unread' };

    const percent = Math.round(row.percentage || 0);
    // SQLite's CURRENT_TIMESTAMP is UTC without a zone ("2026-03-01 10:00:00").
    const raw = String(row.last_read || '');
    const last = Date.parse(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
    const idleDays = Number.isNaN(last) ? Infinity : (now - last) / 86400000;
    return { state: idleDays > STALLED_DAYS ? 'stalled' : 'reading', percent };
  }

  /**
   * One card per book, however many copies are on disk: "PostgreSQL изнутри"
   * is here five times. The copy kept is the one being read, else one with a
   * profile (a copy without one gets left out of reading paths), else the
   * newest edition, else the first found.
   */
  collapseCopies(cards) {
    const groups = [];
    for (const card of cards) {
      const probe = { title: card.title, author: card.author, file_hash: card.file_hash, file_size: card.file_size, page_count: card.pages };
      const group = groups.find((g) =>
        duplicateDetector.compare({ ...g.probe }, { ...probe }) || this.sameTitleWithin(g.probe.title, probe.title));
      if (group) group.cards.push(card);
      else groups.push({ probe, cards: [card] });
    }

    return groups.map(({ cards: copies }) => {
      const keep = [...copies].sort((a, b) =>
        (b.status.state !== 'unread') - (a.status.state !== 'unread') ||
        Boolean(b.profile) - Boolean(a.profile) ||
        (b.year || 0) - (a.year || 0)
      )[0];
      return { ...keep, copies: copies.filter((c) => c !== keep).map((c) => c.id) };
    });
  }

  /**
   * One title inside the other: "Лузанов П, Рогов Е Postgres Первое знакомство"
   * is "Postgres. Первое знакомство" with the authors in front, which the
   * duplicate finder (comparing whole titles) does not catch. Short titles
   * never match this way: "PostgreSQL" is inside half the shelf.
   */
  sameTitleWithin(a, b) {
    const [shorter, longer] = [a, b]
      .map((t) => duplicateDetector.normalizeTitle(t))
      .sort((x, y) => x.length - y.length);
    if (shorter.length < 15 || !shorter.includes(' ')) return false;
    return ` ${longer} `.includes(` ${shorter} `);
  }

  // ---- Step 3: answer ------------------------------------------------------

  formatCard(card) {
    const facts = [
      card.author,
      card.year,
      card.pages && `${card.pages} pages`,
      card.language
    ].filter(Boolean).join(', ');

    const lines = [`[[book:${card.id}]] "${card.title}"${facts ? ` — ${facts}` : ''}`];
    const p = card.profile;
    if (p) {
      lines.push(`  level ${p.level}/5, ${p.kind}; for ${p.audience || 'general readers'}`);
      if (p.prerequisites.length) lines.push(`  assumes: ${p.prerequisites.join('; ')}`);
      if (p.topics.length) lines.push(`  covers: ${p.topics.join('; ')}`);
      if (p.summary) lines.push(`  ${p.summary}`);
    } else {
      lines.push('  level unknown (not profiled yet)');
      if (card.description) lines.push(`  ${card.description.replace(/\s+/g, ' ').slice(0, 300)}`);
    }
    if (card.tags.length) lines.push(`  subjects: ${card.tags.join(', ')}`);

    const s = card.status;
    lines.push(`  status: ${s.state === 'finished' ? 'finished'
      : s.state === 'reading' ? `reading, ${s.percent}% done`
      : s.state === 'stalled' ? `started, stopped at ${s.percent}%`
      : 'not started'}`);
    return lines.join('\n');
  }

  libraryOverview() {
    const total = db.prepare('SELECT COUNT(*) AS n FROM books').get().n;
    const subjects = db.prepare(`
      SELECT t.name, COUNT(*) AS n FROM book_tags bt JOIN tags t ON t.id = bt.tag_id
      GROUP BY t.name ORDER BY n DESC LIMIT 60
    `).all().map((t) => `${t.name} ${t.n}`).join(', ');
    const languages = db.prepare(`
      SELECT COALESCE(language, 'unknown') AS language, COUNT(*) AS n FROM books
      GROUP BY language ORDER BY n DESC LIMIT 8
    `).all().map((l) => `${l.language} ${l.n}`).join(', ');
    return `The library holds ${total} books.\nBooks per subject: ${subjects}\nBooks per language: ${languages}`;
  }

  buildAnswerMessages({ message, history, cards, intent }) {
    const shelf = cards.length
      ? cards.map((c) => this.formatCard(c)).join('\n\n')
      : '(no books matched)';
    const overview = intent === 'library-stats' ? `\n\n${this.libraryOverview()}` : '';

    return [
      { role: 'system', content: `${ANSWER_SYSTEM}\n\nBooks on the shelf for this question:\n\n${shelf}${overview}` },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: message }
    ];
  }

  /** Book ids cited in the text, in order of first mention. */
  citedIds(text) {
    return [...new Set([...text.matchAll(/\[\[book:(\d+)\]\]/g)].map((m) => Number(m[1])))];
  }

  /** Remove citations of books that were not on the cards. */
  stripUnknownCitations(text, allowedIds) {
    const allowed = new Set(allowedIds);
    return text.replace(/\[\[book:(\d+)\]\]/g, (tag, id) => (allowed.has(Number(id)) ? tag : ''));
  }

  /**
   * One turn: the user's message in, the answer streamed out.
   *
   * `emit(event, data)` receives:
   *   meta  {conversationId, intent, books}  before the answer starts
   *   token {text}                           as the answer arrives
   *   done  {content, bookIds}               the answer as saved
   * Throws when the model is unreachable or fails; nothing is saved then.
   */
  async ask({ conversationId, message }, emit, { signal } = {}) {
    message = (message || '').trim();
    if (!message) throw new Error('Ask a question');

    if (conversationId && !db.prepare('SELECT 1 FROM chat_conversations WHERE id = ?').get(Number(conversationId))) {
      throw new Error('No such conversation');
    }
    if (!(await ollama.isAvailable())) throw new Error('The local model is not running (start Ollama)');

    const history = conversationId ? this.history(Number(conversationId)) : [];
    const earlierIds = [...new Set(history.flatMap((m) => m.book_ids))];

    const plan = await this.understand(message, history);
    const pinned = [...new Set([...plan.bookIds.filter((id) => earlierIds.includes(id)), ...earlierIds])];
    const cards = await this.retrieve(plan.searchQueries, pinned);

    const id = conversationId ? Number(conversationId) : this.createConversation(message);
    emit('meta', { conversationId: id, intent: plan.intent, searchQueries: plan.searchQueries, books: cards });

    const text = await ollama.chatStream(
      this.buildAnswerMessages({ message, history, cards, intent: plan.intent }),
      { model: MODEL, signal, onToken: (piece) => emit('token', { text: piece }) }
    );
    if (text === null) {
      if (!conversationId) this.deleteConversation(id);
      throw new Error('The local model did not answer');
    }

    const content = this.stripUnknownCitations(text, cards.map((c) => c.id)).trim();
    const bookIds = this.citedIds(content);
    this.addMessage(id, 'user', message);
    this.addMessage(id, 'assistant', content, bookIds);

    emit('done', { conversationId: id, content, bookIds });
    return { conversationId: id, content, bookIds };
  }

  async status() {
    return {
      available: await ollama.isAvailable(),
      model: MODEL,
      profiled: bookProfiler.countProfiled(),
      total: db.prepare('SELECT COUNT(*) AS n FROM books').get().n
    };
  }
}

module.exports = new LibraryChat();
