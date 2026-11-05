const { db } = require('../database/init');
const path = require('path');
const fs = require('fs').promises;
const chokidar = require('chokidar');
const epubProcessor = require('./epubProcessorImproved'); // Use improved processor with cover extraction
const processorPool = require('./bookProcessorPool');
const metadataEnricher = require('./bookMetadataEnricher');
const quality = require('./metadataQuality');
const aiTagger = require('./aiTagger');
const embeddingService = require('./embeddingService');
const bookProfiler = require('./bookProfiler');
const { ROOTS, rootFor, kindForPath } = require('./libraryFolders');

const THUMBNAIL_BATCH_SIZE = Number(process.env.THUMBNAIL_BATCH_SIZE) || 25;
const THUMBNAIL_CONCURRENCY = Number(process.env.THUMBNAIL_CONCURRENCY) || 3;
const PROCESS_CONCURRENCY = Number(process.env.PROCESSOR_WORKERS) || 2;
const ENRICH_BATCH_SIZE = Number(process.env.ENRICH_BATCH_SIZE) || 25;
const ENRICH_DELAY_MS = Number(process.env.ENRICH_DELAY_MS) || 1000;
const ADULT_BATCH_SIZE = Number(process.env.ADULT_BATCH_SIZE) || 20;
const TAG_BATCH_SIZE = Number(process.env.TAG_BATCH_SIZE) || 20;
const INDEX_BATCH_SIZE = Number(process.env.INDEX_BATCH_SIZE) || 10;
const HASH_BATCH_SIZE = Number(process.env.HASH_BATCH_SIZE) || 50;
const EMBED_BATCH_SIZE = Number(process.env.EMBED_BATCH_SIZE) || 100;
const PROFILE_BATCH_SIZE = Number(process.env.PROFILE_BATCH_SIZE) || 20;
const OCR_BACKGROUND = (process.env.OCR_BACKGROUND || 'on').toLowerCase() !== 'off';
const OCR_NICE = Number(process.env.OCR_NICE) || 15;
// A 3000-page scan is under two hours at the measured two seconds a page.
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS) || 3 * 3600 * 1000;
const enhancedSearch = require('./enhancedSearchService');
const os = require('os');
const fsSync = require('fs');
const { spawn } = require('child_process');
const thumbnailGenerator = require('./thumbnailGeneratorPdf2pic');
const EventEmitter = require('events');

