/**
 * Tag maintenance.
 *
 *   node retag-books.js              # normalise legacy tags, then tag untagged books
 *   node retag-books.js --normalize  # normalise only, no model calls
 *   node retag-books.js --all        # clear every tag and derive them all again
 *   node retag-books.js --limit=50   # cap how many books are tagged this run
 *
 * Runs against the local model through Ollama. Nothing leaves the machine.
 */
const { db } = require('./server/database/init');
const aiTagger = require('./server/services/aiTagger');

const args = process.argv.slice(2);
const normalizeOnly = args.includes('--normalize');
const retagAll = args.includes('--all');
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

(async () => {
  const status = await aiTagger.status();
  console.log(`Ollama: ${status.available ? `${status.model} at ${status.host}` : 'UNAVAILABLE'}`);
  console.log(`Vocabulary: ${status.vocabularySize} tags\n`);

  const normalized = aiTagger.normalizeExistingTags();
  const pruned = aiTagger.pruneOrphanTags();
  console.log(`Normalised: ${normalized.kept} kept, ${normalized.merged} merged onto the ` +
              `vocabulary, ${normalized.removed} dropped as non-subjects, ${pruned} orphan tag(s) pruned`);

  if (normalizeOnly) return finish();

  if (!status.available) {
    console.error('\nOllama is not reachable, so no tagging can run. Start it and try again.');
    return finish();
  }

  if (retagAll) {
    const { changes } = db.prepare('DELETE FROM book_tags').run();
    aiTagger.pruneOrphanTags();
    console.log(`Cleared ${changes} existing tag link(s) for a full re-tag`);
  }

  console.log(`\nTagging ${Math.min(aiTagger.countTaggable(), limit)} book(s)…\n`);

  // Recomputed each pass rather than counted once: the server's own tagging
  // sweep may be running against the same library, so a batch can come back
  // smaller than asked for without meaning the work is finished.
  let done = 0;
  while (done < limit) {
    const batch = Math.min(20, limit - done);
    const result = await aiTagger.tagUntagged(batch, ({ book, tags, source }) => {
      console.log(`  [${source}] ${(book.title || '').slice(0, 46).padEnd(48)} ${tags.join(', ')}`);
    });

    done += result.tagged + result.skipped;

    // Nothing left that has not already been tried.
    if (aiTagger.countTaggable() === 0) break;
  }

  finish();
})();

function finish() {
  const untried = aiTagger.countTaggable();
  const tagged = db.prepare('SELECT COUNT(DISTINCT book_id) AS c FROM book_tags').get().c;
  const total = db.prepare('SELECT COUNT(*) AS c FROM books').get().c;
  const tags = db.prepare('SELECT COUNT(*) AS c FROM tags').get().c;

  console.log(`\n${tagged}/${total} books tagged across ${tags} tags` +
              (untried > 0 ? ` (${untried} still to try)` : ''));
  console.log('\nMost used:');
  db.prepare(`
    SELECT t.name, COUNT(bt.book_id) AS c FROM tags t
    JOIN book_tags bt ON bt.tag_id = t.id
    GROUP BY t.id ORDER BY c DESC LIMIT 12
  `).all().forEach((r) => console.log(`  ${String(r.c).padStart(4)}x ${r.name}`));

  db.close();
}
