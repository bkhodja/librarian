const pdf = require('pdf-parse');
const fs = require('fs').promises;
const quality = require('./metadataQuality');

/**
 * Enhanced PDF content extractor that analyzes text content
 * to extract bibliographic metadata
 */
class PDFContentExtractor {
  constructor() {
    // ISBN patterns - supports ISBN-10 and ISBN-13 with various formats
    this.isbnPatterns = [
      /ISBN[:\s-]*(?:97[89][-\s]?)?\d{1,5}[-\s]?\d{1,7}[-\s]?\d{1,7}[-\s]?\d{1}/gi,
      /ISBN[:\s-]*([0-9X]{10,13})/gi,
      /(?:ISBN|isbn)[\s:]*([0-9\-X]{10,})/gi,
      /\b97[89]\d{10}\b/g,  // Raw ISBN-13
      /\b\d{9}[0-9X]\b/g     // Raw ISBN-10
    ];

    // Publisher patterns
    this.publisherPatterns = [
      /(?:Published by|Publisher[:\s]+|Издательство[:\s]+|Издатель[:\s]+|Publishing House[:\s]+)([^,\n]+)/gi,
      /(?:©|Copyright[^,]*,?)\s*(\d{4})?\s*(?:by\s+)?([A-Z][^,\n]{3,50}(?:Press|Publishing|Publishers|Books|Inc|Ltd|LLC|Company|Co\.|Corporation|House|Group|Media|International))/gi,
      /([A-Z][^,\n]{3,50}(?:Press|Publishing|Publishers|Books|Inc|Ltd|LLC|Company|Co\.|Corporation|House|Group|Media|International))(?:[,\s]+(?:New York|London|Boston|Chicago|San Francisco|Berlin|Moscow|Paris|Tokyo))/gi,
      // Russian publishers
      /(?:Москва|Санкт-Петербург|СПб)[:\s,]*([А-ЯЁ][^,\n]{3,50})/gi
    ];

    // Year patterns
    this.yearPatterns = [
      /(?:©|Copyright)\s*(\d{4})/gi,
      /(?:First published|Published|Publication Date)[:\s]+.*?(\d{4})/gi,
      /(?:Printed in|Published in)[^,]*,?\s*(\d{4})/gi,
      /(?:Edition|ed\.|издание)[^,]*,?\s*(\d{4})/gi,
      // Look for standalone years in copyright page context
      /\b(19[0-9]{2}|20[0-2][0-9])\b/g
    ];

    // Author patterns - enhanced to find author names in various contexts
    this.authorPatterns = [
      /(?:by|By|BY)\s+([A-Z][a-z]+(?:\s+[A-Z]\.?)?(?:\s+[A-Z][a-z]+)+)/g,
      /(?:Author[s]?[:\s]+)([^,\n]+)/gi,
      /^([A-Z][a-z]+(?:\s+[A-Z]\.?)?(?:\s+[A-Z][a-z]+)+)$/gm, // Names on their own line
      // Cyrillic author names
      /(?:Автор[ы]?[:\s]+|автор[ы]?[:\s]+)([^,\n]+)/gi,
      /^([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ]\.?)?(?:\s+[А-ЯЁ][а-яё]+)+)$/gm
    ];

    // Edition patterns
    this.editionPatterns = [
      /(\d+)(?:st|nd|rd|th)\s+[Ee]dition/g,
      /(?:Edition|edition)[:\s]+(\d+|[A-Za-z]+)/gi,
      /(\d+)[-–]\s*(?:е|я)\s+(?:издание|изд\.)/gi,
      /(?:Revised|Updated|Expanded|International|Global)\s+Edition/gi
    ];

