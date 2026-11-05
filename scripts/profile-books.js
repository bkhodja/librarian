/**
 * Book profiles (level, audience, prerequisites) for the library chat.
 *
 *   node scripts/profile-books.js                 # profile every pending book
 *   node scripts/profile-books.js --limit=50      # cap how many this run
 *   node scripts/profile-books.js --ids=12,40     # these books, even if profiled
 *   node scripts/profile-books.js --tag=databases # books with this tag, even if profiled
 *
 * The background sweep does the same thing unattended. Runs against the local
 * model through Ollama. Nothing leaves the machine.
 */
require('dotenv').config();
const { db } = require('../server/database/init');
const ollama = require('../server/services/ollamaClient');
const profiler = require('../server/services/bookProfiler');

const args = process.argv.slice(2);
const arg = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const limit = Number(arg('limit')) || -1;

function selectBooks() {
  if (arg('ids')) return arg('ids').split(',').map(Number);
  if (arg('tag')) {
    return db.prepare(`
      SELECT bt.book_id AS id FROM book_tags bt JOIN tags t ON t.id = bt.tag_id
      WHERE t.name = ? ORDER BY bt.book_id LIMIT ?
    `).all(arg('tag'), limit).map((b) => b.id);
  }
  return profiler.pendingBooks(limit).map((b) => b.id);
}

(async () => {
  if (!(await ollama.isAvailable())) {
    console.error('Ollama is not reachable. Start it and try again.');
    process.exit(1);
  }

  const ids = selectBooks();
  console.log(`Profiling ${ids.length} book(s) with ${profiler.PROFILE_KEY}\n`);

  for (const id of ids) {
    const started = Date.now();
    const { title } = db.prepare('SELECT title FROM books WHERE id = ?').get(id) || {};
    const profile = await profiler.profileBook(id);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(profile
      ? `${id}\tL${profile.level} ${profile.kind}\t${seconds}s\t${title}\n\t${profile.summary}`
      : `${id}\t—\t${seconds}s\t${title} (no usable profile)`);
  }

  console.log(`\n${profiler.countProfiled()} profiled, ${profiler.countPending()} pending`);
  db.close();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
