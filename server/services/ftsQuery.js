/**
 * Turning typed prose into something FTS5 will accept.
 *
 * FTS5 reads punctuation and bare words as operators, so a question or a topic
 * typed by a person has to be reduced to quoted terms before it can be
 * matched. Both the per-book question answering and the cross-book comparison
 * need exactly this, so it lives here rather than in either of them.
 */

const STOPWORDS = new Set([
  'what', 'when', 'where', 'which', 'who', 'why', 'how', 'does', 'do', 'did',
  'is', 'are', 'was', 'were', 'the', 'a', 'an', 'of', 'in', 'on', 'for', 'to',
  'and', 'or', 'this', 'that', 'it', 'about', 'say', 'says', 'book', 'books',
  'tell', 'me', 'my', 'explain', 'explains', 'describe', 'can', 'you', 'i',
  'with', 'from', 'as', 'at', 'compare', 'between', 'difference', 'differences'
]);

/**
 * OR rather than AND: a page covering most of the topic is still the page
 * wanted, and FTS5 ranks the fuller matches higher on its own.
 */
function toMatchQuery(text) {
  const terms = (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  if (terms.length === 0) return null;

  return [...new Set(terms)].map((t) => `"${t}"`).join(' OR ');
}

/** The terms themselves, for highlighting and for checking a quote is on topic. */
function toTerms(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

module.exports = { toMatchQuery, toTerms, STOPWORDS };
