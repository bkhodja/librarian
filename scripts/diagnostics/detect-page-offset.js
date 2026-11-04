#!/usr/bin/env node

const pdfParse = require('pdf-parse');
const { db } = require('../../server/database/init');
const fs = require('fs');

async function detectPageOffset(bookId, filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);

    // Use a custom page render function to analyze first 50 pages
    let foundPage1 = -1;
    let pageCount = 0;

    const options = {
      max: 50, // Only check first 50 pages
      pagerender: async (pageData) => {
        pageCount++;
        const textContent = await pageData.getTextContent();
        const text = textContent.items.map(item => item.str).join(' ');
        const lowerText = text.toLowerCase();

        // Look for page number patterns
        const pagePatterns = [
          /\bpage\s+1\b/i,
          /^1$/,
          /^\s*1\s*$/,
          /\b-\s*1\s*-\b/,
          /\b1\s+\|/,
          /\|\s+1\b/
        ];

        // Check if this looks like page 1
        for (const pattern of pagePatterns) {
          if (pattern.test(text)) {
            if (foundPage1 === -1) {
              foundPage1 = pageCount;
              console.log(`Found "Page 1" pattern at physical page ${pageCount}`);
            }
            break;
          }
        }

        // Also check for content markers
        if (foundPage1 === -1 &&
            (lowerText.includes('introduction') ||
             lowerText.includes('chapter 1') ||
             lowerText.includes('chapter one') ||
             lowerText.includes('preface'))) {
          foundPage1 = pageCount;
          console.log(`Found content start at physical page ${pageCount}`);
        }

        return ''; // Return empty string, we only care about detection
      }
    };

    await pdfParse(dataBuffer, options);

    if (foundPage1 > 0) {
      const offset = foundPage1 - 1;
      console.log(`Book ${bookId}: Offset detected as ${offset}`);
      return offset;
    }

    console.log(`Book ${bookId}: No clear page 1 found, using default offset`);
    return 0;
  } catch (error) {
    console.error(`Error detecting offset for book ${bookId}:`, error.message);
    return 0;
  }
}

async function updateAllBookOffsets() {
  console.log('🔍 Detecting page offsets for all books...\n');

  const books = db.prepare('SELECT id, title, file_path FROM books WHERE file_path IS NOT NULL').all();
  let updated = 0;
  let failed = 0;

  for (const book of books) {
    if (!fs.existsSync(book.file_path)) {
      console.log(`❌ Book ${book.id} (${book.title}): File not found`);
      failed++;
      continue;
    }

    if (!book.file_path.toLowerCase().endsWith('.pdf')) {
      console.log(`⏭️  Book ${book.id} (${book.title}): Not a PDF`);
      continue;
    }

    process.stdout.write(`📖 Analyzing "${book.title.substring(0, 50)}..."... `);

    const offset = await detectPageOffset(book.id, book.file_path);

    // Update the database
    db.prepare('UPDATE books SET page_offset = ? WHERE id = ?').run(offset, book.id);

    if (offset > 0) {
      console.log(`✅ Offset: ${offset}`);
      updated++;
    } else {
      console.log('✅ No offset needed');
    }
  }

  console.log(`\n✅ Complete! Updated ${updated} books with page offsets.`);
  if (failed > 0) {
    console.log(`⚠️  ${failed} books had missing files.`);
  }
}

// Run if called directly
if (require.main === module) {
  const bookId = process.argv[2];

  if (bookId) {
    // Detect offset for a specific book
    const book = db.prepare('SELECT id, title, file_path FROM books WHERE id = ?').get(bookId);

    if (!book) {
      console.error('Book not found');
      process.exit(1);
    }

    detectPageOffset(book.id, book.file_path).then(offset => {
      db.prepare('UPDATE books SET page_offset = ? WHERE id = ?').run(offset, book.id);
      console.log(`Updated book ${book.id} with offset ${offset}`);
      process.exit(0);
    });
  } else {
    // Update all books
    updateAllBookOffsets().then(() => {
      process.exit(0);
    }).catch(error => {
      console.error('Error:', error);
      process.exit(1);
    });
  }
}

module.exports = { detectPageOffset };