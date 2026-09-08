const express = require('express');
const router = express.Router();
const { db } = require('../database/init');
const smartCollections = require('../services/smartCollections');

// Get all collections
router.get('/', (req, res) => {
  try {
    const collections = db.prepare(`
      SELECT c.*, COUNT(bc.book_id) as book_count
      FROM collections c
      LEFT JOIN book_collections bc ON c.id = bc.collection_id
      GROUP BY c.id
      ORDER BY c.position, c.name
    `).all();

    res.json({ collections });
  } catch (error) {
    console.error('Error fetching collections:', error);
    res.status(500).json({ error: 'Failed to fetch collections' });
  }
});

// Get single collection with books
// Declared before '/:id' so Express does not read "suggest" as an id.
/** Shelves worth making, proposed from the library's own tag distribution. */
router.get('/suggest', async (req, res) => {
  try {
    const result = await smartCollections.propose();
    if (!result) return res.status(503).json({ error: 'The local model is not available' });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** Create one of those shelves and fill it. */
router.post('/suggest/create', (req, res) => {
  try {
    res.json(smartCollections.create(req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(req.params.id);

    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    // Get books in this collection
    const books = db.prepare(`
      SELECT b.*, bc.position as collection_position, bc.added_at
      FROM books b
      JOIN book_collections bc ON b.id = bc.book_id
      WHERE bc.collection_id = ?
      ORDER BY bc.position, bc.added_at DESC
    `).all(req.params.id);

    res.json({ ...collection, books });
  } catch (error) {
    console.error('Error fetching collection:', error);
    res.status(500).json({ error: 'Failed to fetch collection' });
  }
});

// Create new collection
router.post('/', (req, res) => {
  try {
    const { name, description, icon, color, is_smart, smart_rules } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Collection name is required' });
    }

    // Get the highest position
    const maxPosition = db.prepare('SELECT MAX(position) as max FROM collections').get();
    const position = (maxPosition.max || 0) + 1;

    const result = db.prepare(`
      INSERT INTO collections (name, description, icon, color, is_smart, smart_rules, position)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      description || null,
      icon || '📚',
      color || '#3B82F6',
      is_smart ? 1 : 0,
      smart_rules ? JSON.stringify(smart_rules) : null,
      position
    );

    res.status(201).json({
      id: result.lastInsertRowid,
      message: 'Collection created successfully'
    });
  } catch (error) {
    console.error('Error creating collection:', error);
    if (error.message.includes('UNIQUE constraint failed')) {
      res.status(400).json({ error: 'Collection with this name already exists' });
    } else {
      res.status(500).json({ error: 'Failed to create collection' });
    }
  }
});

// Update collection
router.put('/:id', (req, res) => {
  try {
    const { name, description, icon, color, is_smart, smart_rules } = req.body;

    const existing = db.prepare('SELECT * FROM collections WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    db.prepare(`
      UPDATE collections
      SET name = ?, description = ?, icon = ?, color = ?, is_smart = ?, smart_rules = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name || existing.name,
      description !== undefined ? description : existing.description,
      icon || existing.icon,
      color || existing.color,
      is_smart !== undefined ? (is_smart ? 1 : 0) : existing.is_smart,
      smart_rules !== undefined ? JSON.stringify(smart_rules) : existing.smart_rules,
      req.params.id
    );

    res.json({ message: 'Collection updated successfully' });
  } catch (error) {
    console.error('Error updating collection:', error);
    res.status(500).json({ error: 'Failed to update collection' });
  }
});

// Delete collection
router.delete('/:id', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM collections WHERE id = ?').run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    res.json({ message: 'Collection deleted successfully' });
  } catch (error) {
    console.error('Error deleting collection:', error);
    res.status(500).json({ error: 'Failed to delete collection' });
  }
});

// Add book to collection
router.post('/:id/books', (req, res) => {
  try {
    const { bookId, bookIds } = req.body;
    const collectionId = req.params.id;

    // Check if collection exists
    const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(collectionId);
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    // Handle single book or multiple books
    const idsToAdd = bookIds || (bookId ? [bookId] : []);

    if (idsToAdd.length === 0) {
      return res.status(400).json({ error: 'Book ID(s) required' });
    }

    // Get the highest position in this collection
    const maxPosition = db.prepare('SELECT MAX(position) as max FROM book_collections WHERE collection_id = ?')
      .get(collectionId);
    let position = (maxPosition.max || 0) + 1;

    // Add books to collection
    const transaction = db.transaction(() => {
      for (const id of idsToAdd) {
        try {
          db.prepare('INSERT INTO book_collections (book_id, collection_id, position) VALUES (?, ?, ?)')
            .run(id, collectionId, position++);
        } catch (err) {
          // Ignore if book is already in collection
          if (!err.message.includes('UNIQUE constraint failed')) {
            throw err;
          }
        }
      }
    });

    transaction();

    res.json({
      message: `Added ${idsToAdd.length} book(s) to collection`,
      bookIds: idsToAdd
    });
  } catch (error) {
    console.error('Error adding books to collection:', error);
    res.status(500).json({ error: 'Failed to add books to collection' });
  }
});

// Remove book from collection
router.delete('/:id/books/:bookId', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM book_collections WHERE collection_id = ? AND book_id = ?')
      .run(req.params.id, req.params.bookId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Book not found in collection' });
    }

    res.json({ message: 'Book removed from collection' });
  } catch (error) {
    console.error('Error removing book from collection:', error);
    res.status(500).json({ error: 'Failed to remove book from collection' });
  }
});

