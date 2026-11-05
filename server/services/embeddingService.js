const { db } = require('../database/init');
const crypto = require('crypto');
const path = require('path');

// Multilingual: most of the library is Russian, and all-MiniLM-L6-v2 is an
// English model. Measured on this library as how often a book's five nearest
// neighbours share one of its tags (tags left out of the text so they could
// not answer for themselves): 54.8% → 61.0% overall, Russian books 43.9% →
// 57.1%, English 72.4% → 67.9%. It also matches a Russian query to an English
// book and back.
const MODEL_NAME = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const EMBEDDING_DIM = 384;

// Bump when buildEmbeddingText changes. Stored with each vector (in
// model_name), so the background sweep re-embeds whatever was made by an
// older model or recipe, and searches never compare vectors from two.
const TEXT_VERSION = 2;
const EMBEDDING_KEY = `${MODEL_NAME}#text-v${TEXT_VERSION}`;

// Embedding runs in the server process alongside OCR and the UI; ONNX Runtime
// would otherwise take every core for a job that needs a few milliseconds.
const INFERENCE_THREADS = 2;

// A book this new may still be waiting for the tagging sweep; embedding it
// now would only mean embedding it again once its tags land.
const AWAIT_TAGS_MS = 24 * 60 * 60 * 1000;

// Downloaded once from the Hugging Face hub, then read from here. The library's
// default is inside node_modules, where every reinstall deleted it.
const MODEL_CACHE = path.join(__dirname, '../../data/models');

class EmbeddingService {
  constructor() {
    this.pipeline = null;
    this.loading = false;
    this.initializeTable();
  }

  initializeTable() {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS book_embeddings (
          book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
          embedding BLOB NOT NULL,
          model_name TEXT NOT NULL,
          text_hash TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('✅ Book embeddings table initialized');
    } catch (error) {
      console.error('Error initializing book_embeddings table:', error);
    }
  }

