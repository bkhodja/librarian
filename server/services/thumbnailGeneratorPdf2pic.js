const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const { fromPath } = require('pdf2pic');

class ThumbnailGeneratorPdf2pic {
  constructor() {
    this.thumbnailsDir = path.join(process.cwd(), 'public', 'thumbnails');
    this.initializeThumbnailsDir();
  }

  async initializeThumbnailsDir() {
    try {
      await fs.mkdir(this.thumbnailsDir, { recursive: true });
    } catch (error) {
      console.error('Error creating thumbnails directory:', error);
    }
  }

  /**
   * Generate thumbnail for a PDF using pdf2pic (requires Ghostscript)
   */
  async generateThumbnail(pdfPath, bookId) {
    try {
      // pdf2pic opens a ReadStream internally and its 'error' event has no
      // listener, so a missing file crashes the process instead of rejecting.
      // Check first rather than letting it get that far.
      try {
        await fs.access(pdfPath);
      } catch {
        console.error(`Skipping thumbnail for book ${bookId}: file not found at ${pdfPath}`);
        return { success: false, missing: true, error: 'File not found' };
      }

      console.log(`Generating PDF thumbnail for book ${bookId}...`);

      // Configure pdf2pic
      const options = {
        density: 100,       // DPI for the conversion
        saveFilename: `temp_book_${bookId}`,
        savePath: this.thumbnailsDir,
        format: 'png',
        width: 600,        // Larger initial size for better quality
        height: 800
      };

      const converter = fromPath(pdfPath, options);

      // Convert the first page to PNG
      const result = await converter(1);  // Page 1

      if (result && result.path) {
        // Now resize and convert to JPEG using sharp
        const tempPath = result.path;
        const thumbnailPath = path.join(this.thumbnailsDir, `book_${bookId}.jpg`);

        await sharp(tempPath)
          .resize(300, 400, {
            fit: 'contain',
            background: { r: 255, g: 255, b: 255, alpha: 1 }
          })
          .jpeg({ quality: 85 })
          .toFile(thumbnailPath);

        // Delete the temporary file
        try {
          await fs.unlink(tempPath);
        } catch (e) {
          // Ignore if temp file doesn't exist
        }

        const finalThumbnail = `/thumbnails/book_${bookId}.jpg`;
        console.log(`PDF thumbnail generated: ${finalThumbnail}`);

        return {
          success: true,
          thumbnail: finalThumbnail,
          thumbnailPath,
          path: thumbnailPath
        };
      } else {
        throw new Error('Failed to convert PDF page');
      }
    } catch (error) {
      console.error(`Error generating PDF thumbnail for book ${bookId}:`, error.message);

      // Create a placeholder image on error
      try {
        const thumbnailPath = path.join(this.thumbnailsDir, `book_${bookId}.jpg`);

        // Create a book-like placeholder
        const svg = `
          <svg width="300" height="400" xmlns="http://www.w3.org/2000/svg">
            <rect width="300" height="400" fill="#f5f5f5"/>
            <rect x="20" y="20" width="260" height="360" fill="#fff" stroke="#ddd" stroke-width="2"/>
            <text x="150" y="50" font-family="Arial, sans-serif" font-size="14" font-weight="bold" text-anchor="middle" fill="#333">PDF</text>
            <line x1="40" y1="80" x2="260" y2="80" stroke="#e0e0e0" stroke-width="1"/>
            <line x1="40" y1="110" x2="260" y2="110" stroke="#e0e0e0" stroke-width="1"/>
            <line x1="40" y1="140" x2="260" y2="140" stroke="#e0e0e0" stroke-width="1"/>
            <line x1="40" y1="170" x2="260" y2="170" stroke="#e0e0e0" stroke-width="1"/>
            <line x1="40" y1="200" x2="260" y2="200" stroke="#e0e0e0" stroke-width="1"/>
            <line x1="40" y1="230" x2="200" y2="230" stroke="#e0e0e0" stroke-width="1"/>
            <rect x="40" y="260" width="100" height="80" fill="#f0f0f0" stroke="#ddd" stroke-width="1"/>
            <text x="150" y="360" font-family="Arial, sans-serif" font-size="10" text-anchor="middle" fill="#999">Book ${bookId}</text>
          </svg>
        `;

        await sharp(Buffer.from(svg))
          .jpeg({ quality: 85 })
          .toFile(thumbnailPath);

        return {
          success: true,
          thumbnail: `/thumbnails/book_${bookId}.jpg`,
          thumbnailPath,
          path: thumbnailPath,
          isPlaceholder: true
        };
      } catch (fallbackError) {
        console.error('Fallback thumbnail generation also failed:', fallbackError);
        return {
          success: false,
          error: error.message
        };
      }
    }
  }

  async thumbnailExists(bookId) {
    try {
      const thumbnailPath = path.join(this.thumbnailsDir, `book_${bookId}.jpg`);
      await fs.access(thumbnailPath);
      return true;
    } catch {
      return false;
    }
  }

  getThumbnailPath(bookId) {
    return `/thumbnails/book_${bookId}.jpg`;
  }

  async deleteThumbnail(bookId) {
    try {
      const thumbnailPath = path.join(this.thumbnailsDir, `book_${bookId}.jpg`);
      await fs.unlink(thumbnailPath);
      return true;
    } catch (error) {
      console.error(`Error deleting thumbnail for book ${bookId}:`, error);
      return false;
    }
  }

  async generateBatch(books, progressCallback) {
    const results = [];
    const total = books.length;

    for (let i = 0; i < total; i++) {
      const book = books[i];

      // Always regenerate thumbnails in batch mode
      // This ensures we get actual PDF thumbnails, not placeholders
      const result = await this.generateThumbnail(book.file_path, book.id);
      results.push({
        bookId: book.id,
        ...result
      });

      if (progressCallback) {
        progressCallback({
          current: i + 1,
          total,
          currentBook: book,
          result: results[results.length - 1]
        });
      }

      // Add a small delay to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return results;
  }
}

module.exports = new ThumbnailGeneratorPdf2pic();