#!/usr/bin/env node

const { db } = require('../../server/database/init');
const enhancedSearch = require('../../server/services/enhancedSearchService');
const properPdfExtractor = require('../../server/services/properPdfExtractor');

async function testMultipleBooks() {
  console.log('🧪 COMPREHENSIVE PAGE NAVIGATION TEST');
  console.log('=' .repeat(80));
  console.log('Testing page navigation across multiple books and search terms\n');

  // Test cases: different books with various search terms
  const testCases = [
    {
      bookId: 23,
      title: 'Site Reliability Workbook',
      searchTerm: 'Kubernetes',
      description: 'Technical term in O\'Reilly book'
    },
    {
      bookId: 8,
      title: 'AWS Cookbook',
      searchTerm: 'Docker',
      description: 'Container technology term'
    },
    {
      bookId: 1,
      title: 'Angular для профессионалов',
      searchTerm: 'Angular',
      description: 'Framework name in Russian book'
    },
    {
      bookId: 11,
      title: 'Defensive Security Handbook',
      searchTerm: 'security',
      description: 'Common security term'
    },
    {
      bookId: 4,
      title: 'разработка на Python',
      searchTerm: 'Python',
      description: 'Programming language'
    }
  ];

  let totalTests = 0;
  let passedTests = 0;

  for (const testCase of testCases) {
    console.log('\n' + '─'.repeat(80));
    console.log(`\n📚 Book ${testCase.bookId}: ${testCase.title}`);
    console.log(`   Testing: "${testCase.searchTerm}" (${testCase.description})`);

    // Get book details
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(testCase.bookId);

    if (!book) {
      console.log('   ❌ Book not found in database');
      continue;
    }

    // Search for occurrences
    const occurrences = enhancedSearch.getBookOccurrences(testCase.bookId, testCase.searchTerm, {
      limit: 3,
      matchType: 'any'
    });

    if (occurrences.length === 0) {
      console.log(`   ⚠️  No occurrences found for "${testCase.searchTerm}"`);
      continue;
    }

    console.log(`   ✅ Found ${occurrences.length} occurrences\n`);

    // Test first 2 occurrences
    for (let i = 0; i < Math.min(2, occurrences.length); i++) {
      totalTests++;
      const occ = occurrences[i];

      console.log(`   📄 Occurrence ${i + 1}:`);
      console.log(`      Page number: ${occ.pageNumber}`);
      console.log(`      Snippet: "${occ.snippet.replace(/<[^>]*>/g, '').substring(0, 80)}..."`);

      // Verify the page content contains the search term
      const pageContent = db.prepare(`
        SELECT content
        FROM book_pages
        WHERE book_id = ? AND page_number = ?
      `).get(testCase.bookId, occ.pageNumber);

      if (pageContent && pageContent.content.toLowerCase().includes(testCase.searchTerm.toLowerCase())) {
        console.log(`      ✅ Verified: Page ${occ.pageNumber} contains "${testCase.searchTerm}"`);
        passedTests++;
      } else {
        console.log(`      ❌ Error: Page ${occ.pageNumber} doesn't contain "${testCase.searchTerm}"`);
      }

      // Show what URL would be used to open the PDF
      if (book.file_path) {
        console.log(`      📖 PDF URL: http://localhost:3001/pdf${book.file_path}#page=${occ.pageNumber}`);
      }
      console.log();
    }
  }

  // Test edge cases
  console.log('\n' + '═'.repeat(80));
  console.log('\n🔬 EDGE CASE TESTS:\n');

  // Test 1: Multi-word phrase search
  console.log('1️⃣ Multi-word Phrase Search:');
  const phraseResults = enhancedSearch.getBookOccurrences(23, 'open source', {
    limit: 2,
    matchType: 'phrase'
  });
  console.log(`   Searching for "open source" in Site Reliability Workbook`);
  console.log(`   Found ${phraseResults.length} results`);
  if (phraseResults.length > 0) {
    console.log(`   First result on page ${phraseResults[0].pageNumber}`);
  }

  // Test 2: Case insensitive search
  console.log('\n2️⃣ Case Insensitive Search:');
  const caseResults1 = enhancedSearch.getBookOccurrences(8, 'docker', { limit: 1 });
  const caseResults2 = enhancedSearch.getBookOccurrences(8, 'DOCKER', { limit: 1 });
  console.log(`   "docker" found: ${caseResults1.length > 0 ? 'Yes, page ' + caseResults1[0].pageNumber : 'No'}`);
  console.log(`   "DOCKER" found: ${caseResults2.length > 0 ? 'Yes, page ' + caseResults2[0].pageNumber : 'No'}`);

  // Test 3: Check page number consistency
  console.log('\n3️⃣ Page Number Consistency:');
  const book23Pages = db.prepare(`
    SELECT MIN(page_number) as min_page, MAX(page_number) as max_page, COUNT(*) as total_pages
    FROM book_pages WHERE book_id = 23
  `).get();
  console.log(`   Site Reliability Workbook:`);
  console.log(`   - First page: ${book23Pages.min_page}`);
  console.log(`   - Last page: ${book23Pages.max_page}`);
  console.log(`   - Total pages: ${book23Pages.total_pages}`);

  // Summary
  console.log('\n' + '═'.repeat(80));
  console.log('\n📊 TEST SUMMARY:\n');
  console.log(`   Total page verification tests: ${totalTests}`);
  console.log(`   Passed: ${passedTests}`);
  console.log(`   Failed: ${totalTests - passedTests}`);
  console.log(`   Success rate: ${totalTests > 0 ? Math.round((passedTests/totalTests)*100) : 0}%`);

  if (passedTests === totalTests && totalTests > 0) {
    console.log('\n   🎉 All tests passed! Page navigation is working correctly.');
  } else if (passedTests > totalTests * 0.8) {
    console.log('\n   ✅ Most tests passed. System is mostly working.');
  } else {
    console.log('\n   ⚠️  Several tests failed. May need further investigation.');
  }

  console.log('\n💡 Instructions for Manual Testing:');
  console.log('   1. Go to http://localhost:5173');
  console.log('   2. Search for any of the tested terms');
  console.log('   3. Click on a book to see occurrences');
  console.log('   4. Click "Open at this page" to verify the PDF opens at the correct location');
  console.log('   5. The search term should be visible on the opened page\n');
}

// Run the test
testMultipleBooks().catch(console.error);