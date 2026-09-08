const { db } = require('../database/init');
const path = require('path');
const fs = require('fs').promises;
const chokidar = require('chokidar');
const epubProcessor = require('./epubProcessorImproved'); // Use improved processor with cover extraction
const processorPool = require('./bookProcessorPool');
const metadataEnricher = require('./bookMetadataEnricher');
const quality = require('./metadataQuality');
const aiTagger = require('./aiTagger');

const THUMBNAIL_BATCH_SIZE = Number(process.env.THUMBNAIL_BATCH_SIZE) || 25;
const THUMBNAIL_CONCURRENCY = Number(process.env.THUMBNAIL_CONCURRENCY) || 3;
const PROCESS_CONCURRENCY = Number(process.env.PROCESSOR_WORKERS) || 2;
const ENRICH_BATCH_SIZE = Number(process.env.ENRICH_BATCH_SIZE) || 25;
const ENRICH_DELAY_MS = Number(process.env.ENRICH_DELAY_MS) || 1000;
const ADULT_BATCH_SIZE = Number(process.env.ADULT_BATCH_SIZE) || 20;
const TAG_BATCH_SIZE = Number(process.env.TAG_BATCH_SIZE) || 20;
const thumbnailGenerator = require('./thumbnailGeneratorPdf2pic');
const EventEmitter = require('events');

class BackgroundTaskManager extends EventEmitter {
  constructor() {
    super();
    this.booksFolder = '/Volumes/Storage/Books';
    this.fileWatcher = null;
    this.processingQueue = new Set();
    this.activeJobs = 0;
    this.isGeneratingThumbnails = false;
    this.isEnriching = false;
    this.isTagging = false;
    this.warnedNoOllama = false;
    // Books tried this run, so a lookup that finds nothing is not repeated
    // every five minutes. Cleared on restart, which retries after an outage.
    this.enrichAttempted = new Set();
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

    // Repair poor titles and authors against Open Library / Google Books.
    this.enrichInterval = setInterval(() => {
      this.enrichPoorMetadata();
    }, 300000);

    // Start one pass shortly after boot rather than waiting out the interval.
    setTimeout(() => this.enrichPoorMetadata(), 15000);

    // Subject-tag whatever is still untagged, using the local model.
    this.tagInterval = setInterval(() => {
      this.tagUntaggedBooks();
    }, 120000);

    setTimeout(() => this.tagUntaggedBooks(), 30000);
  }

  /**
   * Look up books whose title or author failed the quality check and that carry
   * an ISBN, and replace those fields from an external source. The ISBN is the
   * one thing the extractor reads reliably, so it is the key to everything
   * else. Network failures are expected and simply end the pass.
   */
  async enrichPoorMetadata() {
    if (this.isEnriching) return;
    this.isEnriching = true;

    try {
      const candidates = db.prepare(`
        SELECT id, title, author, isbn FROM books
        WHERE isbn IS NOT NULL
          AND needs_review = 0
          AND metadata_source IS NULL
      `).all();

      const needsWork = candidates.filter((book) =>
        !this.enrichAttempted.has(book.id) &&
        (!quality.isPlausibleTitle(book.title) ||
         !quality.isPlausibleAuthor(book.author, { title: book.title }))
      ).slice(0, ENRICH_BATCH_SIZE);

      if (needsWork.length === 0) return;

      console.log(`🔎 Repairing metadata for ${needsWork.length} book(s) by ISBN`);

      for (const book of needsWork) {
        this.enrichAttempted.add(book.id);

        try {
          const updated = await metadataEnricher.enrichBook(book.id);
          if (updated) {
            console.log(`   ✅ ${book.isbn} → ${updated.title} — ${updated.author || 'no author'}`);
          }
        } catch (error) {
          console.error(`   ❌ ${book.isbn}: ${error.message}`);
        }

        // Be a good citizen with a free API.
        await new Promise((resolve) => setTimeout(resolve, ENRICH_DELAY_MS));
      }
    } catch (error) {
      console.error('Metadata enrichment pass failed:', error.message);
    } finally {
      this.isEnriching = false;
    this.isTagging = false;
    this.warnedNoOllama = false;
    }
  }

  /**
   * Tag untagged books with the local model. Runs on a loop until the library
   * is covered, then goes quiet: once every book has tags the query returns
   * nothing and the pass costs one count.
   */
  async tagUntaggedBooks() {
    if (this.isTagging) return;
    this.isTagging = true;

    try {
      // Books the model could not classify stay untagged, so looping on the
      // untagged count alone would re-process the same rows forever.
      const remaining = aiTagger.countTaggable();

      // Adult assessment is separate work on the same model, so returning as
      // soon as there is nothing left to tag stopped it dead: once the library
      // was fully tagged, no book was ever assessed again.
      if (remaining === 0 && aiTagger.countUnassessed() === 0) return;

      const status = await aiTagger.status();
      if (!status.available) {
        // Ollama is not running. Say so once rather than on every pass.
        if (!this.warnedNoOllama) {
          console.warn('🏷️  Local tagging is idle: Ollama is not reachable at ' +
                       `${status.host}. Start it to tag ${remaining} book(s).`);
          this.warnedNoOllama = true;
        }
        return;
      }
      this.warnedNoOllama = false;

      if (remaining > 0) {
        console.log(`🏷️  Tagging ${Math.min(TAG_BATCH_SIZE, remaining)} of ${remaining} untagged book(s) with ${status.model}`);

        const result = await aiTagger.tagUntagged(TAG_BATCH_SIZE);
        console.log(`   tagged ${result.tagged}, skipped ${result.skipped} ` +
                    `(${result.bySource.ai} by model, ${result.bySource.keywords} by keywords)`);
      }

      // Assess adult content in the same pass. It shares the model and the
      // same "is Ollama up" check, and doing it here means a book added today
      // is classified without anyone asking.
      await this.assessAdultContent();

      // Keep going while there is work, rather than waiting out the interval.
      if (aiTagger.countTaggable() > 0 || aiTagger.countUnassessed() > 0) {
        setTimeout(() => this.tagUntaggedBooks(), 1000);
      }
    } catch (error) {
      console.error('Tagging pass failed:', error.message);
    } finally {
      this.isTagging = false;
    }
  }

