const express = require('express');
const router = express.Router();
const autoTagger = require('../services/autoTagger');

/**
 * GET /api/auto-tags/suggestions/:bookId
 * Get tag suggestions for a specific book
 */
router.get('/suggestions/:bookId', async (req, res) => {
  try {
    const bookId = parseInt(req.params.bookId);
    const suggestions = await autoTagger.generateSuggestions(bookId);

    res.json({
      success: true,
      ...suggestions
    });
  } catch (error) {
    console.error('Error generating tag suggestions:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate tag suggestions'
    });
  }
});

/**
 * POST /api/auto-tags/suggestions/batch
 * Get tag suggestions for multiple books
 */
router.post('/suggestions/batch', async (req, res) => {
  try {
    const { bookIds } = req.body;

    if (!bookIds || !Array.isArray(bookIds)) {
      return res.status(400).json({
        success: false,
        error: 'bookIds array is required'
      });
    }

    const suggestions = await autoTagger.batchGenerateSuggestions(bookIds);

    res.json({
      success: true,
      count: suggestions.length,
      suggestions: suggestions
    });
  } catch (error) {
    console.error('Error generating batch tag suggestions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate tag suggestions'
    });
  }
});

/**
 * POST /api/auto-tags/apply/:bookId
 * Apply suggested tags to a book
 */
router.post('/apply/:bookId', async (req, res) => {
  try {
    const bookId = parseInt(req.params.bookId);
    const { tags } = req.body;

    if (!tags || !Array.isArray(tags)) {
      return res.status(400).json({
        success: false,
        error: 'tags array is required'
      });
    }

    const result = await autoTagger.applySuggestions(bookId, tags);

    res.json({
      success: result.success,
      applied: result.applied,
      failed: result.failed,
      message: `Applied ${result.applied.length} tags to book`
    });
  } catch (error) {
    console.error('Error applying tag suggestions:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to apply tag suggestions'
    });
  }
});

/**
 * POST /api/auto-tags/scan-all
 * Scan all books without tags and generate suggestions
 */
router.post('/scan-all', async (req, res) => {
  try {
    const db = require('../database/init');

    // Get all books without tags
    const stmt = db.db.prepare(`
      SELECT b.id
      FROM books b
      LEFT JOIN book_tags bt ON b.id = bt.book_id
      WHERE bt.book_id IS NULL
    `);
    const booksWithoutTags = stmt.all();

    if (booksWithoutTags.length === 0) {
      return res.json({
        success: true,
        message: 'All books already have tags',
        count: 0
      });
    }

    const bookIds = booksWithoutTags.map(b => b.id);
    const suggestions = await autoTagger.batchGenerateSuggestions(bookIds);

    res.json({
      success: true,
      scanned: bookIds.length,
      suggestionsGenerated: suggestions.length,
      suggestions: suggestions
    });
  } catch (error) {
    console.error('Error scanning books for tags:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to scan books for tag suggestions'
    });
  }
});

module.exports = router;