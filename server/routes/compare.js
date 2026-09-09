const express = require('express');
const router = express.Router();
const { db } = require('../database/init');
const compare = require('../services/crossBookCompare');
const ollama = require('../services/ollamaClient');

/** Is the model up, and what can the comparison be narrowed by? */
router.get('/options', async (req, res) => {
  try {
    res.json({
      available: await ollama.isAvailable(),
      model: ollama.model,
      languages: db.prepare(`
        SELECT language, COUNT(*) AS count FROM books
         WHERE language IS NOT NULL AND language != ''
         GROUP BY language HAVING count >= 5 ORDER BY count DESC
      `).all(),
      tags: db.prepare(`
        SELECT t.name, COUNT(*) AS count FROM book_tags bt
          JOIN tags t ON t.id = bt.tag_id
         GROUP BY t.id HAVING count >= 5 ORDER BY count DESC LIMIT 40
      `).all()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * How the library explains a topic, one passage per book.
 *
 * Hidden books stay hidden: if the reader has asked not to see adult titles,
 * a comparison is not a side door back to them.
 */
router.get('/', async (req, res) => {
  try {
    const topic = (req.query.topic || '').trim();
    if (topic.length < 3) {
      return res.status(400).json({ error: 'Give a longer topic' });
    }

    const preferences = db.prepare('SELECT hide_adult_content FROM user_preferences WHERE id = 1').get();

    res.json(await compare.compare(topic, {
      limit: Math.min(Number(req.query.limit) || 6, 10),
      tag: req.query.tag || null,
      language: req.query.language || null,
      includeAdult: !preferences?.hide_adult_content
    }));
  } catch (error) {
    console.error('Comparison failed:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