  async loadModel() {
    if (this.pipeline) return this.pipeline;
    if (this.loading) {
      // Wait for the in-progress load
      while (this.loading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.pipeline;
    }

    this.loading = true;
    try {
      console.log('🧠 Loading embedding model...');
      // @huggingface/transformers is the maintained successor of
      // @xenova/transformers, whose onnxruntime-web pulled in a protobufjs
      // with a code-injection advisory.
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = MODEL_CACHE;
      this.pipeline = await pipeline('feature-extraction', MODEL_NAME, {
        dtype: 'q8',
        session_options: { intraOpNumThreads: INFERENCE_THREADS }
      });
      console.log('✅ Embedding model loaded');
      return this.pipeline;
    } catch (error) {
      console.error('Failed to load embedding model:', error);
      throw error;
    } finally {
      this.loading = false;
    }
  }

  /**
   * The text a book is embedded from: title, author, subject tags and the
   * publisher's description.
   *
   * Page text is left out on purpose. The first pages are copyright notices
   * and front matter, and even a sample from further in made neighbours
   * worse: agreement fell from 61% to 32% with it included. The fields here
   * are short, and say what the book is about.
   */
  buildEmbeddingText(book, tags = []) {
    const parts = [];

    if (book.title) parts.push(book.title);
    if (book.author) parts.push(`by ${book.author}`);
    if (tags.length > 0) parts.push(tags.map(t => t.name).join(', '));
    if (book.description) parts.push(book.description);

    return parts.join('. ');
  }

  /**
   * Generate a SHA-256 hash of input text for change detection
   */
  hashText(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  /**
   * Generate embedding vector for a text string
   */
  async generateEmbedding(text) {
    const extractor = await this.loadModel();
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    // output.data is a Float32Array
    return Array.from(output.data);
  }

  /**
   * Convert float array to Buffer for SQLite BLOB storage
   */
  vectorToBuffer(vector) {
    const buffer = Buffer.alloc(vector.length * 4);
    for (let i = 0; i < vector.length; i++) {
      buffer.writeFloatLE(vector[i], i * 4);
    }
    return buffer;
  }

  /**
   * Convert Buffer back to float array
   */
  bufferToVector(buffer) {
    const vector = new Array(buffer.length / 4);
    for (let i = 0; i < vector.length; i++) {
      vector[i] = buffer.readFloatLE(i * 4);
    }
    return vector;
  }

  /**
   * Cosine similarity between two vectors
   */
  cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Embed a single book and store in database
   */
  async embedBook(bookId, forceReembed = false) {
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
    if (!book) throw new Error(`Book ${bookId} not found`);

    const tags = db.prepare(`
      SELECT t.name FROM tags t
      JOIN book_tags bt ON t.id = bt.tag_id
      WHERE bt.book_id = ?
    `).all(bookId);

    const text = this.buildEmbeddingText(book, tags);
    const textHash = this.hashText(text);

    // Already embedded from the same text, by the same model and recipe
    if (!forceReembed) {
      const existing = db.prepare(
        'SELECT text_hash, model_name FROM book_embeddings WHERE book_id = ?'
      ).get(bookId);
      if (existing && existing.text_hash === textHash && existing.model_name === EMBEDDING_KEY) {
        return { success: true, message: 'Already embedded', skipped: true };
      }
    }

    const vector = await this.generateEmbedding(text);
    const buffer = this.vectorToBuffer(vector);

    db.prepare(`
      INSERT INTO book_embeddings (book_id, embedding, model_name, text_hash, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(book_id) DO UPDATE SET
        embedding = excluded.embedding,
        model_name = excluded.model_name,
        text_hash = excluded.text_hash,
        updated_at = datetime('now')
    `).run(bookId, buffer, EMBEDDING_KEY, textHash);

    return { success: true, message: 'Embedded', skipped: false };
  }

  /**
   * Embed all books that haven't been embedded yet
   */
  async embedAllBooks(options = {}) {
    const { forceReembed = false, onProgress = null } = options;

    let books;
    if (forceReembed) {
      books = db.prepare('SELECT id, title FROM books ORDER BY id').all();
    } else {
      books = this.pendingBooks();
    }

    const stats = { total: books.length, embedded: 0, skipped: 0, failed: 0 };

    // Ensure model is loaded before processing
    await this.loadModel();

    for (let i = 0; i < books.length; i++) {
      const book = books[i];
      try {
        const result = await this.embedBook(book.id, forceReembed);
        if (result.skipped) {
          stats.skipped++;
        } else {
          stats.embedded++;
        }
      } catch (error) {
        console.error(`Failed to embed book ${book.id} (${book.title}):`, error.message);
        stats.failed++;
      }

      if (onProgress) {
        onProgress({
          current: i + 1,
          total: books.length,
          bookTitle: book.title,
          stats
        });
      }
    }

    return stats;
  }

  /**
   * Books with no embedding, or one made by an older model or recipe. A book
   * still waiting for its tags is left for a day; after that it is embedded
   * without them (Ollama may be down), and checkAllBooks catches the tags
   * when they arrive.
   */
  pendingBooks(limit = -1) {
    const awaitTagsSince = new Date(Date.now() - AWAIT_TAGS_MS).toISOString();
    return db.prepare(`
      SELECT b.id, b.title FROM books b
      LEFT JOIN book_embeddings be ON b.id = be.book_id
      WHERE (be.book_id IS NULL OR be.model_name != ?)
        AND NOT (
          datetime(b.date_added) > datetime(?)
          AND NOT EXISTS (SELECT 1 FROM book_tags bt WHERE bt.book_id = b.id)
        )
      ORDER BY b.id
      LIMIT ?
    `).all(EMBEDDING_KEY, awaitTagsSince, limit);
  }

  countPending() {
    return this.pendingBooks().length;
  }

  /**
   * Re-embed every book whose text has changed since it was embedded: a title
   * repaired, tags added or edited, a description fetched. embedBook skips
   * the rest by hash, so this costs a few queries per book and a model call
   * only for the ones that changed. Yields between books so the server stays
   * responsive.
   */
  async checkAllBooks() {
    const ids = db.prepare(`
      SELECT book_id FROM book_embeddings WHERE model_name = ?
    `).all(EMBEDDING_KEY).map(r => r.book_id);

    let updated = 0;
    for (const id of ids) {
      try {
        const result = await this.embedBook(id);
        if (!result.skipped) updated++;
      } catch (error) {
        // The book was deleted mid-pass, most likely; nothing to re-embed.
      }
      await new Promise(resolve => setImmediate(resolve));
    }
    return { checked: ids.length, updated };
  }

  /**
   * Semantic search: find books similar to a query string
   */
  async semanticSearch(query, options = {}) {
    const { limit = 20, minSimilarity = 0.2 } = options;

    const queryVector = await this.generateEmbedding(query);

    const rows = db.prepare(`
      SELECT be.book_id, be.embedding,
             b.title, b.author, b.file_path, b.thumbnail_path,
             b.isbn, b.publisher, b.publication_year, b.language
      FROM book_embeddings be
      JOIN books b ON be.book_id = b.id
      WHERE be.model_name = ?
    `).all(EMBEDDING_KEY);

    const results = rows.map(row => {
      const bookVector = this.bufferToVector(row.embedding);
      const similarity = this.cosineSimilarity(queryVector, bookVector);
      return {
        id: row.book_id,
        title: row.title,
        author: row.author,
        file_path: row.file_path,
        thumbnail_path: row.thumbnail_path,
        isbn: row.isbn,
        publisher: row.publisher,
        publication_year: row.publication_year,
        language: row.language,
        similarity: Math.round(similarity * 1000) / 1000
      };
    });

    return results
      .filter(r => r.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * Find books similar to a given book
   */
  async findSimilarBooks(bookId, options = {}) {
    const { limit = 5, minSimilarity = 0.3 } = options;

    const source = db.prepare(
      'SELECT embedding FROM book_embeddings WHERE book_id = ? AND model_name = ?'
    ).get(bookId, EMBEDDING_KEY);

    if (!source) {
      return { results: [], message: 'Book not yet embedded' };
    }

    const sourceVector = this.bufferToVector(source.embedding);

    const rows = db.prepare(`
      SELECT be.book_id, be.embedding,
             b.title, b.author, b.thumbnail_path
      FROM book_embeddings be
      JOIN books b ON be.book_id = b.id
      WHERE be.book_id != ? AND be.model_name = ?
        -- Similar books for a book, similar magazines for a magazine.
        AND b.kind = (SELECT kind FROM books WHERE id = ?)
    `).all(bookId, EMBEDDING_KEY, bookId);

    const results = rows.map(row => {
      const bookVector = this.bufferToVector(row.embedding);
      const similarity = this.cosineSimilarity(sourceVector, bookVector);
      return {
        id: row.book_id,
        title: row.title,
        author: row.author,
        thumbnail_path: row.thumbnail_path,
        similarity: Math.round(similarity * 1000) / 1000
      };
    });

    return results
      .filter(r => r.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * Hybrid search: combine FTS5 keyword results with semantic results
   */
  async hybridSearch(query, options = {}) {
    const { limit = 20, ftsWeight = 0.4, semanticWeight = 0.6 } = options;

    // Get semantic results
    const semanticResults = await this.semanticSearch(query, { limit: 50, minSimilarity: 0.1 });

    // Get FTS5 results
    let ftsResults = [];
    try {
      const ftsRows = db.prepare(`
        SELECT b.id, b.title, b.author, b.file_path, b.thumbnail_path,
               b.isbn, b.publisher, b.publication_year, b.language,
               rank
        FROM books_fts f
        JOIN books b ON f.book_id = b.id
        WHERE books_fts MATCH ?
        ORDER BY rank
        LIMIT 50
      `).all(query);

      // Normalize FTS ranks (they're negative, lower = better)
      const maxRank = Math.abs(Math.min(...ftsRows.map(r => r.rank), -1));
      ftsResults = ftsRows.map(row => ({
        ...row,
        ftsScore: 1 - (Math.abs(row.rank) / maxRank) // normalize to 0-1
      }));
    } catch (e) {
      // FTS query might fail on special characters — that's OK, semantic will carry it
    }

    // Merge results
    const scoreMap = new Map();

    for (const r of semanticResults) {
      scoreMap.set(r.id, {
        ...r,
        semanticScore: r.similarity,
        ftsScore: 0,
        matchType: 'semantic'
      });
    }

    for (const r of ftsResults) {
      if (scoreMap.has(r.id)) {
        const existing = scoreMap.get(r.id);
        existing.ftsScore = r.ftsScore;
        existing.matchType = 'both';
      } else {
        scoreMap.set(r.id, {
          id: r.id,
          title: r.title,
          author: r.author,
          file_path: r.file_path,
          thumbnail_path: r.thumbnail_path,
          isbn: r.isbn,
          publisher: r.publisher,
          publication_year: r.publication_year,
          language: r.language,
          semanticScore: 0,
          ftsScore: r.ftsScore,
          matchType: 'keyword'
        });
      }
    }

    // Compute hybrid score and sort
    const results = Array.from(scoreMap.values()).map(r => ({
      ...r,
      score: (r.ftsScore * ftsWeight) + (r.semanticScore * semanticWeight)
    }));

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Get embedding stats
   */
  getStats() {
    const totalBooks = db.prepare('SELECT COUNT(*) as count FROM books').get().count;
    const embedded = db.prepare(
      'SELECT COUNT(*) as count FROM book_embeddings WHERE model_name = ?'
    ).get(EMBEDDING_KEY).count;

    return {
      totalBooks,
      embeddedBooks: embedded,
      coverage: totalBooks > 0 ? Math.round((embedded / totalBooks) * 100) : 0,
      modelName: MODEL_NAME,
      embeddingDimension: EMBEDDING_DIM,
      modelLoaded: !!this.pipeline
    };
  }
}

module.exports = new EmbeddingService();
module.exports.EMBEDDING_KEY = EMBEDDING_KEY;
