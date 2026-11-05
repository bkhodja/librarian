const { db } = require('../server/database/init');
const folders = require('../server/services/libraryFolders');
const profiler = require('../server/services/bookProfiler');
const chat = require('../server/services/libraryChat');

const BOOKS = '/test-library/Books';
const MAGAZINES = '/test-library/Magazines';

function insert(filePath, title = 'x', hash = null) {
  const { lastInsertRowid } = db.prepare('INSERT INTO books (title, file_path, file_hash) VALUES (?, ?, ?)')
    .run(title, filePath, hash);
  return db.prepare('SELECT id, kind, series FROM books WHERE id = ?').get(lastInsertRowid);
}

beforeEach(() => {
  db.exec('DELETE FROM book_profiles; DELETE FROM books;');
});

describe('paths', () => {
  test('a file under the magazines folder is a magazine, its first folder the series', () => {
    expect(folders.kindForPath(`${MAGAZINES}/Coffee Magazine/2024/Issue 3.pdf`)).toBe('magazine');
    expect(folders.seriesForPath(`${MAGAZINES}/Coffee Magazine/2024/Issue 3.pdf`)).toBe('Coffee Magazine');
    expect(folders.seriesForPath(`${MAGAZINES}/loose.pdf`)).toBeNull();
  });

  test('anything else is a book', () => {
    expect(folders.kindForPath(`${BOOKS}/Clean Code.pdf`)).toBe('book');
    expect(folders.kindForPath('/test-library/MagazinesOld/x.pdf')).toBe('book');
    expect(folders.seriesForPath(`${BOOKS}/Python/x.pdf`)).toBeNull();
  });
});

describe('classification on insert', () => {
  test('however a row is inserted, its folder decides what it is', () => {
    expect(insert(`${MAGAZINES}/BBC Easy Cook UK/Issue 12.pdf`)).toMatchObject({ kind: 'magazine', series: 'BBC Easy Cook UK' });
    expect(insert(`${MAGAZINES}/10000 words and phrases.pdf`)).toMatchObject({ kind: 'magazine', series: null });
    expect(insert(`${BOOKS}/Databases/Postgres.pdf`)).toMatchObject({ kind: 'book', series: null });
  });

  test('a series name with a quote in it survives', () => {
    expect(insert(`${MAGAZINES}/Reader's Digest/May.pdf`).series).toBe("Reader's Digest");
  });

  test('existing rows are reclassified at startup', () => {
    const row = insert(`${MAGAZINES}/Wired/Jan.pdf`);
    db.prepare("UPDATE books SET kind = 'book', series = NULL WHERE id = ?").run(row.id);

    expect(folders.installClassifier(db)).toBe(1);
    expect(db.prepare('SELECT kind, series FROM books WHERE id = ?').get(row.id))
      .toEqual({ kind: 'magazine', series: 'Wired' });
  });
});

describe('magazines elsewhere', () => {
  test('are not profiled', () => {
    const book = insert(`${BOOKS}/a.pdf`);
    insert(`${MAGAZINES}/Wired/Jan.pdf`);
    expect(profiler.pendingBooks().map((b) => b.id)).toEqual([book.id]);
    expect(profiler.countPending()).toBe(1);
  });

  test('issues of one magazine are not collapsed as copies, but the same file twice is', () => {
    const jan = insert(`${MAGAZINES}/Wired/Jan.pdf`, 'Wired UK January 2024', 'a');
    const feb = insert(`${MAGAZINES}/Wired/Feb.pdf`, 'Wired UK February 2024', 'b');
    const copy = insert(`${MAGAZINES}/Wired/Feb copy.pdf`, 'Wired UK February 2024 (1)', 'b');

    const cards = chat.collapseCopies(chat.bookCards([jan.id, feb.id, copy.id]));
    expect(cards.map((c) => c.id)).toEqual([jan.id, feb.id]);
    expect(cards[1].copies).toEqual([copy.id]);
    expect(chat.formatCard(cards[0])).toContain('magazine issue of Wired');
  });
});
