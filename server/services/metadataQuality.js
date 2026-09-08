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
const normalizeForCompare = (value) =>
  (value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Is `candidate` just a tail-end scrap of the fuller `whole`? Extraction often
 * grabs the last few words of a title — "PHP глазами хакера. 5-е изд" comes
 * back as "е изд", "CS для программиста-самоучки" as "самоучки" — and those
 * scraps pass the plausibility check on their own.
 */
function isFragmentOf(candidate, whole) {
  const a = normalizeForCompare(candidate);
  const b = normalizeForCompare(whole);

  if (!a || !b || a === b) return false;
  if (a.length >= b.length * 0.6) return false;

  return b.endsWith(a) || b.includes(` ${a}`);
}

function bestTitle({ extracted, existing, filePath }) {
  const fromFile = titleFromFilename(filePath);

  // The filename is usually the fullest form available, so an extracted title
  // that is merely a scrap of it loses to it.
  if (isPlausibleTitle(fromFile)) {
    if (isPlausibleTitle(extracted) && !isFragmentOf(extracted, fromFile)) {
      return cleanTitle(extracted);
    }
    if (!isPlausibleTitle(extracted) && isPlausibleTitle(existing) &&
        !isFragmentOf(existing, fromFile)) {
      return cleanTitle(existing);
    }
    return fromFile;
  }

  if (isPlausibleTitle(extracted)) return cleanTitle(extracted);
  if (isPlausibleTitle(existing)) return cleanTitle(existing);

  return cleanTitle(existing) || cleanTitle(extracted) || fromFile || null;
}

/*
 * Publisher, edition and description come off the same copyright page as the
 * author and fail the same way: a sentence fragment from the liability notice
 * lands in `publisher`, the word "edition" from any passing sentence lands in
 * `edition`, and a table of contents lands in `description`.
 */

// Legal prose reads as a clause, not a name. These verbs never appear in one.
const LEGAL_CLAUSE = /\b(cannot|can not|does not|do not|shall|shall not|may not|will not|is not|are not|assume[sd]?|provide[sd]?|responsib|liab|guarantee|warrant|disclaim|represent|endorse|accept)\b/i;

const PUBLISHER_ALIASES = new Map([
  ['oreilly', "O'Reilly Media"],
  ['oreilly media', "O'Reilly Media"],
  ['o reilly', "O'Reilly Media"],
  ['packt', 'Packt'],
  ['packt publishing', 'Packt'],
  ['packt publishing ltd', 'Packt'],
  ['manning', 'Manning'],
  ['manning publications', 'Manning'],
  ['apress', 'Apress'],
  ['no starch press', 'No Starch Press'],
  ['pragmatic bookshelf', 'Pragmatic Bookshelf'],
  ['the pragmatic bookshelf', 'Pragmatic Bookshelf'],
  ['addison wesley', 'Addison-Wesley'],
  ['addison-wesley', 'Addison-Wesley'],
  ['wiley', 'Wiley'],
  ['john wiley sons', 'Wiley'],
  ['springer', 'Springer'],
  ['pearson', 'Pearson'],
  ['mcgraw hill', 'McGraw-Hill'],
  ['mcgraw-hill', 'McGraw-Hill'],
  ['microsoft press', 'Microsoft Press'],
  ['mit press', 'MIT Press'],
  ['the mit press', 'MIT Press'],
  ['cambridge university press', 'Cambridge University Press'],
  ['oxford university press', 'Oxford University Press'],
  ['crc press', 'CRC Press'],
  ['питер', 'Питер'],
  ['дмк пресс', 'ДМК Пресс'],
  ['бхв-петербург', 'БХВ-Петербург']
]);

/**
 * A publisher is a name: short, capitalised, no verbs. Known imprints are
 * folded to one spelling so "O'Reilly", "O’Reilly Media" and "OReilly" stop
 * splitting the same publisher across three filter entries.
 */
function cleanPublisher(value) {
  if (!value || typeof value !== 'string') return null;

  // PDF text extraction leaves doubled spaces and line breaks mid-phrase.
  let name = value.replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');

  if (name.length < 2 || name.length > 60) return null;
  if (!hasLetters(name)) return null;
  if (name.includes('\n')) return null;

  const key = name.toLowerCase().replace(/[^a-zа-яё0-9 ]/gi, '').replace(/\s+/g, ' ').trim();
  if (PUBLISHER_ALIASES.has(key)) return PUBLISHER_ALIASES.get(key);

  if (LEGAL_CLAUSE.test(name)) return null;
  if (BOILERPLATE.test(name)) return null;

  // A publisher line starts with a capital; a scraped mid-sentence fragment
  // ("cannot assume responsibility…", "does not provide medical…") does not.
  if (!/^[A-ZА-ЯЁ0-9]/.test(name)) return null;

  // Names are a handful of words, not a clause.
  if (name.split(' ').length > 6) return null;

  return name;
}

function isPlausiblePublisher(value) {
  return cleanPublisher(value) !== null;
}

// What an edition actually looks like, in either language.
const EDITION_PATTERNS = [
  /^\d+(?:st|nd|rd|th)\s+edition$/i,
  /^(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+edition$/i,
  /^(?:revised|updated|expanded|international|global|annotated|anniversary|special|deluxe)\s+edition$/i,
  /^\d+-?[ея]\s*(?:изд\.?|издание)$/i,
  /^edition\s+\d+$/i,
  /^v?\d+(?:\.\d+)*$/i
];

/**
 * Only accept an edition that matches a recognised form. The extractor matched
 * the word "edition" anywhere, which produced "edition of", "edition
 * published" and "Edition\nRevision" on hundreds of books.
 */
function cleanEdition(value) {
  if (!value || typeof value !== 'string') return null;

  // Keep a trailing period: it belongs to the Russian abbreviation "изд.".
  const edition = value.replace(/\s+/g, ' ').trim().replace(/[,;:]+$/, '');
  if (!edition) return null;

  const match = EDITION_PATTERNS.some((pattern) => pattern.test(edition));
  if (!match) return null;

  // Normalise capitalisation: "2ND EDITION" and "2nd edition" are one thing.
  return edition.replace(/\bedition\b/gi, 'Edition');
}

function isPlausibleEdition(value) {
  return cleanEdition(value) !== null;
}

/**
 * A description should be prose about the book. What the extractor picked up
 * instead was front matter: copyright blocks, ISBN lines, the reproduction
 * notice, and tables of contents held together by dot leaders.
 */
function cleanDescription(value) {
  if (!value || typeof value !== 'string') return null;

  let text = value.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  if (text.length < 60) return null;

  // Dot leaders mean a table of contents.
  if (/\.{5,}/.test(text)) return null;

  // Front matter: a copyright or ISBN block rather than a blurb.
  if (/^(?:isbn\b|©|\(c\)\s|copyright\b)/i.test(text)) return null;
  if (/©/.test(text.slice(0, 200))) return null;

  // The reproduction notice, which appears in most technical books verbatim.
  if (/(prohibited reproduction|retrieval system|all rights reserved|no part of this (?:book|publication)|without (?:the )?(?:prior )?written permission)/i.test(text)) {
    return null;
  }

  // Prose has sentences. A run of headings, page numbers or a licence block
  // does not.
  const letters = (text.match(/[a-zA-Zа-яА-ЯёЁ]/g) || []).length;
  if (letters / text.length < 0.6) return null;

  // Trim to a readable length on a sentence boundary where possible.
  if (text.length > 1200) {
    const cut = text.slice(0, 1200);
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    text = stop > 400 ? cut.slice(0, stop + 1) : cut.trimEnd() + '…';
  }

  return text;
}

function isPlausibleDescription(value) {
  return cleanDescription(value) !== null;
}

module.exports = {
  cleanAuthor,
  cleanPublisher,
  isPlausiblePublisher,
  cleanEdition,
  isPlausibleEdition,
  cleanDescription,
  isPlausibleDescription,
  isPlausibleAuthor,
  cleanTitle,
  isPlausibleTitle,
  titleFromFilename,
  bestTitle
};
