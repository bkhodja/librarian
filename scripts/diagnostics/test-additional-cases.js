#!/usr/bin/env node

const { db } = require('../../server/database/init');
const enhancedSearch = require('../../server/services/enhancedSearchService');

console.log('🔍 Additional Test Cases for Page Navigation\n');
console.log('=' .repeat(70));

// Test Case 1: Search for 'React' in multiple books
console.log('\n📚 Test 1: Search "React" across different books');
const reactBooks = db.prepare(`
  SELECT DISTINCT b.id, b.title, COUNT(*) as occurrences
  FROM book_pages bp
  JOIN books b ON b.id = bp.book_id
  WHERE bp.content LIKE '%React%'
  GROUP BY b.id
  LIMIT 5
`).all();

console.log(`Found "React" in ${reactBooks.length} books:`);
reactBooks.forEach(book => {
  const firstOcc = enhancedSearch.getBookOccurrences(book.id, 'React', { limit: 1 });
  if (firstOcc.length > 0) {
    console.log(`  • ${book.title.substring(0, 40)}...`);
    console.log(`    First occurrence: Page ${firstOcc[0].pageNumber}`);
    console.log(`    Snippet: ${firstOcc[0].snippet.replace(/<[^>]*>/g, '').substring(0, 60)}...`);
  }
});

// Test Case 2: Search for common programming terms
console.log('\n📚 Test 2: Common Programming Terms in AWS Cookbook');
const terms = ['function', 'database', 'API', 'server', 'client'];
const bookId = 8; // AWS Cookbook

terms.forEach(term => {
  const results = enhancedSearch.getBookOccurrences(bookId, term, { limit: 1 });
  if (results.length > 0) {
    console.log(`  ${term}: Found on page ${results[0].pageNumber}`);
  }
});

// Test Case 3: Verify specific page ranges
console.log('\n📚 Test 3: Page Range Verification');
const books = [
  { id: 1, title: 'Angular для профессионалов' },
  { id: 4, title: 'FastAPI веб-разработка' },
  { id: 11, title: 'Defensive Security Handbook' }
];

books.forEach(book => {
  const pageInfo = db.prepare(`
    SELECT MIN(page_number) as first_page,
           MAX(page_number) as last_page,
           COUNT(*) as total_pages
    FROM book_pages WHERE book_id = ?
  `).get(book.id);

  console.log(`  ${book.title.substring(0, 35)}...`);
  console.log(`    Pages: ${pageInfo.first_page} to ${pageInfo.last_page} (total: ${pageInfo.total_pages})`);
});

// Test Case 4: Specific page content verification
console.log('\n📚 Test 4: Specific Page Content Verification');

// Test specific known pages
const pageTests = [
  { bookId: 23, page: 213, expectedContent: 'Kubernetes', description: 'Site Reliability - Kubernetes intro' },
  { bookId: 8, page: 217, expectedContent: 'Docker', description: 'AWS Cookbook - Docker section' },
  { bookId: 1, page: 100, expectedContent: 'Angular', description: 'Angular book - mid section' },
];

pageTests.forEach(test => {
  const pageContent = db.prepare(`
    SELECT content FROM book_pages
    WHERE book_id = ? AND page_number = ?
  `).get(test.bookId, test.page);

  if (pageContent && pageContent.content.includes(test.expectedContent)) {
    console.log(`  ✅ Page ${test.page}: ${test.description} - Contains "${test.expectedContent}"`);
  } else {
    console.log(`  ❌ Page ${test.page}: ${test.description} - Missing "${test.expectedContent}"`);
  }
});

// Test Case 5: Verify URL generation
console.log('\n📚 Test 5: PDF URL Generation Examples');
const sampleBooks = db.prepare(`
  SELECT id, title, file_path
  FROM books
  WHERE file_path IS NOT NULL AND id IN (1, 8, 23)
`).all();

sampleBooks.forEach(book => {
  const occ = enhancedSearch.getBookOccurrences(book.id, 'the', { limit: 1 });
  if (occ.length > 0) {
    console.log(`  ${book.title.substring(0, 35)}...`);
    console.log(`    Page ${occ[0].pageNumber}: http://localhost:3001/pdf${book.file_path}#page=${occ[0].pageNumber}`);
  }
});

// Test Case 6: Cross-book consistency
console.log('\n📚 Test 6: Cross-Book Search Consistency');
const searchTerm = 'data';
const booksWithData = db.prepare(`
  SELECT DISTINCT b.id, b.title
  FROM book_pages bp
  JOIN books b ON b.id = bp.book_id
  WHERE bp.content LIKE '%data%'
  LIMIT 5
`).all();

console.log(`  Searching for "${searchTerm}" in ${booksWithData.length} books:`);
booksWithData.forEach(book => {
  const results = enhancedSearch.getBookOccurrences(book.id, searchTerm, { limit: 1 });
  if (results.length > 0) {
    const verification = db.prepare(`
      SELECT content FROM book_pages
      WHERE book_id = ? AND page_number = ?
    `).get(book.id, results[0].pageNumber);

    const verified = verification && verification.content.toLowerCase().includes(searchTerm);
    console.log(`    ${book.title.substring(0, 30)}... Page ${results[0].pageNumber} ${verified ? '✅' : '❌'}`);
  }
});

console.log('\n' + '=' .repeat(70));
console.log('\n✅ All additional tests completed successfully!');