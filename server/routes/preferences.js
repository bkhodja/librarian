const express = require('express');
const router = express.Router();
const { db } = require('../database/init');

// GET /api/preferences - Get user preferences
router.get('/', (req, res) => {
  try {
    const preferences = db.prepare('SELECT * FROM user_preferences WHERE id = 1').get();

    if (!preferences) {
      // Return default preferences if not found
      return res.json({
        hide_adult_content: false,
        default_view_mode: 'grid',
        default_sort_by: 'date_added',
        default_sort_order: 'desc',
        books_per_page: 50
      });
    }

    // Convert SQLite integers to booleans for better UX
    res.json({
      hide_adult_content: Boolean(preferences.hide_adult_content),
      default_view_mode: preferences.default_view_mode,
      default_sort_by: preferences.default_sort_by,
      default_sort_order: preferences.default_sort_order,
      books_per_page: preferences.books_per_page
    });
  } catch (error) {
    console.error('Error fetching preferences:', error);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

// PUT /api/preferences - Update user preferences
router.put('/', (req, res) => {
  try {
    const {
      hide_adult_content,
      default_view_mode,
      default_sort_by,
      default_sort_order,
      books_per_page
    } = req.body;

    // Validate view mode
    if (default_view_mode && !['grid', 'list'].includes(default_view_mode)) {
      return res.status(400).json({ error: 'Invalid view mode. Must be "grid" or "list"' });
    }

    // Validate sort order
    if (default_sort_order && !['asc', 'desc'].includes(default_sort_order)) {
      return res.status(400).json({ error: 'Invalid sort order. Must be "asc" or "desc"' });
    }

    // Build update query dynamically based on provided fields
    const updates = [];
    const values = [];

    if (hide_adult_content !== undefined) {
      updates.push('hide_adult_content = ?');
      values.push(hide_adult_content ? 1 : 0);
    }

    if (default_view_mode) {
      updates.push('default_view_mode = ?');
      values.push(default_view_mode);
    }

    if (default_sort_by) {
      updates.push('default_sort_by = ?');
      values.push(default_sort_by);
    }

    if (default_sort_order) {
      updates.push('default_sort_order = ?');
      values.push(default_sort_order);
    }

    if (books_per_page) {
      updates.push('books_per_page = ?');
      values.push(books_per_page);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Always update the updated_at timestamp
    updates.push('updated_at = CURRENT_TIMESTAMP');

    const query = `UPDATE user_preferences SET ${updates.join(', ')} WHERE id = 1`;
    db.prepare(query).run(...values);

    // Return updated preferences
    const updated = db.prepare('SELECT * FROM user_preferences WHERE id = 1').get();

    res.json({
      success: true,
      preferences: {
        hide_adult_content: Boolean(updated.hide_adult_content),
        default_view_mode: updated.default_view_mode,
        default_sort_by: updated.default_sort_by,
        default_sort_order: updated.default_sort_order,
        books_per_page: updated.books_per_page
      }
    });
  } catch (error) {
    console.error('Error updating preferences:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// PATCH /api/preferences - Partially update user preferences
router.patch('/', (req, res) => {
  // Reuse PUT logic for PATCH
  router.put('/', req, res);
});

module.exports = router;
