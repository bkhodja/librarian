const express = require('express');
const router = express.Router();
const duplicateDetector = require('../services/duplicateDetector');

/**
 * GET /api/duplicates
 * Get all duplicate groups in the library
 */
router.get('/', async (req, res) => {
  try {
    const duplicateGroups = await duplicateDetector.findAllDuplicates();

    res.json({
      success: true,
      totalGroups: duplicateGroups.length,
      totalDuplicates: duplicateGroups.reduce((sum, group) => sum + group.count, 0),
      groups: duplicateGroups
    });
  } catch (error) {
    console.error('Error finding duplicates:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to find duplicates'
    });
  }
});

/**
 * GET /api/duplicates/:bookId
 * Find duplicates for a specific book
 */
router.get('/:bookId', async (req, res) => {
  try {
    const bookId = parseInt(req.params.bookId);
    const duplicates = await duplicateDetector.findDuplicatesForBook(bookId);

    res.json({
      success: true,
      bookId: bookId,
      duplicatesCount: duplicates.length,
      duplicates: duplicates
    });
  } catch (error) {
    console.error('Error finding duplicates for book:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to find duplicates for book'
    });
  }
});

/**
 * POST /api/duplicates/check-file
 * Check if a file path already exists in the library
 */
router.post('/check-file', async (req, res) => {
  try {
    const { filePath } = req.body;

    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: 'File path is required'
      });
    }

    const existingBook = await duplicateDetector.checkFileExists(filePath);

    res.json({
      success: true,
      exists: !!existingBook,
      book: existingBook || null
    });
  } catch (error) {
    console.error('Error checking file existence:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check file existence'
    });
  }
});

/**
 * POST /api/duplicates/merge
 * Merge duplicate books (keep one, remove others)
 */
router.post('/merge', async (req, res) => {
  try {
    const { keepBookId, removeBookIds } = req.body;

    if (!keepBookId || !removeBookIds || !Array.isArray(removeBookIds)) {
      return res.status(400).json({
        success: false,
        error: 'keepBookId and removeBookIds array are required'
      });
    }

    const result = await duplicateDetector.mergeDuplicates(keepBookId, removeBookIds);

    res.json({
      success: true,
      kept: result.kept,
      removed: result.removed,
      message: `Merged ${result.removed} duplicate(s) into book #${keepBookId}`
    });
  } catch (error) {
    console.error('Error merging duplicates:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to merge duplicates'
    });
  }
});

/**
 * DELETE /api/duplicates/remove
 * Remove specific duplicate books
 */
router.delete('/remove', async (req, res) => {
  try {
    const { bookIds } = req.body;

    if (!bookIds || !Array.isArray(bookIds)) {
      return res.status(400).json({
        success: false,
        error: 'bookIds array is required'
      });
    }

    const db = require('../database/init');
    let removed = 0;

    for (const bookId of bookIds) {
      try {
        db.deleteBook(bookId);
        removed++;
      } catch (e) {
        console.error(`Failed to delete book ${bookId}:`, e);
      }
    }

    res.json({
      success: true,
      removed: removed,
      message: `Removed ${removed} book(s) from the library`
    });
  } catch (error) {
    console.error('Error removing duplicate books:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove duplicate books'
    });
  }
});

module.exports = router;