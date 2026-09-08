const epubProcessor = require('./server/services/epubProcessorImproved');
const { db } = require('./server/database/init');
const path = require('path');
const fs = require('fs');

async function regenerateEpubThumbnails() {
  console.log('🔄 Regenerating ePUB thumbnails with improved extraction...\n');

  // Get all ePUB books
  const epubBooks = db.prepare(`
    SELECT id, file_path, title, thumbnail_path
    FROM books
    WHERE file_path LIKE '%.epub'
    ORDER BY id
  `).all();

  console.log(`Found ${epubBooks.length} ePUB books to process\n`);

  let successCount = 0;
  let realCoverCount = 0;
  let placeholderCount = 0;
  let failureCount = 0;

  for (const book of epubBooks) {
    console.log(`Processing: ${book.title} (ID: ${book.id})`);

    // Check if the file exists
    if (!fs.existsSync(book.file_path)) {
      console.error(`  ❌ File not found: ${book.file_path}`);
      failureCount++;
      continue;
    }

    // Generate thumbnail
    const outputPath = path.join(__dirname, 'public/thumbnails', `${book.id}.png`);

    try {
      const result = await epubProcessor.generateThumbnail(book.file_path, outputPath);

      if (result.success) {
        // Check file size to see if it's a real image or placeholder
        const stats = fs.statSync(outputPath);

        if (stats.size > 5000) {
          console.log(`  ✅ Extracted real cover (${Math.round(stats.size / 1024)}KB)`);
          realCoverCount++;
        } else {
          console.log(`  🎨 Generated placeholder (no cover found)`);
          placeholderCount++;
        }

        // Update database with relative path
        const thumbnailPath = `/thumbnails/${book.id}.png`;
        db.prepare(`
          UPDATE books
          SET thumbnail_path = ?
          WHERE id = ?
        `).run(thumbnailPath, book.id);

        successCount++;
      } else {
        console.error(`  ❌ Failed: ${result.error}`);
        failureCount++;
      }
    } catch (error) {
      console.error(`  ❌ Error: ${error.message}`);
      failureCount++;
    }
  }

  console.log('\n📊 Summary:');
  console.log(`Total ePUB books: ${epubBooks.length}`);
  console.log(`✅ Successfully processed: ${successCount}`);
  console.log(`📖 Real covers extracted: ${realCoverCount}`);
  console.log(`🎨 Placeholders generated: ${placeholderCount}`);
  console.log(`❌ Failed: ${failureCount}`);

  db.close();
}

regenerateEpubThumbnails().catch(console.error);