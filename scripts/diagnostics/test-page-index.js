#!/usr/bin/env node

const enhancedSearch = require('../../server/services/enhancedSearchService');
const { db } = require('../../server/database/init');

async function testPageIndex() {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 TESTING PAGE-LEVEL SEARCH INDEX');
  console.log('='.repeat(80) + '\n');

  // Get current stats
  const stats = enhancedSearch.getIndexStats();
  console.log('Current Page Index Status:');
  console.log(`  Total books: ${stats.totalBooks}`);
  console.log(`  Books with page index: ${stats.indexedBooks}`);
  console.log(`  Total pages indexed: ${stats.totalPages}`);
  console.log(`  Total words indexed: ${stats.totalWords?.toLocaleString() || 0}`);
  console.log(`  Coverage: ${stats.coverage}%\n`);

  // Select a few sample books to test
  const sampleBooks = db.prepare(`
    SELECT id, title, author, file_path
    FROM books
    WHERE pdf_type = 'searchable'
    LIMIT 3
  `).all();

  console.log(`Testing with ${sampleBooks.length} sample books:\n`);

  for (const book of sampleBooks) {
    console.log(`\nIndexing pages for: ${book.title || 'Untitled'}`);
    console.log('-'.repeat(60));

    const startTime = Date.now();
    const result = await enhancedSearch.indexBookPages(book.id);
    const duration = Date.now() - startTime;

    if (result.success) {
      console.log(`✅ Success!`);
      console.log(`  Pages indexed: ${result.pageCount}`);
      console.log(`  Words indexed: ${result.wordCount?.toLocaleString() || 'N/A'}`);
      console.log(`  Time: ${(duration / 1000).toFixed(2)}s`);
      console.log(`  Speed: ~${Math.round(result.wordCount / (duration / 1000))} words/second`);
    } else {
      console.log(`❌ Failed: ${result.message}`);
    }
  }

  // Test enhanced search with page results
  console.log('\n' + '='.repeat(80));
  console.log('🔍 TESTING ENHANCED SEARCH WITH PAGE RESULTS');
  console.log('='.repeat(80) + '\n');

  const testQuery = 'Python';
  console.log(`Searching for: "${testQuery}"\n`);

  const searchResults = enhancedSearch.searchWithPages(testQuery, {
    matchType: 'any',
    groupByBook: true
  });

  console.log(`Found matches in ${searchResults.length} books:\n`);

  searchResults.slice(0, 3).forEach((book, index) => {
    console.log(`${index + 1}. ${book.title || 'Untitled'}`);
    console.log(`   Author: ${book.author || 'Unknown'}`);
    console.log(`   Total occurrences: ${book.totalOccurrences}`);
    console.log(`   Pages with matches: ${book.pageNumbers.join(', ')}`);

    if (book.occurrences.length > 0) {
      console.log(`   First occurrence (Page ${book.occurrences[0].pageNumber}):`);
      // Remove HTML tags from snippet for console display
      const cleanSnippet = book.occurrences[0].snippet
        .replace(/<mark>/g, '**')
        .replace(/<\/mark>/g, '**')
        .replace(/<[^>]*>/g, '');
      console.log(`   "${cleanSnippet}"`);
    }

    if (book.hasMore) {
      console.log(`   ... and more occurrences`);
    }
    console.log('');
  });

  // Test heatmap generation
  if (searchResults.length > 0) {
    const firstBook = searchResults[0];
    console.log('='.repeat(80));
    console.log(`Generating heatmap for: ${firstBook.title}`);
    console.log('-'.repeat(60));

    const heatmap = enhancedSearch.getSearchHeatmap(firstBook.bookId, testQuery);

    // Show top 5 pages with highest density
    const topPages = heatmap
      .filter(h => h.count > 0)
      .sort((a, b) => b.density - a.density)
      .slice(0, 5);

    console.log('Top 5 pages by search term density:');
    topPages.forEach(page => {
      console.log(`  Page ${page.pageNumber}: ${page.count} occurrences (${page.density.toFixed(2)}% density)`);
    });
  }

  // Show final stats
  const finalStats = enhancedSearch.getIndexStats();
  console.log('\n' + '='.repeat(80));
  console.log('📊 FINAL PAGE INDEX STATISTICS');
  console.log('='.repeat(80));
  console.log(`  Total books: ${finalStats.totalBooks}`);
  console.log(`  Books with page index: ${finalStats.indexedBooks}`);
  console.log(`  Total pages indexed: ${finalStats.totalPages}`);
  console.log(`  Total words indexed: ${finalStats.totalWords?.toLocaleString() || 0}`);
  console.log(`  Average words per page: ${finalStats.avgWordsPerPage}`);
  console.log(`  Coverage: ${finalStats.coverage}%`);

  console.log('\n✅ Page-level search test complete!\n');
}

// Run the test
testPageIndex().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});