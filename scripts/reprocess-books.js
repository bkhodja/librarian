const { db } = require('../server/database/init');
const pdfProcessor = require('../server/services/pdfProcessor');
const contentExtractor = require('../server/services/pdfContentExtractor');

async function reprocessBooks() {
  console.log('Re-processing existing books to extract ISBN, publisher, and other metadata...\n');

  // Get all books from database
  const books = db.prepare('SELECT id, file_path, title FROM books').all();
  console.log(`Found ${books.length} books to process\n`);

  let updated = 0;
  let failed = 0;

  for (const book of books) {
    try {
      console.log(`Processing: ${book.title || book.file_path}`);

      // Extract content metadata
      const contentMetadata = await contentExtractor.extractFromContent(book.file_path);

      if (contentMetadata) {
        // Update the book with new metadata
        const stmt = db.prepare(`
          UPDATE books
          SET isbn = COALESCE(?, isbn),
              publisher = COALESCE(?, publisher),
              publication_year = COALESCE(?, publication_year),
              edition = COALESCE(?, edition),
              description = COALESCE(?, description),
              author = CASE WHEN ? IS NOT NULL AND (author IS NULL OR author = '') THEN ? ELSE author END
          WHERE id = ?
        `);

        const result = stmt.run(
          contentMetadata.isbn,
          contentMetadata.publisher,
          contentMetadata.publicationYear,
          contentMetadata.edition,
          contentMetadata.description,
          contentMetadata.authors,
          contentMetadata.authors,
          book.id
        );

        if (result.changes > 0) {
          console.log(`  ✅ Updated with:`);
          if (contentMetadata.isbn) console.log(`     ISBN: ${contentMetadata.isbn}`);
          if (contentMetadata.publisher) console.log(`     Publisher: ${contentMetadata.publisher}`);
          if (contentMetadata.publicationYear) console.log(`     Year: ${contentMetadata.publicationYear}`);
          if (contentMetadata.authors) console.log(`     Authors: ${contentMetadata.authors}`);
          if (contentMetadata.edition) console.log(`     Edition: ${contentMetadata.edition}`);
          updated++;
        } else {
          console.log(`  ℹ️  No new metadata found`);
        }
      } else {
        console.log(`  ℹ️  No metadata extracted`);
      }
    } catch (error) {
      console.error(`  ❌ Error: ${error.message}`);
      failed++;
    }
    console.log('');
  }

  console.log('='.repeat(60));
  console.log(`\nReprocessing complete!`);
  console.log(`  Updated: ${updated} books`);
  console.log(`  Failed: ${failed} books`);
  console.log(`  No changes: ${books.length - updated - failed} books`);
}

// Run the reprocessing
reprocessBooks().then(() => {
  console.log('\nDone! Refresh your browser to see the updated metadata.');
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});