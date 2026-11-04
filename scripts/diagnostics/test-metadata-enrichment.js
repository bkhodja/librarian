const metadataEnricher = require('../../server/services/bookMetadataEnricher');
const { db } = require('../../server/database/init');

async function testMetadataEnrichment() {
  console.log('\n=== Testing Metadata Enrichment ===\n');

  // Get a book with ISBN to test
  const booksWithISBN = db.prepare(`
    SELECT id, title, author, isbn, file_path
    FROM books
    WHERE isbn IS NOT NULL AND isbn != ''
    LIMIT 5
  `).all();

  if (booksWithISBN.length === 0) {
    console.log('No books with ISBN found. Let\'s try with a book without ISBN...');

    const booksWithoutISBN = db.prepare(`
      SELECT id, title, author, file_path
      FROM books
      WHERE title IS NOT NULL AND author IS NOT NULL
      LIMIT 5
    `).all();

    if (booksWithoutISBN.length === 0) {
      console.log('No suitable books found for testing.');
      return;
    }

    for (const book of booksWithoutISBN) {
      console.log(`\nTesting book without ISBN: "${book.title}" by ${book.author}`);
      console.log('-----------------------------------------------------------');

      try {
        const enrichedBook = await metadataEnricher.enrichBook(book.id);
        if (enrichedBook) {
          console.log('✅ Metadata enriched successfully!');
          console.log('New metadata:');
          if (enrichedBook.description) {
            console.log(`  Description: ${enrichedBook.description.substring(0, 200)}...`);
          }
          if (enrichedBook.categories) {
            console.log(`  Categories: ${enrichedBook.categories}`);
          }
          if (enrichedBook.average_rating) {
            console.log(`  Average Rating: ${enrichedBook.average_rating}`);
          }
          if (enrichedBook.metadata_source) {
            console.log(`  Source: ${enrichedBook.metadata_source}`);
          }
        } else {
          console.log('❌ No metadata found from external sources');
        }
      } catch (error) {
        console.error('❌ Error:', error.message);
      }
    }
  } else {
    for (const book of booksWithISBN) {
      console.log(`\nTesting book with ISBN: "${book.title}" (ISBN: ${book.isbn})`);
      console.log('-----------------------------------------------------------');

      try {
        const enrichedBook = await metadataEnricher.enrichBook(book.id);
        if (enrichedBook) {
          console.log('✅ Metadata enriched successfully!');
          console.log('New metadata:');
          if (enrichedBook.description) {
            console.log(`  Description: ${enrichedBook.description.substring(0, 200)}...`);
          }
          if (enrichedBook.publisher && enrichedBook.publisher !== book.publisher) {
            console.log(`  Publisher: ${enrichedBook.publisher}`);
          }
          if (enrichedBook.publication_year) {
            console.log(`  Publication Year: ${enrichedBook.publication_year}`);
          }
          if (enrichedBook.categories) {
            console.log(`  Categories: ${enrichedBook.categories}`);
          }
          if (enrichedBook.average_rating) {
            console.log(`  Average Rating: ${enrichedBook.average_rating}`);
          }
          if (enrichedBook.thumbnail_url) {
            console.log(`  Cover Image: ${enrichedBook.thumbnail_url}`);
          }
          if (enrichedBook.metadata_source) {
            console.log(`  Source: ${enrichedBook.metadata_source}`);
          }
        } else {
          console.log('❌ No additional metadata found from external sources');
        }
      } catch (error) {
        console.error('❌ Error:', error.message);
      }
    }
  }

  console.log('\n=== Testing Complete ===\n');
  process.exit(0);
}

// Run the test
testMetadataEnrichment().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});