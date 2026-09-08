const express = require('express');
const router = express.Router();
const bookQA = require('../services/bookQA');
const ollama = require('../services/ollamaClient');

/** Can this book be questioned, and is the model up? */
router.get('/:bookId/available', async (req, res) => {
  try {
    res.json({
      available: await ollama.isAvailable(),
      indexed: bookQA.hasPages(req.params.bookId),
      model: ollama.model
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** Answer a question from the book's own pages. */
router.post('/:bookId', async (req, res) => {
  try {
    const question = (req.body?.question || '').trim();
    if (question.length < 3) {
      return res.status(400).json({ error: 'Ask a longer question' });
    }

    res.json(await bookQA.ask(req.params.bookId, question));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
