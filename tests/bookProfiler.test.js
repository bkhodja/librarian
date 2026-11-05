jest.mock('../server/services/ollamaClient', () => ({
  model: 'test-model',
  isAvailable: jest.fn(),
  generateJSON: jest.fn()
}));

const { db } = require('../server/database/init');
const ollama = require('../server/services/ollamaClient');
const profiler = require('../server/services/bookProfiler');

const { PROFILE_KEY } = profiler;

let nextPath = 0;
function addBook(title = 'A Book', { tags = [], reading = false } = {}) {
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO books (title, file_path) VALUES (?, ?)'
  ).run(title, `/books/profile-${nextPath++}.pdf`);
  const id = Number(lastInsertRowid);
  for (const name of tags) {
    db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(name);
    const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
    db.prepare('INSERT INTO book_tags (book_id, tag_id) VALUES (?, ?)').run(id, tag.id);
  }
  if (reading) db.prepare('INSERT INTO reading_progress (book_id, current_page) VALUES (?, 3)').run(id);
  return id;
}

function addPage(bookId, pageNumber, content) {
  db.prepare('INSERT INTO book_pages (book_id, page_number, content) VALUES (?, ?, ?)')
    .run(bookId, pageNumber, content);
}

beforeAll(() => {
  db.exec(`CREATE TABLE IF NOT EXISTS book_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, book_id INTEGER NOT NULL, page_number INTEGER NOT NULL,
    content TEXT, UNIQUE(book_id, page_number))`);
});

beforeEach(() => {
  db.exec(`DELETE FROM book_profiles; DELETE FROM book_pages; DELETE FROM reading_progress;
           DELETE FROM book_tags; DELETE FROM books;`);
  ollama.isAvailable.mockResolvedValue(true);
  ollama.generateJSON.mockReset();
});

describe('openingText', () => {
  test('skips near-empty pages and keeps the contents in page order', () => {
    const id = addBook();
    addPage(id, 2, 'Contents: 1. Installing PostgreSQL 2. Your first query '.repeat(3));
    addPage(id, 1, 'Cover');
    const text = profiler.openingText(id);
    expect(text.startsWith('Contents:')).toBe(true);
    expect(text).not.toContain('Cover');
  });

  test('stays within the size budget however long the pages', () => {
    const id = addBook();
    for (let p = 1; p <= 15; p++) addPage(id, p, 'word '.repeat(2000));
    expect(profiler.openingText(id).length).toBeLessThanOrEqual(6000);
  });
});

describe('normalize', () => {
  test('rounds the level and trims the lists', () => {
    expect(profiler.normalize({
      level: 2.4, audience: ' beginners ', prerequisites: ['SQL basics', '', 'a', 'b', 'c', 'd'],
      topics: ['indexes'], kind: 'tutorial', summary: 'A first book.'
    })).toEqual({
      level: 2, audience: 'beginners', prerequisites: ['SQL basics', 'a', 'b', 'c'],
      topics: ['indexes'], kind: 'tutorial', summary: 'A first book.'
    });
  });

  test('rejects a level off the scale, and an unknown kind becomes "other"', () => {
    expect(profiler.normalize({ level: 9 })).toBeNull();
    expect(profiler.normalize(null)).toBeNull();
    expect(profiler.normalize({ level: 3, kind: 'novel' }).kind).toBe('other');
  });
});

describe('profileBook', () => {
  test('stores the profile under the current key', async () => {
    const id = addBook('Postgres. Первое знакомство');
    ollama.generateJSON.mockResolvedValue({
      level: 1, audience: 'newcomers', prerequisites: [], topics: ['SQL'], kind: 'intro', summary: 'Intro.'
    });

    await profiler.profileBook(id);

    expect(profiler.profilesFor([id]).get(id)).toMatchObject({ level: 1, kind: 'intro', topics: ['SQL'] });
    expect(profiler.countPending()).toBe(0);
  });

  test('records a book the model could not read, so it is not retried', async () => {
    const id = addBook();
    ollama.generateJSON.mockResolvedValue(null);

    expect(await profiler.profileBook(id)).toBeNull();
    expect(profiler.countPending()).toBe(0);
    expect(profiler.countProfiled()).toBe(0);
    expect(profiler.profilesFor([id]).size).toBe(0);
  });

  test('leaves the book pending when Ollama is down', async () => {
    addBook();
    ollama.isAvailable.mockResolvedValue(false);
    const [book] = profiler.pendingBooks();

    await expect(profiler.profileBook(book.id)).rejects.toThrow('not reachable');
    expect(profiler.countPending()).toBe(1);
  });
});

describe('pendingBooks', () => {
  test('re-profiles a book profiled by an older model or prompt', () => {
    const id = addBook();
    profiler.save(id, { level: 2, audience: '', prerequisites: [], topics: [], kind: 'intro', summary: '' }, 'h');
    expect(profiler.pendingBooks()).toEqual([]);

    db.prepare("UPDATE book_profiles SET model_name = 'old#profile-v0'").run();
    expect(profiler.pendingBooks().map((b) => b.id)).toEqual([id]);
    expect(PROFILE_KEY).toBe('test-model#profile-v1');
  });

  test('books being read come first, then work subjects, then leisure', () => {
    const novel = addBook('Novel', { tags: ['fiction'] });
    const sql = addBook('SQL', { tags: ['sql'] });
    const current = addBook('Current', { tags: ['fiction'], reading: true });
    expect(profiler.pendingBooks().map((b) => b.id)).toEqual([current, sql, novel]);
  });
});
