const fullTextSearch = require('../../server/services/fullTextSearch');
const { db } = require('../../server/database/init');

async function testFTSIndexing() {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 TESTING FULL-TEXT SEARCH INDEXING');
  console.log('='.repeat(80) + '\n');

  // Get a few sample books to test
  const sampleBooks = db.prepare(`
    SELECT id, title, author, file_path, pdf_type
    FROM books
    WHERE pdf_type = 'searchable'
    LIMIT 5
  `).all();

  console.log(`Testing with ${sampleBooks.length} sample books:\n`);

  for (const book of sampleBooks) {
    console.log(`- ${book.title || 'Untitled'} by ${book.author || 'Unknown'}`);
  }

  console.log('\n' + '-'.repeat(80) + '\n');
  console.log('Starting indexing process...\n');

  // Index each book
  const results = [];
  for (const book of sampleBooks) {
    console.log(`\nIndexing book ${book.id}: ${book.title}`);
    console.log('-'.repeat(40));

    const startTime = Date.now();
    const result = await fullTextSearch.indexBook(book.id, true); // Force reindex for testing
    const duration = Date.now() - startTime;

    results.push({
      bookId: book.id,
      title: book.title,
      ...result,
      duration
    });

    if (result.success) {
      console.log(`✅ Success! Indexed ${result.wordCount} words in ${duration}ms`);
    } else {
      console.log(`❌ Failed: ${result.message}`);
    }
  }

  // Test searching
  console.log('\n' + '='.repeat(80));
  console.log('🔍 TESTING SEARCH FUNCTIONALITY');
  console.log('='.repeat(80) + '\n');

  const testQueries = [
    'Python',
    'JavaScript',
    'database',
    'function',
    'programming'
  ];

  for (const query of testQueries) {
    console.log(`\nSearching for: "${query}"`);
    console.log('-'.repeat(40));

    const searchResults = fullTextSearch.search(query, { limit: 3 });

    if (searchResults.results.length > 0) {
      console.log(`Found ${searchResults.total} results. Top 3:`);
      searchResults.results.forEach((result, i) => {
        console.log(`\n${i + 1}. ${result.title || 'Untitled'}`);
        console.log(`   Author: ${result.author || 'Unknown'}`);
        console.log(`   Snippet: ${result.snippet}`);
      });
    } else {
      console.log('No results found');
    }
  }

  // Test phrase search
  console.log('\n' + '='.repeat(80));
  console.log('🔍 TESTING PHRASE SEARCH');
  console.log('='.repeat(80) + '\n');

  const phraseQuery = 'data structures';
  console.log(`Searching for exact phrase: "${phraseQuery}"`);

  const phraseResults = fullTextSearch.search(phraseQuery, {
    matchType: 'phrase',
    limit: 3
  });

  if (phraseResults.results.length > 0) {
    console.log(`Found ${phraseResults.total} results with exact phrase`);
    phraseResults.results.forEach((result, i) => {
      console.log(`\n${i + 1}. ${result.title}`);
      console.log(`   Snippet: ${result.snippet}`);
    });
  } else {
    console.log('No exact phrase matches found');
  }

  // Show index statistics
  console.log('\n' + '='.repeat(80));
  console.log('📊 INDEX STATISTICS');
  console.log('='.repeat(80) + '\n');

  const stats = fullTextSearch.getIndexStats();
  if (stats) {
    console.log(`Total books in library: ${stats.totalBooks}`);
    console.log(`Books indexed: ${stats.indexedBooks}`);
    console.log(`Books with page data: ${stats.booksWithPages}`);
    console.log(`Total pages indexed: ${stats.totalPages}`);
    console.log(`Coverage: ${stats.coverage}%`);
  }

  // Performance summary
  console.log('\n' + '='.repeat(80));
  console.log('⚡ PERFORMANCE SUMMARY');
  console.log('='.repeat(80) + '\n');

  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  const totalWords = results.reduce((sum, r) => sum + (r.wordCount || 0), 0);

  console.log(`Books indexed: ${results.length}`);
  console.log(`Total words indexed: ${totalWords.toLocaleString()}`);
  console.log(`Average indexing time: ${Math.round(avgDuration)}ms per book`);
  console.log(`Indexing speed: ~${Math.round(totalWords / (avgDuration * results.length / 1000))} words/second`);

  console.log('\n✅ Testing complete!\n');
}

// Run the test
testFTSIndexing().then(() => {
  console.log('Test finished successfully');
  process.exit(0);
}).catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});