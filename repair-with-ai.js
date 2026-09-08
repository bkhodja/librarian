/**
 * Metadata repairs that need the local model.
 *
 *   node repair-with-ai.js              # titles and authors
 *   node repair-with-ai.js --limit=20   # try a few first
 *   node repair-with-ai.js --dry-run    # show what it would change
 *
 * Runs against Ollama on this machine. Nothing leaves it.
 */
const repair = require('./server/services/aiMetadataRepair');
const ollama = require('./server/services/ollamaClient');
const { db } = require('./server/database/init');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

(async () => {
  if (!(await ollama.isAvailable())) {
    console.error(`Ollama is not reachable at ${ollama.host}. Start it and try again.`);
    return db.close();
  }

  const slugs = repair.booksWithSlugTitles();
  const missing = repair.booksMissingAuthor();
  console.log(`Model: ${ollama.model}`);
  console.log(`${slugs.length} run-together title(s), ${missing.length} book(s) without an author\n`);

  if (dryRun) {
    for (const book of slugs.slice(0, Math.min(limit, 10))) {
      console.log(`  ${JSON.stringify(book.title)}\n    -> ${JSON.stringify(await repair.repairTitle(book))}`);
    }
    return db.close();
  }

  const started = Date.now();
  const stats = await repair.run({
    limit,
    onProgress: (p) => {
      if (p.kind === 'title') console.log(`  title  ${p.from.slice(0, 40).padEnd(42)} -> ${p.to}`);
      else console.log(`  author ${(p.title || '').slice(0, 40).padEnd(42)} -> ${p.to}`);
    }
  });

  console.log(`\n${stats.titles} title(s) and ${stats.authors} author(s) repaired ` +
              `in ${Math.round((Date.now() - started) / 1000)}s`);
  console.log(`${stats.titleRejected} title(s) and ${stats.authorRejected} author(s) left alone ` +
              `— the model's answer did not pass the quality check`);

  db.close();
})();
