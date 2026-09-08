const epubProcessor = require('./server/services/epubProcessorImproved');
const { db } = require('./server/database/init');
const path = require('path');
const fs = require('fs');

async function testEpubThumbnail() {
  console.log('Testing improved ePUB thumbnail extraction...\n');

  // Get one ePUB file to test
  const epubBook = db.prepare(`
    SELECT id, file_path, title
    FROM books
    WHERE file_path LIKE '%.epub'
    LIMIT 1
  `).get();

  if (!epubBook) {
    console.log('No ePUB books found in database');
    return;
  }

  console.log(`Testing with: ${epubBook.title}`);
  console.log(`File: ${path.basename(epubBook.file_path)}\n`);

  // Check if the file exists
  if (!fs.existsSync(epubBook.file_path)) {
    console.error(`File not found: ${epubBook.file_path}`);
    return;
  }

  // Generate a test thumbnail
  const testOutputPath = path.join(__dirname, 'public/thumbnails', `test_${epubBook.id}.png`);

  console.log('Extracting cover image...');
  const result = await epubProcessor.generateThumbnail(epubBook.file_path, testOutputPath);

  if (result.success) {
    console.log(`✅ Thumbnail generated successfully: ${testOutputPath}`);

    // Check file size to see if it's a real image or placeholder
    const stats = fs.statSync(testOutputPath);
    console.log(`File size: ${stats.size} bytes`);

    if (stats.size > 5000) {
      console.log('📖 Likely extracted a real cover image!');
    } else {
      console.log('🎨 Generated a placeholder (no cover found in ePUB)');
    }
  } else {
    console.error(`❌ Failed to generate thumbnail: ${result.error}`);
  }

  db.close();
}

testEpubThumbnail().catch(console.error);