// Update collection order
router.put('/reorder', (req, res) => {
  try {
    const { collections } = req.body;

    if (!collections || !Array.isArray(collections)) {
      return res.status(400).json({ error: 'Collections array required' });
    }

    const transaction = db.transaction(() => {
      collections.forEach((collectionId, index) => {
        db.prepare('UPDATE collections SET position = ? WHERE id = ?')
          .run(index, collectionId);
      });
    });

    transaction();

    res.json({ message: 'Collection order updated' });
  } catch (error) {
    console.error('Error reordering collections:', error);
    res.status(500).json({ error: 'Failed to reorder collections' });
  }
});

// Update books order within a collection
router.put('/:id/books/reorder', (req, res) => {
  try {
    const { bookIds } = req.body;
    const collectionId = req.params.id;

    if (!bookIds || !Array.isArray(bookIds)) {
      return res.status(400).json({ error: 'Book IDs array required' });
    }

    const transaction = db.transaction(() => {
      bookIds.forEach((bookId, index) => {
        db.prepare('UPDATE book_collections SET position = ? WHERE collection_id = ? AND book_id = ?')
          .run(index, collectionId, bookId);
      });
    });

    transaction();

    res.json({ message: 'Book order updated in collection' });
  } catch (error) {
    console.error('Error reordering books in collection:', error);
    res.status(500).json({ error: 'Failed to reorder books' });
  }
});

// Create default collections if they don't exist
router.post('/init-defaults', (req, res) => {
  try {
    const defaultCollections = [
      { name: 'Want to Read', icon: '📚', color: '#3B82F6' },
      { name: 'Favorites', icon: '⭐', color: '#F59E0B' },
      { name: 'Completed', icon: '✅', color: '#8B5CF6' }
    ];

    let created = 0;
    for (const collection of defaultCollections) {
      const existing = db.prepare('SELECT id FROM collections WHERE name = ?').get(collection.name);
      if (!existing) {
        const position = created;
        db.prepare(`
          INSERT INTO collections (name, icon, color, position)
          VALUES (?, ?, ?, ?)
        `).run(collection.name, collection.icon, collection.color, position);
        created++;
      }
    }

    res.json({
      message: `Initialized ${created} default collection(s)`,
      created
    });
  } catch (error) {
    console.error('Error creating default collections:', error);
    res.status(500).json({ error: 'Failed to create default collections' });
  }
});

module.exports = router;