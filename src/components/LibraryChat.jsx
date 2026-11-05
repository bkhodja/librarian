import { useCallback, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import ModalPortal from './ModalPortal';

const API = 'http://localhost:3001/api/chat';

const EXAMPLES = [
  'I want to learn PostgreSQL. Which book should I start with, and what next?',
  'What should I read after the basics of machine learning?',
  'Which Kubernetes books do I have, from easiest to hardest?',
  'Хочу изучить Python с нуля. С чего начать?'
];

const LEVELS = ['', 'first steps', 'beginner', 'intermediate', 'advanced', 'expert'];

/**
 * POST a message and read the answer as server-sent events. EventSource can
 * only GET, so the stream is parsed by hand: frames are separated by a blank
 * line, each with an `event:` and a `data:` line.
 */
async function streamMessage(body, signal, onEvent) {
  const response = await fetch(`${API}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `The server responded ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const frames = buffered.split('\n\n');
    buffered = frames.pop();
    for (const frame of frames) {
      const event = frame.match(/^event: (.*)$/m)?.[1];
      const data = frame.match(/^data: (.*)$/m)?.[1];
      if (event && data) onEvent(event, JSON.parse(data));
    }
  }
}

/**
 * The model cites books as [[book:ID]]. Turn each into a link the renderer
 * shows as a book chip, drop the title the model often repeats after it (the
 * chip shows it), and hide a tag still arriving mid-stream.
 */
function prepareMarkdown(text) {
  return text
    .replace(/\[\[book:(\d+)\]\](\**)(?:\s*["«“][^"»”\n]{1,250}["»”])?/g, '[book](#book-$1)$2')
    .replace(/\[\[[^\]]*$/, '');
}

function BookChip({ book, onOpen }) {
  if (!book) return null;
  const level = book.profile?.level;
  return (
    <button
      type="button"
      onClick={() => onOpen(book.id)}
      title={[book.title, book.author, level && `Level ${level} of 5: ${LEVELS[level]}`].filter(Boolean).join(' — ')}
      className="mx-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md bg-surface-sunken px-1.5 py-0.5 align-middle text-left ring-1 ring-hairline transition-colors hover:bg-surface-hover"
    >
      {book.thumbnail_path && (
        <img src={`http://localhost:3001${book.thumbnail_path}`} alt="" className="h-5 w-4 shrink-0 rounded-sm object-cover" />
      )}
      <span className="truncate text-xs font-medium text-ink">{book.title}</span>
      {level && (
        <span className="shrink-0 rounded bg-accent-soft px-1 text-2xs font-semibold text-accent-ink">L{level}</span>
      )}
    </button>
  );
}

function Answer({ content, books, onOpenBook }) {
  return (
    <div className="text-sm leading-relaxed text-ink [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
      <Markdown
        components={{
          a: ({ href, children }) => {
            const id = href?.startsWith('#book-') ? Number(href.slice(6)) : null;
            if (id) return <BookChip book={books[id]} onOpen={onOpenBook} />;
            return <a href={href} target="_blank" rel="noreferrer" className="text-accent underline">{children}</a>;
          }
        }}
      >
        {prepareMarkdown(content)}
      </Markdown>
    </div>
  );
}

function LibraryChat({ isOpen, onClose, onOpenBook }) {
  const [status, setStatus] = useState(null);
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [books, setBooks] = useState({});
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState([]);

  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const rememberBooks = (cards) => setBooks((known) => ({
    ...known,
    ...Object.fromEntries(cards.map((card) => [card.id, card]))
  }));

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await (await fetch(`${API}/status`)).json());
    } catch {
      setStatus({ available: false, unreachable: true });
    }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await (await fetch(`${API}/conversations`)).json());
    } catch {
      setConversations([]);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    loadStatus();
    inputRef.current?.focus();
  }, [isOpen, loadStatus]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('[data-modal-root] .fixed.inset-0')) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const send = async (text = input) => {
    const message = text.trim();
    if (message.length < 2 || streaming) return;

    setInput('');
    setError(null);
    setShowHistory(false);
    setStreaming(true);
    setMessages((list) => [...list, { role: 'user', content: message }, { role: 'assistant', content: '', pending: true }]);

    const updateLast = (change) => setMessages((list) => {
      if (list.length === 0) return list;
      const next = [...list];
      next[next.length - 1] = { ...next[next.length - 1], ...change(next[next.length - 1]) };
      return next;
    });

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamMessage({ conversationId, message }, controller.signal, (event, data) => {
        if (event === 'meta') {
          setConversationId(data.conversationId);
          rememberBooks(data.books);
        } else if (event === 'token') {
          updateLast((last) => ({ content: last.content + data.text }));
        } else if (event === 'done') {
          updateLast(() => ({ content: data.content, pending: false }));
        } else if (event === 'error') {
          throw new Error(data.error);
        }
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message === 'Failed to fetch' ? 'Could not reach the server' : err.message);
        // An answer that never started is just noise in the conversation.
        setMessages((list) => (list[list.length - 1]?.content ? list : list.slice(0, -2)));
        if (!message.includes('\n')) setInput(message);
      }
    } finally {
      updateLast(() => ({ pending: false }));
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  const newChat = () => {
    stop();
    setConversationId(null);
    setMessages([]);
    setError(null);
    setShowHistory(false);
    inputRef.current?.focus();
  };

  const openConversation = async (id) => {
    stop();
    try {
      const data = await (await fetch(`${API}/conversations/${id}`)).json();
      rememberBooks(data.books);
      setConversationId(data.id);
      setMessages(data.messages.map(({ role, content }) => ({ role, content })));
      setError(null);
      setShowHistory(false);
    } catch {
      setError('Could not open that conversation');
    }
  };

  const deleteConversation = async (id) => {
    await fetch(`${API}/conversations/${id}`, { method: 'DELETE' }).catch(() => {});
    if (id === conversationId) newChat();
    loadConversations();
  };

  const toggleHistory = () => {
    if (!showHistory) loadConversations();
    setShowHistory(!showHistory);
  };

  const iconButton = 'flex h-8 w-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink';

  return (
    <ModalPortal>
      <aside
        aria-label="Ask the library"
        aria-hidden={!isOpen}
        className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-surface shadow-2xl ring-1 ring-hairline transition-transform duration-200 ease-out sm:w-[460px] ${isOpen ? 'translate-x-0' : 'pointer-events-none translate-x-full'}`}
      >
        <header className="flex items-center gap-1 border-b border-hairline px-3 py-2">
          <h2 className="flex-1 pl-1 text-sm font-semibold text-ink">Ask the library</h2>
          <button onClick={toggleHistory} className={showHistory ? `${iconButton} bg-accent-soft text-accent-ink` : iconButton} title="Past conversations">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <button onClick={newChat} className={iconButton} title="New conversation">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button onClick={onClose} className={iconButton} title="Close">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        {status && (!status.available || status.profiled < status.total) && (
          <p className="border-b border-hairline bg-surface-sunken px-4 py-1.5 text-2xs text-ink-faint">
            {status.unreachable
              ? 'Could not reach the server'
              : !status.available
                ? 'Needs Ollama: start it to ask questions'
                : `Difficulty known for ${status.profiled.toLocaleString()} of ${status.total.toLocaleString()} books. The rest is being worked out in the background, and until then levels are guesses.`}
          </p>
        )}

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
          {showHistory ? (
            <div>
              <p className="mb-2 text-xs font-medium text-ink-muted">Past conversations</p>
              {conversations.length === 0 && <p className="text-sm text-ink-faint">None yet.</p>}
              <ul className="space-y-1">
                {conversations.map((c) => (
                  <li key={c.id} className="group flex items-center gap-2 rounded-md hover:bg-surface-hover">
                    <button onClick={() => openConversation(c.id)} className="min-w-0 flex-1 px-2 py-1.5 text-left">
                      <span className={`block truncate text-sm ${c.id === conversationId ? 'font-semibold text-ink' : 'text-ink'}`}>{c.title}</span>
                      <span className="text-2xs text-ink-faint">{new Date(`${c.updated_at.replace(' ', 'T')}Z`).toLocaleString()}</span>
                    </button>
                    <button
                      onClick={() => deleteConversation(c.id)}
                      className="mr-1 rounded p-1 text-ink-faint opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
                      title="Delete conversation"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : messages.length === 0 ? (
            <div className="pt-6">
              <p className="text-sm text-ink">
                Ask about anything on your shelves: where to start a subject, what to read next, what you have on a topic.
              </p>
              <div className="mt-4 space-y-2">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    onClick={() => send(example)}
                    disabled={!status?.available}
                    className="block w-full rounded-md bg-surface-sunken px-3 py-2 text-left text-sm text-ink-muted ring-1 ring-hairline transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-50"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((m, i) => (m.role === 'user' ? (
                <div key={i} className="ml-8 whitespace-pre-line rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent-ink">
                  {m.content}
                </div>
              ) : (
                <div key={i}>
                  {m.content
                    ? <Answer content={m.content} books={books} onOpenBook={onOpenBook} />
                    : m.pending && <p className="animate-pulse text-sm text-ink-faint">Looking through your books…</p>}
                </div>
              )))}
            </div>
          )}
        </div>

        {error && (
          <p className="border-t border-hairline px-4 py-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}

        <form
          className="flex items-end gap-2 border-t border-hairline p-3"
          onSubmit={(e) => { e.preventDefault(); send(); }}
        >
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder={status?.available === false ? 'Start Ollama to ask' : 'Ask about your books…'}
            disabled={status?.available === false}
            className="flex-1 resize-none rounded-md border border-hairline bg-surface-sunken px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:bg-surface focus:outline-none disabled:opacity-50"
          />
          {streaming ? (
            <button type="button" onClick={stop} className="shrink-0 rounded-md bg-surface-sunken px-3 py-2 text-sm text-ink ring-1 ring-hairline transition-colors hover:bg-surface-hover">
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!status?.available || input.trim().length < 2}
              className="shrink-0 rounded-md bg-accent px-3 py-2 text-sm text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              Ask
            </button>
          )}
        </form>
      </aside>
    </ModalPortal>
  );
}

export default LibraryChat;
