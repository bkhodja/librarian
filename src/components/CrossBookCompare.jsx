import React, { useEffect, useState } from 'react';
import StatusNote, { useStatus } from './StatusNote';

/**
 * How the library explains one topic, book beside book.
 *
 * The passages are retrieved from the page index, so they are the books'
 * own words and appear whether or not the model is running. What the model
 * adds is a line on each book's angle and a paragraph on how they differ —
 * both marked as its reading rather than the books'. A quoted sentence has
 * been checked against the page it came from; where it could not be checked
 * it is simply not shown.
 */
function CrossBookCompare() {
  const [topic, setTopic] = useState('');
  const [language, setLanguage] = useState('');
  const [tag, setTag] = useState('');
  const [options, setOptions] = useState(null);
  const [result, setResult] = useState(null);
  const [comparing, setComparing] = useState(false);
  const notice = useStatus();

  useEffect(() => {
    fetch('http://localhost:3001/api/compare/options')
      .then((r) => r.json())
      .then(setOptions)
      .catch(() => setOptions({ available: false, languages: [], tags: [] }));
  }, []);

  const run = async () => {
    if (topic.trim().length < 3) return;

    setComparing(true);
    setResult(null);
    notice.clear();

    try {
      const params = new URLSearchParams({ topic: topic.trim() });
      if (language) params.set('language', language);
      if (tag) params.set('tag', tag);

      const response = await fetch(`http://localhost:3001/api/compare?${params}`);
      const data = await response.json();

      if (data.error) notice.error(data.error);
      else if (data.books.length === 0) notice.info(`Nothing in the library covers "${topic.trim()}".`);
      else setResult(data);
    } catch (error) {
      console.error('Comparison failed:', error);
      notice.error('Could not reach the server');
    } finally {
      setComparing(false);
    }
  };

  const openAtPage = (book) => {
    window.open(`http://localhost:3001/pdf${book.filePath}#page=${book.page}`, '_blank');
  };

  return (
    <div className="rounded-lg border border-hairline bg-surface p-4">
      <div className="mb-3">
        <h2 className="text-sm font-medium text-ink">Compare across books</h2>
        <p className="mt-0.5 text-xs text-ink-faint">
          One passage from each book on your shelf that teaches this topic.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
          placeholder="decorators, gradient descent, кэширование…"
          autoComplete="off"
          className="min-w-[16rem] flex-1 rounded-md border border-hairline bg-surface-sunken px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:bg-surface focus:outline-none"
        />

        <select
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className="rounded-md border border-hairline bg-surface-sunken px-2 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        >
          <option value="">Any subject</option>
          {(options?.tags || []).map((t) => (
            <option key={t.name} value={t.name}>{t.name} ({t.count})</option>
          ))}
        </select>

        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="rounded-md border border-hairline bg-surface-sunken px-2 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        >
          <option value="">Any language</option>
          {(options?.languages || []).map((l) => (
            <option key={l.language} value={l.language}>{l.language} ({l.count})</option>
          ))}
        </select>

        <button
          onClick={run}
          disabled={comparing || topic.trim().length < 3}
          className="shrink-0 rounded-md bg-accent px-4 py-2 text-sm text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          {comparing ? 'Reading…' : 'Compare'}
        </button>
      </div>

      <StatusNote status={notice.status} onDismiss={notice.clear} className="mt-3" />

      {comparing && (
        <p className="mt-3 text-xs text-ink-faint">
          Searching every indexed page, then reading the best passage from each book…
        </p>
      )}

      {result && (
        <div className="mt-4">
          {result.contrast && (
            <div className="mb-4 rounded-md bg-accent-soft p-3">
              <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-accent-ink opacity-70">
                How they differ · read by {options?.model || 'the local model'}
              </p>
              <p className="text-sm leading-relaxed text-accent-ink">{result.contrast}</p>
            </div>
          )}

          {!result.modelUsed && (
            <p className="mb-3 text-xs text-ink-faint">
              Ollama is not running, so these are the passages without the reading notes.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {result.books.map((book) => (
              <article
                key={book.id}
                className="flex flex-col rounded-md border border-hairline bg-surface-sunken p-3"
              >
                <header className="mb-2">
                  <h3 className="text-sm font-medium leading-snug text-ink">{book.title}</h3>
                  {book.author && (
                    <p className="mt-0.5 text-xs text-ink-muted">{book.author}</p>
                  )}
                  <p className="mt-1 text-2xs text-ink-faint">
                    {book.matches} page{book.matches === 1 ? '' : 's'} on this topic
                    {book.language ? ` · ${book.language}` : ''}
                  </p>
                </header>

                {book.angle && (
                  <p className="mb-2 text-xs leading-relaxed text-ink-muted">{book.angle}</p>
                )}

                {book.quote && (
                  <blockquote className="mb-2 border-l-2 border-accent pl-2 text-xs italic leading-relaxed text-ink">
                    {book.quote}
                  </blockquote>
                )}

                <p className="mb-3 flex-1 text-xs leading-relaxed text-ink-faint">{book.excerpt}</p>

                <button
                  onClick={() => openAtPage(book)}
                  className="self-start rounded-md border border-hairline px-2 py-1 text-2xs text-ink-muted transition-colors hover:border-accent hover:text-accent"
                >
                  Open at page {book.page}
                </button>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default CrossBookCompare;
