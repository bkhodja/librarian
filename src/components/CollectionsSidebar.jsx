import React, { useState, useEffect } from 'react';

function CollectionsSidebar({ selectedCollection, onCollectionSelect, selectedBookIds, isSelectionMode, onBooksAdded }) {
  const [collections, setCollections] = useState([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [loading, setLoading] = useState(false);

  // Load collections
  useEffect(() => {
    loadCollections();
  }, []);

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
      }
    } catch (error) {
      console.error('Failed to create collection:', error);
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
        alert(result.message);
        await loadCollections(); // Refresh counts
        if (onBooksAdded) {
          onBooksAdded(); // Trigger parent refresh
        }
      }
    } catch (error) {
      console.error('Failed to add books to collection:', error);
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
          onCollectionSelect(null);
        }
      }
    } catch (error) {
      console.error('Failed to delete collection:', error);
    }
  };

  return (
    <aside className="sticky top-0 h-screen w-56 shrink-0 overflow-y-auto border-r border-hairline bg-surface-sunken">
      <div className="p-3">
        <div className="mb-2 flex items-center justify-between">
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

        {/* All Books */}
        <div
          className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors cursor-pointer ${
            selectedCollection === null ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-surface-hover'
          }`}
          onClick={() => onCollectionSelect(null)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="text-base leading-none">📚</span>
              <span className="flex-1">All Books</span>
            </div>
          </div>
        </div>

        {/* Currently Reading - Special Collection */}
        <div
          className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors cursor-pointer ${
            selectedCollection === 'currently-reading' ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-surface-hover'
          }`}
          onClick={() => onCollectionSelect('currently-reading')}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="text-base leading-none">📖</span>
              <span className="flex-1">Currently Reading</span>
            </div>
          </div>
        </div>

        {/* Collections List */}
        <div className="mt-2 space-y-1">
          {collections.map((collection) => (
            <div key={collection.id} className="group relative">
              <div
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors cursor-pointer ${
                  selectedCollection === collection.id ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-surface-hover'
                }`}
                onClick={() => onCollectionSelect(collection.id)}
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