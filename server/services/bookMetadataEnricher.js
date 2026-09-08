const axios = require('axios');
const { db } = require('../database/init');
const quality = require('./metadataQuality');

class BookMetadataEnricher {
  constructor() {
    this.sources = {
      openLibrary: new OpenLibraryAPI(),
      googleBooks: new GoogleBooksAPI(),
    };
    this.cache = new MetadataCache();
  }

  async enrichBook(bookId, options = {}) {
    const book = this.getBookById(bookId);
    if (!book) {
      throw new Error(`Book with ID ${bookId} not found`);
    }

    console.log(`Enriching metadata for: ${book.title || book.file_path}`);

    // Check cache first
    const cachedMetadata = this.cache.get(book.isbn);
    if (cachedMetadata && !options.forceRefresh) {
      console.log('  Using cached metadata');
      return this.updateBookMetadata(bookId, cachedMetadata);
    }

    // Try each source in priority order
    const sources = options.source ? [this.sources[options.source]] : Object.values(this.sources);

    for (const source of sources) {
      try {
        console.log(`  Trying ${source.name}...`);

        let metadata = null;
        let matchedByISBN = false;

        // Try ISBN first (most accurate)
        if (book.isbn) {
          metadata = await source.fetchByISBN(book.isbn);
          matchedByISBN = Boolean(metadata);
        }

        // Fallback to title + author search
        if (!metadata && book.title && book.author) {
          metadata = await source.searchByTitleAuthor(book.title, book.author);
        }

        if (metadata) {
          metadata.matchedByISBN = matchedByISBN;
        }

        if (metadata && this.isValidMetadata(metadata)) {
          console.log(`  ✅ Found metadata from ${source.name}`);

          // Cache the result
          if (book.isbn) {
            this.cache.set(book.isbn, metadata);
          }

          // Update the book with new metadata
          return this.updateBookMetadata(bookId, metadata);
        }
      } catch (error) {
        console.error(`  ❌ Error with ${source.name}:`, error.message);
        continue;
      }
    }

    console.log('  No additional metadata found from external sources');
    return null;
  }

  async enrichMultipleBooks(bookIds, options = {}) {
    const results = {
      success: [],
      failed: [],
      total: bookIds.length
    };

    for (const bookId of bookIds) {
      try {
        const enriched = await this.enrichBook(bookId, options);
        if (enriched) {
          results.success.push({ bookId, data: enriched });
        } else {
          results.failed.push({ bookId, reason: 'No metadata found' });
        }

        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        results.failed.push({ bookId, reason: error.message });
      }
    }

    return results;
  }

  getBookById(bookId) {
    return db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
  }

  isValidMetadata(metadata) {
    // Check if metadata has useful information
    return metadata && (
      metadata.title ||
      metadata.authors ||
      metadata.description ||
      metadata.pageCount ||
      metadata.categories ||
      metadata.averageRating ||
      (metadata.isbn && metadata.isbn !== this.book?.isbn) ||
      (metadata.publisher && metadata.publisher !== this.book?.publisher)
    );
  }

