const chokidar = require('chokidar');
const path = require('path');
const EventEmitter = require('events');
const { db } = require('../database/init');
const pdfProcessor = require('./pdfProcessor');
const { ROOTS } = require('./libraryFolders');

class FileWatcher extends EventEmitter {
  constructor() {
    super();
    this.watcher = null;
    this.folders = ROOTS.map((root) => root.folder);
    this.isWatching = false;
    this.processingQueue = [];
    this.isProcessing = false;
  }

  /**
   * Start watching the Books folder
   */
  start() {
    if (this.isWatching) {
      console.log('File watcher is already running');
      return;
    }

    console.log(`Starting file watcher for: ${this.folders.join(', ')}`);

    // Initialize watcher
    this.watcher = chokidar.watch(this.folders, {
      persistent: true,
      ignoreInitial: true, // Don't trigger for existing files on startup
      followSymlinks: false,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      },
      ignored: /(^|[\/\\])\../, // Ignore dotfiles
    });

    // Handle file additions
    this.watcher.on('add', (filePath) => {
      if (path.extname(filePath).toLowerCase() === '.pdf') {
        console.log(`New PDF detected: ${filePath}`);
        this.emit('pdf-added', filePath);
        this.queueForProcessing(filePath);
      }
    });

    // Handle file changes
    this.watcher.on('change', (filePath) => {
      if (path.extname(filePath).toLowerCase() === '.pdf') {
        console.log(`PDF modified: ${filePath}`);
        this.emit('pdf-changed', filePath);
        this.updateFileInDatabase(filePath);
      }
    });

    // Handle file deletions
    this.watcher.on('unlink', (filePath) => {
      if (path.extname(filePath).toLowerCase() === '.pdf') {
        console.log(`PDF deleted: ${filePath}`);
        this.emit('pdf-deleted', filePath);
        this.removeFromDatabase(filePath);
      }
    });

    // Handle errors
    this.watcher.on('error', (error) => {
      console.error('Watcher error:', error);
      this.emit('error', error);
    });

    // Watcher ready
    this.watcher.on('ready', () => {
      console.log('File watcher is ready and monitoring for changes');
      this.isWatching = true;
      this.emit('ready');
    });
  }

  /**
   * Stop watching
   */
  async stop() {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      this.isWatching = false;
      console.log('File watcher stopped');
      this.emit('stopped');
    }
  }

  /**
   * Queue a file for processing
   */
  queueForProcessing(filePath) {
    if (!this.processingQueue.includes(filePath)) {
      this.processingQueue.push(filePath);
      this.processQueue();
    }
  }

  /**
   * Process queued files
   */
  async processQueue() {
    if (this.isProcessing || this.processingQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.processingQueue.length > 0) {
      const filePath = this.processingQueue.shift();

      try {
        await this.processNewPDF(filePath);
      } catch (error) {
        console.error(`Error processing ${filePath}:`, error);
        this.emit('processing-error', { filePath, error });
      }
    }

    this.isProcessing = false;
  }

  /**
   * Process a newly added PDF
   */
  async processNewPDF(filePath) {
    console.log(`Processing new PDF: ${filePath}`);

    try {
      // Check if file already exists in database
      const existing = db.prepare('SELECT id FROM books WHERE file_path = ?').get(filePath);
      if (existing) {
        console.log(`File already in database: ${filePath}`);
        return;
      }

      // Process PDF to extract metadata
      const pdfData = await pdfProcessor.processPDF(filePath);

      // Prepare data for database insertion
      const bookData = {
        title: pdfData.metadata?.title || pdfData.metadata?.titleFromFilename || path.basename(filePath, '.pdf'),
        author: pdfData.metadata?.author || pdfData.metadata?.authorFromFilename || null,
        language: pdfData.language,
        file_path: filePath,
        file_size: pdfData.fileSize,
        page_count: pdfData.metadata?.pageCount || null,
        pdf_type: pdfData.pdfType,
        ocr_confidence: pdfData.ocrData?.confidence || null,
        needs_review: pdfData.needsReview ? 1 : 0,
        manual_metadata: JSON.stringify(pdfData.metadata || {}),
        date_added: new Date().toISOString(),
        last_modified: new Date().toISOString()
      };

      // Insert into database
      const stmt = db.prepare(`
        INSERT INTO books (
          title, author, language, file_path, file_size,
          page_count, pdf_type, ocr_confidence, needs_review,
          manual_metadata, date_added, last_modified
        ) VALUES (
          @title, @author, @language, @file_path, @file_size,
          @page_count, @pdf_type, @ocr_confidence, @needs_review,
          @manual_metadata, @date_added, @last_modified
        )
      `);

      const result = stmt.run(bookData);
      console.log(`Added book to database: ${bookData.title} (ID: ${result.lastInsertRowid})`);

      this.emit('pdf-processed', {
        id: result.lastInsertRowid,
        filePath,
        ...bookData
      });

    } catch (error) {
      console.error(`Failed to process PDF ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Update file information in database
   */
  async updateFileInDatabase(filePath) {
    try {
      const stmt = db.prepare(`
        UPDATE books
        SET last_modified = CURRENT_TIMESTAMP
        WHERE file_path = ?
      `);
      stmt.run(filePath);
      console.log(`Updated file info: ${filePath}`);
    } catch (error) {
      console.error(`Error updating file ${filePath}:`, error);
    }
  }

  /**
   * Remove file from database
   */
  removeFromDatabase(filePath) {
    try {
      const stmt = db.prepare('DELETE FROM books WHERE file_path = ?');
      const result = stmt.run(filePath);

      if (result.changes > 0) {
        console.log(`Removed from database: ${filePath}`);
        this.emit('pdf-removed', filePath);
      }
    } catch (error) {
      console.error(`Error removing file ${filePath}:`, error);
    }
  }

  /**
   * Get watcher status
   */
  getStatus() {
    return {
      isWatching: this.isWatching,
      folders: this.folders,
      queueLength: this.processingQueue.length,
      isProcessing: this.isProcessing
    };
  }
}

// Export singleton instance
module.exports = new FileWatcher();