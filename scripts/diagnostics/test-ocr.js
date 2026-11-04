#!/usr/bin/env node

const enhancedOCR = require('../../server/services/enhancedOCR');
const { db } = require('../../server/database/init');

async function testOCR() {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 TESTING ENHANCED OCR');
  console.log('='.repeat(80) + '\n');

  // Get OCR statistics
  const stats = enhancedOCR.getOCRStats();
  console.log('Current OCR Statistics:');
  console.log(`  Total scanned PDFs: ${stats.totalScanned}`);
  console.log(`  Processed: ${stats.processed}`);
  console.log(`  Pending: ${stats.pending}`);
  console.log(`  Average confidence: ${stats.avgConfidence.toFixed(1)}%\n`);

  // Get scanned books
  const scannedBooks = db.prepare(`
    SELECT id, title, file_path, pdf_type, ocr_processed
    FROM books
    WHERE pdf_type = 'scanned'
  `).all();

  if (scannedBooks.length === 0) {
    console.log('No scanned PDFs found in the library.');
    return;
  }

  console.log(`Found ${scannedBooks.length} scanned PDF(s):\n`);
  scannedBooks.forEach(book => {
    console.log(`  ID: ${book.id}`);
    console.log(`  Title: ${book.title || 'Untitled'}`);
    console.log(`  OCR Processed: ${book.ocr_processed ? 'Yes' : 'No'}`);
    console.log(`  Path: ${book.file_path}`);
    console.log('  ' + '-'.repeat(76));
  });

  // Process the first unprocessed scanned book
  const unprocessedBook = scannedBooks.find(b => !b.ocr_processed);

  if (unprocessedBook) {
    console.log(`\nProcessing OCR for: ${unprocessedBook.title || 'Untitled'}`);
    console.log('='.repeat(80));

    const result = await enhancedOCR.performOCROnPDF(unprocessedBook.id, {
      forceReprocess: false
    });

    console.log('\nOCR Result:');
    console.log(`  Success: ${result.success}`);
    console.log(`  Message: ${result.message}`);
    if (result.textLength) {
      console.log(`  Text length: ${result.textLength} characters`);
    }
    if (result.confidence) {
      console.log(`  Confidence: ${result.confidence}%`);
    }
    if (result.pageCount) {
      console.log(`  Pages processed: ${result.pageCount}`);
    }
  } else {
    console.log('\nAll scanned PDFs have been processed. Use --force to reprocess.');
  }

  // Get updated stats
  const updatedStats = enhancedOCR.getOCRStats();
  console.log('\n' + '='.repeat(80));
  console.log('📊 UPDATED OCR STATISTICS');
  console.log('='.repeat(80));
  console.log(`  Total scanned PDFs: ${updatedStats.totalScanned}`);
  console.log(`  Processed: ${updatedStats.processed}`);
  console.log(`  Pending: ${updatedStats.pending}`);
  console.log(`  Average confidence: ${updatedStats.avgConfidence.toFixed(1)}%`);

  console.log('\n✅ OCR test complete!\n');
}

// Run the test
testOCR().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});