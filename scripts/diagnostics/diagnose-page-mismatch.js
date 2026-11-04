#!/usr/bin/env node

const { db } = require('../../server/database/init');

// Diagnose the page mismatch issue
console.log('🔍 Diagnosing Page Number Mismatch\n');
console.log('=' .repeat(70));

const bookId = 23;

// Get the search results that user sees
const searchResults = db.prepare(`
  SELECT
    bp.page_number as stored_page,
    substr(bp.content, 1, 200) as content_snippet
  FROM book_pages bp
  JOIN pages_fts pf ON pf.page_id = bp.id
  WHERE bp.book_id = ?
    AND pf.content MATCH 'Kubernetes'
  ORDER BY bp.page_number
  LIMIT 20
`).all(bookId);

console.log('\n📚 Book: Site Reliability Workbook');
console.log('Search term: "Kubernetes"\n');
console.log('What the system shows:\n');

searchResults.forEach((result, index) => {
  console.log(`Result ${index + 1}:`);
  console.log(`  Stored as page: ${result.stored_page}`);
  console.log(`  Content: ${result.content_snippet.substring(0, 100).replace(/\s+/g, ' ')}...`);
  console.log();
});

// Now check what specific pages contain
console.log('\n' + '=' .repeat(70));
console.log('📄 Checking specific pages around where user found the issue:\n');

const pagesToCheck = [136, 137, 138, 139, 140, 143, 144, 145, 146];
pagesToCheck.forEach(pageNum => {
  const page = db.prepare(`
    SELECT substr(content, 1, 150) as snippet
    FROM book_pages
    WHERE book_id = ? AND page_number = ?
  `).get(bookId, pageNum);

  if (page) {
    const hasKubernetes = page.snippet.toLowerCase().includes('kubernetes');
    console.log(`Page ${pageNum}: ${hasKubernetes ? '✓ HAS "Kubernetes"' : '  no kubernetes'}`);
    if (hasKubernetes) {
      console.log(`  Content: "${page.snippet.substring(0, 80).replace(/\s+/g, ' ')}..."`);
    }
  } else {
    console.log(`Page ${pageNum}: [not in database]`);
  }
});

console.log('\n' + '=' .repeat(70));
console.log('\n💡 Analysis:');
console.log('If you see "Kubernetes" content at page X in our database,');
console.log('but it appears at page Y in the PDF viewer, then:');
console.log('Our extraction is off by: Y - X pages\n');

// Search for the specific text user mentioned
const userText = db.prepare(`
  SELECT page_number, substr(content, 1, 300) as snippet
  FROM book_pages
  WHERE book_id = ?
    AND (content LIKE '%useful introduction to Kubernetes%'
         OR content LIKE '%kubernetes.io/docs/concepts%'
         OR content LIKE '%beast of a system%')
  LIMIT 1
`).get(bookId);

if (userText) {
  console.log('🎯 Found the exact text you mentioned!');
  console.log(`   Stored at page: ${userText.page_number}`);
  console.log(`   You said it's at PDF page: 145 (printed as 128)`);
  console.log(`   Extraction offset: ${145 - userText.page_number} pages\n`);
  console.log(`   Content: "${userText.snippet.substring(0, 150).replace(/\s+/g, ' ')}..."`);
}