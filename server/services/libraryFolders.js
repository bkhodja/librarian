const path = require('path');

/**
 * The folders the library is read from, and what each holds.
 *
 * Books and magazines are the same kind of row — a PDF or ePUB with a cover,
 * text, tags and an embedding — told apart by which folder the file is in.
 * A magazine's series ("Coffee Magazine") is the folder directly under the
 * magazines folder; a file loose in the magazines folder has none.
 */

const BOOKS_FOLDER = path.resolve(process.env.BOOKS_FOLDER || '/Volumes/Storage/Books');
const MAGAZINES_FOLDER = path.resolve(process.env.MAGAZINES_FOLDER || '/Volumes/Storage/Magazines');

const ROOTS = [
  { kind: 'book', folder: BOOKS_FOLDER },
  { kind: 'magazine', folder: MAGAZINES_FOLDER }
];

const KINDS = ROOTS.map((root) => root.kind);

function isInside(filePath, folder) {
  return path.resolve(filePath).startsWith(folder + path.sep);
}

/** The root a file belongs to, or null if it is in neither folder. */
function rootFor(filePath) {
  return ROOTS.find((root) => isInside(filePath, root.folder)) || null;
}

function kindForPath(filePath) {
  return rootFor(filePath)?.kind || 'book';
}

function seriesForPath(filePath) {
  if (!isInside(filePath, MAGAZINES_FOLDER)) return null;
  const parts = path.relative(MAGAZINES_FOLDER, path.resolve(filePath)).split(path.sep);
  return parts.length > 1 ? parts[0] : null;
}

/**
 * Keep books.kind and books.series in step with file_path, however a row gets
 * in: the scanner, the watcher, the manual scan and the add-a-book endpoint
 * each insert their own way. A trigger covers them all; it is rebuilt on every
 * start because the folder can change, and existing rows are reclassified.
 */
function installClassifier(db) {
  const prefix = MAGAZINES_FOLDER + path.sep;
  const rest = `substr(NEW.file_path, ${prefix.length + 1})`;
  const quoted = `'${prefix.replace(/'/g, "''")}'`;

  db.exec(`
    DROP TRIGGER IF EXISTS books_classify;
    CREATE TRIGGER books_classify AFTER INSERT ON books
    WHEN substr(NEW.file_path, 1, ${prefix.length}) = ${quoted}
    BEGIN
      UPDATE books SET
        kind = 'magazine',
        series = CASE WHEN instr(${rest}, '/') > 0
                      THEN substr(${rest}, 1, instr(${rest}, '/') - 1) END
      WHERE id = NEW.id;
    END;
  `);

  const rows = db.prepare('SELECT id, file_path, kind, series FROM books').all();
  const update = db.prepare('UPDATE books SET kind = ?, series = ? WHERE id = ?');
  let changed = 0;
  db.transaction(() => {
    for (const row of rows) {
      const kind = kindForPath(row.file_path);
      const series = seriesForPath(row.file_path);
      if (kind !== row.kind || series !== row.series) {
        update.run(kind, series, row.id);
        changed++;
      }
    }
  })();
  return changed;
}

module.exports = {
  BOOKS_FOLDER,
  MAGAZINES_FOLDER,
  ROOTS,
  KINDS,
  rootFor,
  kindForPath,
  seriesForPath,
  installClassifier
};
