const { db } = require('../server/database/init');
const embeddings = require('../server/services/embeddingService');

const { EMBEDDING_KEY } = embeddings;
const DAY = 24 * 60 * 60 * 1000;

let nextPath = 0;
function addBook({ title = 'A Book', addedAgo = 30 * DAY, tags = [], embedded = null } = {}) {
  const added = new Date(Date.now() - addedAgo).toISOString();
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO books (title, file_path, date_added) VALUES (?, ?, ?)'
  ).run(title, `/books/${nextPath++}.pdf`, added);

  for (const name of tags) {
    db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(name);
    const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
    db.prepare('INSERT INTO book_tags (book_id, tag_id) VALUES (?, ?)').run(id, tag.id);
  }
  if (embedded) {
    db.prepare(`
      INSERT INTO book_embeddings (book_id, embedding, model_name, text_hash)
      VALUES (?, ?, ?, 'hash')
    `).run(id, Buffer.alloc(16), embedded);
  }
  return Number(id);
}

const pendingIds = () => embeddings.pendingBooks().map((b) => b.id);

beforeEach(() => {
  db.exec('DELETE FROM book_embeddings; DELETE FROM book_tags; DELETE FROM books;');
});

describe('buildEmbeddingText', () => {
  test('is title, author, tags and description', () => {
    const text = embeddings.buildEmbeddingText(
      { title: 'Clean Code', author: 'Robert C. Martin', description: 'Writing readable software.' },
      [{ name: 'software-engineering' }, { name: 'programming-practices' }]
    );
    expect(text).toBe(
      'Clean Code. by Robert C. Martin. software-engineering, programming-practices. Writing readable software.'
    );
  });

  test('leaves out whatever is missing', () => {
    expect(embeddings.buildEmbeddingText({ title: 'Untagged Book' })).toBe('Untagged Book');
  });
});

describe('pendingBooks', () => {
  test('includes a book with no embedding', () => {
    const id = addBook({ tags: ['python'] });
    expect(pendingIds()).toEqual([id]);
  });

  test('skips a book embedded by the current model and recipe', () => {
    addBook({ tags: ['python'], embedded: EMBEDDING_KEY });
    expect(pendingIds()).toEqual([]);
  });

  test('includes a book embedded by an older model', () => {
    const id = addBook({ tags: ['python'], embedded: 'Xenova/all-MiniLM-L6-v2' });
    expect(pendingIds()).toEqual([id]);
  });

  test('waits for a new book to be tagged', () => {
    addBook({ addedAgo: 60 * 1000 });
    expect(pendingIds()).toEqual([]);
  });

  test('does not wait for a new book that is already tagged', () => {
    const id = addBook({ addedAgo: 60 * 1000, tags: ['python'] });
    expect(pendingIds()).toEqual([id]);
  });

  test('stops waiting for tags after a day', () => {
    const id = addBook({ addedAgo: 2 * DAY });
    expect(pendingIds()).toEqual([id]);
  });

  test('reads both date formats the library holds', () => {
    // 344 early rows were written as "YYYY-MM-DD HH:MM:SS", not ISO.
    const id = addBook();
    db.prepare("UPDATE books SET date_added = '2026-03-01 10:00:00' WHERE id = ?").run(id);
    expect(pendingIds()).toEqual([id]);
  });

  test('honours a limit', () => {
    addBook({ tags: ['a'] });
    addBook({ tags: ['a'] });
    addBook({ tags: ['a'] });
    expect(embeddings.pendingBooks(2)).toHaveLength(2);
    expect(embeddings.countPending()).toBe(3);
  });
});
