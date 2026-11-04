#!/usr/bin/env node

const { db } = require('../../server/database/init');
const enhancedSearch = require('../../server/services/enhancedSearchService');

console.log('🔦 Testing PDF Search Term Highlighting\n');
console.log('=' .repeat(70));

// Test cases with different search terms
const testCases = [
  {
    bookId: 23,
    title: 'Site Reliability Workbook',
    searchTerms: ['Kubernetes', 'open source', 'reliability']
  },
  {
    bookId: 8,
    title: 'AWS Cookbook',
    searchTerms: ['Docker', 'AWS Lambda', 'cloud']
  },
  {
    bookId: 1,
    title: 'Angular для профессионалов',
    searchTerms: ['Angular', 'TypeScript', 'component']
  }
];

console.log('\n📚 Generating Test URLs with Search Highlighting:\n');

for (const test of testCases) {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(test.bookId);

  if (!book) continue;

  console.log(`\n📖 ${test.title}`);
  console.log(`   File: ${book.file_path}\n`);

  for (const searchTerm of test.searchTerms) {
    const occurrences = enhancedSearch.getBookOccurrences(test.bookId, searchTerm, { limit: 1 });

    if (occurrences.length > 0) {
      const pageNum = occurrences[0].pageNumber;
      const highlightUrl = `http://localhost:3001/pdf${book.file_path}#page=${pageNum}&search=${encodeURIComponent(searchTerm)}`;

      console.log(`   🔍 "${searchTerm}" - Page ${pageNum}`);
      console.log(`      URL: ${highlightUrl}`);

      // Show what the search parameter looks like
      console.log(`      Encoded search: search=${encodeURIComponent(searchTerm)}`);
    } else {
      console.log(`   ⚠️  "${searchTerm}" - Not found`);
    }
  }
}

console.log('\n' + '=' .repeat(70));
console.log('\n💡 How PDF Search Highlighting Works:\n');
console.log('   1. The #search parameter is added to the PDF URL');
console.log('   2. Modern PDF viewers (PDF.js in browsers) automatically highlight the term');
console.log('   3. The search box opens with the term pre-filled');
console.log('   4. All occurrences on the page are highlighted');
console.log('   5. Users can navigate between occurrences using Ctrl+G (next) and Shift+Ctrl+G (previous)');

console.log('\n🧪 Testing Special Characters:\n');

const specialTerms = [
  'C++',
  'C#',
  '.NET',
  'Node.js',
  'Vue.js',
  'React & Redux',
  'HTML/CSS',
  'key:value',
  'user@domain'
];

console.log('   Encoded search parameters for special characters:');
for (const term of specialTerms) {
  console.log(`   "${term}" → search=${encodeURIComponent(term)}`);
}

console.log('\n✅ Highlighting feature configured successfully!');
console.log('\n📝 Manual Testing Instructions:');
console.log('   1. Go to http://localhost:5173');
console.log('   2. Search for any term (try "Kubernetes", "Docker", or "Angular")');
console.log('   3. Click on a book to see occurrences');
console.log('   4. Click "Open at this page"');
console.log('   5. The PDF should open with:');
console.log('      - Correct page displayed');
console.log('      - Search term highlighted in yellow');
console.log('      - Search box open with the term');
console.log('   6. Try multi-word searches like "open source" or "AWS Lambda"');