  updateBookMetadata(bookId, metadata) {
    const book = this.getBookById(bookId);

    // Title and author are the two fields the extractor gets wrong most often,
    // so a trustworthy remote value replaces a local one that fails the quality
    // check. A good local value is never overwritten, and a title/author search
    // match is not trusted for this — only an ISBN match identifies the book.
    const trusted = Boolean(metadata.matchedByISBN);

    const remoteTitle = quality.cleanTitle(metadata.title);
    const useTitle =
      trusted && remoteTitle && quality.isPlausibleTitle(remoteTitle) &&
      !quality.isPlausibleTitle(book?.title)
        ? remoteTitle
        : null;

    const remoteAuthor = quality.cleanAuthor(metadata.authors, {
      title: remoteTitle || book?.title
    });
    const useAuthor =
      trusted && remoteAuthor &&
      !quality.isPlausibleAuthor(book?.author, { title: book?.title })
        ? remoteAuthor
        : null;

    const stmt = db.prepare(`
      UPDATE books
      SET
        title = COALESCE(?, title),
        author = COALESCE(?, author),
        description = CASE WHEN ? IS NOT NULL AND (description IS NULL OR description = '') THEN ? ELSE description END,
        publisher = CASE WHEN ? IS NOT NULL AND (publisher IS NULL OR publisher = '') THEN ? ELSE publisher END,
        publication_year = CASE WHEN ? IS NOT NULL AND publication_year IS NULL THEN ? ELSE publication_year END,
        page_count = CASE WHEN ? IS NOT NULL AND (page_count IS NULL OR page_count = 0) THEN ? ELSE page_count END,
        language = CASE WHEN ? IS NOT NULL AND (language IS NULL OR language = '') THEN ? ELSE language END,
        categories = CASE WHEN ? IS NOT NULL THEN ? ELSE categories END,
        average_rating = CASE WHEN ? IS NOT NULL THEN ? ELSE average_rating END,
        thumbnail_url = CASE WHEN ? IS NOT NULL THEN ? ELSE thumbnail_url END,
        metadata_source = ?,
        metadata_updated_at = datetime('now')
      WHERE id = ?
    `);

    const result = stmt.run(
      useTitle,
      useAuthor,
      metadata.description, metadata.description,
      metadata.publisher, metadata.publisher,
      metadata.publicationYear, metadata.publicationYear,
      metadata.pageCount, metadata.pageCount,
      metadata.language, metadata.language,
      metadata.categories ? JSON.stringify(metadata.categories) : null,
      metadata.categories ? JSON.stringify(metadata.categories) : null,
      metadata.averageRating, metadata.averageRating,
      metadata.thumbnailUrl, metadata.thumbnailUrl,
      metadata.source,
      bookId
    );

    if (result.changes > 0) {
      return this.getBookById(bookId);
    }

    return null;
  }
}

class OpenLibraryAPI {
  constructor() {
    this.name = 'Open Library';
    this.baseUrl = 'https://openlibrary.org';
  }

  async fetchByISBN(isbn) {
    try {
      // Clean ISBN
      const cleanISBN = isbn.replace(/[^0-9X]/gi, '');

      // Try the works API first for better descriptions
      const response = await axios.get(
        `${this.baseUrl}/api/books?bibkeys=ISBN:${cleanISBN}&format=json&jscmd=data`,
        { timeout: 10000 }
      );

      const key = `ISBN:${cleanISBN}`;
      const bookData = response.data[key];

      if (!bookData) {
        return null;
      }

      // Extract and format the metadata
      const metadata = {
        title: bookData.title,
        authors: bookData.authors ? bookData.authors.map(a => a.name).join(', ') : null,
        publisher: bookData.publishers ? bookData.publishers[0]?.name : null,
        publicationYear: bookData.publish_date ? this.extractYear(bookData.publish_date) : null,
        pageCount: bookData.number_of_pages,
        description: bookData.excerpts ? bookData.excerpts[0]?.text : null,
        isbn: cleanISBN,
        categories: bookData.subjects ? bookData.subjects.map(s => s.name).slice(0, 5) : null,
        thumbnailUrl: bookData.cover ? bookData.cover.large || bookData.cover.medium : null,
        source: 'Open Library',
      };

      // If no description in main data, try to fetch from works
      if (!metadata.description && bookData.works && bookData.works[0]) {
        const workKey = bookData.works[0].key;
        const workData = await this.fetchWork(workKey);
        if (workData && workData.description) {
          metadata.description = typeof workData.description === 'object'
            ? workData.description.value
            : workData.description;
        }
      }

      return metadata;
    } catch (error) {
      console.error('Open Library API error:', error.message);
      return null;
    }
  }

  async fetchWork(workKey) {
    try {
      const response = await axios.get(
        `${this.baseUrl}${workKey}.json`,
        { timeout: 5000 }
      );
      return response.data;
    } catch (error) {
      return null;
    }
  }

  async searchByTitleAuthor(title, author) {
    try {
      const query = `${title} ${author}`.replace(/\s+/g, '+');
      const response = await axios.get(
        `${this.baseUrl}/search.json?q=${query}&limit=1`,
        { timeout: 10000 }
      );

      if (!response.data.docs || response.data.docs.length === 0) {
        return null;
      }

      const book = response.data.docs[0];

      return {
        title: book.title,
        authors: book.author_name ? book.author_name.join(', ') : null,
        publisher: book.publisher ? book.publisher[0] : null,
        publicationYear: book.first_publish_year,
        pageCount: book.number_of_pages_median,
        isbn: book.isbn ? book.isbn[0] : null,
        categories: book.subject ? book.subject.slice(0, 5) : null,
        language: book.language ? book.language[0] : null,
        source: 'Open Library',
      };
    } catch (error) {
      console.error('Open Library search error:', error.message);
      return null;
    }
  }

