const { db } = require('../database/init');
const pdfParse = require('pdf-parse');
const fs = require('fs').promises;
const properPdfExtractor = require('./properPdfExtractor');
const path = require('path');
const epubPageExtractor = require('./epubPageExtractor');
const pdfOcrExtractor = require('./pdfOcrExtractor');

class EnhancedSearchService {
  constructor() {
    this.initializePageIndex();
  }

  initializePageIndex() {
    // Create page-level index table if it doesn't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS book_pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER NOT NULL,
        page_number INTEGER NOT NULL,
        content TEXT,
        word_count INTEGER,
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
      )
    `);

    // Create search occurrences table for tracking
    db.exec(`
      CREATE TABLE IF NOT EXISTS search_occurrences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER NOT NULL,
        page_number INTEGER NOT NULL,
        search_term TEXT NOT NULL,
        context TEXT,
        position INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
      )
    `);

    // Create FTS table for page-level search
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
        page_id UNINDEXED,
        book_id UNINDEXED,
        page_number UNINDEXED,
        content,
        tokenize = 'unicode61'
      )
    `);

    console.log('✅ Page-level search index initialized');
  }

  /**
   * Index a book with page-level granularity
   */
  async indexBookPages(bookId) {
    try {
      const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
      if (!book) {
        return { success: false, message: 'Book not found' };
      }

      // Check if already indexed
      const existingPages = db.prepare(
        'SELECT COUNT(*) as count FROM book_pages WHERE book_id = ?'
      ).get(bookId);

      if (existingPages.count > 0) {
        return { success: true, message: 'Already indexed', pageCount: existingPages.count };
      }

      try {
        await fs.access(book.file_path);
      } catch {
        return { success: false, message: `File not found: ${book.file_path}` };
      }

      console.log(`Indexing pages for: ${book.title || 'Untitled'}`);

      /*
       * PDFs have pages the viewer can navigate to, so their numbering comes
       * from the file. ePUBs reflow and have none, so the extractor cuts the
       * reading order into pages of comparable size — useful for retrieval and
       * citation, but not something the ePUB reader can jump to.
       */
      const isEpub = path.extname(book.file_path || '').toLowerCase() === '.epub';
      const isScanned = !isEpub && book.pdf_type === 'scanned';

      let extractionResult;
      let source;

      if (isEpub) {
        source = 'ePUB';
        extractionResult = await epubPageExtractor.extractPages(book.file_path);
      } else if (isScanned) {
        // No text layer to read, so the pages are rendered and recognised.
        // Far slower than the others — seconds a page rather than milliseconds.
        source = 'OCR';
        extractionResult = await pdfOcrExtractor.extractPages(book.file_path, {
          pageCount: book.page_count,
          language: book.language,
          // A long scan is minutes of silence otherwise, which is
          // indistinguishable from a hang.
          onProgress: ({ done, total }) => {
            if (done % 40 === 0 || done === total) {
              process.stdout.write(`   OCR ${done}/${total} pages\r`);
            }
          }
        });
      } else {
        source = 'PDF';
        extractionResult = await properPdfExtractor.extractPages(book.file_path, { verbose: false });
      }

      if (!extractionResult.success) {
        throw new Error(`${source} extraction failed: ${extractionResult.error}`);
      }

      const pages = extractionResult.pages;
      let totalWords = 0;

      const insertPage = db.prepare(`
        INSERT INTO book_pages (book_id, page_number, content, word_count)
        VALUES (?, ?, ?, ?)
      `);

      const insertFTS = db.prepare(`
        INSERT INTO pages_fts (page_id, book_id, page_number, content)
        VALUES (?, ?, ?, ?)
      `);

      db.exec('BEGIN TRANSACTION');

      for (const page of pages) {
        if (page.content && page.content.trim().length > 0) {
          // Insert into pages table using the actual page number from PDF
          const result = insertPage.run(bookId, page.pageNumber, page.content, page.wordCount);

          // Insert into FTS index
          insertFTS.run(result.lastInsertRowid, bookId, page.pageNumber, page.content);

          totalWords += page.wordCount;
        }
      }

      if (isScanned) {
        db.prepare(`
          UPDATE books
          SET ocr_status = 'completed',
              ocr_confidence = ?,
              ocr_processed = 1,
              ocr_processed_at = datetime('now')
          WHERE id = ?
        `).run(extractionResult.confidence ?? null, bookId);
      }

      db.exec('COMMIT');

      console.log(`✅ Indexed ${pages.length} pages (${totalWords} words)` +
        (isScanned ? ` via OCR, ${Math.round(extractionResult.confidence)}% confidence, ${extractionResult.languages}` : ''));

      return {
        success: true,
        pageCount: pages.length,
        wordCount: totalWords
      };

    } catch (error) {
      console.error(`Error indexing pages for book ${bookId}: ${error.message}`);

      // Only roll back a transaction that was actually opened. Extraction runs
      // before BEGIN, so a failure there left nothing to roll back and the
      // ROLLBACK threw on top of the original error — which escaped this
      // handler and ended the whole indexing run on the first missing file.
      if (db.inTransaction) db.exec('ROLLBACK');

      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Search with page-level results
   */
  searchWithPages(query, options = {}) {
    try {
      const {
        bookId = null,
        limit = 10,
        matchType = 'any',
        groupByBook = true
      } = options;

      // Prepare FTS query
      let ftsQuery = query;
      if (matchType === 'all') {
        ftsQuery = query.split(' ').map(term => `"${term}"`).join(' AND ');
      } else if (matchType === 'phrase') {
        ftsQuery = `"${query}"`;
      }

      // Search in pages
      let sql = `
        SELECT
          p.book_id,
          p.page_number,
          b.title,
          b.author,
          b.thumbnail_path,
          snippet(pages_fts, 3, '<mark>', '</mark>', '...', 32) as snippet,
          LENGTH(p.content) - LENGTH(REPLACE(LOWER(p.content), LOWER(?), '')) as occurrence_count
        FROM pages_fts
        JOIN book_pages p ON pages_fts.page_id = p.id
        JOIN books b ON p.book_id = b.id
        WHERE pages_fts MATCH ?
      `;

      const params = [query, ftsQuery];

      if (bookId) {
        sql += ' AND p.book_id = ?';
        params.push(bookId);
      }

      sql += ' ORDER BY rank, p.book_id, p.page_number';

      if (!groupByBook) {
        sql += ` LIMIT ${limit}`;
      }

      const results = db.prepare(sql).all(...params);

      if (groupByBook) {
        // Group results by book with page occurrences
        const grouped = {};

        for (const result of results) {
          if (!grouped[result.book_id]) {
            grouped[result.book_id] = {
              bookId: result.book_id,
              title: result.title,
              author: result.author,
              thumbnailPath: result.thumbnail_path,
              occurrences: [],
              totalOccurrences: 0,
              pageNumbers: new Set()
            };
          }

          grouped[result.book_id].occurrences.push({
            pageNumber: result.page_number,
            snippet: result.snippet,
            count: Math.round(result.occurrence_count / query.length)
          });

          grouped[result.book_id].pageNumbers.add(result.page_number);
          grouped[result.book_id].totalOccurrences += Math.round(result.occurrence_count / query.length);
        }

        // Convert to array and limit occurrences per book
        return Object.values(grouped).map(book => ({
          ...book,
          pageNumbers: Array.from(book.pageNumbers).sort((a, b) => a - b),
          occurrences: book.occurrences.slice(0, 5), // Show first 5 occurrences
          hasMore: book.occurrences.length > 5
        }));
      }

      return results;

    } catch (error) {
      console.error('Search error:', error);
      return [];
    }
  }

  /**
   * Get all occurrences in a specific book
   */
  getBookOccurrences(bookId, query, options = {}) {
    try {
      const { limit = 50, matchType = 'phrase' } = options;

      // Format query for FTS5 based on match type
      let ftsQuery = query;
      if (matchType === 'phrase' || query.includes(' ')) {
        // For multi-word queries or explicit phrase search, wrap in quotes
        ftsQuery = `"${query}"`;
      }

      const sql = `
        SELECT
          p.page_number,
          snippet(pages_fts, 3, '<mark>', '</mark>', '...', 50) as snippet,
          p.content
        FROM pages_fts
        JOIN book_pages p ON pages_fts.page_id = p.id
        WHERE p.book_id = ? AND pages_fts MATCH ?
        ORDER BY p.page_number
        LIMIT ?
      `;

      const results = db.prepare(sql).all(bookId, ftsQuery, limit);

      // Calculate positions within each page
      return results.map(result => {
        const lowerContent = result.content.toLowerCase();
        const lowerQuery = query.toLowerCase();
        const positions = [];
        let index = 0;

        while ((index = lowerContent.indexOf(lowerQuery, index)) !== -1) {
          positions.push(index);
          index += lowerQuery.length;
        }

        return {
          pageNumber: result.page_number,
          snippet: result.snippet,
          occurrenceCount: positions.length,
          positions: positions.slice(0, 5) // First 5 positions
        };
      });

    } catch (error) {
      console.error('Error getting book occurrences:', error);
      return [];
    }
  }

  /**
   * Create search heatmap for a book
   */
  getSearchHeatmap(bookId, query) {
    try {
      const pages = db.prepare(`
        SELECT
          page_number,
          word_count,
          content
        FROM book_pages
        WHERE book_id = ?
        ORDER BY page_number
      `).all(bookId);

      const heatmap = pages.map(page => {
        const lowerContent = page.content.toLowerCase();
        const lowerQuery = query.toLowerCase();
        let count = 0;
        let index = 0;

        while ((index = lowerContent.indexOf(lowerQuery, index)) !== -1) {
          count++;
          index += lowerQuery.length;
        }

        return {
          pageNumber: page.page_number,
          density: page.word_count > 0 ? (count / page.word_count) * 100 : 0,
          count
        };
      });

      return heatmap;

    } catch (error) {
      console.error('Error creating heatmap:', error);
      return [];
    }
  }

  /**
   * Get statistics about page indexing
   */
  getIndexStats() {
    const stats = db.prepare(`
      SELECT
        COUNT(DISTINCT book_id) as indexed_books,
        COUNT(*) as total_pages,
        SUM(word_count) as total_words,
        AVG(word_count) as avg_words_per_page
      FROM book_pages
    `).get();

    const totalBooks = db.prepare('SELECT COUNT(*) as count FROM books').get().count;

    return {
      totalBooks,
      indexedBooks: stats.indexed_books || 0,
      totalPages: stats.total_pages || 0,
      totalWords: stats.total_words || 0,
      avgWordsPerPage: Math.round(stats.avg_words_per_page || 0),
      coverage: totalBooks > 0 ? Math.round((stats.indexed_books / totalBooks) * 100) : 0
    };
  }
}

module.exports = new EnhancedSearchService();