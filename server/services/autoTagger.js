const db = require('../database/init');

class AutoTagger {
  constructor() {
    // Common programming/technical keywords for auto-tagging
    this.technicalKeywords = {
      'programming': ['code', 'coding', 'programming', 'developer', 'software', 'algorithm', 'function', 'variable', 'syntax'],
      'javascript': ['javascript', 'js', 'node', 'nodejs', 'react', 'vue', 'angular', 'typescript', 'npm', 'webpack'],
      'python': ['python', 'django', 'flask', 'pandas', 'numpy', 'jupyter', 'pip', 'scikit', 'tensorflow', 'pytorch'],
      'web': ['html', 'css', 'web', 'website', 'frontend', 'backend', 'api', 'rest', 'graphql', 'http'],
      'database': ['database', 'sql', 'mysql', 'postgresql', 'mongodb', 'redis', 'nosql', 'query', 'schema'],
      'devops': ['docker', 'kubernetes', 'ci/cd', 'jenkins', 'aws', 'azure', 'cloud', 'deployment', 'container'],
      'mobile': ['ios', 'android', 'mobile', 'swift', 'kotlin', 'react native', 'flutter', 'app development'],
      'ai': ['artificial intelligence', 'machine learning', 'deep learning', 'neural network', 'ai', 'ml', 'nlp', 'computer vision'],
      'security': ['security', 'encryption', 'authentication', 'vulnerability', 'penetration', 'firewall', 'ssl', 'https'],
      'design': ['ui', 'ux', 'design', 'user interface', 'user experience', 'wireframe', 'prototype', 'figma', 'sketch']
    };

    // Academic/genre categories
    this.genreKeywords = {
      'science': ['physics', 'chemistry', 'biology', 'science', 'scientific', 'research', 'experiment', 'theory', 'hypothesis'],
      'mathematics': ['mathematics', 'math', 'calculus', 'algebra', 'geometry', 'statistics', 'probability', 'equation'],
      'history': ['history', 'historical', 'war', 'civilization', 'ancient', 'medieval', 'modern history', 'revolution'],
      'philosophy': ['philosophy', 'philosophical', 'ethics', 'logic', 'metaphysics', 'epistemology', 'existential'],
      'business': ['business', 'management', 'marketing', 'finance', 'economics', 'startup', 'entrepreneur', 'strategy'],
      'psychology': ['psychology', 'psychological', 'behavior', 'cognitive', 'mental', 'therapy', 'counseling', 'personality'],
      'fiction': ['novel', 'fiction', 'story', 'character', 'plot', 'narrative', 'protagonist', 'chapter'],
      'tutorial': ['tutorial', 'guide', 'how to', 'step by step', 'learn', 'beginner', 'advanced', 'course', 'lesson'],
      'reference': ['reference', 'manual', 'documentation', 'handbook', 'guide', 'dictionary', 'encyclopedia']
    };

    // Language-specific tags
    this.languageTags = {
      'ru': 'Russian',
      'rus': 'Russian',
      'en': 'English',
      'eng': 'English',
      'de': 'German',
      'deu': 'German',
      'fr': 'French',
      'fra': 'French',
      'es': 'Spanish',
      'spa': 'Spanish'
    };

    // File type tags
    this.fileTypeTags = {
      'searchable': 'Searchable PDF',
      'scanned': 'Scanned PDF',
      'mixed': 'Mixed PDF',
      'epub': 'EPUB'
    };
  }

  /**
   * Analyze text and extract relevant keywords
   */
  analyzeText(text, minOccurrences = 3) {
    if (!text) return [];

    const lowerText = text.toLowerCase();
    const foundTags = new Set();

    // Check technical keywords
    for (const [tag, keywords] of Object.entries(this.technicalKeywords)) {
      let occurrences = 0;
      for (const keyword of keywords) {
        const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
        const matches = lowerText.match(regex);
        if (matches) {
          occurrences += matches.length;
        }
      }
      if (occurrences >= minOccurrences) {
        foundTags.add(tag);
      }
    }

    // Check genre keywords
    for (const [tag, keywords] of Object.entries(this.genreKeywords)) {
      let occurrences = 0;
      for (const keyword of keywords) {
        const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
        const matches = lowerText.match(regex);
        if (matches) {
          occurrences += matches.length;
        }
      }
      if (occurrences >= minOccurrences) {
        foundTags.add(tag);
      }
    }

    return Array.from(foundTags);
  }

  /**
   * Analyze title for specific patterns
   */
  analyzeTitle(title) {
    if (!title) return [];

    const tags = new Set();
    const lowerTitle = title.toLowerCase();

    // Check for edition patterns
    if (/\d+(st|nd|rd|th)\s+edition/i.test(title)) {
      const match = title.match(/(\d+)(st|nd|rd|th)\s+edition/i);
      if (match) {
        tags.add(`${match[1]}${match[2]} Edition`);
      }
    }

    // Check for year patterns
    const yearMatch = title.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      const year = parseInt(yearMatch[0]);
      if (year >= 1990 && year <= new Date().getFullYear()) {
        if (year >= 2020) tags.add('Recent');
        else if (year >= 2010) tags.add('2010s');
        else if (year >= 2000) tags.add('2000s');
        else tags.add('1990s');
      }
    }

    // Check for series/volume patterns
    if (/vol(ume)?\s*\d+/i.test(title) || /part\s*\d+/i.test(title)) {
      tags.add('Series');
    }

