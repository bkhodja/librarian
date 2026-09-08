const { db } = require('../database/init');
const Tesseract = require('tesseract.js');
const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');

class OCRQueueManager extends EventEmitter {
  constructor() {
    super();
    this.isProcessing = false;
    this.currentJob = null;
    this.maxConcurrent = 2; // Process 2 books at a time
    this.activeWorkers = 0;
    this.processInterval = null;
    this.workers = [];
    this.shouldStop = false;
  }

  async initialize() {
    console.log('🚀 Initializing OCR Queue Manager...');

    // NOTE: OCR is currently disabled because Tesseract.js cannot process PDFs directly.
    // It requires PDF-to-image conversion first. This will be implemented in a future update.

    // Create Tesseract workers
    // for (let i = 0; i < this.maxConcurrent; i++) {
    //   const worker = await Tesseract.createWorker(['eng', 'rus'], 1, {
    //     logger: m => {
    //       if (m.status === 'recognizing text' && this.currentJob) {
    //         this.emit('progress', {
    //           bookId: this.currentJob.book_id,
    //           progress: Math.round(m.progress * 100)
    //         });
    //       }
    //     }
    //   });
    //   this.workers.push(worker);
    // }

    // Start processing queue - DISABLED until PDF-to-image conversion is added
    // this.startProcessing();
    console.log('✅ OCR Queue Manager initialized (processing disabled - needs PDF-to-image conversion)');
  }

  startProcessing() {
    if (this.processInterval) return;

    this.processInterval = setInterval(() => {
      if (!this.shouldStop) {
        this.processQueue();
      }
    }, 5000); // Check queue every 5 seconds
  }

