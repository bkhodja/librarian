const { db } = require('./server/database/init');

console.log('Checking ePUB processing status...\n');

// Get sample ePUB books
const epubBooks = db.prepare(`
  SELECT id, title, author, language, page_count, thumbnail_path
  FROM books
  WHERE file_path LIKE '%.epub'
  LIMIT 5
`).all();

console.log(`Found ${epubBooks.length} ePUB books. Sample:\n`);

epubBooks.forEach(book => {
  console.log(`ID: ${book.id}`);
  console.log(`Title: ${book.title}`);
  console.log(`Author: ${book.author || 'Not set'}`);
  console.log(`Language: ${book.language || 'Not set'}`);
  console.log(`Page Count: ${book.page_count || 'Not set'}`);
  console.log(`Thumbnail: ${book.thumbnail_path || 'Not set'}`);
  console.log('---');
});

// Count processed vs unprocessed
const stats = db.prepare(`
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN language IS NOT NULL AND language != 'Not scanned' THEN 1 ELSE 0 END) as processed,
    SUM(CASE WHEN thumbnail_path IS NOT NULL THEN 1 ELSE 0 END) as with_thumbnails
  FROM books
  WHERE file_path LIKE '%.epub'
`).get();

console.log('\nePUB Processing Statistics:');
console.log(`Total ePUB files: ${stats.total}`);
console.log(`Processed: ${stats.processed}`);
console.log(`With thumbnails: ${stats.with_thumbnails}`);

db.close();