    // Check for specific formats
    if (/handbook/i.test(title)) tags.add('Handbook');
    if (/cookbook/i.test(title)) tags.add('Cookbook');
    if (/textbook/i.test(title)) tags.add('Textbook');
    if (/workbook/i.test(title)) tags.add('Workbook');

    // Check for level indicators
    if (/beginner|introduction|intro\b/i.test(title)) tags.add('Beginner');
    if (/advanced/i.test(title)) tags.add('Advanced');
    if (/intermediate/i.test(title)) tags.add('Intermediate');
    if (/professional/i.test(title)) tags.add('Professional');

    return Array.from(tags);
  }

  /**
   * Analyze author name for patterns
   */
  analyzeAuthor(author) {
    if (!author) return [];

    const tags = new Set();

    // Check for multiple authors
    if (author.includes(',') || author.includes('&') || author.includes(' and ')) {
      tags.add('Multiple Authors');
    }

    // Check for organization/company authors
    if (/\b(inc|llc|ltd|corporation|corp|company|press|publisher)/i.test(author)) {
      tags.add('Corporate Author');
    }

    return Array.from(tags);
  }

  /**
   * Generate tag suggestions for a book
   */
  async generateSuggestions(bookId) {
    const book = db.getBookById(bookId);
    if (!book) {
      throw new Error('Book not found');
    }

    const suggestions = new Set();

    // Add language tag
    if (book.language && this.languageTags[book.language.toLowerCase()]) {
      suggestions.add(this.languageTags[book.language.toLowerCase()]);
    }

    // Add file type tag
    if (book.pdf_type && this.fileTypeTags[book.pdf_type]) {
      suggestions.add(this.fileTypeTags[book.pdf_type]);
    }

    // Analyze title
    const titleTags = this.analyzeTitle(book.title);
    titleTags.forEach(tag => suggestions.add(tag));

    // Analyze author
    const authorTags = this.analyzeAuthor(book.author);
    authorTags.forEach(tag => suggestions.add(tag));

    // Analyze content (if available)
    if (book.content || book.ocr_text) {
      const contentText = book.content || book.ocr_text;
      // Take first 10000 characters for analysis to avoid performance issues
      const sampleText = contentText.substring(0, 10000);
      const contentTags = this.analyzeText(sampleText);
      contentTags.forEach(tag => suggestions.add(tag));
    }

    // Analyze description
    if (book.description) {
      const descTags = this.analyzeText(book.description, 1); // Lower threshold for description
      descTags.forEach(tag => suggestions.add(tag));
    }

    // Add page count categories
    if (book.page_count) {
      if (book.page_count < 50) suggestions.add('Short');
      else if (book.page_count < 200) suggestions.add('Medium Length');
      else if (book.page_count < 500) suggestions.add('Full Length');
      else suggestions.add('Long');
    }

    // Add file size categories
    if (book.file_size) {
      const mb = book.file_size / (1024 * 1024);
      if (mb < 1) suggestions.add('Small File');
      else if (mb < 10) suggestions.add('Medium File');
      else if (mb < 50) suggestions.add('Large File');
      else suggestions.add('Very Large File');
    }

    // Get existing tags to exclude from suggestions
    const existingTags = db.getBookTags(bookId).map(tag => tag.name.toLowerCase());

    // Filter out existing tags and return suggestions
    const finalSuggestions = Array.from(suggestions).filter(tag =>
      !existingTags.includes(tag.toLowerCase())
    );

    return {
      bookId: bookId,
      title: book.title,
      suggestions: finalSuggestions.slice(0, 10) // Limit to top 10 suggestions
    };
  }

  /**
   * Batch generate suggestions for multiple books
   */
  async batchGenerateSuggestions(bookIds) {
    const results = [];

    for (const bookId of bookIds) {
      try {
        const suggestions = await this.generateSuggestions(bookId);
        if (suggestions.suggestions.length > 0) {
          results.push(suggestions);
        }
      } catch (error) {
        console.error(`Failed to generate suggestions for book ${bookId}:`, error);
      }
    }

    return results;
  }

  /**
   * Apply suggested tags to a book
   */
  async applySuggestions(bookId, tagNames) {
    const book = db.getBookById(bookId);
    if (!book) {
      throw new Error('Book not found');
    }

    const appliedTags = [];
    const failedTags = [];

    for (const tagName of tagNames) {
      try {
        // First, ensure the tag exists in the database
        let tag = db.db.prepare('SELECT * FROM tags WHERE LOWER(name) = LOWER(?)').get(tagName);

        if (!tag) {
          // Create the tag if it doesn't exist
          const stmt = db.db.prepare('INSERT INTO tags (name) VALUES (?)');
          const result = stmt.run(tagName);
          tag = { id: result.lastInsertRowid, name: tagName };
        }

        // Add tag to book
        try {
          db.addTagToBook(bookId, tag.id);
          appliedTags.push(tagName);
        } catch (e) {
          if (!e.message.includes('UNIQUE constraint failed')) {
            failedTags.push(tagName);
          }
        }
      } catch (error) {
        console.error(`Failed to apply tag "${tagName}":`, error);
        failedTags.push(tagName);
      }
    }

    return {
      success: appliedTags.length > 0,
      applied: appliedTags,
      failed: failedTags
    };
  }
}

module.exports = new AutoTagger();