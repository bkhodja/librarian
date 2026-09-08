/**
 * Shared judgement about whether a title or author is worth storing.
 *
 * Metadata scraped from a PDF's front matter is frequently not metadata at
 * all: copyright boilerplate, the publisher's own name, or the list of cities
 * in an O'Reilly colophon all look like a line of capitalised words. Rather
 * than trusting whatever the extractor returns, candidates are checked here
 * before they reach the database, and anything rejected leaves the field empty
 * so an ISBN lookup can fill it in properly.
 */

const path = require('path');

// Legal and production boilerplate that shows up on copyright pages.
const BOILERPLATE = /copyright|\(c\)|©|all rights reserved|no part of|disclaim|warrant|make no repre|library of congress|printed in|published (by|in)|first published|isbn|issn|www\.|https?:|@|trademark|permission|liability|errata|colophon/i;

// Corporate suffixes. A publisher is not an author.
const COMPANY = /\b(ltd|llc|l\.l\.c|inc|inc\.|gmbh|b\.v|s\.a|co\.|corp|company|press|publishing|publishers|publications|media|books|house|editions|verlag|group|imprint|place|street|avenue|издательство|изд-во)\b/i;

// Cities that appear in publisher colophons, which the "capitalised line"
// heuristic happily reads as a person's name.
const COLOPHON_CITIES = new Set([
  'beijing', 'boston', 'farnham', 'sebastopol', 'tokyo', 'cambridge', 'sydney',
  'san francisco', 'new york', 'london', 'berlin', 'paris', 'shanghai', 'taipei',
  'singapore', 'hong kong', 'toronto', 'chicago', 'birmingham', 'mumbai',
  'delhi', 'москва', 'санкт-петербург', 'киев', 'минск'
]);

const KNOWN_PUBLISHERS = new Set([
  "o'reilly", "o'reilly media", 'packt', 'packt publishing', 'manning',
  'addison-wesley', 'pearson', 'mcgraw-hill', 'wiley', 'springer', 'apress',
  'cambridge university press', 'oxford university press', 'mit press',
  'no starch press', 'pragmatic bookshelf', 'academic press', 'prentice hall',
  'sams', 'wrox', 'microsoft press', 'adobe press', 'manning publications',
  'питер', 'эксмо', 'аст', 'диалектика', 'бхв-петербург', 'дмк пресс'
]);

// Words that appear in book titles and cover copy but never in a person's
// name. One of these anywhere in a candidate means a topic phrase was scraped
// rather than an author.
const TOPIC_WORDS = new Set([
  'data', 'engineering', 'engineer', 'python', 'java', 'javascript', 'typescript',
  'programming', 'development', 'developer', 'analysis', 'analytics', 'science',
  'guide', 'handbook', 'cookbook', 'edition', 'learning', 'machine', 'design',
  'patterns', 'practices', 'introduction', 'fundamentals', 'mastering', 'beginners',
  'advanced', 'complete', 'essential', 'modern', 'practical', 'reference', 'manual',
  'tutorial', 'course', 'workbook', 'primer', 'bootcamp', 'masterclass', 'recipes',
  'solutions', 'architecture', 'systems', 'network', 'security', 'database',
  'cloud', 'devops', 'testing', 'algorithms', 'structures', 'framework', 'api',
  'web', 'mobile', 'android', 'kotlin', 'swift', 'react', 'angular', 'vue',
  'perspective', 'director', 'manager', 'management', 'volume', 'series', 'first',
  'second', 'third', 'technologies', 'technology', 'software', 'computing',
  // Vendor and product names, which cover copy puts where an author would go.
  'microsoft', 'google', 'amazon', 'oracle', 'adobe', 'apple', 'ibm', 'azure',
  'aws', 'docker', 'kubernetes', 'linux', 'windows', 'postgresql', 'mysql',
  'mongodb', 'fabric', 'tableau', 'salesforce',
  // Cover phrases and series names that read like a two-word name.
  'getting', 'started', 'tools', 'shell', 'bash', 'unix', 'power', 'hands',
  'crash', 'pocket', 'nutshell', 'depth', 'action', 'practice', 'theory'
]);

const PLACEHOLDER_TITLES = new Set([
  'untitled', 'unknown', 'document', 'book', 'pdf', 'microsoft word', 'no title',
  'title', 'untitled document', 'без названия', 'txt', 'text', 'ocr', 'scan',
  'copy', 'final', 'draft', 'ebook', 'output'
]);

const hasLetters = (s) => /[a-zA-Zа-яА-ЯёЁ]/.test(s);

/**
 * Is one person's name plausible? Applied per-author, so a comma-separated
 * list is judged a name at a time rather than as one long string.
 */