  stopProcessing() {
    this.shouldStop = true;
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }
  }

  async shutdown() {
    console.log('🛑 Shutting down OCR Queue Manager...');
    this.stopProcessing();

    // Terminate all workers
    for (const worker of this.workers) {
      await worker.terminate();
    }

    console.log('✅ OCR Queue Manager shut down');
  }

  // Add books to OCR queue
  async addToQueue(bookIds) {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO ocr_queue (book_id, status, priority)
      VALUES (?, 'pending', ?)
    `);

    const updateStatus = db.prepare(`
      UPDATE books
      SET ocr_status = 'pending'
      WHERE id = ?
    `);

    const transaction = db.transaction((ids) => {
      for (const id of ids) {
        // Higher priority for smaller files
        const book = db.prepare('SELECT file_size FROM books WHERE id = ?').get(id);
        const priority = book ? Math.max(0, 100 - Math.floor(book.file_size / 1000000)) : 0;

        insert.run(id, priority);
        updateStatus.run(id);
      }
    });

    transaction(bookIds);
    this.emit('queued', { count: bookIds.length });
    return { success: true, queued: bookIds.length };
  }

  // Add all scanned PDFs to queue
  async queueAllScannedPDFs() {
    const scannedBooks = db.prepare(`
      SELECT id FROM books
      WHERE pdf_type IN ('scanned', 'mixed')
      AND (ocr_status IS NULL OR ocr_status IN ('not_needed', 'failed'))
      AND file_path LIKE '%.pdf'
    `).all();

    if (scannedBooks.length === 0) {
      return { success: true, queued: 0, message: 'No scanned PDFs need OCR' };
    }

    const bookIds = scannedBooks.map(b => b.id);
    return this.addToQueue(bookIds);
  }

  // Process the queue
  async processQueue() {
    if (this.activeWorkers >= this.maxConcurrent) return;

    // Get next job from queue
    const nextJob = db.prepare(`
      SELECT q.*, b.file_path, b.title, b.id as book_id
      FROM ocr_queue q
      JOIN books b ON q.book_id = b.id
      WHERE q.status = 'pending'
      ORDER BY q.priority DESC, q.created_at ASC
      LIMIT 1
    `).get();

    if (!nextJob) return;

    this.activeWorkers++;
    this.processJob(nextJob);
  }

  async processJob(job) {
    const workerIndex = this.workers.length - this.activeWorkers;
    const worker = this.workers[workerIndex];

    try {
      console.log(`🔍 Starting OCR for: ${job.title} (ID: ${job.book_id})`);

      // Update status to processing
      db.prepare(`
        UPDATE ocr_queue
        SET status = 'processing', started_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(job.id);

      db.prepare(`
        UPDATE books
        SET ocr_status = 'processing'
        WHERE id = ?
      `).run(job.book_id);

      this.emit('processing', {
        bookId: job.book_id,
        title: job.title
      });

      // Check if file exists
      const fileExists = await fs.access(job.file_path)
        .then(() => true)
        .catch(() => false);

      if (!fileExists) {
        throw new Error('File not found');
      }

      // Perform OCR
      const startTime = Date.now();
      const { data: { text, confidence } } = await worker.recognize(job.file_path);
      const duration = Date.now() - startTime;

      // Save OCR results
      db.prepare(`
        UPDATE books
        SET ocr_text = ?,
            ocr_confidence = ?,
            ocr_processed = 1,
            ocr_processed_at = CURRENT_TIMESTAMP,
            ocr_status = 'completed',
            ocr_error = NULL
        WHERE id = ?
      `).run(text, confidence, job.book_id);

      // Update queue status
      db.prepare(`
        UPDATE ocr_queue
        SET status = 'completed',
            completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(job.id);

      // Update full-text search index if exists
      const ftsExists = db.prepare(`
        SELECT COUNT(*) as count
        FROM sqlite_master
        WHERE type='table' AND name='books_fts'
      `).get();

      if (ftsExists.count > 0) {
        // Update FTS index
        db.prepare(`
          UPDATE books_fts
          SET content = ?
          WHERE rowid = ?
        `).run(text, job.book_id);
      }

      console.log(`✅ OCR completed for: ${job.title} (Confidence: ${confidence}%, Duration: ${duration/1000}s)`);

      this.emit('completed', {
        bookId: job.book_id,
        title: job.title,
        confidence,
        duration
      });

    } catch (error) {
      console.error(`❌ OCR failed for ${job.title}:`, error.message);

      // Update error status
      db.prepare(`
        UPDATE books
        SET ocr_status = 'failed',
            ocr_error = ?
        WHERE id = ?
      `).run(error.message, job.book_id);

      // Update queue with failure
      const attempts = (job.attempts || 0) + 1;
      const status = attempts >= 3 ? 'failed' : 'pending'; // Retry up to 3 times

      db.prepare(`
        UPDATE ocr_queue
        SET status = ?,
            attempts = ?,
            error_message = ?
        WHERE id = ?
      `).run(status, attempts, error.message, job.id);

      this.emit('failed', {
        bookId: job.book_id,
        title: job.title,
        error: error.message,
        attempts
      });
    } finally {
      this.activeWorkers--;

      // Process next job
      if (!this.shouldStop) {
        setTimeout(() => this.processQueue(), 100);
      }
    }
  }

  // Get queue statistics
  getQueueStats() {
    const stats = db.prepare(`
      SELECT
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        COUNT(*) as total
      FROM ocr_queue
    `).get();

    const booksNeedingOCR = db.prepare(`
      SELECT COUNT(*) as count
      FROM books
      WHERE pdf_type IN ('scanned', 'mixed')
      AND (ocr_status IS NULL OR ocr_status = 'not_needed')
    `).get();

    return {
      queue: stats,
      booksNeedingOCR: booksNeedingOCR.count,
      activeWorkers: this.activeWorkers,
      maxConcurrent: this.maxConcurrent
    };
  }

  // Get queue items
  getQueueItems(limit = 50) {
    return db.prepare(`
      SELECT
        q.*,
        b.title,
        b.author,
        b.file_size,
        b.pdf_type,
        b.ocr_confidence
      FROM ocr_queue q
      JOIN books b ON q.book_id = b.id
      ORDER BY
        CASE WHEN q.status = 'processing' THEN 0
             WHEN q.status = 'pending' THEN 1
             WHEN q.status = 'failed' THEN 2
             ELSE 3 END,
        q.priority DESC,
        q.created_at ASC
      LIMIT ?
    `).all(limit);
  }

  // Remove item from queue
  removeFromQueue(bookId) {
    db.prepare('DELETE FROM ocr_queue WHERE book_id = ?').run(bookId);
    db.prepare(`
      UPDATE books
      SET ocr_status = CASE
        WHEN pdf_type IN ('searchable', 'unknown') THEN 'not_needed'
        ELSE NULL
      END
      WHERE id = ?
    `).run(bookId);

    return { success: true };
  }

  // Clear completed jobs from queue
  clearCompleted() {
    const result = db.prepare(`
      DELETE FROM ocr_queue
      WHERE status = 'completed'
    `).run();

    return { success: true, cleared: result.changes };
  }

  // Reset failed jobs
  resetFailed() {
    db.prepare(`
      UPDATE ocr_queue
      SET status = 'pending',
          attempts = 0,
          error_message = NULL
      WHERE status = 'failed'
    `).run();

    db.prepare(`
      UPDATE books
      SET ocr_status = 'pending',
          ocr_error = NULL
      WHERE ocr_status = 'failed'
    `).run();

    return { success: true };
  }
}

module.exports = new OCRQueueManager();