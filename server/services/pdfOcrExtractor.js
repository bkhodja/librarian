/**
 * Page text for scanned PDFs, via OCR.
 *
 * A scanned PDF holds page images and no text layer, so pdf-parse returns
 * nothing and these books have always been invisible to search, summaries and
 * question answering. This renders each page to an image and reads it with
 * Tesseract, which runs locally like everything else here.
 *
 * Pages are rendered in small batches and deleted as they are consumed: a
 * 689-page book at this resolution is gigabytes of PNG if rendered in one go.
 */

const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const { pdfToPng } = require('pdf-to-png-converter');
const Tesseract = require('tesseract.js');

const LANGUAGES = process.env.OCR_LANGUAGE || 'rus+eng';
const WORKERS = Number(process.env.OCR_WORKERS) || 4;
const RENDER_BATCH = Number(process.env.OCR_RENDER_BATCH) || 8;

// Higher is more accurate and slower. At 2.0 dense Russian pages came back at
// 86-92% confidence, which is enough for search and for a model to read.
const SCALE = Number(process.env.OCR_SCALE) || 2.0;

// Below this a page is almost certainly furniture — a scan artefact, a blank,
// or a plate — rather than text worth indexing.
const MIN_CONFIDENCE = Number(process.env.OCR_MIN_CONFIDENCE) || 40;
const MIN_WORDS = Number(process.env.OCR_MIN_WORDS) || 5;

class PdfOcrExtractor {
  /** Recognise one batch of rendered pages across the worker pool. */
  async recognizeBatch(workers, images) {
    const queue = images.slice();
    const results = [];

    await Promise.all(workers.map(async (worker) => {
      while (queue.length > 0) {
        const image = queue.shift();
        if (!image) return;

        try {
          const { data } = await worker.recognize(image.path);
          const content = (data.text || '').replace(/[ \t]+/g, ' ').trim();
          const wordCount = content ? content.split(/\s+/).length : 0;

          if (wordCount >= MIN_WORDS && data.confidence >= MIN_CONFIDENCE) {
            results.push({
              pageNumber: image.pageNumber,
              content,
              wordCount,
              confidence: data.confidence
            });
          }
        } catch (error) {
          console.error(`  OCR failed on page ${image.pageNumber}: ${error.message}`);
        } finally {
          await fsp.unlink(image.path).catch(() => {});
        }
      }
    }));

    return results;
  }

  /**
   * Extract a scanned PDF as pages. Same return shape as the PDF and ePUB
   * extractors, so the indexer treats all three alike.
   */
  /**
   * Tesseract's language choice matters: reading an English page with Russian
   * enabled makes it guess Cyrillic for Latin shapes, which turned "GETTING
   * STARTED" into "ОЕТНЕ РЕЗОВАМ". Russian technical books do carry English
   * code, so those keep both.
   */
  languagesFor(bookLanguage) {
    if (process.env.OCR_LANGUAGE) return process.env.OCR_LANGUAGE;

    switch ((bookLanguage || '').toLowerCase()) {
      case 'english': return 'eng';
      case 'russian': return 'rus+eng';
      default: return 'rus+eng';
    }
  }

  /**
   * Most scanned books have no recorded language — there was no text to detect
   * one from. Read a couple of pages with both alphabets enabled and see which
   * script actually came back, then commit to that for the rest of the book.
   */
  async detectLanguages(filePath, workDir, total) {
    const sample = [Math.min(3, total), Math.ceil(total / 2)].filter((n, i, a) => n >= 1 && a.indexOf(n) === i);

    let worker;
    try {
      const images = await pdfToPng(filePath, {
        outputFolder: workDir, viewportScale: 1.5, pagesToProcess: sample
      });

      worker = await Tesseract.createWorker('rus+eng');
      let cyrillic = 0;
      let latin = 0;

      for (const image of images) {
        const { data } = await worker.recognize(image.path);
        cyrillic += (data.text.match(/[а-яё]/gi) || []).length;
        latin += (data.text.match(/[a-z]/gi) || []).length;
        await fsp.unlink(image.path).catch(() => {});
      }

      if (cyrillic + latin < 50) return 'rus+eng';       // too little to judge
      return cyrillic / (cyrillic + latin) < 0.1 ? 'eng' : 'rus+eng';
    } catch {
      return 'rus+eng';
    } finally {
      if (worker) await worker.terminate().catch(() => {});
    }
  }

  async extractPages(filePath, { pageCount, onProgress, language } = {}) {
    let workDir;
    let workers = [];

    try {
      await fsp.access(filePath);
      workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'librarian-ocr-'));

      // Page count is not always recorded; probe the file when it is missing.
      let total = pageCount;
      if (!total || total < 1) {
        const probe = await pdfToPng(filePath, { outputFolder: workDir, viewportScale: 0.1 });
        total = probe.length;
        await Promise.all(probe.map((p) => fsp.unlink(p.path).catch(() => {})));
      }

      // A recorded language is trusted; otherwise look at the pages.
      const languages = (language && language.toLowerCase() !== 'unknown')
        ? this.languagesFor(language)
        : await this.detectLanguages(filePath, workDir, total);
      workers = await Promise.all(
        Array.from({ length: WORKERS }, () => Tesseract.createWorker(languages))
      );

      const pages = [];
      for (let start = 1; start <= total; start += RENDER_BATCH) {
        const numbers = [];
        for (let n = start; n < start + RENDER_BATCH && n <= total; n++) numbers.push(n);

        let images;
        try {
          images = await pdfToPng(filePath, {
            outputFolder: workDir,
            viewportScale: SCALE,
            pagesToProcess: numbers
          });
        } catch (error) {
          console.error(`  Could not render pages ${numbers[0]}-${numbers[numbers.length - 1]}: ${error.message}`);
          continue;
        }

        pages.push(...await this.recognizeBatch(workers, images));
        if (onProgress) onProgress({ done: Math.min(start + RENDER_BATCH - 1, total), total });
      }

      if (pages.length === 0) {
        return { success: false, error: 'OCR produced no usable text' };
      }

      pages.sort((a, b) => a.pageNumber - b.pageNumber);

      const confidence =
        pages.reduce((sum, p) => sum + p.confidence, 0) / pages.length;

      return { success: true, pages, confidence, languages };
    } catch (error) {
      return { success: false, error: error.message };
    } finally {
      await Promise.all(workers.map((w) => w.terminate().catch(() => {})));
      if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}

module.exports = new PdfOcrExtractor();
