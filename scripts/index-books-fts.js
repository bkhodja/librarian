#!/usr/bin/env node

const fullTextSearch = require('../server/services/fullTextSearch');
const { db } = require('../server/database/init');

async function indexBooks() {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 FULL-TEXT SEARCH INDEXING');
  console.log('='.repeat(80) + '\n');

  // Check current status
  const stats = fullTextSearch.getIndexStats();
  if (stats) {
    console.log('Current Index Status:');
    console.log(`  Total books: ${stats.totalBooks}`);
    console.log(`  Indexed books: ${stats.indexedBooks}`);
    console.log(`  Coverage: ${stats.coverage}%`);
    console.log('');
  }

  const args = process.argv.slice(2);
  const forceRebuild = args.includes('--rebuild');

  if (forceRebuild) {
    console.log('🔄 Force rebuild mode: Clearing existing index...\n');
    await fullTextSearch.rebuildIndex();
  } else {
    await fullTextSearch.indexAllBooks();
  }

  // Show final stats
  const finalStats = fullTextSearch.getIndexStats();
  if (finalStats) {
    console.log('\n' + '='.repeat(80));
    console.log('📊 FINAL INDEX STATISTICS');
    console.log('='.repeat(80));
    console.log(`  Total books: ${finalStats.totalBooks}`);
    console.log(`  Indexed books: ${finalStats.indexedBooks}`);
    console.log(`  Books with page data: ${finalStats.booksWithPages}`);
    console.log(`  Total pages indexed: ${finalStats.totalPages}`);
    console.log(`  Coverage: ${finalStats.coverage}%`);
  }

  console.log('\n✅ Indexing complete! Full-text search is now available.\n');
}

// Run the indexing
indexBooks().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});