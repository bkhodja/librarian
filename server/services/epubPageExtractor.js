/**
 * Page-level text extraction for ePUBs.
 *
 * An ePUB has no pages — it is a zip of XHTML documents that a reader reflows
 * to whatever screen it is on. The rest of this app is built around
 * `book_pages`, so the reading order is walked and the text cut into synthetic
 * pages of roughly the size a PDF page holds here (254 words on average across
 * the 284,697 already indexed). That keeps retrieval, search and summarisation
 * working on ePUBs exactly as they do on PDFs.
 *
 * The page numbers are ours, not the book's: they give citations a useful
 * granularity, but they do not correspond to anything the ePUB reader can
 * navigate to, which uses CFI locations instead.
 */

const fs = require('fs').promises;
const path = require('path');
const JSZip = require('jszip');
const xml2js = require('xml2js');

const WORDS_PER_PAGE = Number(process.env.EPUB_WORDS_PER_PAGE) || 250;

const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&apos;': "'", '&#39;': "'", '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
  '&laquo;': '«', '&raquo;': '»', '&ldquo;': '“', '&rdquo;': '”', '&rsquo;': '’'
};

/** Readable text out of one XHTML document. */
function htmlToText(html) {
  let text = html;

  // Anything that is not prose.
  text = text.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ');
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');

  // Keep the block structure, so paragraphs do not run together.
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');

  text = text.replace(/<[^>]+>/g, ' ');

  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  text = text.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
  for (const [entity, char] of Object.entries(ENTITIES)) {
    text = text.split(entity).join(char);
  }

  return text
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map((line) => line.trim()).join('\n')
    .trim();
}

class EpubPageExtractor {
  constructor() {
    this.parser = new xml2js.Parser();
  }

  /** Locate the OPF, which lists the manifest and the reading order. */
  async findOpf(zip) {
    const container = await zip.file('META-INF/container.xml')?.async('string');

    if (container) {
      const parsed = await this.parser.parseStringPromise(container);
      const rootfile = parsed?.container?.rootfiles?.[0]?.rootfile?.[0];
      if (rootfile?.$?.['full-path']) return rootfile.$['full-path'];
    }

    // Some files omit or misplace container.xml.
    const candidates = Object.keys(zip.files).filter((name) => name.endsWith('.opf'));
    return candidates[0] || null;
  }

  /**
   * The spine in reading order, resolved to paths inside the zip.
   * Falls back to every XHTML file in the archive when the spine is unusable,
   * since a book with an unreadable spine is still worth indexing.
   */
  async readingOrder(zip, opfPath) {
    const opfDir = path.posix.dirname(opfPath);
    const resolve = (href) =>
      (opfDir === '.' ? href : path.posix.join(opfDir, href)).replace(/^\.\//, '');

    try {
      const opf = await zip.file(opfPath)?.async('string');
      const parsed = await this.parser.parseStringPromise(opf);
      const pkg = parsed?.package;

      const manifest = {};
      for (const item of pkg?.manifest?.[0]?.item || []) {
        if (item.$?.id && item.$?.href) manifest[item.$.id] = item.$.href;
      }

      const order = [];
      for (const ref of pkg?.spine?.[0]?.itemref || []) {
        const href = manifest[ref.$?.idref];
        if (!href) continue;

        const full = resolve(decodeURIComponent(href));
        if (zip.file(full)) order.push(full);
      }

      if (order.length > 0) return order;
    } catch {
      // Fall through to the scan below.
    }

    return Object.keys(zip.files)
      .filter((name) => /\.(x?html?|xml)$/i.test(name) && !name.includes('META-INF'))
      .sort();
  }

  /**
   * Cut a document's text into pages of roughly WORDS_PER_PAGE, breaking on
   * paragraph boundaries so a page does not start mid-sentence.
   */
  paginate(text, startNumber) {
    const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const pages = [];

    let current = [];
    let words = 0;

    const flush = () => {
      if (current.length === 0) return;
      const content = current.join('\n\n');
      pages.push({
        pageNumber: startNumber + pages.length,
        content,
        wordCount: content.split(/\s+/).filter(Boolean).length
      });
      current = [];
      words = 0;
    };

    for (const paragraph of paragraphs) {
      const length = paragraph.split(/\s+/).filter(Boolean).length;

      // A paragraph longer than a page becomes pages of its own.
      if (length > WORDS_PER_PAGE * 2) {
        flush();
        const tokens = paragraph.split(/\s+/);
        for (let i = 0; i < tokens.length; i += WORDS_PER_PAGE) {
          const slice = tokens.slice(i, i + WORDS_PER_PAGE).join(' ');
          pages.push({
            pageNumber: startNumber + pages.length,
            content: slice,
            wordCount: slice.split(/\s+/).filter(Boolean).length
          });
        }
        continue;
      }

      if (words + length > WORDS_PER_PAGE) flush();
      current.push(paragraph);
      words += length;
    }

    flush();
    return pages;
  }

  /** Extract an ePUB as pages. Mirrors the PDF extractor's return shape. */
  async extractPages(filePath) {
    try {
      const zip = await JSZip.loadAsync(await fs.readFile(filePath));

      const opfPath = await this.findOpf(zip);
      if (!opfPath) {
        return { success: false, error: 'No OPF found; the file may not be a valid ePUB' };
      }

      const documents = await this.readingOrder(zip, opfPath);
      if (documents.length === 0) {
        return { success: false, error: 'No readable documents in the archive' };
      }

      const pages = [];
      for (const doc of documents) {
        const html = await zip.file(doc)?.async('string');
        if (!html) continue;

        const text = htmlToText(html);
        if (text.length < 20) continue;   // navigation, title pages, empty wrappers

        pages.push(...this.paginate(text, pages.length + 1));
      }

      if (pages.length === 0) {
        return { success: false, error: 'No text could be read from the archive' };
      }

      return { success: true, pages, documentCount: documents.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = new EpubPageExtractor();
module.exports.htmlToText = htmlToText;
