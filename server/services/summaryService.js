const { db } = require('../database/init');
const crypto = require('crypto');

const DEFAULT_MODEL = process.env.SUMMARY_MODEL || 'claude-haiku-4-5-20251001';
const MAX_TOKENS_PER_REQUEST = 180000;
const CHUNK_SIZE = 40000; // tokens per chunk for map-reduce

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

  async getClient() {
    if (this.client) return this.client;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    this.client = new Anthropic({ apiKey });
    return this.client;
  }

  isAvailable() {
    return !!process.env.ANTHROPIC_API_KEY;
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
    // Try page-level content first (better for sampling)
    const pages = db.prepare(
      'SELECT page_number, content FROM book_pages WHERE book_id = ? ORDER BY page_number'
    ).all(bookId);

    if (pages.length > 0) {
      const text = pages.map(p => p.content).join('\n\n');
      return { text, pageCount: pages.length, source: 'pages', pages };
    }

    // Fall back to FTS content
    const fts = db.prepare(
      'SELECT content FROM books_fts WHERE book_id = ?'
    ).get(bookId);

    if (fts?.content) {
      return { text: fts.content, pageCount: null, source: 'fts', pages: null };
    }

    // Fall back to book's own content field
    const book = db.prepare('SELECT content, ocr_text FROM books WHERE id = ?').get(bookId);
    const text = book?.content || book?.ocr_text || '';
    return { text, pageCount: null, source: 'book', pages: null };
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
    const client = await this.getClient();
    const prompt = this.buildPrompt(book, 'single-pass');

    const response = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 1500,
      messages: [
        { role: 'user', content: `${prompt}\n\n--- BOOK CONTENT ---\n${text}` }
      ]
    });

    return this.parseResponse(response);
  }

  /**
   * Map-reduce summarization for longer books
   */
  async summarizeMapReduce(chunks, book) {
    const client = await this.getClient();

    // Map: summarize each chunk
    const chunkSummaries = [];
    for (let i = 0; i < chunks.length; i++) {
      console.log(`  Summarizing chunk ${i + 1}/${chunks.length}...`);
      const response = await client.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 800,
        messages: [
          {
            role: 'user',
            content: `Summarize this section (part ${i + 1} of ${chunks.length}) of "${book.title || 'a book'}" in 2-3 paragraphs. Focus on key points and themes.\n\n${chunks[i]}`
          }
        ]
      });
      chunkSummaries.push(response.content[0].text);
    }

    // Reduce: synthesize chunk summaries into final summary
    const prompt = this.buildPrompt(book, 'map-reduce');
    const combined = chunkSummaries.map((s, i) => `[Part ${i + 1}]\n${s}`).join('\n\n');

    const response = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: `${prompt}\n\nHere are summaries of each section of the book:\n\n${combined}`
        }
      ]
    });

    return this.parseResponse(response);
  }

  /**
   * Parse Claude's JSON response
   */
  parseResponse(response) {
    const text = response.content[0].text;
    try {
      // Try to extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*"summary"[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      // JSON parse failed
    }
    // Fallback: use the whole response as the summary
    return { summary: text, summary_short: text.slice(0, 200) };
  }

  /**
   * Extractive fallback when no API key is available
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
      throw new Error('Insufficient text content for summary generation');
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

    if (this.isAvailable() && this.checkRateLimit()) {
      // AI-powered summary
      console.log(`🤖 Generating AI summary for: ${book.title} (~${tokenEstimate} tokens)`);

      if (tokenEstimate < 50000) {
        strategy = 'single-pass';
        result = await this.summarizeSinglePass(text, book);
      } else if (tokenEstimate < MAX_TOKENS_PER_REQUEST) {
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
    } else {
      // Extractive fallback
      console.log(`📝 Generating extractive summary for: ${book.title} (no API key)`);
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
      apiAvailable: this.isAvailable(),
      model: DEFAULT_MODEL
    };
  }
}

module.exports = new SummaryService();
