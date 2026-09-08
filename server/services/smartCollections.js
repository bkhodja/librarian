/**
 * Proposing shelves from what is actually on them.
 *
 * The alternative is a rule builder, where the user has to already know what
 * their library contains in order to describe it. This reads the tag
 * distribution and suggests groupings, which the user accepts or ignores.
 *
 * A proposal is a set of tags, not a saved query language: a collection built
 * from it is filled by tag membership, so it stays explainable and can be
 * edited afterwards like any other collection.
 */

const { db } = require('../database/init');
const ollama = require('./ollamaClient');
const vocabulary = require('./tagVocabulary');

const MIN_BOOKS = Number(process.env.SMART_COLLECTION_MIN) || 4;

const SCHEMA = {
  type: 'object',
  properties: {
    collections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          icon: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' }
        },
        required: ['name', 'tags']
      }
    }
  },
  required: ['collections']
};

class SmartCollections {
  /** Tags with enough books behind them to be worth a shelf. */
  tagDistribution() {
    return db.prepare(`
      SELECT t.name, COUNT(bt.book_id) AS count
      FROM tags t JOIN book_tags bt ON bt.tag_id = t.id
      GROUP BY t.id
      HAVING count >= ?
      ORDER BY count DESC
    `).all(MIN_BOOKS);
  }

  existingNames() {
    return new Set(
      db.prepare('SELECT name FROM collections').all().map((r) => r.name.toLowerCase())
    );
  }

  /** How many books a set of tags would gather, requiring any of them. */
  countForTags(tags) {
    if (!tags.length) return 0;

    const placeholders = tags.map(() => '?').join(',');
    return db.prepare(`
      SELECT COUNT(DISTINCT bt.book_id) AS count
      FROM book_tags bt JOIN tags t ON t.id = bt.tag_id
      WHERE t.name IN (${placeholders})
    `).get(...tags).count;
  }

  async propose(limit = 6) {
    const distribution = this.tagDistribution();
    if (distribution.length === 0) return { collections: [], reason: 'Nothing is tagged yet.' };

    const existing = this.existingNames();

    const result = await ollama.generateJSON(
      `A personal book library, described by how many books carry each subject tag:\n\n` +
      distribution.map((t) => `${t.name}: ${t.count}`).join('\n') +
      `\n\nShelves that already exist: ${[...existing].join(', ') || 'none'}\n\n` +
      `Propose up to ${limit} shelves worth making for this library. A good shelf ` +
      `groups tags someone would browse together and holds enough books to be ` +
      `worth opening. Do not repeat a shelf that already exists, and do not ` +
      `propose a shelf for a single tag that is already easy to filter by.\n\n` +
      `Use only the tags listed above. Give each shelf a short name and one emoji.\n\n` +
      `Reply as JSON: {"collections":[{"name":"...","icon":"📚","tags":["..."],"reason":"..."}]}`,
      SCHEMA,
      { maxTokens: 600, temperature: 0.4 }
    );

    if (!result?.collections) return null;

    const proposals = [];
    for (const proposal of result.collections) {
      const tags = [...new Set(
        (proposal.tags || []).map((t) => vocabulary.canonicalize(t)).filter(Boolean)
      )];
      if (tags.length === 0) continue;

      // The model tends to put the emoji in the name as well as the icon,
      // which renders it twice on the shelf.
      const name = String(proposal.name || '')
        .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
      if (!name || existing.has(name.toLowerCase())) continue;

      // Counted here rather than taken on trust: the model is estimating from
      // a list of numbers, and a shelf that turns out to be empty is worse
      // than one not offered.
      const count = this.countForTags(tags);
      if (count < MIN_BOOKS) continue;

      proposals.push({
        name,
        icon: (proposal.icon || '📚').replace(/\uFE0F/g, '').slice(0, 2) || '📚',
        tags,
        count,
        reason: String(proposal.reason || '').slice(0, 200)
      });
    }

    return { collections: proposals.slice(0, limit) };
  }

  /** Create a collection and fill it from the tags it was proposed for. */
  create({ name, icon, tags }) {
    if (!name || !Array.isArray(tags) || tags.length === 0) {
      throw new Error('A shelf needs a name and at least one tag');
    }

    const placeholders = tags.map(() => '?').join(',');
    const books = db.prepare(`
      SELECT DISTINCT bt.book_id FROM book_tags bt
      JOIN tags t ON t.id = bt.tag_id
      WHERE t.name IN (${placeholders})
    `).all(...tags).map((r) => r.book_id);

    const write = db.transaction(() => {
      const { lastInsertRowid } = db.prepare(
        'INSERT INTO collections (name, description, icon) VALUES (?, ?, ?)'
      ).run(name, `Books tagged ${tags.join(', ')}`, icon || '📚');

      const link = db.prepare(
        'INSERT OR IGNORE INTO book_collections (book_id, collection_id) VALUES (?, ?)'
      );
      for (const bookId of books) link.run(bookId, lastInsertRowid);

      return lastInsertRowid;
    });

    return { id: write(), name, added: books.length };
  }
}

module.exports = new SmartCollections();
