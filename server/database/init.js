const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

/**
 * Which database file to open.
 *
 * DATABASE_PATH was documented in .env.example but nothing read it — the path
 * was hardcoded, so there was no way to point the app at a copy. Anything that
 * might destroy data had to be tried against the real library.
 *
 * Relative paths resolve from the project root, so DATABASE_PATH=./data/test.db
 * means what it looks like from the command line.
 */
const DEFAULT_DB = path.join(__dirname, '../../data/librarian.db');
const dbFile = process.env.DATABASE_PATH
  ? path.resolve(__dirname, '../..', process.env.DATABASE_PATH)
  : DEFAULT_DB;

fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const isDefault = path.resolve(dbFile) === path.resolve(DEFAULT_DB);

// Always say which file is open. Working on the wrong database is the kind of
// mistake that is only obvious afterwards.
console.log(isDefault
  ? `📚 Library database: ${dbFile}`
  : `🧪 Library database: ${dbFile}  (not the default — set by DATABASE_PATH)`);

// Initialize database
const db = new Database(dbFile);
db.pragma('journal_mode = WAL'); // Better performance for concurrent access

// Create tables
const createTables = () => {
  // Books table
  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      author TEXT,
      language TEXT,
      file_path TEXT UNIQUE NOT NULL,
      file_size INTEGER,
      page_count INTEGER,
      pdf_type TEXT CHECK(pdf_type IN ('searchable', 'scanned', 'mixed', 'unknown')),
      ocr_confidence REAL,
      needs_review INTEGER DEFAULT 0,
      manual_metadata TEXT,
      date_added DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_modified DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_opened DATETIME
    )
  `);

  // Tags table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      color TEXT
    )
  `);

  // Categories table
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      parent_id INTEGER,
      FOREIGN KEY (parent_id) REFERENCES categories(id)
    )
  `);

  // Book-Tags relationship
  db.exec(`
    CREATE TABLE IF NOT EXISTS book_tags (
      book_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (book_id, tag_id),
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )
  `);

  // Book-Categories relationship
  db.exec(`
    CREATE TABLE IF NOT EXISTS book_categories (
      book_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      PRIMARY KEY (book_id, category_id),
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    )
  `);

  // Book notes
  db.exec(`
    CREATE TABLE IF NOT EXISTS book_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    )
  `);

  // Reading progress
  db.exec(`
    CREATE TABLE IF NOT EXISTS reading_progress (
      book_id INTEGER PRIMARY KEY,
      current_page INTEGER,
      total_pages INTEGER,
      last_read DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    )
  `);

  // User preferences
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      hide_adult_content INTEGER DEFAULT 0,
      default_view_mode TEXT DEFAULT 'grid' CHECK(default_view_mode IN ('grid', 'list')),
      default_sort_by TEXT DEFAULT 'date_added',
      default_sort_order TEXT DEFAULT 'desc' CHECK(default_sort_order IN ('asc', 'desc')),
      books_per_page INTEGER DEFAULT 50,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Initialize default preferences if not exists
  db.exec(`
    INSERT OR IGNORE INTO user_preferences (id, hide_adult_content, default_view_mode)
    VALUES (1, 0, 'grid')
  `);

  // OCR Queue table
  db.exec(`
    CREATE TABLE IF NOT EXISTS ocr_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL UNIQUE,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
      priority INTEGER DEFAULT 0,
      attempts INTEGER DEFAULT 0,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      completed_at DATETIME,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    )
  `);

  // Collections/Shelves table
  db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      icon TEXT,
      color TEXT,
      is_smart INTEGER DEFAULT 0,
      smart_rules TEXT, -- JSON for smart collection rules
      position INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Book-Collections relationship
  db.exec(`
    CREATE TABLE IF NOT EXISTS book_collections (
      book_id INTEGER NOT NULL,
      collection_id INTEGER NOT NULL,
      position INTEGER DEFAULT 0,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (book_id, collection_id),
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
    )
  `);

  // Create indexes for better performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
    CREATE INDEX IF NOT EXISTS idx_books_author ON books(author);
    CREATE INDEX IF NOT EXISTS idx_books_language ON books(language);
    CREATE INDEX IF NOT EXISTS idx_books_date_added ON books(date_added);
    CREATE INDEX IF NOT EXISTS idx_book_tags_book_id ON book_tags(book_id);
    CREATE INDEX IF NOT EXISTS idx_book_tags_tag_id ON book_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_collections_name ON collections(name);
    CREATE INDEX IF NOT EXISTS idx_collections_position ON collections(position);
    CREATE INDEX IF NOT EXISTS idx_book_collections_book_id ON book_collections(book_id);
    CREATE INDEX IF NOT EXISTS idx_book_collections_collection_id ON book_collections(collection_id);
  `);

  console.log('✅ Database tables created successfully');
};

