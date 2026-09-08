const express = require('express');
const router = express.Router();
const summaryService = require('../services/summaryService');

// GET /api/summaries/status - Check if AI summaries are available
router.get('/status', async (req, res) => {
  const available = await summaryService.isAvailable();
  res.json({
    available,
    provider: 'ollama',
    fallback: 'extractive',
    model: process.env.SUMMARY_MODEL || process.env.OLLAMA_MODEL || 'gemma3:4b',
    host: process.env.OLLAMA_HOST || 'http://localhost:11434'
  });
});

// GET /api/summaries/stats - Summary coverage stats
router.get('/stats', (req, res) => {
  try {
    const stats = summaryService.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/summaries/:bookId - Get cached summary
router.get('/:bookId', (req, res) => {
  try {
    const summary = summaryService.getSummary(parseInt(req.params.bookId));
    if (!summary) {
      return res.status(404).json({ error: 'No summary found for this book' });
    }
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/summaries/:bookId/generate - Generate summary
router.post('/:bookId/generate', async (req, res) => {
  try {
    const bookId = parseInt(req.params.bookId);
    const { force = false } = req.body || {};

    const result = await summaryService.generateSummary(bookId, { force });
    res.json(result);
  } catch (error) {
    console.error('Summary generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/summaries/:bookId - Delete cached summary
router.delete('/:bookId', (req, res) => {
  try {
    summaryService.deleteSummary(parseInt(req.params.bookId));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/summaries/batch - Batch generate summaries
router.post('/batch', async (req, res) => {
  try {
    const { bookIds, force = false } = req.body || {};
    if (!bookIds || !Array.isArray(bookIds)) {
      return res.status(400).json({ error: 'bookIds array is required' });
    }

    // Respond immediately
    res.json({ message: 'Batch summary generation started', count: bookIds.length });

    // Process in background
    for (const bookId of bookIds) {
      try {
        await summaryService.generateSummary(bookId, { force });
        console.log(`✅ Summary generated for book ${bookId}`);
      } catch (error) {
        console.error(`Failed to summarize book ${bookId}:`, error.message);
      }
      // Delay between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('📝 Batch summary generation complete');
  } catch (error) {
    console.error('Batch summary error:', error);
  }
});

module.exports = router;