  /**
   * Flag sexually explicit books so the "hide adult content" preference has
   * something to act on. Previously the flag was only ever set by hand, one
   * book at a time, so turning the preference on hid almost nothing.
   *
   * The model may only raise the flag, never lower it — see recordAdult.
   */
  async assessAdultContent() {
    const remaining = aiTagger.countUnassessed();
    if (remaining === 0) return;

    const result = await aiTagger.assessUnassessed(ADULT_BATCH_SIZE, ({ book, why }) => {
      console.log(`   🔞 flagged as adult: ${(book.title || '').slice(0, 50)}${why ? ` — ${why}` : ''}`);
    });

    if (result.assessed > 0) {
      console.log(`   assessed ${result.assessed} book(s) for adult content, flagged ${result.flagged}` +
                  ` (${remaining - result.assessed} left)`);
    }
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

  processQueuedBooks() {
    while (this.activeJobs < PROCESS_CONCURRENCY && this.processingQueue.size > 0) {
      const bookId = this.processingQueue.values().next().value;
      this.processingQueue.delete(bookId);

      this.activeJobs++;
      this.processBook(bookId).finally(() => {
        this.activeJobs--;
        if (this.processingQueue.size > 0) {
          setTimeout(() => this.processQueuedBooks(), 100);
        }
      });
    }
  }

  async processBook(bookId) {
    try {
      const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
      if (book) {
        if (!(await this.fileExists(book.file_path))) {
          console.warn(`Skipping missing file: ${book.file_path}`);
          this.markMissing(bookId);
          return;
        }

        // The cover is what the library grid needs to render, and it is far
        // cheaper than parsing the document, so produce it first rather than
        // making it wait behind metadata extraction.
        if (!book.thumbnail_path) {
          await this.generateThumbnailForBook(book);
        }

        console.log(`⚙️  Processing: ${path.basename(book.file_path)}`);

        // Runs in a worker thread: parsing a large PDF would otherwise block
        // the event loop and stall every in-flight API request.
        const result = await processorPool.process(book.file_path);

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
            result.title || book.title,
            result.author,
            result.language,
            result.pageCount,
            result.pdfType,
            result.ocrConfidence,
            result.isbn,
            result.publisher,
            result.publicationYear,
            result.edition,
            result.description,
            bookId
          );
        } else {
          // Leave a marker so the book drops out of the unprocessed sweep
          // instead of being retried on every pass forever.
          console.error(`Failed to process ${book.file_path}: ${result.error || 'unknown error'}`);
          db.prepare(
            "UPDATE books SET language = COALESCE(language, 'unknown'), needs_review = 1 WHERE id = ?"
          ).run(bookId);
        }
      }
    } catch (error) {
      console.error(`Error processing book ${bookId}:`, error);
    }
  }

  async processUnprocessedBooks() {
    const unprocessedBooks = db.prepare(`
      SELECT id FROM books
      WHERE (language IS NULL OR language = 'Not scanned')
        AND needs_review = 0
      LIMIT ?
    `).all(PROCESS_CONCURRENCY * 5);

    if (unprocessedBooks.length > 0) {
      console.log(`📋 Found ${unprocessedBooks.length} unprocessed books`);
      unprocessedBooks.forEach(book => {
        this.processingQueue.add(book.id);
      });
      this.processQueuedBooks();
    }
  }

  async generateMissingThumbnails() {
    if (this.isGeneratingThumbnails) return;
    this.isGeneratingThumbnails = true;

    try {
      const batch = db.prepare(`
        SELECT id, file_path FROM books
        WHERE thumbnail_path IS NULL
          AND needs_review = 0
        LIMIT ?
      `).all(THUMBNAIL_BATCH_SIZE);

      if (batch.length === 0) return;

      console.log(`🖼️  Generating thumbnails for ${batch.length} books`);

      // pdf2pic shells out to Ghostscript, so these overlap on the CPU rather
      // than blocking the event loop. A few at a time fills the grid quickly
      // without starving the API.
      for (let i = 0; i < batch.length; i += THUMBNAIL_CONCURRENCY) {
        const slice = batch.slice(i, i + THUMBNAIL_CONCURRENCY);
        await Promise.all(slice.map((book) => this.generateThumbnailForBook(book)));
      }

      // More to do: keep going rather than waiting out the interval, so a
      // freshly imported library gets its covers in minutes not hours.
      if (batch.length === THUMBNAIL_BATCH_SIZE) {
        setTimeout(() => this.generateMissingThumbnails(), 250);
      }
    } finally {
      this.isGeneratingThumbnails = false;
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
    if (this.enrichInterval) clearInterval(this.enrichInterval);
    if (this.tagInterval) clearInterval(this.tagInterval);

    await processorPool.shutdown();

    console.log('✅ Background Task Manager shut down');
  }
}

module.exports = new BackgroundTaskManager();