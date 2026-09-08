const express = require('express');
const router = express.Router();
const aiTagger = require('../services/aiTagger');
const vocabulary = require('../services/tagVocabulary');
const queryInterpreter = require('../services/queryInterpreter');
const { db } = require('../database/init');

/** Is local tagging available, and how much is left to do? */
router.get('/status', async (req, res) => {
  try {
    res.json(await aiTagger.status());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** The controlled vocabulary, with how many books carry each tag. */
router.get('/vocabulary', (req, res) => {
  try {
    const counts = new Map(
      db.prepare(`
        SELECT t.name, COUNT(bt.book_id) AS count
        FROM tags t LEFT JOIN book_tags bt ON bt.tag_id = t.id
        GROUP BY t.id
      `).all().map((row) => [row.name, row.count])
    );

    res.json({
      tags: vocabulary.VOCABULARY.map(({ tag, hint }) => ({
        tag,
        hint,
        count: counts.get(tag) || 0
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** Suggest tags for one book without storing them. */
router.get('/suggest/:bookId', async (req, res) => {
  try {
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.bookId);
    if (!book) return res.status(404).json({ error: 'Book not found' });

    res.json(await aiTagger.suggest(book));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** Suggest and store for one book. */
router.post('/tag/:bookId', async (req, res) => {
  try {
    res.json(await aiTagger.tagBook(req.params.bookId));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** Tag a batch of currently untagged books. */
router.post('/tag-untagged', async (req, res) => {
  try {
    const limit = Math.min(Number(req.body?.limit) || 25, 200);
    res.json(await aiTagger.tagUntagged(limit));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** Clear a book's tags and derive them again. */
router.post('/retag/:bookId', async (req, res) => {
  try {
    res.json(await aiTagger.retagBook(req.params.bookId));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** Fold legacy tags onto the vocabulary and drop what is not a subject. */
router.post('/normalize', (req, res) => {
  try {
    const result = aiTagger.normalizeExistingTags();
    result.pruned = aiTagger.pruneOrphanTags();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Read a plain-language request and return the filter it means. The client
 * applies it, so the result stays visible and reversible.
 */
router.get('/interpret', async (req, res) => {
  try {
    const result = await queryInterpreter.interpret(req.query.q || '');
    if (!result) {
      return res.status(503).json({ error: 'The local model is not available' });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