  extractYear(dateString) {
    const match = dateString.match(/\d{4}/);
    return match ? parseInt(match[0]) : null;
  }
}

class GoogleBooksAPI {
  constructor() {
    this.name = 'Google Books';
    this.baseUrl = 'https://www.googleapis.com/books/v1';
    this.apiKey = process.env.GOOGLE_BOOKS_API_KEY || null;

    // Unauthenticated requests are rate limited per IP and, once the limit is
    // hit, every subsequent call returns 429. Retrying each book costs a round
    // trip and returns nothing, so stand down for the rest of the run after a
    // few refusals. Set GOOGLE_BOOKS_API_KEY to raise the limit.
    this.consecutive429s = 0;
    this.disabled = false;
  }

  noteFailure(error) {
    if (error.response?.status !== 429) return;

    this.consecutive429s++;
    if (this.consecutive429s >= 3 && !this.disabled) {
      this.disabled = true;
      console.warn(
        '  ⚠️  Google Books is rate limiting this address; skipping it for the ' +
        'rest of this run. Set GOOGLE_BOOKS_API_KEY to raise the quota.'
      );
    }
  }

  async fetchByISBN(isbn) {
    if (this.disabled) return null;

    try {
      const cleanISBN = isbn.replace(/[^0-9X]/gi, '');

      let url = `${this.baseUrl}/volumes?q=isbn:${cleanISBN}`;
      if (this.apiKey) {
        url += `&key=${this.apiKey}`;
      }

      const response = await axios.get(url, { timeout: 10000 });

      if (!response.data.items || response.data.items.length === 0) {
        return null;
      }

      const book = response.data.items[0].volumeInfo;
      this.consecutive429s = 0;

      return {
        title: book.subtitle ? `${book.title}: ${book.subtitle}` : book.title,
        authors: book.authors ? book.authors.join(', ') : null,
        publisher: book.publisher,
        publicationYear: book.publishedDate ? this.extractYear(book.publishedDate) : null,
        pageCount: book.pageCount,
        description: book.description,
        isbn: cleanISBN,
        categories: book.categories,
        language: book.language,
        averageRating: book.averageRating,
        thumbnailUrl: book.imageLinks ? book.imageLinks.thumbnail : null,
        source: 'Google Books',
      };
    } catch (error) {
      this.noteFailure(error);
      if (!this.disabled) console.error('Google Books API error:', error.message);
      return null;
    }
  }

  async searchByTitleAuthor(title, author) {
    if (this.disabled) return null;

    try {
      const query = `intitle:${title}+inauthor:${author}`.replace(/\s+/g, '+');

      let url = `${this.baseUrl}/volumes?q=${query}&maxResults=1`;
      if (this.apiKey) {
        url += `&key=${this.apiKey}`;
      }

      const response = await axios.get(url, { timeout: 10000 });

      if (!response.data.items || response.data.items.length === 0) {
        return null;
      }

      const book = response.data.items[0].volumeInfo;
      const identifiers = book.industryIdentifiers || [];
      const isbn13 = identifiers.find(id => id.type === 'ISBN_13');
      const isbn10 = identifiers.find(id => id.type === 'ISBN_10');

      return {
        title: book.title,
        authors: book.authors ? book.authors.join(', ') : null,
        publisher: book.publisher,
        publicationYear: book.publishedDate ? this.extractYear(book.publishedDate) : null,
        pageCount: book.pageCount,
        description: book.description,
        isbn: isbn13?.identifier || isbn10?.identifier || null,
        categories: book.categories,
        language: book.language,
        averageRating: book.averageRating,
        thumbnailUrl: book.imageLinks ? book.imageLinks.thumbnail : null,
        source: 'Google Books',
      };
    } catch (error) {
      console.error('Google Books search error:', error.message);
      return null;
    }
  }

  extractYear(dateString) {
    const match = dateString.match(/\d{4}/);
    return match ? parseInt(match[0]) : null;
  }
}

class MetadataCache {
  constructor() {
    this.cache = new Map();
    this.maxAge = 24 * 60 * 60 * 1000; // 24 hours
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() - item.timestamp > this.maxAge) {
      this.cache.delete(key);
      return null;
    }

    return item.data;
  }

  set(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  clear() {
    this.cache.clear();
  }
}

module.exports = new BookMetadataEnricher();