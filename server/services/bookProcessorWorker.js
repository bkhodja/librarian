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
const quality = require('./metadataQuality');

/**
 * The two processors report their results differently: processPDF returns a
 * flat object with no success flag, while processEpub returns
 * { success, metadata }. Flatten both into one shape so callers do not have to
 * know which one ran.
 */
function normalizePdf(result) {
  const metadata = result.metadata || {};

  // Prefer a title that reads like one. An embedded "Untitled" or a filename
  // slug loses to whatever else is available, and a rejected author is left
  // null so an ISBN lookup can supply the real one.
  const title = quality.bestTitle({
    extracted: metadata.title,
    existing: metadata.titleFromFilename,
    filePath: result.filePath
  });

  return {
    success: !result.error && Boolean(result.metadata),
    title,
    author: quality.cleanAuthor(metadata.author || metadata.authorFromFilename, { title }),
    language: result.language || null,
    pageCount: metadata.pageCount || null,
    pdfType: result.pdfType || null,
    ocrConfidence: result.ocrData?.confidence ?? null,
    isbn: metadata.isbn || null,
    publisher: quality.cleanPublisher(metadata.publisher),
    publicationYear: metadata.publicationYear || metadata.yearFromFilename || null,
    edition: quality.cleanEdition(metadata.edition),
    description: quality.cleanDescription(metadata.description),
    needsReview: Boolean(result.needsReview),
    error: result.error || null
  };
}

function normalizeEpub(result) {
  const metadata = result.metadata || {};

  const title = quality.bestTitle({
    extracted: metadata.title,
    filePath: result.filePath
  });

  return {
    success: Boolean(result.success),
    title,
    author: quality.cleanAuthor(metadata.author, { title }),
    language: metadata.language || null,
    pageCount: metadata.chapters || null,
    pdfType: null,
    ocrConfidence: null,
    isbn: metadata.isbn || null,
    publisher: quality.cleanPublisher(metadata.publisher),
    publicationYear: metadata.publicationYear || null,
    edition: quality.cleanEdition(metadata.edition),
    description: quality.cleanDescription(metadata.description),
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
    const result = await epubProcessor.processEpub(filePath);
    return normalizeEpub({ ...result, filePath });
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
