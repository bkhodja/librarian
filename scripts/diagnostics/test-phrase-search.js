#!/usr/bin/env node

const enhancedSearch = require('../../server/services/enhancedSearchService');
const { db } = require('../../server/database/init');

async function testPhraseSearch() {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 TESTING EXACT PHRASE SEARCH');
  console.log('='.repeat(80) + '\n');

  // Test phrases
  const testPhrases = [
    'DAX language',
    'Power BI',
    'data analysis',
    'machine learning'
  ];

  for (const phrase of testPhrases) {
    console.log(`\n📝 Testing phrase: "${phrase}"`);
    console.log('-'.repeat(60));

    // Test with phrase matching
    console.log('\nWith PHRASE matching:');
    const phraseResults = enhancedSearch.searchWithPages(phrase, {
      matchType: 'phrase',
      groupByBook: true
    });

    if (phraseResults.length > 0) {
      console.log(`✅ Found ${phraseResults.length} books with exact phrase "${phrase}"`);

      // Show first book
      const firstBook = phraseResults[0];
      console.log(`   First match: ${firstBook.title}`);
      console.log(`   Total occurrences: ${firstBook.totalOccurrences}`);
      console.log(`   Pages: ${firstBook.pageNumbers.slice(0, 5).join(', ')}${firstBook.pageNumbers.length > 5 ? '...' : ''}`);

      // Get detailed occurrences
      const occurrences = enhancedSearch.getBookOccurrences(firstBook.bookId, phrase, {
        matchType: 'phrase',
        limit: 3
      });

      if (occurrences.length > 0) {
        console.log(`   Sample snippets:`);
        occurrences.forEach((occ, idx) => {
          const cleanSnippet = occ.snippet
            .replace(/<mark>/g, '**')
            .replace(/<\/mark>/g, '**')
            .replace(/<[^>]*>/g, '');
          console.log(`     ${idx + 1}. Page ${occ.pageNumber}: "${cleanSnippet}"`);
        });
      }
    } else {
      console.log(`❌ No exact matches for phrase "${phrase}"`);
    }

    // Compare with ANY word matching
    console.log('\nWith ANY word matching:');
    const anyResults = enhancedSearch.searchWithPages(phrase, {
      matchType: 'any',
      groupByBook: true
    });

    if (anyResults.length > 0) {
      console.log(`📚 Found ${anyResults.length} books with ANY word from "${phrase}"`);
      const firstBook = anyResults[0];
      console.log(`   First match: ${firstBook.title}`);
      console.log(`   Total occurrences: ${firstBook.totalOccurrences}`);
    }

    // Show difference
    if (phraseResults.length > 0 && anyResults.length > 0) {
      const phraseCount = phraseResults.reduce((sum, book) => sum + book.totalOccurrences, 0);
      const anyCount = anyResults.reduce((sum, book) => sum + book.totalOccurrences, 0);
      console.log(`\n📊 Comparison:`);
      console.log(`   Exact phrase matches: ${phraseCount} occurrences in ${phraseResults.length} books`);
      console.log(`   Any word matches: ${anyCount} occurrences in ${anyResults.length} books`);
      console.log(`   Filtering precision: ${((phraseCount / anyCount) * 100).toFixed(1)}%`);
    }
  }

  // Test a specific book if provided
  const args = process.argv.slice(2);
  if (args[0]) {
    const bookId = parseInt(args[0]);
    const searchPhrase = args[1] || 'DAX language';

    console.log('\n' + '='.repeat(80));
    console.log(`📖 Testing book ID ${bookId} for phrase: "${searchPhrase}"`);
    console.log('='.repeat(80));

    const occurrences = enhancedSearch.getBookOccurrences(bookId, searchPhrase, {
      matchType: 'phrase',
      limit: 10
    });

    console.log(`\nFound ${occurrences.length} pages with exact phrase`);
    occurrences.forEach((occ, idx) => {
      const cleanSnippet = occ.snippet
        .replace(/<mark>/g, '**')
        .replace(/<\/mark>/g, '**')
        .replace(/<[^>]*>/g, '');
      console.log(`\n${idx + 1}. Page ${occ.pageNumber} (${occ.occurrenceCount} occurrences):`);
      console.log(`   "${cleanSnippet}"`);
    });
  }

  console.log('\n✅ Phrase search test complete!\n');
}

// Run the test
testPhraseSearch().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});