// Run migrations to add new columns
const runMigrations = () => {
  // Check if thumbnail_path column exists
  const columns = db.prepare("PRAGMA table_info(books)").all();
  const hasThumbnailPath = columns.some(col => col.name === 'thumbnail_path');
  const hasPublicationYear = columns.some(col => col.name === 'publication_year');
  const hasISBN = columns.some(col => col.name === 'isbn');
  const hasPublisher = columns.some(col => col.name === 'publisher');
  const hasEdition = columns.some(col => col.name === 'edition');
  const hasDescription = columns.some(col => col.name === 'description');

  if (!hasThumbnailPath) {
    db.exec('ALTER TABLE books ADD COLUMN thumbnail_path TEXT');
    console.log('✅ Added thumbnail_path column to books table');
  }

  if (!hasPublicationYear) {
    db.exec('ALTER TABLE books ADD COLUMN publication_year INTEGER');
    console.log('✅ Added publication_year column to books table');
  }

  if (!hasISBN) {
    db.exec('ALTER TABLE books ADD COLUMN isbn TEXT');
    console.log('✅ Added isbn column to books table');
  }

  if (!hasPublisher) {
    db.exec('ALTER TABLE books ADD COLUMN publisher TEXT');
    console.log('✅ Added publisher column to books table');
  }

  if (!hasEdition) {
    db.exec('ALTER TABLE books ADD COLUMN edition TEXT');
    console.log('✅ Added edition column to books table');
  }

  if (!hasDescription) {
    db.exec('ALTER TABLE books ADD COLUMN description TEXT');
    console.log('✅ Added description column to books table');
  }

  // Add metadata enrichment columns
  const hasCategories = columns.some(col => col.name === 'categories');
  const hasAverageRating = columns.some(col => col.name === 'average_rating');
  const hasThumbnailUrl = columns.some(col => col.name === 'thumbnail_url');
  const hasMetadataSource = columns.some(col => col.name === 'metadata_source');
  const hasMetadataUpdatedAt = columns.some(col => col.name === 'metadata_updated_at');

  if (!hasCategories) {
    db.exec('ALTER TABLE books ADD COLUMN categories TEXT');
    console.log('✅ Added categories column to books table');
  }

  if (!hasAverageRating) {
    db.exec('ALTER TABLE books ADD COLUMN average_rating REAL');
    console.log('✅ Added average_rating column to books table');
  }

  if (!hasThumbnailUrl) {
    db.exec('ALTER TABLE books ADD COLUMN thumbnail_url TEXT');
    console.log('✅ Added thumbnail_url column to books table');
  }

  if (!hasMetadataSource) {
    db.exec('ALTER TABLE books ADD COLUMN metadata_source TEXT');
    console.log('✅ Added metadata_source column to books table');
  }

  if (!hasMetadataUpdatedAt) {
    db.exec('ALTER TABLE books ADD COLUMN metadata_updated_at DATETIME');
    console.log('✅ Added metadata_updated_at column to books table');
  }

  // Add indexed_at column for full-text search tracking
  const hasIndexedAt = columns.some(col => col.name === 'indexed_at');
  if (!hasIndexedAt) {
    db.exec('ALTER TABLE books ADD COLUMN indexed_at DATETIME');
    console.log('✅ Added indexed_at column to books table');
  }

  // Add OCR-related columns
  const hasOcrProcessed = columns.some(col => col.name === 'ocr_processed');
  const hasOcrText = columns.some(col => col.name === 'ocr_text');
  const hasOcrProcessedAt = columns.some(col => col.name === 'ocr_processed_at');

  if (!hasOcrProcessed) {
    db.exec('ALTER TABLE books ADD COLUMN ocr_processed INTEGER DEFAULT 0');
    console.log('✅ Added ocr_processed column to books table');
  }

  if (!hasOcrText) {
    db.exec('ALTER TABLE books ADD COLUMN ocr_text TEXT');
    console.log('✅ Added ocr_text column to books table');
  }

  if (!hasOcrProcessedAt) {
    db.exec('ALTER TABLE books ADD COLUMN ocr_processed_at DATETIME');
    console.log('✅ Added ocr_processed_at column to books table');
  }

  // Add OCR status column
  const hasOcrStatus = columns.some(col => col.name === 'ocr_status');
  if (!hasOcrStatus) {
    // Single quotes: SQLite accepts double-quoted string literals when writing
    // the schema but rejects them when VACUUM re-parses it, which left the
    // database unable to be vacuumed or copied with VACUUM INTO.
    db.exec("ALTER TABLE books ADD COLUMN ocr_status TEXT DEFAULT 'not_needed' CHECK(ocr_status IN ('not_needed', 'pending', 'processing', 'completed', 'failed'))");
    console.log('✅ Added ocr_status column to books table');
  }

  // Add OCR error column
  const hasOcrError = columns.some(col => col.name === 'ocr_error');
  if (!hasOcrError) {
    db.exec('ALTER TABLE books ADD COLUMN ocr_error TEXT');
    console.log('✅ Added ocr_error column to books table');
  }

  // Add reading progress enhancement columns
  const progressColumns = db.prepare("PRAGMA table_info(reading_progress)").all();
  const hasStartedReading = progressColumns.some(col => col.name === 'started_reading');
  const hasFinishedReading = progressColumns.some(col => col.name === 'finished_reading');
  const hasPercentage = progressColumns.some(col => col.name === 'percentage');
  const hasReadingTime = progressColumns.some(col => col.name === 'reading_time_minutes');

  if (!hasStartedReading) {
    db.exec('ALTER TABLE reading_progress ADD COLUMN started_reading DATETIME');
    console.log('✅ Added started_reading column to reading_progress table');
  }

  if (!hasFinishedReading) {
    db.exec('ALTER TABLE reading_progress ADD COLUMN finished_reading DATETIME');
    console.log('✅ Added finished_reading column to reading_progress table');
  }

  if (!hasPercentage) {
    db.exec('ALTER TABLE reading_progress ADD COLUMN percentage REAL DEFAULT 0');
    console.log('✅ Added percentage column to reading_progress table');
  }

  if (!hasReadingTime) {
    db.exec('ALTER TABLE reading_progress ADD COLUMN reading_time_minutes INTEGER DEFAULT 0');
    console.log('✅ Added reading_time_minutes column to reading_progress table');
  }

  // Add adult content flag column
  const hasIsAdult = columns.some(col => col.name === 'is_adult');
  if (!hasIsAdult) {
    db.exec('ALTER TABLE books ADD COLUMN is_adult INTEGER DEFAULT 0');
    console.log('✅ Added is_adult column to books table');
  }
};