class BackgroundTaskManager extends EventEmitter {
  constructor() {
    super();
    // Books and magazines are both watched; libraryFolders resolves each
    // path, so a folder given as ".../Books/" still yields file paths that
    // match the ones already in the database.
    this.roots = ROOTS;
    this.fileWatcher = null;
    this.processingQueue = new Set();
    this.activeJobs = 0;
    // Thumbnail jobs by book id. processBook and the periodic sweep both
    // pick up a new book while its cover is still NULL, so without this the
    // same PDF went through Ghostscript twice at once.
    this.thumbnailJobs = new Map();
    this.isGeneratingThumbnails = false;
    this.isEnriching = false;
    this.isTagging = false;
    this.isIndexing = false;
    this.isOcring = false;
    this.isHashing = false;
    this.hashFailed = new Set();
    this.isEmbedding = false;
    this.isCheckingEmbeddings = false;
    this.isProfiling = false;
    this.warnedProfileOllama = false;
    this.warnedNoOllama = false;
    // Books whose text could not be read this run. Retried after a restart,
    // which is soon enough for a file that has since been fixed.
    this.indexFailed = new Set();
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
    console.log('📚 Scanning the books and magazines folders for new files...');
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
      for (const root of this.roots) {
        // A library with no magazines folder is fine; say nothing about it.
        if (!(await this.fileExists(root.folder))) continue;
        await this.scanDirectory(root.folder, existingPaths, newBooks);
      }
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
    this.fileWatcher = chokidar.watch(this.roots.map((root) => root.folder), {
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
        console.log(`${kindForPath(filePath) === 'magazine' ? '📰 New magazine' : '📖 New book'} detected: ${path.basename(filePath)}`);

        // A rejection here is unhandled and, on current Node, fatal. The
        // file can legitimately be gone by now — a download manager that
        // renames or removes its temporary file, for instance.
        let stats;
        try {
          stats = await fs.stat(filePath);
        } catch (error) {
          console.warn(`Skipping ${path.basename(filePath)}: ${error.message}`);
          return;
        }

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
        // When the external drive unmounts, every file vanishes at once and
        // this handler fires for each of them. Deleting the rows would empty
        // the library; the books are still there, just not reachable.
        const root = rootFor(filePath);
        if (!root || !(await this.fileExists(root.folder))) {
          console.warn(`Ignoring removal of ${path.basename(filePath)}: its folder is not mounted`);
          return;
        }

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

        let stats;
        try {
          stats = await fs.stat(filePath);
        } catch (error) {
          console.warn(`Skipping ${path.basename(filePath)}: ${error.message}`);
          return;
        }

        // The contents changed, so everything derived from them is stale.
        // In particular a download that stalled long enough to be picked up
        // half-written got a placeholder cover and a failed parse; clearing
        // both lets the finished file be read properly.
        db.prepare(`
          UPDATE books
          SET file_size = ?, last_modified = CURRENT_TIMESTAMP,
              thumbnail_path = NULL, needs_review = 0
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

    // Extract the text of whatever has none yet. Summaries, asking a book a
    // question and page search all read from it, and until now it was only
    // ever filled in by hand, so most of the library had none.
    this.indexInterval = setInterval(() => {
      this.indexUnindexedBooks();
    }, 60000);

    setTimeout(() => this.indexUnindexedBooks(), 45000);

    // Digest whatever was ingested before file hashes existed.
    this.hashInterval = setInterval(() => {
      this.hashUnhashedBooks();
    }, 300000);

    setTimeout(() => this.hashUnhashedBooks(), 20000);

    // Embed books for semantic search and Similar Books. Until this sweep
    // existed, embeddings were made once by hand; 4,500 books added since had
    // none, and searches could not find them.
    this.embedInterval = setInterval(() => {
      this.embedPendingBooks();
    }, 120000);

    setTimeout(() => this.embedPendingBooks(), 60000);

    // Re-embed books whose title, tags or description changed after they
    // were embedded. Hourly: those changes are rare and none is urgent.
    this.embedCheckInterval = setInterval(() => {
      this.checkEmbeddings();
    }, 3600000);

    // Profile each book (level, audience, prerequisites) for the library
    // chat's reading paths. Hours of model time for the whole library, so it
    // runs a batch at a time and gives way to tagging.
    this.profileInterval = setInterval(() => {
      this.profilePendingBooks();
    }, 300000);

    setTimeout(() => this.profilePendingBooks(), 90000);

    // Scanned books, one at a time, in a low-priority child process. Days of
    // work for a large library, so it only starts once the text books are
    // done and never gets in the way of anything interactive.
    if (OCR_BACKGROUND) {
      this.ocrInterval = setInterval(() => {
        this.ocrScannedBooks();
      }, 120000);

      setTimeout(() => this.ocrScannedBooks(), 90000);
    }
  }

  /**
   * Embed a batch of books with no embedding (or an outdated one), and keep
   * going while there are more. A few milliseconds a book, so a whole
   * library takes a minute or two.
   */
  async embedPendingBooks() {
    if (this.isEmbedding) return;
    this.isEmbedding = true;

    try {
      const batch = embeddingService.pendingBooks(EMBED_BATCH_SIZE);
      if (batch.length === 0) return;

      let embedded = 0;
      let failed = 0;
      for (const book of batch) {
        try {
          await embeddingService.embedBook(book.id);
          embedded++;
        } catch (error) {
          failed++;
          console.error(`   Could not embed book ${book.id}: ${error.message}`);
        }
      }

      const remaining = embeddingService.countPending();
      console.log(`🧠 Embedded ${embedded} book(s)` +
                  (failed ? `, ${failed} failed` : '') +
                  (remaining ? `; ${remaining} to go` : ''));

      // A book that fails stays pending; only carry on if this batch made
      // progress, or a broken model would spin here.
      if (remaining > 0 && embedded > 0) {
        setTimeout(() => this.embedPendingBooks(), 1000);
      }
    } catch (error) {
      console.error('Embedding pass failed:', error.message);
    } finally {
      this.isEmbedding = false;
    }
  }

  async profilePendingBooks() {
    // Tagging shares the model; new books get their tags first.
    if (this.isProfiling || this.isTagging) return;
    this.isProfiling = true;

    try {
      const batch = bookProfiler.pendingBooks(PROFILE_BATCH_SIZE);
      if (batch.length === 0) return;

      let profiled = 0;
      let unusable = 0;
      for (const book of batch) {
        if (this.isTagging) break;
        try {
          if (await bookProfiler.profileBook(book.id)) profiled++;
          else unusable++;
        } catch (error) {
          // Ollama is down: stop here, and say so once rather than every pass.
          if (!this.warnedProfileOllama) {
            console.warn(`🎓 Book profiling is idle: ${error.message}`);
            this.warnedProfileOllama = true;
          }
          return;
        }
      }
      this.warnedProfileOllama = false;

      const remaining = bookProfiler.countPending();
      console.log(`🎓 Profiled ${profiled} book(s)` +
                  (unusable ? `, ${unusable} without a usable profile` : '') +
                  (remaining ? `; ${remaining} to go` : ''));

      // Books without a usable profile are recorded, so every batch makes
      // progress; keep going rather than waiting out the interval.
      if (remaining > 0 && profiled + unusable > 0) {
        setTimeout(() => this.profilePendingBooks(), 1000);
      }
    } catch (error) {
      console.error('Profiling pass failed:', error.message);
    } finally {
      this.isProfiling = false;
    }
  }

  async checkEmbeddings() {
    if (this.isCheckingEmbeddings || this.isEmbedding) return;
    this.isCheckingEmbeddings = true;

    try {
      const { updated } = await embeddingService.checkAllBooks();
      if (updated > 0) {
        console.log(`🧠 Re-embedded ${updated} book(s) whose title, tags or description changed`);
      }
    } catch (error) {
      console.error('Embedding check failed:', error.message);
    } finally {
      this.isCheckingEmbeddings = false;
    }
  }

  /**
   * OCR the next scanned book that has no text. Smallest first: the early
   * results arrive in minutes rather than hours, and a book that fails is
   * marked so it is not retried on every pass — scripts/index-pages.js --ocr can
   * force one by hand.
   */
  async ocrScannedBooks() {
    if (this.isOcring || this.isIndexing) return;
    this.isOcring = true;

    try {
      const book = db.prepare(`
        SELECT b.id, b.title, b.file_path, b.pdf_type, b.page_count, b.language
        FROM books b
        WHERE b.pdf_type = 'scanned'
          AND b.needs_review = 0
          AND (b.ocr_status IS NULL OR b.ocr_status NOT IN ('completed', 'failed', 'no_text'))
          AND NOT EXISTS (SELECT 1 FROM book_pages p WHERE p.book_id = b.id)
        ORDER BY COALESCE(b.page_count, 100000), b.id
        LIMIT 1
      `).get();

      if (!book) return;

      if (!(await this.fileExists(book.file_path))) {
        this.markMissing(book.id);
        return;
      }

      const remaining = db.prepare(`
        SELECT COUNT(*) AS n FROM books b
        WHERE b.pdf_type = 'scanned' AND b.needs_review = 0
          AND (b.ocr_status IS NULL OR b.ocr_status NOT IN ('completed', 'failed', 'no_text'))
          AND NOT EXISTS (SELECT 1 FROM book_pages p WHERE p.book_id = b.id)
      `).get().n;

      console.log(`🔍 OCR: ${path.basename(book.file_path)} (${book.page_count || '?'} pages, ${remaining} scanned book(s) to go)`);
      const started = Date.now();

      const result = await this.runOcrChild(book);
      const setStatus = db.prepare('UPDATE books SET ocr_status = ? WHERE id = ?');

      if (!result.success) {
        setStatus.run('failed', book.id);
        console.error(`   ❌ ${path.basename(book.file_path)}: ${result.error || 'OCR failed'}`);
        return;
      }

      const { stored, totalWords } = enhancedSearch.storePages(book.id, result);
      if (stored === 0) {
        setStatus.run('no_text', book.id);
        console.error(`   ❌ ${path.basename(book.file_path)}: OCR found no readable text`);
        return;
      }

      const minutes = ((Date.now() - started) / 60000).toFixed(1);
      console.log(`   ✅ ${path.basename(book.file_path)}: ${stored} pages, ${totalWords} words, ` +
                  `${Math.round(result.confidence || 0)}% confidence, ${minutes} min`);

      // Straight on to the next one; the interval is only a safety net.
      setTimeout(() => this.ocrScannedBooks(), 2000);
    } catch (error) {
      console.error('OCR pass failed:', error.message);
    } finally {
      this.isOcring = false;
    }
  }

  runOcrChild(book) {
    return new Promise((resolve) => {
      const resultPath = path.join(os.tmpdir(), `bibliotheka-ocr-${book.id}-${process.pid}.json`);
      const script = path.join(__dirname, 'ocrChild.js');
      const child = spawn('nice', ['-n', String(OCR_NICE), process.execPath, script, JSON.stringify(book), resultPath], {
        cwd: path.join(__dirname, '../..'),
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stderr = '';
      child.stdout.on('data', (data) => process.stdout.write(data));
      child.stderr.on('data', (data) => { stderr += data; });

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
      }, OCR_TIMEOUT_MS);

      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({ success: false, error: error.message });
      });

      child.on('close', (code, signal) => {
        clearTimeout(timer);
        let result;
        try {
          result = JSON.parse(fsSync.readFileSync(resultPath, 'utf8'));
        } catch {
          result = {
            success: false,
            error: signal ? `killed by ${signal} after ${OCR_TIMEOUT_MS / 60000} min` :
                   `exited with code ${code}: ${stderr.trim().split('\n').pop() || 'no output'}`
          };
        }
        fsSync.unlink(resultPath, () => {});
        resolve(result);
      });
    });
  }

  /**
   * Page-index books that have no text yet. Extraction happens in the worker
   * pool and the rows are written here, one book at a time: the pool is shared
   * with metadata extraction for new arrivals, which should not queue behind
   * a backlog of old ones.
   *
   * Scanned PDFs are left alone — OCR is minutes per book and stays opt-in.
   * They keep their "Scan" badge, which says why they have no text.
   */
  async indexUnindexedBooks() {
    if (this.isIndexing) return;
    this.isIndexing = true;

    try {
      const batch = db.prepare(`
        SELECT b.id, b.title, b.file_path, b.pdf_type, b.page_count, b.language
        FROM books b
        WHERE b.needs_review = 0
          AND b.language IS NOT NULL
          AND (b.pdf_type IS NULL OR b.pdf_type != 'scanned')
          AND NOT EXISTS (SELECT 1 FROM book_pages p WHERE p.book_id = b.id)
        ORDER BY b.date_added DESC
        LIMIT ?
      `).all(INDEX_BATCH_SIZE + this.indexFailed.size)
        .filter((book) => !this.indexFailed.has(book.id))
        .slice(0, INDEX_BATCH_SIZE);

      if (batch.length === 0) return;

      console.log(`📄 Extracting text from ${batch.length} book(s)`);

      for (const book of batch) {
        if (!(await this.fileExists(book.file_path))) {
          this.markMissing(book.id);
          continue;
        }

        const result = await processorPool.extractPages(book);

        if (!result.success || !result.pages || result.pages.length === 0) {
          this.indexFailed.add(book.id);
          console.error(`   ❌ ${path.basename(book.file_path)}: ${result.error || 'no text found'}`);
          continue;
        }

        const { stored, totalWords } = enhancedSearch.storePages(book.id, result);
        if (stored === 0) {
          // Every page came back blank — a text layer with nothing in it.
          // Nothing was written, so it would be picked up again next sweep.
          this.indexFailed.add(book.id);
          console.error(`   ❌ ${path.basename(book.file_path)}: pages contain no text`);
          continue;
        }
        console.log(`   ✅ ${path.basename(book.file_path)}: ${stored} pages, ${totalWords} words`);
      }

      // Keep going while there is work, rather than waiting out the interval.
      if (batch.length === INDEX_BATCH_SIZE) {
        setTimeout(() => this.indexUnindexedBooks(), 1000);
      }
    } catch (error) {
      console.error('Text extraction pass failed:', error.message);
    } finally {
      this.isIndexing = false;
    }
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
          AND kind = 'book'
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

        if (result.fileHash) this.recordHash(bookId, result.fileHash);

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

  /**
   * Store a file's digest and say so if it makes the book a copy of one
   * already on the shelf — the moment the second copy arrives is the moment
   * someone can still remember downloading it.
   */
  recordHash(bookId, fileHash) {
    db.prepare('UPDATE books SET file_hash = ? WHERE id = ?').run(fileHash, bookId);

    const twin = db.prepare(
      'SELECT id, title FROM books WHERE file_hash = ? AND id != ? LIMIT 1'
    ).get(fileHash, bookId);
    if (twin) {
      console.log(`   👯 Book ${bookId} is a byte-for-byte copy of #${twin.id} "${twin.title}" — see Find Duplicates`);
    }
  }

  /**
   * Digest books that predate the file_hash column. I/O-bound rather than
   * CPU-bound, so one at a time through the pool is plenty, and the whole
   * library is a few minutes' reading.
   */
  async hashUnhashedBooks() {
    if (this.isHashing) return;
    this.isHashing = true;

    try {
      const batch = db.prepare(`
        SELECT id, file_path FROM books
        WHERE file_hash IS NULL AND needs_review = 0
        ORDER BY id
        LIMIT ?
      `).all(HASH_BATCH_SIZE + this.hashFailed.size)
        .filter((book) => !this.hashFailed.has(book.id))
        .slice(0, HASH_BATCH_SIZE);

      if (batch.length === 0) return;

      for (const book of batch) {
        if (!(await this.fileExists(book.file_path))) {
          this.markMissing(book.id);
          continue;
        }
        const result = await processorPool.hashFile(book.file_path);
        if (result.success && result.fileHash) {
          this.recordHash(book.id, result.fileHash);
        } else {
          this.hashFailed.add(book.id);
          console.error(`   ❌ could not hash ${path.basename(book.file_path)}: ${result.error || 'unknown error'}`);
        }
      }

      const left = db.prepare('SELECT COUNT(*) AS n FROM books WHERE file_hash IS NULL AND needs_review = 0').get().n;
      console.log(`#️⃣  Hashed ${batch.length} book(s), ${left} to go`);

      if (batch.length === HASH_BATCH_SIZE) {
        setTimeout(() => this.hashUnhashedBooks(), 500);
      }
    } catch (error) {
      console.error('Hashing pass failed:', error.message);
    } finally {
      this.isHashing = false;
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
      `).all(THUMBNAIL_BATCH_SIZE).filter((book) => !this.thumbnailJobs.has(book.id));

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

  generateThumbnailForBook(book) {
    // A second caller for a book already in flight waits on the same job.
    let job = this.thumbnailJobs.get(book.id);
    if (!job) {
      job = this.renderThumbnail(book).finally(() => this.thumbnailJobs.delete(book.id));
      this.thumbnailJobs.set(book.id, job);
    }
    return job;
  }

  async renderThumbnail(book) {
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
    if (this.indexInterval) clearInterval(this.indexInterval);
    if (this.ocrInterval) clearInterval(this.ocrInterval);
    if (this.hashInterval) clearInterval(this.hashInterval);
    if (this.embedInterval) clearInterval(this.embedInterval);
    if (this.embedCheckInterval) clearInterval(this.embedCheckInterval);
    if (this.profileInterval) clearInterval(this.profileInterval);

    await processorPool.shutdown();

    console.log('✅ Background Task Manager shut down');
  }
}

module.exports = new BackgroundTaskManager();