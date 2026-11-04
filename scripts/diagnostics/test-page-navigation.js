#!/usr/bin/env node

const { db } = require('../../server/database/init');
const enhancedSearch = require('../../server/services/enhancedSearchService');

// Test the complete page navigation flow
async function testPageNavigation() {
  console.log('🧪 Testing Page Navigation System\n');
  console.log('=' .repeat(60));

  // Test with Site Reliability Workbook - Book ID 23
  const bookId = 23;
  const searchTerm = 'Kubernetes';

  console.log('📚 Test Book: Site Reliability Workbook (ID: 23)');

  // Get book info
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
  const pageOffset = book.page_offset || 0;
  console.log(`   Page Offset: ${pageOffset}`);
  console.log(`   File Path: ${book.file_path}\n`);

  // Search for occurrences
  console.log(`🔍 Searching for: "${searchTerm}"`);
  const occurrences = enhancedSearch.getBookOccurrences(bookId, searchTerm, {
    limit: 10,
    matchType: 'phrase'
  });

  console.log(`📊 Found ${occurrences.length} occurrences\n`);

  if (occurrences.length === 0) {
    console.log('❌ No occurrences found. Book may not be indexed.');
    console.log('   Run: node scripts/index-pages.js to index all books\n');
    return;
  }

  console.log('📄 Page Number Mapping:\n');
  console.log('   Physical | Logical | For PDF  | For Display');
  console.log('   ---------|---------|----------|------------');

  occurrences.slice(0, 5).forEach(occ => {
    const physicalPage = occ.pageNumber;
    const logicalPage = physicalPage - pageOffset;

    console.log(`   ${String(physicalPage).padEnd(8)} | ${String(logicalPage).padEnd(7)} | #page=${physicalPage} | Page ${logicalPage}`);

    // Show snippet
    const snippet = occ.snippet.replace(/<[^>]*>/g, '').substring(0, 60);
    console.log(`   └─ "${snippet}..."\n`);
  });

  console.log('\n✅ System Configuration:');
  console.log('   1. Database stores: PHYSICAL page numbers');
  console.log('   2. Display to users: LOGICAL page numbers (physical - offset)');
  console.log('   3. Open PDF with: PHYSICAL page numbers (#page=physical)');
  console.log('   4. SearchResultsModal shows: Logical pages to users, opens with physical\n');

  // Verify a specific page
  console.log('🔬 Verification Test:');
  const testOccurrence = occurrences[0];
  if (testOccurrence) {
    console.log(`   First occurrence:`);
    console.log(`   - Database page_number: ${testOccurrence.pageNumber} (physical)`);
    console.log(`   - Display to user as: Page ${testOccurrence.pageNumber - pageOffset}`);
    console.log(`   - Open PDF with URL: /pdf${book.file_path}#page=${testOccurrence.pageNumber}`);
    console.log(`   - This should show content containing: "${searchTerm}"`);
  }

  // Test different search terms
  console.log('\n🔍 Testing Additional Search Terms:');
  const testTerms = ['Docker', 'monitoring', 'SLO'];

  for (const term of testTerms) {
    const results = enhancedSearch.getBookOccurrences(bookId, term, {
      limit: 1,
      matchType: 'any'
    });

    if (results.length > 0) {
      const physicalPage = results[0].pageNumber;
      const logicalPage = physicalPage - pageOffset;
      console.log(`   "${term}": Physical page ${physicalPage} → Display as Page ${logicalPage}`);
    } else {
      console.log(`   "${term}": No occurrences found`);
    }
  }

  console.log('\n' + '=' .repeat(60));
  console.log('✨ Page navigation test complete!\n');
}

// Run the test
testPageNavigation().catch(console.error);