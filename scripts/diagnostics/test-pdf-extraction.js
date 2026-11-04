const pdfProcessor = require('../../server/services/pdfProcessor');
const path = require('path');

// Test cases with different filename patterns
const testFilenames = [
  'John Doe - The Art of Programming - 2023.pdf',
  'Jane Smith - Machine Learning Basics (2022).pdf',
  'Clean Code - Robert Martin.pdf',
  'Programming in Python by Guido van Rossum.pdf',
  'Database Design 2024.pdf',
  'Smith, John - Data Structures and Algorithms - 2021.pdf',
  'Deep Learning (Ian Goodfellow, Yoshua Bengio) 2016.pdf',
  'The Pragmatic Programmer - Andrew Hunt & David Thomas - 1999.pdf'
];

console.log('Testing PDF metadata extraction for author and publication year\n');
console.log('=' .repeat(70));

// Test filename parsing
testFilenames.forEach(filename => {
  // Create a mock PDF result
  const mockResult = {
    metadata: {}
  };

  // Extract year from filename
  let extractedYear = null;
  const yearMatch = filename.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1]);
    if (year >= 1900 && year <= new Date().getFullYear()) {
      extractedYear = year;
    }
  }

  // Clean up filename
  const baseName = path.basename(filename, '.pdf');
  let cleanFileName = baseName
    .replace(/_\d+$/, '')
    .replace(/\s*[-–—]\s*\d{4}$/, '')
    .replace(/\s*\(\d{4}\)$/, '')
    .replace(/,?\s*\d+[-е]?\s*(изд|издание|edition|ed)\.?$/i, '')
    .trim();

  // Parse author and title patterns
  const patterns = [
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*[-–—]\s*(.+)$/,
    /^(.+?)\s*[-–—]\s*(.+?)\s*[-–—]\s*\d{4}$/,
    /^(.+?)\s*[-–—]\s*(.+)$/,
    /^(.+?)\.\s+(.+)$/,
    /^(.+?),\s*(.+)$/,
    /^(.+?)\s+by\s+(.+)$/i,
    /^(.+?)\s*\((.+?)\)$/,
  ];

  let extractedTitle = cleanFileName;
  let extractedAuthor = null;

  for (const pattern of patterns) {
    const match = cleanFileName.match(pattern);
    if (match) {
      const part1 = match[1].trim();
      const part2 = match[2].trim();

      // Simple heuristic for author detection
      const looksLikeAuthor = (text) => {
        const words = text.split(/\s+/);
        return words.length >= 2 && words.length <= 4 &&
               /^[A-Z][a-z]+/.test(words[0]) &&
               !/[&+#@]/.test(text);
      };

      if (/by\s+/i.test(cleanFileName)) {
        extractedTitle = part1;
        extractedAuthor = part2;
      } else if (looksLikeAuthor(part1)) {
        extractedAuthor = part1;
        extractedTitle = part2;
      } else {
        extractedTitle = part1;
        extractedAuthor = part2;
      }
      break;
    }
  }

  console.log(`\nFilename: ${filename}`);
  console.log(`  Title:  ${extractedTitle || 'Not extracted'}`);
  console.log(`  Author: ${extractedAuthor || 'Not extracted'}`);
  console.log(`  Year:   ${extractedYear || 'Not extracted'}`);
});

console.log('\n' + '=' .repeat(70));
console.log('\nNote: This test only validates filename parsing logic.');
console.log('For actual PDF metadata extraction, scan real PDF files in your library.');
console.log('\nTo test with real PDFs:');
console.log('1. Place PDF files in your configured Books folder');
console.log('2. Run "Scan Library" from the UI');
console.log('3. Check if author and publication year are extracted correctly');