    // Known publisher names for validation
    this.knownPublishers = new Set([
      'O\'Reilly', 'O\'Reilly Media', 'Packt', 'Packt Publishing', 'Manning',
      'Addison-Wesley', 'Pearson', 'McGraw-Hill', 'Wiley', 'Springer',
      'Cambridge University Press', 'Oxford University Press', 'MIT Press',
      'No Starch Press', 'Pragmatic Bookshelf', 'Apress', 'Academic Press',
      'Prentice Hall', 'Sams', 'Wrox', 'Microsoft Press', 'Adobe Press',
      'Питер', 'ЭКСМО', 'АСТ', 'Диалектика', 'БХВ-Петербург', 'ДМК Пресс'
    ]);
  }

  /**
   * Extract metadata from PDF text content
   */
  async extractFromContent(filePath) {
    try {
      const dataBuffer = await fs.readFile(filePath);
      const data = await pdf(dataBuffer);

      if (!data.text || data.text.length < 100) {
        console.log('PDF has insufficient text content for extraction');
        return null;
      }

      // Focus on first ~5000 and last ~2000 characters where metadata is usually found
      const firstPages = data.text.substring(0, 5000);
      const lastPages = data.text.substring(Math.max(0, data.text.length - 2000));
      const searchText = firstPages + '\n' + lastPages;

      // The filename is usually the best title available at this point, and
      // knowing it lets the author check reject series and product names that
      // merely repeat the title.
      const authorContext = { title: quality.titleFromFilename(filePath) };

      // Extract all metadata
      const metadata = {
        isbn: this.extractISBN(searchText) || this.extractISBN(data.text),
        publisher: this.extractPublisher(searchText) || this.extractPublisher(data.text),
        publicationYear: this.extractYear(searchText) || this.extractYear(data.text),
        authors: this.extractAuthors(firstPages, authorContext) ||
                 this.extractAuthors(data.text.substring(0, 10000), authorContext),
        edition: this.extractEdition(searchText),
        description: this.extractDescription(firstPages),
        // Also keep the full text for language detection
        fullText: data.text.substring(0, 10000)
      };

      // Clean up and validate
      return this.validateAndClean(metadata);
    } catch (error) {
      console.error('Error extracting content from PDF:', error);
      return null;
    }
  }

  /**
   * Extract ISBN from text
   */
  extractISBN(text) {
    for (const pattern of this.isbnPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        // Clean up the ISBN
        let isbn = matches[0].replace(/[^0-9X]/gi, '');

        // Validate ISBN length (10 or 13 digits)
        if (isbn.length === 10 || isbn.length === 13) {
          // Additional validation for ISBN-13 prefix
          if (isbn.length === 13 && !isbn.startsWith('978') && !isbn.startsWith('979')) {
            continue;
          }
          return isbn;
        }
      }
    }
    return null;
  }

  /**
   * Extract publisher from text
   */
  extractPublisher(text) {
    // First, check against known publishers
    for (const publisher of this.knownPublishers) {
      const regex = new RegExp(`\\b${publisher.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(text)) {
        return publisher;
      }
    }

    // Then try patterns
    for (const pattern of this.publisherPatterns) {
      const matches = [...text.matchAll(pattern)];
      if (matches.length > 0) {
        // Get the last captured group (usually the publisher name)
        for (const match of matches) {
          const publisherName = match[match.length - 1];
          if (publisherName && publisherName.length > 3 && publisherName.length < 100) {
            // Clean up
            const cleaned = publisherName
              .trim()
              .replace(/[,.]$/, '')
              .replace(/^\W+|\W+$/g, '');

            // Skip if it looks like a year or number
            if (!/^\d+$/.test(cleaned) && cleaned.length > 3) {
              return cleaned;
            }
          }
        }
      }
    }
    return null;
  }

  /**
   * Extract publication year from text
   */
  extractYear(text) {
    const currentYear = new Date().getFullYear();
    const years = new Set();

    for (const pattern of this.yearPatterns) {
      const matches = [...text.matchAll(pattern)];
      for (const match of matches) {
        const year = parseInt(match[1]);
        if (year >= 1900 && year <= currentYear) {
          years.add(year);
        }
      }
    }

    // Return the most recent reasonable year
    if (years.size > 0) {
      const yearsArray = Array.from(years).sort((a, b) => b - a);
      // Prefer years that are not too recent (might be reprint dates)
      for (const year of yearsArray) {
        if (year <= currentYear && year >= 1950) {
          return year;
        }
      }
      return yearsArray[0];
    }

    return null;
  }

  /**
   * Extract authors from text
   */
  extractAuthors(text, context = {}) {
    const authors = [];

    // Look for author patterns
    for (const pattern of this.authorPatterns) {
      const matches = [...text.matchAll(pattern)];
      for (const match of matches) {
        const candidate = match[1];
        if (!candidate) continue;

        const cleaned = candidate
          .trim()
          .replace(/[,.]$/, '')
          .replace(/^\W+|\W+$/g, '');

        // The patterns match any line of capitalised words, which on a
        // copyright page means publisher names, colophon cities and legal
        // boilerplate as often as people. Let the quality check decide.
        const validated = quality.cleanAuthor(cleaned, context);
        if (validated && !authors.includes(validated)) {
          authors.push(validated);
        }
      }
    }

    // Return as comma-separated string
    return authors.length > 0 ? authors.slice(0, 3).join(', ') : null;
  }

  /**
   * Extract edition information
   */
  extractEdition(text) {
    for (const pattern of this.editionPatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[0].trim();
      }
    }
    return null;
  }

  /**
   * Extract book description (usually from back cover or introduction)
   */
  extractDescription(text) {
    // Look for common description indicators
    const descPatterns = [
      /(?:About this book|Book Description|Description|Summary)[:\s]+([^]{100,500})/i,
      /(?:From the Publisher|Back Cover)[:\s]+([^]{100,500})/i,
      /^([A-Z][^.!?]{100,500}[.!?])/m  // First substantial paragraph
    ];

    for (const pattern of descPatterns) {
      const match = text.match(pattern);
      if (match) {
        const desc = match[1].trim()
          .replace(/\s+/g, ' ')  // Normalize whitespace
          .substring(0, 500);    // Limit length

        if (desc.length > 50) {
          return desc;
        }
      }
    }
    return null;
  }

  /**
   * Validate and clean extracted metadata
   */
  validateAndClean(metadata) {
    const cleaned = {};

    if (metadata.isbn) {
      cleaned.isbn = metadata.isbn;
    }

    if (metadata.publisher && metadata.publisher.length > 2) {
      cleaned.publisher = metadata.publisher.substring(0, 100);
    }

    if (metadata.publicationYear && metadata.publicationYear >= 1900) {
      cleaned.publicationYear = metadata.publicationYear;
    }

    if (metadata.authors && metadata.authors.length > 3) {
      cleaned.authors = metadata.authors.substring(0, 200);
    }

    if (metadata.edition) {
      cleaned.edition = metadata.edition.substring(0, 50);
    }

    if (metadata.description && metadata.description.length > 20) {
      cleaned.description = metadata.description;
    }

    cleaned.fullText = metadata.fullText;

    return Object.keys(cleaned).length > 1 ? cleaned : null;
  }
}

module.exports = new PDFContentExtractor();