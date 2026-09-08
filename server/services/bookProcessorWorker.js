/**
 * Worker-thread entry point for book metadata extraction.
 *
 * pdf-parse is CPU-bound and runs to completion synchronously enough that
 * parsing a few-hundred-page PDF stalls the event loop for seconds. Running it
 * on the main thread meant every API request queued behind the background scan.
 * This module hosts that work off-thread; neither processor touches the
 * database, so there is no shared state to coordinate.
 */
const path = require('path');
const { parentPort } = require('worker_threads');

const pdfProcessor = require('./pdfProcessor');
const epubProcessor = require('./epubProcessorImproved');

/**
 * The two processors report their results differently: processPDF returns a
 * flat object with no success flag, while processEpub returns
 * { success, metadata }. Flatten both into one shape so callers do not have to
 * know which one ran.
 */
function normalizePdf(result) {
  const metadata = result.metadata || {};

  return {
    success: !result.error && Boolean(result.metadata),
    title: metadata.title || null,
    author: metadata.author || metadata.authorFromFilename || null,
    language: result.language || null,
    pageCount: metadata.pageCount || null,
    pdfType: result.pdfType || null,
    ocrConfidence: result.ocrData?.confidence ?? null,
    isbn: metadata.isbn || null,
    publisher: metadata.publisher || null,
    publicationYear: metadata.publicationYear || metadata.yearFromFilename || null,
    edition: metadata.edition || null,
    description: metadata.description || null,
    needsReview: Boolean(result.needsReview),
    error: result.error || null
  };
}

function normalizeEpub(result) {
  const metadata = result.metadata || {};

  return {
    success: Boolean(result.success),
    title: metadata.title || null,
    author: metadata.author || null,
    language: metadata.language || null,
    pageCount: metadata.chapters || null,
    pdfType: null,
    ocrConfidence: null,
    isbn: metadata.isbn || null,
    publisher: metadata.publisher || null,
    publicationYear: metadata.publicationYear || null,
    edition: metadata.edition || null,
    description: metadata.description || null,
    needsReview: false,
    error: result.error || null
  };
}

async function process(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.pdf') {
    return normalizePdf(await pdfProcessor.processPDF(filePath));
  }

  if (ext === '.epub') {
    return normalizeEpub(await epubProcessor.processEpub(filePath));
  }

  return { success: false, error: `Unsupported file type: ${ext}` };
}

parentPort.on('message', async ({ id, filePath }) => {
  try {
    parentPort.postMessage({ id, result: await process(filePath) });
  } catch (error) {
    parentPort.postMessage({
      id,
      result: { success: false, error: error.message }
    });
  }
});
