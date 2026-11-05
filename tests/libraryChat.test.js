jest.mock('../server/services/ollamaClient', () => ({
  model: 'test-model',
  isAvailable: jest.fn(),
  chat: jest.fn(),
  chatStream: jest.fn(),
  generateJSON: jest.fn()
}));
jest.mock('../server/services/embeddingService', () => ({
  semanticSearch: jest.fn()
}));

const { db } = require('../server/database/init');
const ollama = require('../server/services/ollamaClient');
const embeddingService = require('../server/services/embeddingService');
const profiler = require('../server/services/bookProfiler');
const chat = require('../server/services/libraryChat');

let nextPath = 0;

function addBook(title, { author = null, year = null, hash = null, level = null } = {}) {
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO books (title, author, publication_year, file_hash, file_path) VALUES (?, ?, ?, ?, ?)
  `).run(title, author, year, hash, `/books/chat-${nextPath++}.pdf`);
  const id = Number(lastInsertRowid);
  if (level) {
    profiler.save(id, { level, audience: 'x', prerequisites: [], topics: [], kind: 'intro', summary: '' }, 'h');
  }
  return id;
}

beforeEach(() => {
  db.exec(`DELETE FROM chat_conversations; DELETE FROM book_profiles; DELETE FROM reading_progress;
           DELETE FROM book_tags; DELETE FROM books;`);
  chat.catalog = null;
  jest.resetAllMocks();
  ollama.isAvailable.mockResolvedValue(true);
  embeddingService.semanticSearch.mockResolvedValue([]);
});

describe('readingStatus', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');

  test.each([
    [{ finished_reading: '2026-10-01 10:00:00', percentage: 40 }, { state: 'finished' }],
    [{ percentage: 97 }, { state: 'finished' }],
    [{}, { state: 'unread' }],
    [{ percentage: 30.4, last_read: '2026-11-01 09:00:00' }, { state: 'reading', percent: 30 }],
    [{ percentage: 30, last_read: '2026-08-01T09:00:00.000Z' }, { state: 'stalled', percent: 30 }]
  ])('%o → %o', (row, expected) => {
    expect(chat.readingStatus(row, now)).toEqual(expected);
  });
});

describe('collapseCopies', () => {
  test('keeps one card per book, preferring a profiled copy over a newer one', () => {
    const old = addBook('PostgreSQL изнутри', { author: 'Рогов', year: 2022, level: 5 });
    const newer = addBook('PostgreSQL изнутри', { author: 'Рогов', year: 2024 });
    const other = addBook('Postgres. Первое знакомство', { level: 1 });

    const cards = chat.collapseCopies(chat.bookCards([newer, other, old]));

    expect(cards.map((c) => c.id)).toEqual([old, other]);
    expect(cards[0].copies).toEqual([newer]);
  });

  test('identical files are one book whatever their titles', () => {
    const a = addBook('scan_0001', { hash: 'abc' });
    const b = addBook('Clean Code', { hash: 'abc' });
    expect(chat.collapseCopies(chat.bookCards([a, b]))).toHaveLength(1);
  });
});

describe('keywordSearch', () => {
  test('matches Cyrillic titles regardless of case', () => {
    const id = addBook('МАШИННОЕ ОБУЧЕНИЕ для всех');
    addBook('Cooking at home');
    expect(chat.keywordSearch('машинное обучение').map((b) => b.id)).toEqual([id]);
  });

  test('matches other forms of a word', () => {
    const postgres = addBook('Postgres. Первое знакомство');
    const ml = addBook('Основы машинного обучения');
    expect(chat.keywordSearch('PostgreSQL').map((b) => b.id)).toEqual([postgres]);
    expect(chat.keywordSearch('обучение').map((b) => b.id)).toEqual([ml]);
  });
});

describe('citations', () => {
  test('a book not on the cards is removed, and cited ids come back in order', () => {
    const text = 'Start with [[book:3]], then [[book:99]] and [[book:1]]; again [[book:3]].';
    const clean = chat.stripUnknownCitations(text, [1, 3]);
    expect(clean).toBe('Start with [[book:3]], then  and [[book:1]]; again [[book:3]].');
    expect(chat.citedIds(clean)).toEqual([3, 1]);
  });
});

describe('ask', () => {
  test('streams an answer, saves both messages and only keeps real citations', async () => {
    const intro = addBook('Postgres. Первое знакомство', { level: 1 });
    ollama.chat.mockResolvedValue({ intent: 'reading-path', searchQueries: ['PostgreSQL'], bookIds: [] });
    ollama.chatStream.mockImplementation(async (messages, { onToken }) => {
      onToken('Start with ');
      onToken(`[[book:${intro}]] and [[book:424242]].`);
      return `Start with [[book:${intro}]] and [[book:424242]].`;
    });

    const events = [];
    const result = await chat.ask({ message: 'Where do I start with PostgreSQL?' }, (e, d) => events.push([e, d]));

    expect(events.map(([e]) => e)).toEqual(['meta', 'token', 'token', 'done']);
    expect(events[0][1].books.map((b) => b.id)).toEqual([intro]);

    const system = ollama.chatStream.mock.calls[0][0][0].content;
    expect(system).toContain(`[[book:${intro}]] "Postgres. Первое знакомство"`);
    expect(system).toContain('level 1/5');

    expect(result.bookIds).toEqual([intro]);
    const saved = chat.getConversation(result.conversationId);
    expect(saved.title).toBe('Where do I start with PostgreSQL?');
    expect(saved.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(saved.messages[1].content).toBe(`Start with [[book:${intro}]] and .`);
    expect(saved.books.map((b) => b.id)).toEqual([intro]);
  });

  test('a follow-up keeps the books the conversation already cited', async () => {
    const intro = addBook('Postgres. Первое знакомство', { level: 1 });
    const conversationId = chat.createConversation('PostgreSQL?');
    chat.addMessage(conversationId, 'user', 'PostgreSQL?');
    chat.addMessage(conversationId, 'assistant', `Read [[book:${intro}]].`, [intro]);

    ollama.chat.mockResolvedValue({ intent: 'recommend', searchQueries: ['unrelated'], bookIds: [] });
    ollama.chatStream.mockResolvedValue('Then that one again.');

    const events = [];
    await chat.ask({ conversationId, message: 'And after that?' }, (e, d) => events.push([e, d]));

    expect(events[0][1].books.map((b) => b.id)).toContain(intro);
    const sent = ollama.chatStream.mock.calls[0][0];
    expect(sent.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(chat.getConversation(conversationId).messages).toHaveLength(4);
  });

  test('saves nothing when the model does not answer', async () => {
    ollama.chat.mockResolvedValue(null);
    ollama.chatStream.mockResolvedValue(null);

    await expect(chat.ask({ message: 'Anything on Rust?' }, () => {})).rejects.toThrow('did not answer');
    expect(chat.listConversations()).toEqual([]);
  });

  test('refuses up front when Ollama is down', async () => {
    ollama.isAvailable.mockResolvedValue(false);
    await expect(chat.ask({ message: 'Anything on Rust?' }, () => {})).rejects.toThrow('not running');
  });
});

describe('conversations', () => {
  test('a long first question is shortened into the title, and deleting removes the messages', () => {
    const id = chat.createConversation('word '.repeat(40));
    chat.addMessage(id, 'user', 'hello');
    expect(chat.listConversations()[0].title).toHaveLength(78);

    expect(chat.deleteConversation(id)).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get().n).toBe(0);
  });
});
