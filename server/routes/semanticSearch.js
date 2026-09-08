const express = require('express');
const router = express.Router();
const embeddingService = require('../services/embeddingService');

// GET /api/search/semantic?q=<query>&limit=20
router.get('/semantic', async (req, res) => {
  try {
    const { q, limit = 20, minSimilarity = 0.2 } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const results = await embeddingService.semanticSearch(q, {
      limit: parseInt(limit),
      minSimilarity: parseFloat(minSimilarity)
    });

    res.json({ results, query: q, total: results.length });
  } catch (error) {
    console.error('Semantic search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/search/hybrid?q=<query>&limit=20
router.get('/hybrid', async (req, res) => {
  try {
    const { q, limit = 20, ftsWeight = 0.4, semanticWeight = 0.6 } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const results = await embeddingService.hybridSearch(q, {
      limit: parseInt(limit),
      ftsWeight: parseFloat(ftsWeight),
      semanticWeight: parseFloat(semanticWeight)
    });

    res.json({ results, query: q, total: results.length });
  } catch (error) {
    console.error('Hybrid search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/search/similar/:bookId
router.get('/similar/:bookId', async (req, res) => {
  try {
    const { bookId } = req.params;
    const { limit = 5 } = req.query;

    const results = await embeddingService.findSimilarBooks(parseInt(bookId), {
      limit: parseInt(limit)
    });

    res.json(results);
  } catch (error) {
    console.error('Similar books error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/search/embeddings/stats
router.get('/embeddings/stats', (req, res) => {
  try {
    const stats = embeddingService.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/search/embeddings/generate - Embed all books
router.post('/embeddings/generate', async (req, res) => {
  try {
    const { force = false } = req.body || {};

    // Respond immediately, process in background
    res.json({ message: 'Embedding generation started', status: 'processing' });

    const stats = await embeddingService.embedAllBooks({
      forceReembed: force,
      onProgress: (progress) => {
        if (progress.current % 10 === 0 || progress.current === progress.total) {
          console.log(`🧠 Embedding progress: ${progress.current}/${progress.total} - ${progress.bookTitle}`);
        }
      }
    });

    console.log('🧠 Embedding complete:', stats);
  } catch (error) {
    console.error('Embedding generation error:', error);
  }
});

// POST /api/search/embeddings/book/:bookId - Embed single book
router.post('/embeddings/book/:bookId', async (req, res) => {
  try {
    const { bookId } = req.params;
    const { force = false } = req.body || {};

    const result = await embeddingService.embedBook(parseInt(bookId), force);
    res.json(result);
  } catch (error) {
    console.error('Embed book error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
