const express = require('express');
const router = express.Router();
const ocrQueueManager = require('../services/ocrQueueManager');
const { db } = require('../database/init');

// Get OCR queue statistics
router.get('/stats', (req, res) => {
  try {
    const stats = ocrQueueManager.getQueueStats();
    res.json(stats);
  } catch (error) {
    console.error('Error getting OCR queue stats:', error);
    res.status(500).json({ error: 'Failed to get queue statistics' });
  }
});

// Get queue items
router.get('/items', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const items = ocrQueueManager.getQueueItems(limit);
    res.json({ items });
  } catch (error) {
    console.error('Error getting queue items:', error);
    res.status(500).json({ error: 'Failed to get queue items' });
  }
});

// Add books to OCR queue
router.post('/add', async (req, res) => {
  try {
    const { bookIds } = req.body;

    if (!bookIds || !Array.isArray(bookIds)) {
      return res.status(400).json({ error: 'bookIds array is required' });
    }

    const result = await ocrQueueManager.addToQueue(bookIds);
    res.json(result);
  } catch (error) {
    console.error('Error adding to OCR queue:', error);
    res.status(500).json({ error: 'Failed to add books to queue' });
  }
});

// Queue all scanned PDFs for OCR
router.post('/batch', async (req, res) => {
  try {
    const result = await ocrQueueManager.queueAllScannedPDFs();
    res.json(result);
  } catch (error) {
    console.error('Error queuing batch OCR:', error);
    res.status(500).json({ error: 'Failed to queue batch OCR' });
  }
});

// Remove book from queue
router.delete('/remove/:bookId', (req, res) => {
  try {
    const bookId = parseInt(req.params.bookId);
    const result = ocrQueueManager.removeFromQueue(bookId);
    res.json(result);
  } catch (error) {
    console.error('Error removing from queue:', error);
    res.status(500).json({ error: 'Failed to remove from queue' });
  }
});

// Clear completed jobs
router.post('/clear-completed', (req, res) => {
  try {
    const result = ocrQueueManager.clearCompleted();
    res.json(result);
  } catch (error) {
    console.error('Error clearing completed jobs:', error);
    res.status(500).json({ error: 'Failed to clear completed jobs' });
  }
});

// Reset failed jobs
router.post('/reset-failed', (req, res) => {
  try {
    const result = ocrQueueManager.resetFailed();
    res.json(result);
  } catch (error) {
    console.error('Error resetting failed jobs:', error);
    res.status(500).json({ error: 'Failed to reset failed jobs' });
  }
});

// Get books needing OCR
router.get('/books-needing-ocr', (req, res) => {
  try {
    const books = db.prepare(`
      SELECT
        id,
        title,
        author,
        file_size,
        pdf_type,
        ocr_status,
        ocr_confidence
      FROM books
      WHERE pdf_type IN ('scanned', 'mixed')
      AND (ocr_status IS NULL OR ocr_status IN ('not_needed', 'failed'))
      ORDER BY file_size ASC
      LIMIT 100
    `).all();

    res.json({ books, total: books.length });
  } catch (error) {
    console.error('Error getting books needing OCR:', error);
    res.status(500).json({ error: 'Failed to get books needing OCR' });
  }
});

// Get OCR history for a book
router.get('/history/:bookId', (req, res) => {
  try {
    const bookId = parseInt(req.params.bookId);

    const book = db.prepare(`
      SELECT
        id,
        title,
        ocr_status,
        ocr_confidence,
        ocr_processed_at,
        ocr_error
      FROM books
      WHERE id = ?
    `).get(bookId);

    const queueHistory = db.prepare(`
      SELECT *
      FROM ocr_queue
      WHERE book_id = ?
      ORDER BY created_at DESC
    `).all(bookId);

    res.json({ book, queueHistory });
  } catch (error) {
    console.error('Error getting OCR history:', error);
    res.status(500).json({ error: 'Failed to get OCR history' });
  }
});

// Start/stop processing
router.post('/control', (req, res) => {
  try {
    const { action } = req.body;

    if (action === 'start') {
      ocrQueueManager.startProcessing();
      res.json({ success: true, message: 'OCR processing started' });
    } else if (action === 'stop') {
      ocrQueueManager.stopProcessing();
      res.json({ success: true, message: 'OCR processing stopped' });
    } else {
      res.status(400).json({ error: 'Invalid action. Use "start" or "stop"' });
    }
  } catch (error) {
    console.error('Error controlling OCR processing:', error);
    res.status(500).json({ error: 'Failed to control processing' });
  }
});

module.exports = router;