function isPlausiblePerson(candidate) {
  const name = candidate.trim();

  if (name.length < 4 || name.length > 60) return false;
  if (!hasLetters(name)) return false;
  if (BOILERPLATE.test(name)) return false;
  if (COMPANY.test(name)) return false;
  if (KNOWN_PUBLISHERS.has(name.toLowerCase())) return false;
  if (COLOPHON_CITIES.has(name.toLowerCase())) return false;

  // Digits belong in an ISBN or an address, not a name.
  if (/\d/.test(name)) return false;

  const words = name.split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;

  // A topic phrase lifted off the cover, not a person.
  if (words.some((w) => TOPIC_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, '')))) return false;

  // Truncated scrapes such as "San F" or "Implementing Da" end in a stub.
  // A genuine initial keeps its period, as in "David K. Rensin".
  if (words.some((w) => w.replace(/\./g, '').length < 3 && !w.endsWith('.'))) return false;

  // Real names are capitalised; a scraped sentence fragment usually is not.
  const capitalised = words.filter((w) => /^[A-ZА-ЯЁ]/.test(w)).length;
  return capitalised >= Math.max(2, words.length - 1);
}

/**
 * Validate a whole author field, which may list several people.
 * Returns the cleaned value, or null if nothing in it looks like a name.
 */
function cleanAuthor(value, context = {}) {
  if (!value || typeof value !== 'string') return null;

  const title = (context.title || '').toLowerCase();

  // A newline means the extractor ran two unrelated lines together.
  const parts = value
    .split(/\s*[,;\n]\s*|\s+(?:and|&|и)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);

  const people = [];
  for (const part of parts) {
    if (!isPlausiblePerson(part)) continue;
    if (people.includes(part)) continue;

    // A "name" that is already part of the title is the series or product,
    // not the author.
    if (title && title.includes(part.toLowerCase())) continue;

    people.push(part);
  }

  return people.length > 0 ? people.slice(0, 4).join(', ') : null;
}

function isPlausibleAuthor(value, context = {}) {
  return cleanAuthor(value, context) !== null;
}

/**
 * Tidy a title without judging it: strip an extension, turn separators into
 * spaces, drop a leading ISBN, collapse whitespace.
 */
function cleanTitle(value) {
  if (!value || typeof value !== 'string') return null;

  let title = value.trim();

  title = title.replace(/\.(pdf|epub|djvu|mobi|azw3?)$/i, '');
  title = title.replace(/^\s*(?:ISBN[\s:-]*)?\d[\d-]{8,18}\d[\s\-–—_]*/i, ''); // leading ISBN, hyphenated or not
  title = title.replace(/[-_]txt$/i, '');
  title = title.replace(/[_]+/g, ' ');
  title = title.replace(/\s+/g, ' ').trim();
  title = title.replace(/^[-–—\s]+|[-–—\s]+$/g, '');

  return title.length > 0 ? title : null;
}

/**
 * Is this title usable, or a filename slug / placeholder standing in for one?
 * Slugs are rejected rather than patched up: "bayesiananalysiswithpython"
 * cannot be re-spaced locally, but an ISBN lookup returns the real title.
 */
function isPlausibleTitle(value) {
  const title = cleanTitle(value);

  if (!title) return false;
  if (title.length < 4 || title.length > 300) return false;
  if (!hasLetters(title)) return false;
  if (PLACEHOLDER_TITLES.has(title.toLowerCase())) return false;

  // A run of digits that long is an ISBN or a product code.
  if (/\d{7,}/.test(title)) return false;

  // Run-together slug: long, no spaces, and not simply one long word.
  const words = title.split(/\s+/);
  if (words.length === 1 && title.length > 18) return false;

  // A single run-together word, even alongside an edition suffix:
  // "expertdatamodelingwithpowerbi 2nd edition" is still a slug.
  if (words.some((w) => w.length > 18 && /^[a-z]+$/.test(w))) return false;

  return true;
}

/**
 * Last-resort title from the filename. Better than a placeholder, and often
 * genuinely correct for a well-named library.
 */
function titleFromFilename(filePath) {
  if (!filePath) return null;
  return cleanTitle(path.basename(filePath, path.extname(filePath)));
}

/**
 * Pick the best title available, preferring a real one and falling back to the
 * filename rather than storing "Untitled".
 */
function bestTitle({ extracted, existing, filePath }) {
  if (isPlausibleTitle(extracted)) return cleanTitle(extracted);
  if (isPlausibleTitle(existing)) return cleanTitle(existing);

  const fromFile = titleFromFilename(filePath);
  if (isPlausibleTitle(fromFile)) return fromFile;

  return cleanTitle(existing) || cleanTitle(extracted) || fromFile || null;
}

module.exports = {
  cleanAuthor,
  isPlausibleAuthor,
  cleanTitle,
  isPlausibleTitle,
  titleFromFilename,
  bestTitle
};
