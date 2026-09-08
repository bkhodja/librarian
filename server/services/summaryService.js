const { db } = require('../database/init');
const ollama = require('./ollamaClient');
const crypto = require('crypto');

const DEFAULT_MODEL = process.env.SUMMARY_MODEL || process.env.OLLAMA_MODEL || 'gemma3:4b';
// Sized for a local model: a laptop can hold a far larger context than it can
// process quickly, and quality falls off long before the window does.
const MAX_TOKENS_PER_REQUEST = Number(process.env.SUMMARY_MAX_TOKENS) || 8000;
const CHUNK_SIZE = Number(process.env.SUMMARY_CHUNK_TOKENS) || 6000; // per map-reduce chunk

// How many request-budgets of text map-reduce will work through before the
// book is sampled instead. Each multiple is another pass over the model, so
// this trades minutes against coverage.
const MAP_REDUCE_LIMIT = Number(process.env.SUMMARY_MAP_REDUCE_LIMIT) || 6;

// Ollama constrains decoding to this shape, so the reply parses without the
// regex-hunt for a JSON object that the hosted call needed.
const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    summary_short: { type: 'string' }
  },
  required: ['summary', 'summary_short']
};


class SummaryService {
  constructor() {
    this.client = null;
    this.rateLimiter = { requests: [], hourRequests: [] };
    this.initializeTable();
  }

  initializeTable() {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS book_summaries (
          book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
          summary TEXT NOT NULL,
          summary_short TEXT,
          model_name TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          token_count INTEGER,
          strategy TEXT,
          status TEXT DEFAULT 'completed' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
          error_message TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('✅ Book summaries table initialized');
    } catch (error) {
      console.error('Error initializing book_summaries table:', error);
    }
  }

  /** The local model server. Nothing here needs an API key. */
  async getClient() {
    return ollama;
  }


  async isAvailable() {
    return ollama.isAvailable();
  }

  estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }

  hashContent(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  /**
   * Check rate limits. Returns true if request is allowed.
   */
  checkRateLimit() {
    const now = Date.now();
    const perMinute = parseInt(process.env.SUMMARY_RATE_LIMIT_PER_MINUTE) || 10;
    const perHour = parseInt(process.env.SUMMARY_RATE_LIMIT_PER_HOUR) || 100;

    // Clean old entries
    this.rateLimiter.requests = this.rateLimiter.requests.filter(t => now - t < 60000);
    this.rateLimiter.hourRequests = this.rateLimiter.hourRequests.filter(t => now - t < 3600000);

    if (this.rateLimiter.requests.length >= perMinute) return false;
    if (this.rateLimiter.hourRequests.length >= perHour) return false;

    this.rateLimiter.requests.push(now);
    this.rateLimiter.hourRequests.push(now);
    return true;
  }

  /**
   * Get book text content from database
   */
  getBookText(bookId) {
    // Ids arrive from the URL as strings. book_pages.book_id has integer
    // affinity so a string coerces, but books_fts.book_id is an FTS5
    // UNINDEXED column with none, where '351' matches nothing.
    const id = Number(bookId);

    // Try page-level content first (better for sampling)
    const pages = db.prepare(
      'SELECT page_number, content FROM book_pages WHERE book_id = ? ORDER BY page_number'
    ).all(id);

    if (pages.length > 0) {
      const text = pages.map(p => p.content).join('\n\n');
      return { text, pageCount: pages.length, source: 'pages', pages };
    }

    // Fall back to FTS content
    const fts = db.prepare(
      'SELECT content FROM books_fts WHERE book_id = ?'
    ).get(id);

    if (fts?.content) {
      return { text: fts.content, pageCount: null, source: 'fts', pages: null };
    }

    // Last resort, OCR output. There is no `content` column on books — the
    // extracted text lives in book_pages — and asking for one made this
    // fallback throw "no such column: content" instead of returning nothing,
    // so every book without indexed pages failed with a 500.
    const book = db.prepare('SELECT ocr_text FROM books WHERE id = ?').get(id);
    return { text: book?.ocr_text || '', pageCount: null, source: 'ocr', pages: null };
  }

  /**
   * Split text into chunks at paragraph boundaries
   */
  chunkText(text, maxTokens = CHUNK_SIZE) {
    const maxChars = maxTokens * 4;
    if (text.length <= maxChars) return [text];

    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxChars) {
        chunks.push(remaining);
        break;
      }

      // Find a paragraph break near the limit
      let splitPoint = remaining.lastIndexOf('\n\n', maxChars);
      if (splitPoint < maxChars * 0.5) {
        // No good paragraph break, try single newline
        splitPoint = remaining.lastIndexOf('\n', maxChars);
      }
      if (splitPoint < maxChars * 0.5) {
        // No good break at all, split at limit
        splitPoint = maxChars;
      }

      chunks.push(remaining.slice(0, splitPoint));
      remaining = remaining.slice(splitPoint).trimStart();
    }

    return chunks;
  }

  /**
   * Sample representative pages for very long books
   */
  samplePages(pages, targetTokens = MAX_TOKENS_PER_REQUEST) {
    const totalPages = pages.length;
    if (totalPages === 0) return '';

    // Take first 10%, middle 10%, last 10%
    const sampleSize = Math.max(3, Math.floor(totalPages * 0.1));
    const firstPages = pages.slice(0, sampleSize);
    const midStart = Math.floor(totalPages / 2) - Math.floor(sampleSize / 2);
    const middlePages = pages.slice(midStart, midStart + sampleSize);
    const lastPages = pages.slice(-sampleSize);

    const sampled = [
      '--- BEGINNING OF BOOK ---',
      ...firstPages.map(p => p.content),
      '--- MIDDLE OF BOOK ---',
      ...middlePages.map(p => p.content),
      '--- END OF BOOK ---',
      ...lastPages.map(p => p.content)
    ].join('\n\n');

    // Trim if still too long
    const maxChars = targetTokens * 4;
    return sampled.length > maxChars ? sampled.slice(0, maxChars) : sampled;
  }

  /**
   * Build the prompt for summary generation
   */
  buildPrompt(book, strategy) {
    const lang = book.language || 'the same language as the content';
    return `You are summarizing a book for a personal library catalog.

Book: "${book.title || 'Unknown'}" by ${book.author || 'Unknown Author'}
Language: ${lang}
${book.publication_year ? `Year: ${book.publication_year}` : ''}
${book.publisher ? `Publisher: ${book.publisher}` : ''}
${strategy !== 'single-pass' ? `Note: This is a ${strategy} summary — the text may be partial or chunked.` : ''}

Provide:
1. A comprehensive summary (3-5 paragraphs) covering the main themes, arguments, and key points.
2. A short summary (1-2 sentences) suitable for a catalog card.

Respond in ${lang}. Format your response as JSON:
{"summary": "...", "summary_short": "..."}`;
  }

  /**
   * Single-pass summarization for shorter books
   */
  async summarizeSinglePass(text, book) {
    const prompt = this.buildPrompt(book, 'single-pass');

    const result = await ollama.generateJSON(
      `${prompt}\n\n--- BOOK CONTENT ---\n${text}`,
      SUMMARY_SCHEMA,
      { model: DEFAULT_MODEL, maxTokens: 1200, temperature: 0.3 }
    );

    return this.normalizeResult(result);
  }

  /**
   * Map-reduce summarization for longer books
   */
  async summarizeMapReduce(chunks, book) {
    // Map: summarize each chunk
    const chunkSummaries = [];
    for (let i = 0; i < chunks.length; i++) {
      console.log(`  Summarizing chunk ${i + 1}/${chunks.length}...`);

      const part = await ollama.generateText(
        `Summarize this section (part ${i + 1} of ${chunks.length}) of "${book.title || 'a book'}" ` +
        `in 2-3 paragraphs. Focus on key points and themes.\n\n${chunks[i]}`,
        { model: DEFAULT_MODEL, maxTokens: 600, temperature: 0.3 }
      );

      if (part) chunkSummaries.push(part);
    }

    if (chunkSummaries.length === 0) return null;

    // Reduce: synthesize chunk summaries into final summary
    const prompt = this.buildPrompt(book, 'map-reduce');
    const combined = chunkSummaries.map((text, i) => `[Part ${i + 1}]\n${text}`).join('\n\n');

    const result = await ollama.generateJSON(
      `${prompt}\n\nHere are summaries of each section of the book:\n\n${combined}`,
      SUMMARY_SCHEMA,
      { model: DEFAULT_MODEL, maxTokens: 1200, temperature: 0.3 }
    );

    return this.normalizeResult(result);
  }

  /**
   * The schema guarantees the shape, but the model can still return an empty
   * string, and generateJSON returns null when Ollama is unreachable.
   */
  normalizeResult(result) {
    if (!result || typeof result.summary !== 'string' || !result.summary.trim()) {
      return null;
    }

    const summary = result.summary.trim();
    const short = typeof result.summary_short === 'string' && result.summary_short.trim()
      ? result.summary_short.trim()
      : summary.slice(0, 200);

    return { summary, summary_short: short };
  }

  /**
   * Extractive fallback for when the local model is unavailable
   */
  extractiveFallback(text, book) {
    const words = text.split(/\s+/);
    const firstPart = words.slice(0, 500).join(' ');
    const lastPart = words.length > 700 ? words.slice(-200).join(' ') : '';

    const summary = lastPart
      ? `**Opening:**\n${firstPart}\n\n**Conclusion:**\n${lastPart}`
      : firstPart;

    const summary_short = `${(book.title || 'This book').slice(0, 80)} — ${words.length.toLocaleString()} words extracted from content.`;

    return { summary, summary_short };
  }

  /**
   * Main entry point: generate summary for a book
   */
  async generateSummary(bookId, options = {}) {
    const { force = false } = options;

    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
    if (!book) throw new Error(`Book ${bookId} not found`);

    const { text, pages } = this.getBookText(bookId);
    if (!text || text.trim().length < 100) {
      const error = new Error(
        'This book has no extracted text yet, so there is nothing to summarise. ' +
        'Text is extracted when a book is indexed for page-level search.'
      );
      error.code = 'NO_TEXT';
      throw error;
    }

    const contentHash = this.hashContent(text);

    // Check cache
    if (!force) {
      const existing = db.prepare(
        'SELECT * FROM book_summaries WHERE book_id = ? AND content_hash = ?'
      ).get(bookId, contentHash);
      if (existing) {
        return {
          summary: existing.summary,
          summary_short: existing.summary_short,
          strategy: existing.strategy,
          model: existing.model_name,
          cached: true
        };
      }
    }

    const tokenEstimate = this.estimateTokens(text);
    let result;
    let strategy;
    let modelName;

    if ((await this.isAvailable()) && this.checkRateLimit()) {
      // AI-powered summary
      console.log(`🤖 Generating AI summary for: ${book.title} (~${tokenEstimate} tokens)`);

      /*
       * Thresholds derive from the request budget rather than being fixed.
       * They were written for a 200K hosted window — anything under 50,000
       * tokens went in a single pass — and when the budget dropped to 8,000
       * for a local model the numbers were not brought with it. That sent
       * books of up to 50,000 tokens whole to a model sized for 8,000, and
       * made the map-reduce branch unreachable, since its 8,000-token
       * condition sat behind one that had already matched at 50,000.
       */
      if (tokenEstimate <= MAX_TOKENS_PER_REQUEST) {
        strategy = 'single-pass';
        result = await this.summarizeSinglePass(text, book);
      } else if (tokenEstimate <= MAX_TOKENS_PER_REQUEST * MAP_REDUCE_LIMIT) {
        strategy = 'map-reduce';
        const chunks = this.chunkText(text);
        result = await this.summarizeMapReduce(chunks, book);
      } else {
        strategy = 'sampled';
        const sampledText = pages
          ? this.samplePages(pages)
          : text.slice(0, MAX_TOKENS_PER_REQUEST * 4);
        result = await this.summarizeSinglePass(sampledText, book);
      }
      modelName = DEFAULT_MODEL;

      // The model server can go away between the availability check and the
      // call itself. An empty result is not a summary.
      if (!result) {
        console.log(`📝 Local model returned nothing; falling back to an excerpt for: ${book.title}`);
        strategy = 'extractive';
        result = this.extractiveFallback(text, book);
        modelName = 'extractive-local';
      }
    } else {
      // Extractive fallback
      console.log(`📝 Generating extractive summary for: ${book.title} (local model unavailable)`);
      strategy = 'extractive';
      result = this.extractiveFallback(text, book);
      modelName = 'extractive-local';
    }

    // Store in database
    db.prepare(`
      INSERT INTO book_summaries (book_id, summary, summary_short, model_name, content_hash, token_count, strategy, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', datetime('now'))
      ON CONFLICT(book_id) DO UPDATE SET
        summary = excluded.summary,
        summary_short = excluded.summary_short,
        model_name = excluded.model_name,
        content_hash = excluded.content_hash,
        token_count = excluded.token_count,
        strategy = excluded.strategy,
        status = 'completed',
        error_message = NULL,
        updated_at = datetime('now')
    `).run(bookId, result.summary, result.summary_short, modelName, contentHash, tokenEstimate, strategy);

    return {
      summary: result.summary,
      summary_short: result.summary_short,
      strategy,
      model: modelName,
      cached: false
    };
  }

  /**
   * Get cached summary for a book
   */
  getSummary(bookId) {
    return db.prepare('SELECT * FROM book_summaries WHERE book_id = ?').get(bookId);
  }

  /**
   * Delete cached summary
   */
  deleteSummary(bookId) {
    return db.prepare('DELETE FROM book_summaries WHERE book_id = ?').run(bookId);
  }

  /**
   * Get summary stats
   */
  getStats() {
    const totalBooks = db.prepare('SELECT COUNT(*) as count FROM books').get().count;
    const summarized = db.prepare('SELECT COUNT(*) as count FROM book_summaries').get().count;
    const byStrategy = db.prepare(
      'SELECT strategy, COUNT(*) as count FROM book_summaries GROUP BY strategy'
    ).all();
    const totalTokens = db.prepare(
      'SELECT COALESCE(SUM(token_count), 0) as total FROM book_summaries'
    ).get().total;

    return {
      totalBooks,
      summarizedBooks: summarized,
      coverage: totalBooks > 0 ? Math.round((summarized / totalBooks) * 100) : 0,
      byStrategy,
      totalTokensProcessed: totalTokens,
      model: DEFAULT_MODEL
    };
  }
}

module.exports = new SummaryService();
