const { db } = require('../database/init');
const path = require('path');
const fs = require('fs').promises;
const chokidar = require('chokidar');
const pdfProcessor = require('./pdfProcessor');
const epubProcessor = require('./epubProcessorImproved'); // Use improved processor with cover extraction
const thumbnailGenerator = require('./thumbnailGeneratorPdf2pic');
const EventEmitter = require('events');

class BackgroundTaskManager extends EventEmitter {
  constructor() {
    super();
    this.booksFolder = '/Volumes/Storage/Books';
    this.fileWatcher = null;
    this.processingQueue = new Set();
    this.isProcessing = false;
    this.scanInterval = null;
    this.processInterval = null;
    this.thumbnailInterval = null;
  }

  async initialize() {
    console.log('🚀 Initializing Background Task Manager...');

    // Start with an initial scan
    await this.performInitialScan();

    // Setup file watcher for real-time updates
    this.setupFileWatcher();

    // Setup periodic tasks
    this.setupPeriodicTasks();

    console.log('✅ Background Task Manager initialized');
  }

  async performInitialScan() {
    console.log('📚 Starting initial library scan...');
    try {
      const newBooks = await this.scanForNewBooks();
      if (newBooks.length > 0) {
        console.log(`📖 Found ${newBooks.length} new books`);
        await this.addBooksToDatabase(newBooks);

        // Queue for processing
        newBooks.forEach(book => {
          this.processingQueue.add(book.id);
        });

        // Start processing
        this.processQueuedBooks();
      } else {
        console.log('✅ Library is up to date');
      }
    } catch (error) {
      console.error('Error during initial scan:', error);
    }
  }

  async scanForNewBooks() {
    try {
      const existingPaths = new Set(
        db.prepare('SELECT file_path FROM books').all().map(b => b.file_path)
      );

      const newBooks = [];
      await this.scanDirectory(this.booksFolder, existingPaths, newBooks);
      return newBooks;
    } catch (error) {
      console.error('Error scanning for new books:', error);
      return [];
    }
  }

  async scanDirectory(dirPath, existingPaths, newBooks) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          await this.scanDirectory(fullPath, existingPaths, newBooks);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if ((ext === '.pdf' || ext === '.epub') && !existingPaths.has(fullPath)) {
            const stats = await fs.stat(fullPath);
            newBooks.push({
              file_path: fullPath,
              file_name: entry.name,
              file_size: stats.size,
              file_type: ext.substring(1), // 'pdf' or 'epub'
              date_added: new Date().toISOString()
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error);
    }
  }

  async addBooksToDatabase(books) {
    const insert = db.prepare(`
      INSERT INTO books (file_path, title, file_size, date_added)
      VALUES (?, ?, ?, ?)
    `);

    const transaction = db.transaction((books) => {
      for (const book of books) {
        // Extract title from filename
        const ext = path.extname(book.file_name);
        const title = path.basename(book.file_name, ext)
          .replace(/_/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        try {
          const result = insert.run(
            book.file_path,
            title,
            book.file_size,
            book.date_added
          );
          book.id = result.lastInsertRowid;
        } catch (err) {
          if (!err.message.includes('UNIQUE constraint')) {
            console.error(`Error adding book ${book.file_name}:`, err);
          }
        }
      }
    });

    transaction(books);
  }

  setupFileWatcher() {
    console.log('👁️  Setting up file watcher...');

    // Initialize watcher
    this.fileWatcher = chokidar.watch(this.booksFolder, {
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      },
      ignored: /(^|[\/\\])\../, // ignore dotfiles
    });

    // Handle new files
    this.fileWatcher.on('add', async (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.pdf' || ext === '.epub') {
        console.log(`📖 New book detected: ${path.basename(filePath)}`);

        const stats = await fs.stat(filePath);
        const books = [{
          file_path: filePath,
          file_name: path.basename(filePath),
          file_size: stats.size,
          date_added: new Date().toISOString()
        }];

        await this.addBooksToDatabase(books);

        // Queue for processing
        if (books[0].id) {
          this.processingQueue.add(books[0].id);
          this.processQueuedBooks();
        }

        // Emit event for UI update
        this.emit('book-added', books[0]);
      }
    });

