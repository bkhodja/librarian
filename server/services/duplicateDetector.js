const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../database/init');

class DuplicateDetector {
  constructor() {
    this.titleSimilarityThreshold = 0.85; // 85% similarity for titles
    this.authorSimilarityThreshold = 0.90; // 90% similarity for authors
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,    // deletion
            dp[i][j - 1] + 1,    // insertion
            dp[i - 1][j - 1] + 1 // substitution
          );
        }
      }
    }

    return dp[m][n];
  }

  /**
   * Calculate similarity ratio between two strings
   */
  similarity(str1, str2) {
    if (!str1 || !str2) return 0;

    str1 = str1.toLowerCase().trim();
    str2 = str2.toLowerCase().trim();

    if (str1 === str2) return 1;

    const distance = this.levenshteinDistance(str1, str2);
    const maxLength = Math.max(str1.length, str2.length);

    if (maxLength === 0) return 1;

    return 1 - (distance / maxLength);
  }

  /**
   * Normalize title for comparison
   */
  normalizeTitle(title) {
    if (!title) return '';

    return title
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ')     // Normalize whitespace
      .replace(/^(the|a|an)\s+/i, '') // Remove common articles
      .trim();
  }

  /**
   * Normalize author name for comparison
   */
  normalizeAuthor(author) {
    if (!author) return '';

    return author
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ')     // Normalize whitespace
      .trim();
  }

  /**
   * Calculate file hash for exact file comparison
   */
  async calculateFileHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath);

      stream.on('data', data => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Find all duplicate groups in the library
   */
  async findAllDuplicates() {
    const books = db.getAllBooks();
    const duplicateGroups = [];
    const processed = new Set();

    for (let i = 0; i < books.length; i++) {
      if (processed.has(books[i].id)) continue;

      const duplicates = [];
      const book1 = books[i];
      const normalized1Title = this.normalizeTitle(book1.title);
      const normalized1Author = this.normalizeAuthor(book1.author);

      for (let j = i + 1; j < books.length; j++) {
        if (processed.has(books[j].id)) continue;

        const book2 = books[j];
        const normalized2Title = this.normalizeTitle(book2.title);
        const normalized2Author = this.normalizeAuthor(book2.author);

        // Check title similarity
        const titleSimilarity = this.similarity(normalized1Title, normalized2Title);

        // Check author similarity (if both have authors)
        let authorSimilarity = 0;
        if (book1.author && book2.author) {
          authorSimilarity = this.similarity(normalized1Author, normalized2Author);
        }

        // Consider as potential duplicate if:
        // 1. Titles are very similar AND authors are similar (if present)
        // 2. OR exact title match
        const isPotentialDuplicate =
          (titleSimilarity >= this.titleSimilarityThreshold &&
           (!book1.author || !book2.author || authorSimilarity >= this.authorSimilarityThreshold)) ||
          (normalized1Title === normalized2Title && normalized1Title !== '');

        if (isPotentialDuplicate) {
          if (duplicates.length === 0) {
            duplicates.push({
              book: book1,
              confidence: 1.0,
              reasons: ['Original']
            });
            processed.add(book1.id);
          }

          const confidence = (titleSimilarity + authorSimilarity) / 2;
          const reasons = [];

          if (titleSimilarity >= 0.95) {
            reasons.push('Nearly identical title');
          } else if (titleSimilarity >= this.titleSimilarityThreshold) {
            reasons.push('Similar title');
          }

          if (authorSimilarity >= 0.95) {
            reasons.push('Same author');
          } else if (authorSimilarity >= this.authorSimilarityThreshold) {
            reasons.push('Similar author');
          }

          if (book1.file_size === book2.file_size) {
            reasons.push('Same file size');
          }

          if (book1.page_count === book2.page_count && book1.page_count > 0) {
            reasons.push('Same page count');
          }

          duplicates.push({
            book: book2,
            confidence: confidence,
            reasons: reasons
          });
          processed.add(book2.id);
        }
      }

      if (duplicates.length > 1) {
        duplicateGroups.push({
          groupId: `group_${i}`,
          count: duplicates.length,
          duplicates: duplicates.sort((a, b) => b.confidence - a.confidence)
        });
      }
    }

    return duplicateGroups;
  }

  /**
   * Find duplicates for a specific book
   */
  async findDuplicatesForBook(bookId) {
    const book = db.getBookById(bookId);
    if (!book) {
      throw new Error('Book not found');
    }

    const allBooks = db.getAllBooks();
    const duplicates = [];
    const normalizedTitle = this.normalizeTitle(book.title);
    const normalizedAuthor = this.normalizeAuthor(book.author);

    for (const otherBook of allBooks) {
      if (otherBook.id === bookId) continue;

      const otherNormalizedTitle = this.normalizeTitle(otherBook.title);
      const otherNormalizedAuthor = this.normalizeAuthor(otherBook.author);

      const titleSimilarity = this.similarity(normalizedTitle, otherNormalizedTitle);
      let authorSimilarity = 0;

      if (book.author && otherBook.author) {
        authorSimilarity = this.similarity(normalizedAuthor, otherNormalizedAuthor);
      }

      const isPotentialDuplicate =
        (titleSimilarity >= this.titleSimilarityThreshold &&
         (!book.author || !otherBook.author || authorSimilarity >= this.authorSimilarityThreshold)) ||
        (normalizedTitle === otherNormalizedTitle && normalizedTitle !== '');

      if (isPotentialDuplicate) {
        const confidence = (titleSimilarity + authorSimilarity) / 2;
        const reasons = [];

        if (titleSimilarity >= 0.95) {
          reasons.push('Nearly identical title');
        } else if (titleSimilarity >= this.titleSimilarityThreshold) {
          reasons.push('Similar title');
        }

        if (authorSimilarity >= 0.95) {
          reasons.push('Same author');
        } else if (authorSimilarity >= this.authorSimilarityThreshold) {
          reasons.push('Similar author');
        }

        if (book.file_size === otherBook.file_size) {
          reasons.push('Same file size');
        }

        if (book.page_count === otherBook.page_count && book.page_count > 0) {
          reasons.push('Same page count');
        }

        duplicates.push({
          book: otherBook,
          confidence: confidence,
          reasons: reasons
        });
      }
    }

    return duplicates.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Check if a file path already exists in the library
   */
  async checkFileExists(filePath) {
    const books = db.getAllBooks();
    const normalizedPath = path.normalize(filePath).toLowerCase();

    return books.find(book =>
      path.normalize(book.file_path).toLowerCase() === normalizedPath
    );
  }

  /**
   * Merge duplicate books (keep one, remove others)
   */
  async mergeDuplicates(keepBookId, removeBookIds) {
    const keepBook = db.getBookById(keepBookId);
    if (!keepBook) {
      throw new Error('Book to keep not found');
    }

    // Merge metadata from books to be removed
    const booksToRemove = removeBookIds.map(id => db.getBookById(id)).filter(Boolean);

    for (const bookToRemove of booksToRemove) {
      // Merge tags
      const tags = db.getBookTags(bookToRemove.id);
      for (const tag of tags) {
        try {
          db.addTagToBook(keepBookId, tag.id);
        } catch (e) {
          // Tag might already exist
        }
      }

      // Merge collections
      const stmt = db.db.prepare(`
        INSERT OR IGNORE INTO book_collections (book_id, collection_id, position, added_at)
        SELECT ?, collection_id, position, added_at
        FROM book_collections
        WHERE book_id = ?
      `);
      stmt.run(keepBookId, bookToRemove.id);

      // Merge metadata (prefer non-empty values)
      const updates = {};
      if (!keepBook.author && bookToRemove.author) {
        updates.author = bookToRemove.author;
      }
      if (!keepBook.isbn && bookToRemove.isbn) {
        updates.isbn = bookToRemove.isbn;
      }
      if (!keepBook.publisher && bookToRemove.publisher) {
        updates.publisher = bookToRemove.publisher;
      }
      if (!keepBook.publication_year && bookToRemove.publication_year) {
        updates.publication_year = bookToRemove.publication_year;
      }
      if (!keepBook.description && bookToRemove.description) {
        updates.description = bookToRemove.description;
      }

      if (Object.keys(updates).length > 0) {
        db.updateBook(keepBookId, updates);
      }

      // Delete the duplicate book
      db.deleteBook(bookToRemove.id);
    }

    return {
      kept: keepBook,
      removed: booksToRemove.length
    };
  }
}

module.exports = new DuplicateDetector();