#!/usr/bin/env node

const enhancedSearch = require('./server/services/enhancedSearchService');
const { db } = require('./server/database/init');

async function indexPages() {
  console.log('\n' + '='.repeat(80));
  console.log('📄 PAGE-LEVEL SEARCH INDEXING');
  console.log('='.repeat(80) + '\n');

  const args = process.argv.slice(2);
  // OCR is opt-in: it is seconds a page rather than milliseconds, so a plain
  // run should not silently turn into a half-hour job.
  const withOcr = args.includes('--ocr');
  const positional = args.filter((a) => !a.startsWith('--'));
  const bookId = positional[0] ? parseInt(positional[0]) : null;
  const limit = positional[1] ? parseInt(positional[1]) : 10;

  // Get current stats
  const stats = enhancedSearch.getIndexStats();
  console.log('Current Status:');
  console.log(`  Total books: ${stats.totalBooks}`);
  console.log(`  Books with page index: ${stats.indexedBooks}`);
  console.log(`  Total pages indexed: ${stats.totalPages}`);
  console.log(`  Coverage: ${stats.coverage}%\n`);

  let booksToIndex;

  if (bookId) {
    // Index specific book
    booksToIndex = db.prepare('SELECT id, title FROM books WHERE id = ?').all(bookId);

    if (booksToIndex.length === 0) {
      console.log(`Book with ID ${bookId} not found`);
      return;
    }
  } else {
    // Index books that haven't been indexed yet
    // ePUBs have no pdf_type, so restricting to 'searchable' skipped every one
    // of them. They carry text and are worth indexing; scanned PDFs are not,
    // since they hold images and need OCR first.
    booksToIndex = db.prepare(`
      SELECT b.id, b.title
      FROM books b
      LEFT JOIN (
        SELECT DISTINCT book_id
        FROM book_pages
      ) bp ON b.id = bp.book_id
      WHERE bp.book_id IS NULL
        AND (
          b.pdf_type IN ('searchable', 'mixed')
          OR lower(b.file_path) LIKE '%.epub'
          ${withOcr ? "OR b.pdf_type = 'scanned'" : ''}
        )
      LIMIT ?
    `).all(limit);
  }

  if (booksToIndex.length === 0) {
    console.log('✅ All searchable books are already indexed!');
    return;
  }

  console.log(`Indexing ${booksToIndex.length} book(s)...\n`);

  let successCount = 0;
  let totalPages = 0;
  let totalWords = 0;

  for (const book of booksToIndex) {
    console.log(`Indexing: ${book.title || 'Untitled'} (ID: ${book.id})`);
    console.log('-'.repeat(60));

    const startTime = Date.now();
    const result = await enhancedSearch.indexBookPages(book.id);
    const duration = Date.now() - startTime;

    if (result.success) {
      console.log(`✅ Success! ${result.pageCount} pages, ${result.wordCount?.toLocaleString()} words`);
      console.log(`   Time: ${(duration / 1000).toFixed(2)}s\n`);
      successCount++;
      totalPages += result.pageCount;
      totalWords += result.wordCount || 0;
    } else {
      console.log(`❌ Failed: ${result.message}\n`);
    }
  }

  // Final stats
  const finalStats = enhancedSearch.getIndexStats();

  console.log('='.repeat(80));
  console.log('📊 INDEXING COMPLETE');
  console.log('='.repeat(80));
  console.log(`  Books indexed in this session: ${successCount}`);
  console.log(`  Pages indexed in this session: ${totalPages}`);
  console.log(`  Words indexed in this session: ${totalWords.toLocaleString()}`);
  console.log('\nOverall Statistics:');
  console.log(`  Total books: ${finalStats.totalBooks}`);
  console.log(`  Books with page index: ${finalStats.indexedBooks}`);
  console.log(`  Total pages: ${finalStats.totalPages}`);
  console.log(`  Coverage: ${finalStats.coverage}%`);

  if (finalStats.indexedBooks < finalStats.totalBooks) {
    console.log(`\n💡 Tip: Run 'node index-pages.js' to index more books`);
  }
}

// Run the indexing
indexPages().then(() => {
  console.log('\n✅ Done!\n');
  process.exit(0);
}).catch(error => {
  console.error('Error:', error);
  process.exit(1);
});