    // Handle deleted files
    this.fileWatcher.on('unlink', async (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.pdf' || ext === '.epub') {
        console.log(`🗑️  Book removed: ${path.basename(filePath)}`);

        try {
          db.prepare('DELETE FROM books WHERE file_path = ?').run(filePath);

          // Emit event for UI update
          this.emit('book-removed', filePath);
        } catch (error) {
          console.error('Error removing book:', error);
        }
      }
    });

    // Handle file changes
    this.fileWatcher.on('change', async (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.pdf' || ext === '.epub') {
        console.log(`📝 Book modified: ${path.basename(filePath)}`);

        const stats = await fs.stat(filePath);
        db.prepare(`
          UPDATE books
          SET file_size = ?, last_modified = CURRENT_TIMESTAMP
          WHERE file_path = ?
        `).run(stats.size, filePath);

        // Reprocess the book
        const book = db.prepare('SELECT id FROM books WHERE file_path = ?').get(filePath);
        if (book) {
          this.processingQueue.add(book.id);
          this.processQueuedBooks();
        }
      }
    });

    console.log('✅ File watcher active');
  }

  setupPeriodicTasks() {
    // Process unprocessed books every 30 seconds
    this.processInterval = setInterval(() => {
      this.processUnprocessedBooks();
    }, 30000);

    // Generate missing thumbnails every minute
    this.thumbnailInterval = setInterval(() => {
      this.generateMissingThumbnails();
    }, 60000);

    // Full scan every hour (in case file watcher missed something)
    this.scanInterval = setInterval(() => {
      this.performInitialScan();
    }, 3600000);
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // A book whose file is gone would otherwise be re-queued on every sweep,
  // since the queries that feed the queue look for NULL metadata/thumbnail.
  // Flag it for review so it drops out of those queries.
  markMissing(bookId) {
    try {
      db.prepare(
        "UPDATE books SET needs_review = 1, language = COALESCE(language, 'unknown') WHERE id = ?"
      ).run(bookId);
    } catch (error) {
      console.error(`Failed to flag missing book ${bookId}:`, error.message);
    }
  }

  async processQueuedBooks() {
    if (this.isProcessing || this.processingQueue.size === 0) return;

    this.isProcessing = true;
    const bookId = this.processingQueue.values().next().value;
    this.processingQueue.delete(bookId);

    try {
      const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
      if (book) {
        if (!(await this.fileExists(book.file_path))) {
          console.warn(`Skipping missing file: ${book.file_path}`);
          this.markMissing(bookId);
          return;
        }

        console.log(`⚙️  Processing: ${path.basename(book.file_path)}`);

        // Determine file type and process accordingly
        const ext = path.extname(book.file_path).toLowerCase();
        let result;

        if (ext === '.pdf') {
          // Process PDF
          result = await pdfProcessor.processPDF(book.file_path);
        } else if (ext === '.epub') {
          // Process ePUB
          result = await epubProcessor.processEpub(book.file_path);
        } else {
          console.error(`Unsupported file type: ${ext}`);
          return;
        }

        if (result.success) {
          // Update database with extracted metadata
          db.prepare(`
            UPDATE books
            SET title = ?, author = ?, language = ?, page_count = ?,
                pdf_type = ?, ocr_confidence = ?,
                isbn = ?, publisher = ?, publication_year = ?,
                edition = ?, description = ?
            WHERE id = ?
          `).run(
            result.metadata.title || book.title,
            result.metadata.author,
            result.metadata.language,
            result.metadata.pageCount || result.metadata.chapters, // ePUBs have chapters instead of pages
            result.metadata.pdfType || (ext === '.epub' ? null : result.metadata.fileType),
            result.metadata.ocrConfidence || null,
            result.metadata.isbn,
            result.metadata.publisher,
            result.metadata.publicationYear,
            result.metadata.edition,
            result.metadata.description,
            bookId
          );

          // Generate thumbnail
          await this.generateThumbnailForBook(book);
        }
      }
    } catch (error) {
      console.error(`Error processing book ${bookId}:`, error);
    } finally {
      this.isProcessing = false;
      // Process next in queue
      if (this.processingQueue.size > 0) {
        setTimeout(() => this.processQueuedBooks(), 100);
      }
    }
  }

  async processUnprocessedBooks() {
    const unprocessedBooks = db.prepare(`
      SELECT id FROM books
      WHERE (language IS NULL OR language = 'Not scanned')
        AND needs_review = 0
      LIMIT 10
    `).all();

    if (unprocessedBooks.length > 0) {
      console.log(`📋 Found ${unprocessedBooks.length} unprocessed books`);
      unprocessedBooks.forEach(book => {
        this.processingQueue.add(book.id);
      });
      this.processQueuedBooks();
    }
  }

  async generateMissingThumbnails() {
    const booksWithoutThumbnails = db.prepare(`
      SELECT id, file_path FROM books
      WHERE thumbnail_path IS NULL
        AND needs_review = 0
      LIMIT 5
    `).all();

    if (booksWithoutThumbnails.length > 0) {
      console.log(`🖼️  Generating thumbnails for ${booksWithoutThumbnails.length} books`);

      for (const book of booksWithoutThumbnails) {
        await this.generateThumbnailForBook(book);
      }
    }
  }

  async generateThumbnailForBook(book) {
    try {
      if (!(await this.fileExists(book.file_path))) {
        console.warn(`Skipping thumbnail for missing file: ${book.file_path}`);
        this.markMissing(book.id);
        return;
      }

      const ext = path.extname(book.file_path).toLowerCase();
      let result;

      if (ext === '.pdf') {
        // Use PDF thumbnail generator
        try {
          result = await thumbnailGenerator.generateThumbnail(
            book.file_path,
            book.id || book.file_path
          );
        } catch (pdfError) {
          console.error(`PDF thumbnail generation failed for book ${book.id}:`, pdfError.message);
          return;
        }
      } else if (ext === '.epub') {
        // Use ePUB thumbnail generator
        const thumbnailPath = path.join(__dirname, '../../public/thumbnails', `${book.id}.png`);
        try {
          result = await epubProcessor.generateThumbnail(book.file_path, thumbnailPath);
        } catch (epubError) {
          console.error(`ePUB thumbnail generation failed for book ${book.id}:`, epubError.message);
          return;
        }
      } else {
        console.error(`Unsupported file type for thumbnail: ${ext}`);
        return;
      }

      if (result && result.success && result.thumbnailPath && typeof result.thumbnailPath === 'string') {
        // Convert absolute path to relative path for web serving
        let thumbnailPath = result.thumbnailPath;
        if (thumbnailPath.includes('/public/thumbnails/')) {
          thumbnailPath = `/thumbnails/${path.basename(thumbnailPath)}`;
        }

        db.prepare(`
          UPDATE books
          SET thumbnail_path = ?
          WHERE id = ?
        `).run(thumbnailPath, book.id);

        console.log(`✅ Thumbnail generated for: ${path.basename(book.file_path)}`);
      }
    } catch (error) {
      console.error(`Error generating thumbnail for book ${book.id}:`, error.message);
      // Don't throw - just log and continue
    }
  }

  async shutdown() {
    console.log('🛑 Shutting down Background Task Manager...');

    // Stop file watcher
    if (this.fileWatcher) {
      await this.fileWatcher.close();
    }

    // Clear intervals
    if (this.scanInterval) clearInterval(this.scanInterval);
    if (this.processInterval) clearInterval(this.processInterval);
    if (this.thumbnailInterval) clearInterval(this.thumbnailInterval);

    console.log('✅ Background Task Manager shut down');
  }
}

module.exports = new BackgroundTaskManager();