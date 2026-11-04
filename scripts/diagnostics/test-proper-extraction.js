#!/usr/bin/env node

const properPdfExtractor = require('../../server/services/properPdfExtractor');
const { db } = require('../../server/database/init');

async function testExtraction() {
  console.log('🔍 Testing Proper PDF Extraction\n');
  console.log('=' .repeat(70));

  const bookId = 23;
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);

  if (!book || !book.file_path) {
    console.error('Book not found or no file path');
    return;
  }

  console.log(`📚 Book: ${book.title}`);
  console.log(`📁 File: ${book.file_path}\n`);

  // First, search for the text patterns user mentioned
  console.log('🔎 Searching for "kubernetes.io" in the PDF...\n');

  const matches = await properPdfExtractor.findTextInPdf(
    book.file_path,
    'kubernetes.io',
    { maxResults: 5 }
  );

  if (matches.length > 0) {
    console.log(`Found ${matches.length} matches:\n`);
    matches.forEach((match, i) => {
      console.log(`Match ${i + 1}: Page ${match.pageNumber}`);
      console.log(`  Context: ...${match.context}...\n`);
    });
  } else {
    console.log('No matches found for "kubernetes.io"\n');
  }

  // Now check specific pages around where user said the text is
  console.log('📄 Checking pages 143-147 (around where user found the text):\n');

  for (let pageNum = 143; pageNum <= 147; pageNum++) {
    const page = await properPdfExtractor.extractSinglePage(book.file_path, pageNum);

    if (page) {
      const hasKubernetes = page.content.toLowerCase().includes('kubernetes');
      const hasIntroduction = page.content.toLowerCase().includes('introduction');
      const hasKubernetesIo = page.content.includes('kubernetes.io');

      console.log(`Page ${pageNum}:`);
      if (hasKubernetes || hasIntroduction || hasKubernetesIo) {
        console.log(`  ✓ Found relevant content!`);
        if (hasKubernetes) console.log(`    - Contains "kubernetes"`);
        if (hasIntroduction) console.log(`    - Contains "introduction"`);
        if (hasKubernetesIo) console.log(`    - Contains "kubernetes.io"`);
        console.log(`  Preview: ${page.content.substring(0, 150)}...`);
      } else {
        console.log(`  - No kubernetes-related content`);
      }
      console.log();
    }
  }

  // Compare with what's in our database
  console.log('📊 Comparison with current database:\n');

  for (let pageNum = 143; pageNum <= 147; pageNum++) {
    const dbPage = db.prepare(`
      SELECT substr(content, 1, 150) as snippet
      FROM book_pages
      WHERE book_id = ? AND page_number = ?
    `).get(bookId, pageNum);

    const pdfPage = await properPdfExtractor.extractSinglePage(book.file_path, pageNum);

    if (dbPage && pdfPage) {
      const dbSnippet = dbPage.snippet.substring(0, 50).replace(/\s+/g, ' ');
      const pdfSnippet = pdfPage.content.substring(0, 50).replace(/\s+/g, ' ');

      console.log(`Page ${pageNum}:`);
      console.log(`  DB:  "${dbSnippet}..."`);
      console.log(`  PDF: "${pdfSnippet}..."`);
      console.log(`  Match: ${dbSnippet === pdfSnippet ? '✓' : '✗ DIFFERENT!'}`);
      console.log();
    }
  }
}

testExtraction().catch(console.error);