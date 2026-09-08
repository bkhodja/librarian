#!/usr/bin/env node
/**
 * Repair double-quoted string literals in the stored schema.
 *
 *   node scripts/repair-schema.js --dry-run   # show what would change
 *   node scripts/repair-schema.js             # repair, keeping a backup
 *   node scripts/repair-schema.js --vacuum    # repair, then reclaim space
 *
 * A migration wrote `DEFAULT "not_needed"` into the books table. SQLite
 * accepts double-quoted string literals when the statement runs but treats
 * them as identifiers when it re-parses the schema, so VACUUM — and anything
 * built on it — fails outright. Only the recorded schema text is wrong; the
 * data is fine.
 *
 * Editing sqlite_master needs writable_schema, so this takes a full backup
 * first and refuses to continue without one.
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const doVacuum = args.includes('--vacuum');

const dbFile = process.env.DATABASE_PATH
  ? path.resolve(ROOT, process.env.DATABASE_PATH)
  : path.join(ROOT, 'data/librarian.db');

const mb = (f) => (fs.existsSync(f) ? (fs.statSync(f).size / 1048576).toFixed(0) + 'MB' : '—');

// Literals that belong to the known bad migration. Deliberately specific:
// a blanket replace of every double-quoted token in the schema would also
// rewrite genuinely quoted identifiers.
const LITERALS = ['not_needed', 'pending', 'processing', 'completed', 'failed'];

function findBadTables(db) {
  return db.prepare(
    "SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL AND type = 'table'"
  ).all().filter((row) => LITERALS.some((l) => row.sql.includes(`"${l}"`)));
}

const fix = (sql) =>
  LITERALS.reduce((acc, l) => acc.split(`"${l}"`).join(`'${l}'`), sql);

(async () => {
  if (!fs.existsSync(dbFile)) {
    console.error(`No database at ${dbFile}`);
    process.exit(1);
  }

  console.log(`Database: ${dbFile}  (${mb(dbFile)})\n`);

  const probe = new Database(dbFile, { readonly: true });
  const bad = findBadTables(probe);

  if (bad.length === 0) {
    console.log('Nothing to repair — no double-quoted literals in the schema.');
    // Confirm the consequence rather than just the cause.
    try {
      probe.close();
      const w = new Database(dbFile);
      w.exec('VACUUM');
      w.close();
      console.log('VACUUM succeeds.');
    } catch (error) {
      console.log(`VACUUM still fails: ${error.message}`);
    }
    process.exit(0);
  }

  for (const table of bad) {
    console.log(`  ${table.name}:`);
    for (const l of LITERALS) {
      if (table.sql.includes(`"${l}"`)) console.log(`    "${l}"  ->  '${l}'`);
    }
  }
  probe.close();

  if (dryRun) {
    console.log('\nDry run — nothing written.');
    process.exit(0);
  }

  // Backup before touching sqlite_master. Non-negotiable.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backup = `${dbFile}.backup-${stamp}`;
  console.log(`\nBacking up to ${path.basename(backup)}…`);

  const source = new Database(dbFile, { readonly: true });
  await source.backup(backup);
  source.close();

  if (!fs.existsSync(backup) || fs.statSync(backup).size === 0) {
    console.error('Backup failed; stopping without changing anything.');
    process.exit(1);
  }
  console.log(`  backup is ${mb(backup)}`);

  const db = new Database(dbFile);
  try {
    db.unsafeMode(true);
    db.pragma('writable_schema = ON');

    const update = db.prepare('UPDATE sqlite_master SET sql = ? WHERE name = ?');
    db.transaction(() => {
      for (const table of bad) update.run(fix(table.sql), table.name);
    })();

    db.pragma('writable_schema = OFF');
  } finally {
    db.unsafeMode(false);
  }

  const integrity = db.pragma('integrity_check', { simple: true });
  console.log(`\nintegrity_check: ${integrity}`);
  if (integrity !== 'ok') {
    console.error(`Repair left the database inconsistent. Restore from ${backup}`);
    process.exit(1);
  }

  const remaining = findBadTables(db);
  console.log(`double-quoted literals remaining: ${remaining.length}`);

  if (doVacuum) {
    console.log('\nVacuuming…');
    const started = Date.now();
    db.exec('VACUUM');
    console.log(`  done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } else {
    // Prove the repair achieved its purpose without rewriting the whole file.
    console.log('\nChecking that VACUUM would now work…');
    db.exec('PRAGMA schema_version');
  }

  db.close();

  console.log(`\nRepaired. ${mb(dbFile)} now.`);
  console.log(`Backup kept at ${backup} — delete it once you are satisfied.`);
})();
