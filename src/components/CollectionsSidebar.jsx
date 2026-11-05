import React, { useState, useEffect } from 'react';
import StatusNote, { useStatus } from './StatusNote';

function NavItem({ active, icon, label, count, badge, badgeTitle, onClick, indent = false }) {
  return (
    <div
      className={`flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
        indent ? 'pl-4' : ''
      } ${active ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-surface-hover'}`}
      onClick={onClick}
    >
      {icon && <span className="text-base leading-none">{icon}</span>}
      <span className="min-w-0 flex-1 truncate" title={label}>{label}</span>
      {badge > 0 && (
        <span
          className="rounded-full bg-accent px-1.5 py-0.5 text-2xs font-semibold tabular-nums text-white"
          title={badgeTitle}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {count != null && !badge && (
        <span className="shrink-0 text-2xs tabular-nums text-ink-faint">{count.toLocaleString()}</span>
      )}
    </div>
  );
}

function SectionHeading({ children }) {
  return (
    <h2 className="mb-1 mt-4 px-2 text-2xs font-semibold uppercase tracking-wider text-ink-faint first:mt-0">
      {children}
    </h2>
  );
}

function CollectionsSidebar({ selectedCollection, section = 'book', onSelect, selectedBookIds, isSelectionMode, onBooksAdded, unseenCount = 0 }) {
  const notice = useStatus();
  const [suggestions, setSuggestions] = useState(null);
  const [suggesting, setSuggesting] = useState(false);
  const [collections, setCollections] = useState([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [loading, setLoading] = useState(false);

  const [sections, setSections] = useState({ book: null, magazine: null });
  const [titles, setTitles] = useState([]);
  const [titlesOpen, setTitlesOpen] = useState(false);
  const [titleFilter, setTitleFilter] = useState('');

  // Load collections
  useEffect(() => {
    loadCollections();
  }, []);

  // Section counts and magazine titles. New issues arrive in the background,
  // so this is refreshed now and then rather than only once.
  useEffect(() => {
    let retry;
    const load = async () => {
      clearTimeout(retry);
      try {
        const [counts, series] = await Promise.all([
          fetch('http://localhost:3001/api/books/sections').then((r) => r.json()),
          fetch('http://localhost:3001/api/books/series').then((r) => r.json())
        ]);
        setSections(counts);
        setTitles(Array.isArray(series) ? series : []);
      } catch {
        // The server may be restarting; try again soon rather than in a minute.
        retry = setTimeout(load, 5000);
      }
    };
    load();
    const timer = setInterval(load, 60000);
    return () => {
      clearInterval(timer);
      clearTimeout(retry);
    };
  }, []);

  // Opening a magazine's issues from elsewhere should show where it is.
  useEffect(() => {
    if (typeof selectedCollection === 'string' && selectedCollection.startsWith('series:')) {
      setTitlesOpen(true);
    }
  }, [selectedCollection]);

  const isView = (viewSection, collection) =>
    section === viewSection && selectedCollection === collection;

  const shownTitles = titleFilter.trim()
    ? titles.filter((t) => t.name.toLowerCase().includes(titleFilter.trim().toLowerCase()))
    : titles;

  const loadCollections = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/collections');
      const data = await response.json();
      setCollections(data.collections || []);

      // Initialize default collections if empty
      if (!data.collections || data.collections.length === 0) {
        await initializeDefaults();
      }
    } catch (error) {
      console.error('Failed to load collections:', error);
    }
  };

  const initializeDefaults = async () => {
    try {
      await fetch('http://localhost:3001/api/collections/init-defaults', {
        method: 'POST'
      });
      await loadCollections();
    } catch (error) {
      console.error('Failed to initialize default collections:', error);
    }
  };

  const createCollection = async () => {
    if (!newCollectionName.trim()) return;

    try {
      const response = await fetch('http://localhost:3001/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCollectionName })
      });

      if (response.ok) {
        setNewCollectionName('');
        setIsCreating(false);
        await loadCollections();
      } else {
        const detail = await response.json().catch(() => ({}));
        notice.error(detail.error || 'Could not create that shelf');
      }
    } catch (error) {
      console.error('Failed to create collection:', error);
      notice.error('Could not reach the server');
    }
  };

  const addSelectedBooksToCollection = async (collectionId) => {
    if (selectedBookIds.size === 0) return;

    try {
      setLoading(true);
      const response = await fetch(`http://localhost:3001/api/collections/${collectionId}/books`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookIds: Array.from(selectedBookIds) })
      });

      if (response.ok) {
        const result = await response.json();
        notice.success(result.message);
        await loadCollections(); // Refresh counts
        if (onBooksAdded) {
          onBooksAdded(); // Trigger parent refresh
        }
      } else {
        const detail = await response.json().catch(() => ({}));
        notice.error(detail.error || 'Could not add those books');
      }
    } catch (error) {
      console.error('Failed to add books to collection:', error);
      notice.error('Could not reach the server');
    } finally {
      setLoading(false);
    }
  };

  const deleteCollection = async (id) => {
    if (!window.confirm('Are you sure you want to delete this collection?')) return;

    try {
      const response = await fetch(`http://localhost:3001/api/collections/${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        await loadCollections();
        if (selectedCollection === id) {
          onSelect(section, null);
        }
      } else {
        const detail = await response.json().catch(() => ({}));
        notice.error(detail.error || 'Could not delete that shelf');
      }
    } catch (error) {
      console.error('Failed to delete collection:', error);
    }
  };

  const suggestShelves = async () => {
    setSuggesting(true);
    notice.clear();
    try {
      const response = await fetch('http://localhost:3001/api/collections/suggest');
      const data = await response.json();
      if (!response.ok) {
        notice.error(data.error || 'Could not get suggestions');
        return;
      }
      if (!data.collections?.length) {
        notice.info('Nothing to suggest yet — tag some books first.');
        return;
      }
      setSuggestions(data.collections);
    } catch {
      notice.error('Could not reach the server');
    } finally {
      setSuggesting(false);
    }
  };

  const createSuggested = async (proposal) => {
    try {
      const response = await fetch('http://localhost:3001/api/collections/suggest/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proposal)
      });
      const data = await response.json();
      if (!response.ok) {
        notice.error(data.error || 'Could not create that shelf');
        return;
      }
      notice.success(`Created "${data.name}" with ${data.added} book(s)`);
      setSuggestions((current) => current.filter((c) => c.name !== proposal.name));
      loadCollections();
    } catch {
      notice.error('Could not reach the server');
    }
  };

  return (
    <aside className="sticky top-0 h-screen w-56 shrink-0 overflow-y-auto border-r border-hairline bg-surface-sunken">
      <div className="p-3">
        <SectionHeading>Books</SectionHeading>
        <NavItem
          icon="📚" label="All Books" count={sections.book}
          active={isView('book', null)} onClick={() => onSelect('book', null)}
        />
        {/* Recently Added - a view over the section, not a stored collection */}
        <NavItem
          icon="🆕" label="Recently Added"
          badge={section === 'book' ? unseenCount : 0}
          badgeTitle={`${unseenCount} added since you last looked`}
          active={isView('book', 'recently-added')} onClick={() => onSelect('book', 'recently-added')}
        />
        <NavItem
          icon="📖" label="Currently Reading"
          active={isView('book', 'currently-reading')} onClick={() => onSelect('book', 'currently-reading')}
        />

        <SectionHeading>Magazines</SectionHeading>
        <NavItem
          icon="📰" label="All Magazines" count={sections.magazine}
          active={isView('magazine', null)} onClick={() => onSelect('magazine', null)}
        />
        <NavItem
          icon="🆕" label="Recently Added"
          badge={section === 'magazine' ? unseenCount : 0}
          badgeTitle={`${unseenCount} added since you last looked`}
          active={isView('magazine', 'recently-added')} onClick={() => onSelect('magazine', 'recently-added')}
        />
        <NavItem
          icon="📖" label="Currently Reading"
          active={isView('magazine', 'currently-reading')} onClick={() => onSelect('magazine', 'currently-reading')}
        />
        {titles.length > 0 && (
          <>
            <button
              onClick={() => setTitlesOpen(!titlesOpen)}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
              aria-expanded={titlesOpen}
            >
              <svg className={`h-4 w-4 transition-transform ${titlesOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="flex-1">Titles</span>
              <span className="text-2xs tabular-nums text-ink-faint">{titles.length}</span>
            </button>
            {titlesOpen && (
              <div className="mb-1">
                {titles.length > 12 && (
                  <input
                    type="search"
                    value={titleFilter}
                    onChange={(e) => setTitleFilter(e.target.value)}
                    placeholder="Filter titles…"
                    className="mx-2 mb-1 w-[calc(100%-1rem)] rounded border border-hairline bg-surface px-2 py-1 text-xs text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
                  />
                )}
                {shownTitles.map((title) => (
                  <NavItem
                    key={title.name}
                    indent
                    label={title.name}
                    count={title.count}
                    active={isView('magazine', `series:${title.name}`)}
                    onClick={() => onSelect('magazine', `series:${title.name}`)}
                  />
                ))}
                {shownTitles.length === 0 && (
                  <p className="px-4 py-1 text-2xs text-ink-faint">No title matches</p>
                )}
              </div>
            )}
          </>
        )}

        <div className="mb-2 mt-4 flex items-center justify-between">
          <h2 className="px-2 text-2xs font-semibold uppercase tracking-wider text-ink-faint">Collections</h2>
          {!isCreating && (
            <button
              onClick={() => setIsCreating(true)}
              className="flex h-6 w-6 items-center justify-center rounded text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
              title="Create new collection"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          )}
        </div>

        <StatusNote status={notice.status} onDismiss={notice.clear} className="mb-3" />

        <button
          onClick={suggestShelves}
          disabled={suggesting}
          className="mb-3 w-full rounded-md px-2 py-1.5 text-left text-xs text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-50"
        >
          {suggesting ? 'Looking at your library…' : '✦ Suggest shelves'}
        </button>

        {suggestions && (
          <div className="mb-3 space-y-1.5">
            {suggestions.map((proposal) => (
              <div key={proposal.name} className="rounded-md bg-surface p-2 ring-1 ring-hairline">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-medium text-ink">
                    {proposal.icon} {proposal.name}
                  </span>
                  <span className="shrink-0 text-2xs tabular-nums text-ink-faint">
                    {proposal.count}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-2xs leading-snug text-ink-faint">
                  {proposal.tags.join(', ')}
                </p>
                <div className="mt-1.5 flex gap-1.5">
                  <button
                    onClick={() => createSuggested(proposal)}
                    className="rounded bg-accent px-2 py-0.5 text-2xs font-medium text-white hover:bg-accent-hover"
                  >
                    Create
                  </button>
                  <button
                    onClick={() => setSuggestions((c) => c.filter((x) => x.name !== proposal.name))}
                    className="rounded px-2 py-0.5 text-2xs text-ink-faint hover:text-ink"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {isCreating && (
          <div className="mb-4">
            <input
              type="text"
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && createCollection()}
              placeholder="Collection name..."
              className="w-full px-3 py-2 border border-hairline bg-surface text-ink rounded-md focus:outline-none focus:ring-2 focus:ring-accent"
              autoFocus
            />
            <div className="flex space-x-2 mt-2">
              <button
                onClick={createCollection}
                className="px-3 py-1 bg-accent text-white text-sm rounded hover:bg-accent-hover"
              >
                Create
              </button>
              <button
                onClick={() => {
                  setIsCreating(false);
                  setNewCollectionName('');
                }}
                className="px-3 py-1 rounded border border-hairline text-sm text-ink-muted hover:bg-surface-hover hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Collections List */}
        <div className="mt-2 space-y-1">
          {collections.map((collection) => (
            <div key={collection.id} className="group relative">
              <div
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors cursor-pointer ${
                  selectedCollection === collection.id ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-surface-hover'
                }`}
                onClick={() => onSelect(section, collection.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-base leading-none">{collection.icon || '📁'}</span>
                    <div>
                      <div className="truncate">{collection.name}</div>
                      
                    </div>
                  </div>
                  <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {isSelectionMode && selectedBookIds.size > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          addSelectedBooksToCollection(collection.id);
                        }}
                        className="p-1 text-green-600 hover:bg-emerald-500/10 rounded"
                        title="Add selected books"
                        disabled={loading}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteCollection(collection.id);
                      }}
                      className="p-1 text-red-600 hover:bg-red-500/10 rounded"
                      title="Delete collection"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Quick add to collection when in selection mode */}
        {isSelectionMode && selectedBookIds.size > 0 && (
          <div className="mt-5 rounded-md bg-accent-soft px-2.5 py-2">
            <p className="text-xs font-medium text-accent-ink">
              {selectedBookIds.size} book{selectedBookIds.size !== 1 ? 's' : ''} selected
            </p>
            <p className="mt-1 text-2xs leading-snug text-ink-muted">
              Use the + beside a collection to add them
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

export default CollectionsSidebar;