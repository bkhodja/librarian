// Script to trigger reprocessing of ePUB files
const { db } = require('./server/database/init');

console.log('🔄 Marking ePUB files for reprocessing...\n');

// Find all ePUB files in the database
const epubFiles = db.prepare(`
  SELECT id, file_path, title
  FROM books
  WHERE file_path LIKE '%.epub'
`).all();

console.log(`Found ${epubFiles.length} ePUB files`);

if (epubFiles.length > 0) {
  // Mark them as unprocessed by clearing their language field
  const update = db.prepare(`
    UPDATE books
    SET language = NULL
    WHERE id = ?
  `);

  const transaction = db.transaction((files) => {
    for (const file of files) {
      update.run(file.id);
      console.log(`✅ Marked for reprocessing: ${file.title}`);
    }
  });

  transaction(epubFiles);

  console.log(`\n✅ All ${epubFiles.length} ePUB files marked for reprocessing`);
  console.log('\nThe background task manager will process them automatically.');
  console.log('Check the server logs to monitor processing progress.');
} else {
  console.log('No ePUB files found in the database');
}

db.close();