// Initialize tables
createTables();
runMigrations();

// Helper functions
const getStats = () => {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_books,
      COUNT(DISTINCT author) as total_authors,
      SUM(page_count) as total_pages,
      AVG(page_count) as avg_pages,
      COUNT(DISTINCT language) as languages
    FROM books
  `).get();

  const byLanguage = db.prepare(`
    SELECT language, COUNT(*) as count
    FROM books
    WHERE language IS NOT NULL
    GROUP BY language
  `).all();

  const byPdfType = db.prepare(`
    SELECT pdf_type, COUNT(*) as count
    FROM books
    WHERE pdf_type IS NOT NULL
    GROUP BY pdf_type
  `).all();

  const needsReview = db.prepare(`
    SELECT COUNT(*) as count
    FROM books
    WHERE needs_review = 1
  `).get();

  return {
    ...stats,
    byLanguage,
    byPdfType,
    needsReview: needsReview.count
  };
};

// Export database instance and helper functions
// Helper functions for database operations
const getBookById = (id) => {
  const stmt = db.prepare('SELECT * FROM books WHERE id = ?');
  return stmt.get(id);
};

const getAllBooks = () => {
  const stmt = db.prepare('SELECT * FROM books ORDER BY date_added DESC');
  return stmt.all();
};

const getBookTags = (bookId) => {
  const stmt = db.prepare(`
    SELECT t.* FROM tags t
    JOIN book_tags bt ON t.id = bt.tag_id
    WHERE bt.book_id = ?
  `);
  return stmt.all(bookId);
};

const addTagToBook = (bookId, tagId) => {
  const stmt = db.prepare('INSERT INTO book_tags (book_id, tag_id) VALUES (?, ?)');
  return stmt.run(bookId, tagId);
};

const updateBook = (id, updates) => {
  const fields = Object.keys(updates);
  const values = Object.values(updates);

  if (fields.length === 0) return;

  const setClause = fields.map(field => `${field} = ?`).join(', ');
  const stmt = db.prepare(`UPDATE books SET ${setClause} WHERE id = ?`);
  return stmt.run(...values, id);
};

const deleteBook = (id) => {
  const stmt = db.prepare('DELETE FROM books WHERE id = ?');
  return stmt.run(id);
};

module.exports = {
  db,
  dbFile,
  isDefaultDatabase: isDefault,
  getStats,
  close: () => db.close(),
  getBookById,
  getAllBooks,
  getBookTags,
  addTagToBook,
  updateBook,
  deleteBook
};