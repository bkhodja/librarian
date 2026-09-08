import React, { useEffect, useState } from 'react';
import StatusNote, { useStatus } from './StatusNote';

/**
 * Ask a book a question and get an answer from its own pages.
 *
 * The answer is drawn only from pages retrieved out of this book, and the
 * pages are shown alongside it so it can be checked. When the book does not
 * cover the question the model says so rather than answering from general
 * knowledge, and that case is marked, because an ungrounded answer that looks
 * like a grounded one is the failure worth avoiding here.
 */
function AskBook({ book }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);
  const [asking, setAsking] = useState(false);
  const [availability, setAvailability] = useState(null);
  const status = useStatus();

  useEffect(() => {
    setAnswer(null);
    setQuestion('');
    status.clear();

    if (!book?.id) return;
    let cancelled = false;

    fetch(`http://localhost:3001/api/ask/${book.id}/available`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setAvailability(d); })
      .catch(() => { if (!cancelled) setAvailability({ available: false, indexed: false }); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.id]);

  const ask = async () => {
    if (question.trim().length < 3) return;

    setAsking(true);
    setAnswer(null);
    status.clear();

    try {
      const response = await fetch(`http://localhost:3001/api/ask/${book.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question })
      });
      const data = await response.json();

      if (data.answer) setAnswer(data);
      else status.info(data.reason || data.error || 'No answer could be found');
    } catch (error) {
      console.error('Ask failed:', error);
      status.error('Could not reach the server');
    } finally {
      setAsking(false);
    }
  };

  if (!availability) return null;

  if (!availability.indexed) {
    return (
      <div className="pt-2">
        <label className="block text-sm font-medium text-ink-muted mb-1">Ask this book</label>
        <p className="text-xs text-ink-faint italic">
          This book's pages have not been indexed yet, so there is nothing to read.
        </p>
      </div>
    );
  }

  const cited = answer?.pages?.length ? answer.pages : answer?.searched?.slice(0, 4);

  return (
    <div className="pt-2">
      <div className="mb-2 flex items-center justify-between">
        <label className="block text-sm font-medium text-ink-muted">Ask this book</label>
        {!availability.available && (
          <span className="text-2xs text-ink-faint">Needs Ollama</span>
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') ask(); }}
          placeholder="What does this book say about…?"
          disabled={!availability.available || asking}
          className="flex-1 rounded-md border border-hairline bg-surface-sunken px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:bg-surface focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={ask}
          disabled={!availability.available || asking || question.trim().length < 3}
          className="shrink-0 rounded-md bg-accent px-3 py-2 text-sm text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          {asking ? 'Reading…' : 'Ask'}
        </button>
      </div>

      <StatusNote status={status.status} onDismiss={status.clear} className="mt-2" />

      {asking && (
        <p className="mt-2 text-xs text-ink-faint">
          Searching the book's pages and reading the matches…
        </p>
      )}

      {answer && (
        <div className="mt-2 rounded-md bg-surface-sunken p-3">
          {answer.grounded === false && (
            <p className="mb-2 text-2xs font-medium text-amber-700 dark:text-amber-300">
              Not answered by this book
            </p>
          )}
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{answer.answer}</p>
          {cited?.length > 0 && (
            <p className="mt-2 text-2xs text-ink-faint">
              From page{cited.length === 1 ? '' : 's'} {cited.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default AskBook;
