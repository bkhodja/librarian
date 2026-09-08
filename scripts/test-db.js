#!/usr/bin/env node
/**
 * Make a throwaway copy of the library database for destructive testing.
 *
 *   node scripts/test-db.js                 # 60-book sample (fast)
 *   node scripts/test-db.js --sample=200    # a bigger sample
 *   node scripts/test-db.js --full          # everything, ~1GB
 *   node scripts/test-db.js --status        # what exists right now
 *
 * Then run the app against it:
 *   npm run server:test
 *
 * The copy is made with VACUUM INTO, which writes one consistent file and
 * needs no WAL handling, and it is only ever read from the live database —
 * nothing here writes to it.
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LIVE = path.join(ROOT, 'data/librarian.db');
const TEST = path.join(ROOT, 'data/test.librarian.db');

const args = process.argv.slice(2);
const full = args.includes('--full');
const status = args.includes('--status');
const sampleArg = args.find((a) => a.startsWith('--sample='));
const sampleSize = sampleArg ? Number(sampleArg.split('=')[1]) : 60;

const mb = (file) => (fs.existsSync(file) ? (fs.statSync(file).size / 1048576).toFixed(0) + 'MB' : '—');

function describe(file, label) {
  if (!fs.existsSync(file)) return console.log(`  ${label.padEnd(10)} (does not exist)`);
  const db = new Database(file, { readonly: true });
  const count = (t) => {
    try { return db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c; } catch { return '—'; }
  };
  console.log(`  ${label.padEnd(10)} ${mb(file).padStart(6)}  ` +
              `${count('books')} books, ${count('book_pages')} pages, ` +
              `${count('book_tags')} tag links, ${count('collections')} shelves`);
  db.close();
}

if (status) {
  console.log('\nDatabases:');
  describe(LIVE, 'live');
  describe(TEST, 'test');
  console.log(`\n  live: ${LIVE}\n  test: ${TEST}\n`);
  process.exit(0);
}

/** Empty an FTS table and refill it from the rows that are left. */
function rebuildFts(db, table, insertSql) {
  try {
    db.exec(`DELETE FROM ${table}`);
    db.exec(insertSql);
  } catch (error) {
    console.warn(`  could not rebuild ${table}: ${error.message}`);
  }
}

/**
 * Rewrite double-quoted string literals in the stored schema as single-quoted.
 *
 * An older migration wrote `DEFAULT "not_needed"` into the books table.
 * SQLite accepts that when the statement runs but rejects it when VACUUM
 * re-parses the schema, so the database cannot be vacuumed or copied with
 * VACUUM INTO. Fixing the recorded text needs writable_schema, which is why it
 * is done here on a copy — the same steps work on the live database, but that
 * is a decision to make deliberately rather than as a side effect of making a
 * test fixture.
 */
function repairSchemaQuoting(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'books'").get();
  if (!row || !/DEFAULT "/.test(row.sql)) return false;

  const fixed = row.sql.replace(/"(not_needed|pending|processing|completed|failed)"/g, "'$1'");

  // better-sqlite3 refuses writes to sqlite_master unless unsafe mode is on.
  db.unsafeMode(true);
  try {
    db.pragma('writable_schema = ON');
    db.prepare("UPDATE sqlite_master SET sql = ? WHERE name = 'books'").run(fixed);
    db.pragma('writable_schema = OFF');
  } finally {
    db.unsafeMode(false);
  }

  const check = db.pragma('integrity_check', { simple: true });
  if (check !== 'ok') {
    throw new Error(`Schema repair left the database inconsistent: ${check}`);
  }

  console.log('  repaired double-quoted literals in the stored schema');
  return true;
}

async function main() {
if (!fs.existsSync(LIVE)) {
  console.error(`No library database at ${LIVE}`);
  process.exit(1);
}

// Remove any previous copy, including stray WAL files from a crashed run.
for (const suffix of ['', '-wal', '-shm']) {
  const file = TEST + suffix;
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

console.log(`Copying ${mb(LIVE)} from the live database…`);
const started = Date.now();

// The online backup API rather than VACUUM INTO. VACUUM re-parses the stored
// schema strictly, and an older migration wrote double-quoted string literals
// into it, which SQLite accepts on the way in and rejects on the way back —
// so VACUUM fails on this database. backup() copies pages and does not care.
const live = new Database(LIVE, { readonly: true });
await live.backup(TEST);
live.close();

console.log(`  copied in ${((Date.now() - started) / 1000).toFixed(1)}s`);

if (!full) {
  console.log(`Trimming to ${sampleSize} books…`);
  const test = new Database(TEST);

  // Keep a spread rather than the first N: the oldest books have the richest
  // metadata and the newest have the least, and testing wants both.
  const keep = test.prepare(`
    SELECT id FROM books
    WHERE id IN (SELECT id FROM books ORDER BY id LIMIT ?)
       OR id IN (SELECT id FROM books ORDER BY id DESC LIMIT ?)
       OR id IN (SELECT book_id FROM book_tags GROUP BY book_id ORDER BY COUNT(*) DESC LIMIT ?)
  `).all(Math.ceil(sampleSize / 3), Math.ceil(sampleSize / 3), Math.ceil(sampleSize / 3))
    .map((r) => r.id);

  const placeholders = keep.map(() => '?').join(',');

  // Deleting from books cascades to the child tables that declare it; the
  // rest are cleared explicitly so nothing is left pointing at a missing book.
  test.transaction(() => {
    test.prepare(`DELETE FROM books WHERE id NOT IN (${placeholders})`).run(...keep);
    for (const table of ['book_tags', 'book_collections', 'book_pages',
                         'reading_progress', 'book_embeddings', 'book_summaries',
                         'search_occurrences', 'ocr_queue', 'book_notes', 'book_categories']) {
      try {
        test.prepare(`DELETE FROM ${table} WHERE book_id NOT IN (${placeholders})`).run(...keep);
      } catch {
        // Table absent in this schema version, or has no book_id.
      }
    }
  })();

  /*
   * Both FTS tables are standalone rather than external-content, so they hold
   * their own copy of every row and 'rebuild' does not apply to them — it
   * fails, and the deleted books stay searchable. Empty them and refill from
   * what survived.
   */
  rebuildFts(test, 'pages_fts', `
    INSERT INTO pages_fts (page_id, book_id, page_number, content)
    SELECT id, book_id, page_number, content FROM book_pages WHERE content IS NOT NULL
  `);

  rebuildFts(test, 'books_fts', `
    INSERT INTO books_fts (book_id, title, author, content, description)
    SELECT id, title, author, NULL, description FROM books
  `);

  repairSchemaQuoting(test);
  test.exec('VACUUM');
  test.close();
}

console.log('');
describe(LIVE, 'live');
describe(TEST, 'test');
console.log(`\nRun the app against the copy:\n  npm run server:test\n`);
console.log(`Or one command:\n  DATABASE_PATH=./data/test.librarian.db node server/index.js\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
