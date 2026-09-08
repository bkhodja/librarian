/**
 * Repair titles and authors across the existing library.
 *
 * Runs in two passes:
 *   1. Local — re-judge what is already stored, drop scraped boilerplate, and
 *      fall back to the filename where a title is a placeholder or a slug.
 *   2. Remote — for books that still look wrong and carry an ISBN, take the
 *      title and author from Open Library / Google Books.
 *
 * Usage:
 *   node repair-metadata.js            # both passes
 *   node repair-metadata.js --local    # pass 1 only, no network
 *   node repair-metadata.js --dry-run  # report without writing
 *   node repair-metadata.js --limit=50 # cap the remote pass
 */
const { db } = require('./server/database/init');
const quality = require('./server/services/metadataQuality');
const enricher = require('./server/services/bookMetadataEnricher');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const localOnly = args.includes('--local');
const limitArg = args.find((a) => a.startsWith('--limit='));
const remoteLimit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

function localPass(label = 'Local pass') {
  const books = db.prepare(
    'SELECT id, title, author, publisher, edition, description, file_path FROM books'
  ).all();
  const update = db.prepare(`
    UPDATE books
    SET title = ?, author = ?, publisher = ?, edition = ?, description = ?
    WHERE id = ?
  `);

  const counts = { title: 0, author: 0, publisher: 0, edition: 0, description: 0 };
  let cleared = 0;

  for (const book of books) {
    const title = quality.bestTitle({ existing: book.title, filePath: book.file_path });
    const next = {
      title,
      author: quality.cleanAuthor(book.author, { title }),
      publisher: quality.cleanPublisher(book.publisher),
      edition: quality.cleanEdition(book.edition),
      description: quality.cleanDescription(book.description)
    };

    let changed = false;
    for (const field of Object.keys(counts)) {
      if ((next[field] || null) === (book[field] || null)) continue;
      counts[field]++;
      if (book[field] && !next[field]) cleared++;
      changed = true;
    }
    if (!changed) continue;

    if (!dryRun) {
      update.run(next.title, next.author, next.publisher, next.edition, next.description, book.id);
    }
  }

  console.log(`\n${label}: ` + Object.entries(counts)
    .map(([field, n]) => `${n} ${field}`).join(', ') +
    ` changed (${cleared} field(s) cleared as unusable)`);
}

async function remotePass() {
  const books = db.prepare(
    'SELECT id, title, author, publisher, isbn FROM books WHERE isbn IS NOT NULL'
  ).all();

  const needsWork = books.filter((b) =>
    !quality.isPlausibleTitle(b.title) ||
    !quality.isPlausibleAuthor(b.author, { title: b.title }) ||
    !quality.isPlausiblePublisher(b.publisher)
  ).slice(0, remoteLimit);

  console.log(`\nRemote pass: ${needsWork.length} book(s) to look up by ISBN`);
  if (dryRun) {
    needsWork.slice(0, 20).forEach((b) =>
      console.log(`  would look up ${b.isbn} (${b.title})`));
    return;
  }

  let fixed = 0;
  for (const [i, book] of needsWork.entries()) {
    try {
      const updated = await enricher.enrichBook(book.id);
      if (updated && (updated.title !== book.title || updated.author !== book.author)) {
        fixed++;
        console.log(`  [${i + 1}/${needsWork.length}] ${updated.title} — ${updated.author || 'no author'}`);
      }
    } catch (error) {
      console.error(`  [${i + 1}/${needsWork.length}] ${book.isbn}: ${error.message}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`\nRemote pass: ${fixed} book(s) repaired`);
}

(async () => {
  if (dryRun) console.log('DRY RUN — nothing will be written');

  localPass();

  if (!localOnly) {
    await remotePass();

    // Re-run the local check now that titles are correct. An author scraped
    // from the cover ("Best Practices", "Using Kotlin") is only recognisable
    // as part of the title once the title itself is no longer a slug.
    localPass('Second local pass');
  }

  const rows = db.prepare('SELECT title, author, publisher, edition, description FROM books').all();
  const usable = (field, fn) => rows.filter((r) => fn(r[field], r)).length;

  console.log('\nUsable after repair:');
  console.log(`  title       ${usable('title', (v) => quality.isPlausibleTitle(v))}/${rows.length}`);
  console.log(`  author      ${usable('author', (v, r) => quality.isPlausibleAuthor(v, { title: r.title }))}/${rows.length}`);
  console.log(`  publisher   ${usable('publisher', (v) => quality.isPlausiblePublisher(v))}/${rows.length}`);
  console.log(`  edition     ${usable('edition', (v) => quality.isPlausibleEdition(v))}/${rows.length}`);
  console.log(`  description ${usable('description', (v) => quality.isPlausibleDescription(v))}/${rows.length}`);

  db.close();
})();
