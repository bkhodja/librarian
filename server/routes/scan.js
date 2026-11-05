const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const { db } = require('../database/init');
const pdfProcessor = require('../services/pdfProcessor');
const fileWatcher = require('../services/fileWatcher');
const { BOOKS_FOLDER, ROOTS } = require('../services/libraryFolders');

// Recursively scan directory for PDF files
async function scanDirectory(dirPath) {
  const pdfFiles = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subFiles = await scanDirectory(fullPath);
        pdfFiles.push(...subFiles);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.pdf') {
        // Add PDF file to list
        const stats = await fs.stat(fullPath);
        pdfFiles.push({
          path: fullPath,
          name: entry.name,
          size: stats.size,
          modified: stats.mtime
        });
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dirPath}:`, error);
  }

  return pdfFiles;
}

// Trigger library scan
router.post('/', async (req, res) => {
  try {
    const fastMode = req.query.fast === 'true' || (req.body && req.body.fast === true);
    console.log(`Starting scan of: ${BOOKS_FOLDER} (${fastMode ? 'fast' : 'full'} mode)`);

    // Check if directory exists
    try {
      await fs.access(BOOKS_FOLDER);
    } catch {
      return res.status(404).json({
        error: 'Books folder not found',
        path: BOOKS_FOLDER,
        hint: 'Please update BOOKS_FOLDER in server/routes/scan.js or set BOOKS_FOLDER environment variable'
      });
    }

    // Scan for PDF files, books and magazines alike
    const pdfFiles = [];
    for (const root of ROOTS) {
      if (await fs.access(root.folder).then(() => true, () => false)) {
        pdfFiles.push(...await scanDirectory(root.folder));
      }
    }
    console.log(`Found ${pdfFiles.length} PDF files`);

    // Get existing files from database
    const existingFiles = db.prepare('SELECT file_path FROM books').all()
      .map(book => book.file_path);

    // Prepare insert statement
    const insertBook = db.prepare(`
      INSERT OR IGNORE INTO books (file_path, file_size, last_modified)
      VALUES (?, ?, ?)
    `);

    let added = 0;
    let skipped = 0;

    // Process each PDF file
    for (const pdf of pdfFiles) {
      if (existingFiles.includes(pdf.path)) {
        skipped++;
        continue;
      }

      if (fastMode) {
        // Fast mode: just add the file without processing
        const fileName = path.basename(pdf.name, '.pdf');
        const title = fileName.replace(/[-_]/g, ' ');

        insertBook.run(pdf.path, pdf.size, pdf.modified.toISOString());

        // Update with title extracted from filename
        db.prepare('UPDATE books SET title = ? WHERE file_path = ?')
          .run(title, pdf.path);

        added++;
      } else {
        // Full mode: process PDF metadata
        try {
          const pdfData = await pdfProcessor.processPDF(pdf.path);

          const stmt = db.prepare(`
            INSERT INTO books (
              title, author, language, file_path, file_size,
              page_count, pdf_type, ocr_confidence, needs_review,
              publication_year, isbn, publisher, edition, description,
              manual_metadata, date_added, last_modified
            ) VALUES (
              @title, @author, @language, @file_path, @file_size,
              @page_count, @pdf_type, @ocr_confidence, @needs_review,
              @publication_year, @isbn, @publisher, @edition, @description,
              @manual_metadata, @date_added, @last_modified
            )
          `);

          stmt.run({
            title: pdfData.metadata?.title || pdfData.metadata?.titleFromFilename || path.basename(pdf.name, '.pdf'),
            author: pdfData.metadata?.author || pdfData.metadata?.authorFromFilename || null,
            language: pdfData.language,
            file_path: pdf.path,
            file_size: pdf.size,
            page_count: pdfData.metadata?.pageCount || null,
            pdf_type: pdfData.pdfType,
            ocr_confidence: pdfData.ocrData?.confidence || null,
            needs_review: pdfData.needsReview ? 1 : 0,
            publication_year: pdfData.metadata?.publicationYear || pdfData.metadata?.yearFromFilename || null,
            isbn: pdfData.metadata?.isbn || null,
            publisher: pdfData.metadata?.publisher || null,
            edition: pdfData.metadata?.edition || null,
            description: pdfData.metadata?.description || null,
            manual_metadata: JSON.stringify(pdfData.metadata || {}),
            date_added: pdf.modified.toISOString(),
            last_modified: pdf.modified.toISOString()
          });

          added++;
          console.log(`Processed: ${pdfData.metadata?.title || path.basename(pdf.name)}`);
        } catch (error) {
          console.error(`Failed to process ${pdf.path}:`, error);
          // Fall back to simple insertion
          insertBook.run(pdf.path, pdf.size, pdf.modified.toISOString());
          added++;
        }
      }
    }

    res.json({
      success: true,
      scanned: pdfFiles.length,
      added,
      skipped,
      message: `Scan complete: ${added} new books added, ${skipped} already in library`
    });
  } catch (error) {
    console.error('Scan error:', error);
    res.status(500).json({ error: 'Scan failed', details: error.message });
  }
});

// Get scan status/configuration
router.get('/config', async (req, res) => {
  const exists = await fs.access(BOOKS_FOLDER).then(() => true).catch(() => false);
  res.json({
    booksFolder: BOOKS_FOLDER,
    exists,
    folders: await Promise.all(ROOTS.map(async (root) => ({
      ...root,
      exists: await fs.access(root.folder).then(() => true, () => false)
    }))),
    watcherStatus: fileWatcher.getStatus()
  });
});

// Start file watcher
router.post('/watch/start', (req, res) => {
  try {
    fileWatcher.start();
    res.json({
      success: true,
      message: 'File watcher started',
      status: fileWatcher.getStatus()
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to start watcher',
      details: error.message
    });
  }
});

// Stop file watcher
router.post('/watch/stop', async (req, res) => {
  try {
    await fileWatcher.stop();
    res.json({
      success: true,
      message: 'File watcher stopped',
      status: fileWatcher.getStatus()
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to stop watcher',
      details: error.message
    });
  }
});

// Get watcher status
router.get('/watch/status', (req, res) => {
  res.json(fileWatcher.getStatus());
});

module.exports = router;