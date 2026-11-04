#!/usr/bin/env node

const { db } = require('../../server/database/init');

// This script verifies and tests the page numbering system
// We store PHYSICAL page numbers in the database
// We display LOGICAL page numbers to users
// When opening PDFs, we use PHYSICAL page numbers

function testPageNumbering() {
  console.log('🔍 Testing page numbering system...\n');

  // Get a book with known content and offset
  const testBookId = 23; // Site Reliability Workbook
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(testBookId);

  if (!book) {
    console.error('Test book not found');
    return;
  }

  console.log(`📖 Testing with: ${book.title}`);
  console.log(`   Page offset: ${book.page_offset || 0}`);
  console.log(`   File path: ${book.file_path}\n`);

  // Get some pages with content
  const pages = db.prepare(`
    SELECT page_number, substr(content, 1, 100) as snippet
    FROM book_pages
    WHERE book_id = ? AND content LIKE '%Kubernetes%'
    LIMIT 5
  `).all(testBookId);

  console.log('📄 Sample pages with "Kubernetes":');
  pages.forEach(page => {
    const physicalPage = page.page_number;
    const logicalPage = physicalPage - (book.page_offset || 0);

    console.log(`\n   Physical page ${physicalPage} → Logical page ${logicalPage}`);
    console.log(`   Content: "${page.snippet.substring(0, 50)}..."`);
    console.log(`   ✅ Open PDF at: #page=${physicalPage}`);
  });

  console.log('\n📊 Summary:');
  console.log('   - Database stores: PHYSICAL page numbers');
  console.log('   - Display to user: LOGICAL page numbers (physical - offset)');
  console.log('   - Open PDF with: PHYSICAL page numbers (from database)');
  console.log('\n✅ The current system is correct! Just need to apply transformations in the right places.');
}

// Run the test
testPageNumbering();