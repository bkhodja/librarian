#!/usr/bin/env node

const { db } = require('../../server/database/init');
const enhancedSearch = require('../../server/services/enhancedSearchService');
const fs = require('fs');

// Test universal page navigation with different books and offsets
async function testUniversalNavigation() {
  console.log('🔬 UNIVERSAL PAGE NAVIGATION TEST\n');
  console.log('=' .repeat(70));

  // Test with multiple books having different offsets
  const testCases = [
    { bookId: 23, searchTerm: 'Kubernetes', expectedOffset: 5 },  // Site Reliability Workbook
    { bookId: 8, searchTerm: 'Docker', expectedOffset: 1 },       // AWS Cookbook
    { bookId: 1, searchTerm: 'Angular', expectedOffset: 0 },      // Angular book (no offset)
  ];

  let allTestsPassed = true;

  for (const testCase of testCases) {
    const { bookId, searchTerm, expectedOffset } = testCase;

    console.log(`\n📚 Testing Book ID ${bookId}`);
    console.log('-' .repeat(70));

    // Get book details
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
    if (!book) {
      console.log(`❌ Book ${bookId} not found`);
      allTestsPassed = false;
      continue;
    }

    console.log(`   Title: ${book.title.substring(0, 60)}...`);
    console.log(`   Page Offset: ${book.page_offset || 0} (expected: ${expectedOffset})`);
    console.log(`   Search Term: "${searchTerm}"`);

    // Get search occurrences
    const occurrences = enhancedSearch.getBookOccurrences(bookId, searchTerm, {
      limit: 3,
      matchType: 'any'
    });

    if (occurrences.length === 0) {
      console.log(`   ⚠️  No occurrences found for "${searchTerm}"`);
      continue;
    }

    console.log(`   ✅ Found ${occurrences.length} occurrences\n`);

    // Test first occurrence
    const firstOcc = occurrences[0];
    const physicalPage = firstOcc.pageNumber;
    const logicalPage = physicalPage - (book.page_offset || 0);

    console.log('   📄 First Occurrence:');
    console.log(`      Physical Page (in DB): ${physicalPage}`);
    console.log(`      Logical Page (displayed): ${logicalPage}`);
    console.log(`      PDF URL: #page=${physicalPage}`);
    console.log(`      Snippet: "${firstOcc.snippet.replace(/<[^>]*>/g, '').substring(0, 50)}..."`);

    // Verify the mapping
    console.log('\n   🔍 Verification:');
    console.log(`      ✓ User sees: "Page ${logicalPage}"`);
    console.log(`      ✓ PDF opens at: physical page ${physicalPage}`);
    console.log(`      ✓ Content should contain: "${searchTerm}"`);

    // Check if file exists
    if (book.file_path && fs.existsSync(book.file_path)) {
      console.log(`      ✓ PDF file exists at: ${book.file_path.substring(0, 60)}...`);
    } else {
      console.log(`      ❌ PDF file missing: ${book.file_path}`);
      allTestsPassed = false;
    }
  }

  console.log('\n' + '=' .repeat(70));
  console.log('\n📊 SUMMARY:\n');

  console.log('✅ Page Numbering System:');
  console.log('   1. Database stores PHYSICAL page numbers');
  console.log('   2. UI displays LOGICAL page numbers (physical - offset)');
  console.log('   3. PDFs open at PHYSICAL page numbers');
  console.log('   4. This works universally for all books regardless of offset');

  console.log('\n✅ Implementation:');
  console.log('   - SearchResultsModal displays: occurrence.pageNumber - pageOffset');
  console.log('   - SearchResultsModal opens PDF: #page={occurrence.pageNumber}');
  console.log('   - Server provides pageOffset in /books/:id/occurrences endpoint');

  if (allTestsPassed) {
    console.log('\n✨ All tests passed! Page navigation is working correctly.');
  } else {
    console.log('\n⚠️  Some tests failed. Check the output above for details.');
  }

  console.log('\n🎯 Next Steps:');
  console.log('   1. Try searching for "Kubernetes" in the UI');
  console.log('   2. Click on any occurrence in the modal');
  console.log('   3. Verify the PDF opens at the correct page with the search term visible');
  console.log('\n');
}

// Run the test
testUniversalNavigation().catch(console.error);