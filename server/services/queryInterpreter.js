/**
 * Turns a sentence into the filters the library already supports.
 *
 * The filter bar can express "python books in English added recently", but
 * only as four separate controls the user has to find and set. This reads the
 * sentence and sets them, so the question can be asked the way it is thought.
 *
 * It deliberately does not search: it returns the filter the UI applies, so
 * what happened stays visible and reversible rather than being a ranked list
 * the user cannot argue with.
 */

const { db } = require('../database/init');
const ollama = require('./ollamaClient');
const vocabulary = require('./tagVocabulary');

const SCHEMA = {
  type: 'object',
  properties: {
    tags: { type: 'array', items: { type: 'string' } },
    text: { type: ['string', 'null'] },
    author: { type: ['string', 'null'] },
    language: { type: ['string', 'null'] },
    fileType: { type: ['string', 'null'] },
    yearFrom: { type: ['integer', 'null'] },
    yearTo: { type: ['integer', 'null'] },
    addedWithinDays: { type: ['integer', 'null'] },
    sortBy: { type: ['string', 'null'] },
    sortOrder: { type: ['string', 'null'] }
  },
  required: ['tags', 'text']
};

const SORTS = new Set(['title', 'author', 'date_added', 'file_size']);

class QueryInterpreter {
  /** The values actually present in this library, so the model picks real ones. */
  context() {
    const languages = db.prepare(
      "SELECT DISTINCT language FROM books WHERE language IS NOT NULL AND language != ''"
    ).all().map((r) => r.language);

    // The whole vocabulary, not only the tags currently in use. Offering just
    // what is in use meant a request for "cookbooks" had no "cooking" to pick
    // and settled on "writing" instead. A tag no book carries yields an empty
    // result, which is the honest answer to the question asked.
    const inUse = new Set(db.prepare(`
      SELECT t.name FROM tags t JOIN book_tags bt ON bt.tag_id = t.id GROUP BY t.id
    `).all().map((r) => r.name));

    return { languages, tags: vocabulary.TAGS, inUse };
  }

  buildPrompt(question, context) {
    // Worked examples rather than rules alone. Described only in prose, the
    // model put "in English" nowhere, "russian" into the text field, and
    // invented a "fiction" tag for a question about dates.
    return `Turn a request about a personal book library into a filter.

Tags in use (choose only from these):
${context.tags.join(', ') || '(none yet)'}

Languages present: ${context.languages.join(', ') || 'unknown'}
File types: pdf, epub
Sort fields: title, author, date_added, file_size
Today is ${new Date().toISOString().slice(0, 10)}.

Field meanings:
- tags: subjects, and ONLY ones from the list above. Never invent one.
- text: words to match against a title, when the request names a particular
  book. Not for subjects, and never for generic words like "books" or
  "beginners".
- author: a person's name.
- language: only when the request names one.
- yearFrom / yearTo: when the book was PUBLISHED.
- addedWithinDays: when the book was ADDED to the library — "recently",
  "this week", "today". Never for publication dates.
- Leave every field the request does not ask for as null.

Examples:

Request: "python books for beginners"
{"tags":["python"],"text":null,"author":null,"language":null,"fileType":null,"yearFrom":null,"yearTo":null,"addedWithinDays":null,"sortBy":null,"sortOrder":null}

Request: "books about kubernetes and docker in English"
{"tags":["kubernetes","docker"],"text":null,"author":null,"language":"English","fileType":null,"yearFrom":null,"yearTo":null,"addedWithinDays":null,"sortBy":null,"sortOrder":null}

Request: "russian books about business"
{"tags":["business"],"text":null,"author":null,"language":"Russian","fileType":null,"yearFrom":null,"yearTo":null,"addedWithinDays":null,"sortBy":null,"sortOrder":null}

Request: "what did I add this week"
{"tags":[],"text":null,"author":null,"language":null,"fileType":null,"yearFrom":null,"yearTo":null,"addedWithinDays":7,"sortBy":"date_added","sortOrder":"desc"}

Request: "books by Martin Kleppmann"
{"tags":[],"text":null,"author":"Martin Kleppmann","language":null,"fileType":null,"yearFrom":null,"yearTo":null,"addedWithinDays":null,"sortBy":null,"sortOrder":null}

Request: "largest epub files"
{"tags":[],"text":null,"author":null,"language":null,"fileType":"epub","yearFrom":null,"yearTo":null,"addedWithinDays":null,"sortBy":"file_size","sortOrder":"desc"}

Request: "machine learning published after 2020"
{"tags":["machine-learning"],"text":null,"author":null,"language":null,"fileType":null,"yearFrom":2020,"yearTo":null,"addedWithinDays":null,"sortBy":null,"sortOrder":null}

Now this one.

Request: "${question}"

Reply as JSON.`;
  }

  /**
   * Returns { filters, unmatched } — unmatched lists anything the model asked
   * for that this library cannot express, so the UI can say so rather than
   * silently returning the wrong books.
   */
  async interpret(question) {
    if (!question || question.trim().length < 2) return null;

    const context = this.context();
    const raw = await ollama.generateJSON(this.buildPrompt(question, context), SCHEMA, {
      maxTokens: 220
    });
    if (!raw) return null;

    const unmatched = [];

    const tags = [];
    for (const candidate of raw.tags || []) {
      const tag = vocabulary.canonicalize(candidate);
      if (!tag) {
        if (candidate) unmatched.push(String(candidate));
        continue;
      }

      tags.push(tag);
      // A real subject that nothing is filed under yet. Worth saying, because
      // an empty grid otherwise looks like a bug.
      if (!context.inUse.has(tag)) unmatched.push(`${tag} (no books tagged yet)`);
    }

    const language = context.languages.find(
      (l) => l.toLowerCase() === String(raw.language || '').toLowerCase()
    ) || null;

    const fileType = ['pdf', 'epub'].includes(String(raw.fileType || '').toLowerCase())
      ? String(raw.fileType).toLowerCase()
      : null;

    const year = (value) => {
      const n = Number(value);
      return Number.isInteger(n) && n > 1400 && n <= new Date().getFullYear() + 1 ? n : null;
    };

    return {
      filters: {
        tags: [...new Set(tags)],
        text: typeof raw.text === 'string' && raw.text.trim() ? raw.text.trim() : null,
        author: typeof raw.author === 'string' && raw.author.trim() ? raw.author.trim() : null,
        language,
        fileType,
        yearFrom: year(raw.yearFrom),
        yearTo: year(raw.yearTo),
        addedWithinDays: Number.isInteger(raw.addedWithinDays) && raw.addedWithinDays > 0
          ? Math.min(raw.addedWithinDays, 3650)
          : null,
        sortBy: SORTS.has(raw.sortBy) ? raw.sortBy : null,
        sortOrder: raw.sortOrder === 'asc' || raw.sortOrder === 'desc' ? raw.sortOrder : null
      },
      unmatched
    };
  }
}

module.exports = new QueryInterpreter();
