const metadataEnricher = require('../server/services/bookMetadataEnricher');
const { db } = require('../server/database/init');

async function enrichAllBooks() {
  console.log('\n' + '='.repeat(80));
  console.log('📚 BATCH METADATA ENRICHMENT');
  console.log('='.repeat(80) + '\n');

  // Get all books that don't have enriched metadata yet
  const books = db.prepare(`
    SELECT id, title, author, isbn, file_path,
           description, metadata_source
    FROM books
    WHERE (metadata_source IS NULL OR metadata_source = '')
    ORDER BY
      CASE WHEN isbn IS NOT NULL THEN 0 ELSE 1 END,
      id
  `).all();

  console.log(`Found ${books.length} books without external metadata\n`);

  if (books.length === 0) {
    console.log('All books already have metadata from external sources!');
    return;
  }

  const stats = {
    total: books.length,
    enriched: 0,
    failed: 0,
    skipped: 0,
    sources: {
      'Open Library': 0,
      'Google Books': 0
    }
  };

  console.log('Starting enrichment process...');
  console.log('(This may take a while - rate limiting to avoid API blocks)\n');
  console.log('─'.repeat(80));

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    const progress = `[${i + 1}/${books.length}]`;

    // Skip books with very minimal info
    if (!book.isbn && (!book.title || !book.author)) {
      console.log(`${progress} ⏭️  Skipping: ${book.file_path} (insufficient metadata)`);
      stats.skipped++;
      continue;
    }

    const bookInfo = book.isbn
      ? `"${book.title || 'Unknown'}" (ISBN: ${book.isbn})`
      : `"${book.title}" by ${book.author}`;

    console.log(`${progress} 🔍 Processing: ${bookInfo}`);

    try {
      const enrichedBook = await metadataEnricher.enrichBook(book.id);

      if (enrichedBook && enrichedBook.metadata_source) {
        console.log(`      ✅ Enriched from ${enrichedBook.metadata_source}`);

        // Show what was added
        const additions = [];
        if (enrichedBook.description && !book.description) additions.push('description');
        if (enrichedBook.categories) additions.push('categories');
        if (enrichedBook.average_rating) additions.push('rating');
        if (enrichedBook.thumbnail_url) additions.push('cover');

        if (additions.length > 0) {
          console.log(`      📝 Added: ${additions.join(', ')}`);
        }

        stats.enriched++;
        stats.sources[enrichedBook.metadata_source] =
          (stats.sources[enrichedBook.metadata_source] || 0) + 1;
      } else {
        console.log(`      ❌ No metadata found`);
        stats.failed++;
      }
    } catch (error) {
      console.log(`      ⚠️  Error: ${error.message}`);
      stats.failed++;
    }

    // Add delay to avoid rate limiting (500ms between requests)
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n' + '='.repeat(80));
  console.log('📊 ENRICHMENT COMPLETE');
  console.log('='.repeat(80));
  console.log(`\nTotal books processed: ${stats.total}`);
  console.log(`✅ Successfully enriched: ${stats.enriched} (${Math.round(stats.enriched / stats.total * 100)}%)`);
  console.log(`❌ No metadata found: ${stats.failed} (${Math.round(stats.failed / stats.total * 100)}%)`);
  console.log(`⏭️  Skipped (no info): ${stats.skipped}`);

  console.log('\nMetadata sources:');
  for (const [source, count] of Object.entries(stats.sources)) {
    if (count > 0) {
      console.log(`  - ${source}: ${count} books`);
    }
  }

  // Show some statistics about what was enriched
  const enrichedStats = db.prepare(`
    SELECT
      COUNT(*) as total_enriched,
      COUNT(CASE WHEN description IS NOT NULL THEN 1 END) as with_description,
      COUNT(CASE WHEN categories IS NOT NULL THEN 1 END) as with_categories,
      COUNT(CASE WHEN average_rating IS NOT NULL THEN 1 END) as with_rating,
      COUNT(CASE WHEN thumbnail_url IS NOT NULL THEN 1 END) as with_cover
    FROM books
    WHERE metadata_source IS NOT NULL
  `).get();

  console.log('\n📈 Overall library statistics:');
  console.log(`  - Books with descriptions: ${enrichedStats.with_description}`);
  console.log(`  - Books with categories: ${enrichedStats.with_categories}`);
  console.log(`  - Books with ratings: ${enrichedStats.with_rating}`);
  console.log(`  - Books with cover images: ${enrichedStats.with_cover}`);

  console.log('\n✨ Done! Refresh your browser to see the enriched metadata.\n');
}

// Run with command line options
const args = process.argv.slice(2);
const forceAll = args.includes('--force-all');

if (forceAll) {
  console.log('Force mode: Will re-enrich all books, including those with existing metadata');
  // Clear metadata source to force re-enrichment
  db.prepare('UPDATE books SET metadata_source = NULL').run();
}

// Run the enrichment
enrichAllBooks().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});