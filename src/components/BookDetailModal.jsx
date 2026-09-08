import React, { useState, useEffect } from 'react';
import ReadingProgress from './ReadingProgress';

function BookDetailModal({ book, isOpen, onClose, onUpdate, onRead, onCollectionChange }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedBook, setEditedBook] = useState(book || {});
  const [tags, setTags] = useState([]);
  const [newTag, setNewTag] = useState('');
  const [isEnrichingMetadata, setIsEnrichingMetadata] = useState(false);
  const [collections, setCollections] = useState([]);
  const [bookCollections, setBookCollections] = useState([]);
  const [tagSuggestions, setTagSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [similarBooks, setSimilarBooks] = useState([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryAvailable, setSummaryAvailable] = useState(false);

  useEffect(() => {
    setEditedBook(book || {});
    setSummary(null);
    if (book?.id) {
      fetchTags(book.id);
      fetchCollections();
      fetchBookCollections(book.id);
      fetchSimilarBooks(book.id);
      fetchSummary(book.id);
      checkSummaryAvailability();
    }
  }, [book]);

  const fetchTags = async (bookId) => {
    try {
      const response = await fetch(`http://localhost:3001/api/books/${bookId}/tags`);
      const data = await response.json();
      setTags(data.tags || []);
    } catch (error) {
      console.error('Failed to fetch tags:', error);
    }
  };

  const fetchCollections = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/collections');
      const data = await response.json();
      setCollections(data.collections || []);
    } catch (error) {
      console.error('Failed to fetch collections:', error);
    }
  };

  const fetchBookCollections = async (bookId) => {
    try {
      const response = await fetch(`http://localhost:3001/api/books/${bookId}/collections`);
      const data = await response.json();
      setBookCollections(data.collections || []);
    } catch (error) {
      console.error('Failed to fetch book collections:', error);
    }
  };

  const toggleCollection = async (collectionId) => {
    if (!book?.id) return;

    const isInCollection = bookCollections.some(c => c.id === collectionId);

    try {
      if (isInCollection) {
        // Remove from collection
        await fetch(`http://localhost:3001/api/collections/${collectionId}/books/${book.id}`, {
          method: 'DELETE'
        });
        setBookCollections(bookCollections.filter(c => c.id !== collectionId));
      } else {
        // Add to collection
        await fetch(`http://localhost:3001/api/collections/${collectionId}/books`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookIds: [book.id] })
        });
        const collection = collections.find(c => c.id === collectionId);
        if (collection) {
          setBookCollections([...bookCollections, collection]);
        }
      }

      // Trigger collection refresh with a small delay to ensure DB is updated
      if (onCollectionChange) {
        setTimeout(() => {
          onCollectionChange();
        }, 100);
      }
    } catch (error) {
      console.error('Failed to update collection:', error);
    }
  };

  const fetchSimilarBooks = async (bookId) => {
    setLoadingSimilar(true);
    try {
      const response = await fetch(`http://localhost:3001/api/search/similar/${bookId}?limit=5`);
      const data = await response.json();
      setSimilarBooks(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to fetch similar books:', error);
      setSimilarBooks([]);
    } finally {
      setLoadingSimilar(false);
    }
  };

  const fetchSummary = async (bookId) => {
    try {
      const response = await fetch(`http://localhost:3001/api/summaries/${bookId}`);
      if (response.ok) {
        const data = await response.json();
        setSummary(data);
      } else {
        setSummary(null);
      }
    } catch (error) {
      setSummary(null);
    }
  };

  const checkSummaryAvailability = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/summaries/status');
      const data = await response.json();
      setSummaryAvailable(data.available);
    } catch {
      setSummaryAvailable(false);
    }
  };

  const handleGenerateSummary = async (force = false) => {
    if (!book?.id) return;
    setLoadingSummary(true);
    try {
      const response = await fetch(`http://localhost:3001/api/summaries/${book.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force })
      });
      const data = await response.json();
      if (data.error) {
        alert(`Summary generation failed: ${data.error}`);
      } else {
        setSummary({
          summary: data.summary,
          summary_short: data.summary_short,
          strategy: data.strategy,
          model_name: data.model
        });
      }
    } catch (error) {
      console.error('Failed to generate summary:', error);
      alert('Failed to generate summary. Please try again.');
    } finally {
      setLoadingSummary(false);
    }
  };

  const fetchTagSuggestions = async () => {
    if (!book?.id) return;

    setLoadingSuggestions(true);
    try {
      const response = await fetch(`http://localhost:3001/api/auto-tags/suggestions/${book.id}`);
      const data = await response.json();

      if (data.success && data.suggestions) {
        setTagSuggestions(data.suggestions);
      }
    } catch (error) {
      console.error('Failed to fetch tag suggestions:', error);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const applyTagSuggestion = async (tagName) => {
    if (!book?.id) return;

    try {
      const response = await fetch(`http://localhost:3001/api/auto-tags/apply/${book.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: [tagName] })
      });

      const data = await response.json();

      if (data.success) {
        // Refresh tags to show the new one
        fetchTags(book.id);
        // Remove the applied suggestion from the list
        setTagSuggestions(tagSuggestions.filter(s => s !== tagName));
      }
    } catch (error) {
      console.error('Failed to apply tag suggestion:', error);
    }
  };

  const applyAllSuggestions = async () => {
    if (!book?.id || tagSuggestions.length === 0) return;

    try {
      const response = await fetch(`http://localhost:3001/api/auto-tags/apply/${book.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: tagSuggestions })
      });

      const data = await response.json();

      if (data.success) {
        // Refresh tags to show the new ones
        fetchTags(book.id);
        // Clear all suggestions
        setTagSuggestions([]);
      }
    } catch (error) {
      console.error('Failed to apply tag suggestions:', error);
    }
  };

  const handleSave = async () => {
    try {
      // Only send fields that were actually edited, don't include thumbnail_path
      // unless it was explicitly changed
      const fieldsToUpdate = { ...editedBook };

      // Remove thumbnail_path if it's not being explicitly updated
      // This prevents accidentally setting it to undefined/null
      if (!('thumbnail_path' in editedBook)) {
        delete fieldsToUpdate.thumbnail_path;
      }

      const response = await fetch(`http://localhost:3001/api/books/${book.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fieldsToUpdate),
      });

      if (response.ok) {
        const updatedBook = await response.json();
        // Merge with current book to ensure we have all fields
        const mergedBook = { ...book, ...updatedBook };
        onUpdate(mergedBook);
        setIsEditing(false);
      }
    } catch (error) {
      console.error('Failed to update book:', error);
    }
  };

  const handleAddTag = async () => {
    if (!newTag.trim()) return;

    try {
      const response = await fetch(`http://localhost:3001/api/books/${book.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: newTag.trim() }),
      });

      if (response.ok) {
        fetchTags(book.id);
        setNewTag('');
      }
    } catch (error) {
      console.error('Failed to add tag:', error);
    }
  };

  const handleRemoveTag = async (tagId) => {
    try {
      const response = await fetch(`http://localhost:3001/api/books/${book.id}/tags/${tagId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setTags(tags.filter(tag => tag.id !== tagId));
      }
    } catch (error) {
      console.error('Failed to remove tag:', error);
    }
  };

  const handleOpenFile = () => {
    if (book?.file_path) {
      fetch(`http://localhost:3001/api/books/${book.id}/open`, {
        method: 'POST',
      });
    }
  };

  const handleEnrichMetadata = async () => {
    if (!book?.id) return;

    setIsEnrichingMetadata(true);
    try {
      const response = await fetch(`http://localhost:3001/api/books/${book.id}/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceRefresh: true }),
      });

      const data = await response.json();

      if (data.success && data.book) {
        // Merge enriched metadata with existing book data to preserve thumbnail
        const updatedBook = {
          ...book,
          ...data.book,
          thumbnail_path: book.thumbnail_path || data.book.thumbnail_path // Preserve original thumbnail
        };

        // Update the book with enriched metadata
        onUpdate(updatedBook);
        setEditedBook(updatedBook);

        // Trigger collection refresh if needed
        if (onCollectionChange) {
          onCollectionChange();
        }

        // Show success message
        alert(`Metadata enriched successfully!\nSource: ${data.book.metadata_source || 'Multiple sources'}`);
      } else {
        alert(data.message || 'No additional metadata found for this book');
      }
    } catch (error) {
      console.error('Failed to enrich metadata:', error);
      alert('Failed to enrich metadata. Please try again.');
    } finally {
      setIsEnrichingMetadata(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-2xl font-bold text-gray-800">Book Details</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            ✕
          </button>
        </div>

        {book && (
          <div className="space-y-4">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              {isEditing ? (
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={editedBook.title || ''}
                  onChange={(e) => setEditedBook({ ...editedBook, title: e.target.value })}
                />
              ) : (
                <p className="text-gray-900">{book.title || 'Untitled'}</p>
              )}
            </div>

            {/* Author */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Author</label>
              {isEditing ? (
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={editedBook.author || ''}
                  onChange={(e) => setEditedBook({ ...editedBook, author: e.target.value })}
                />
              ) : (
                <p className="text-gray-900">{book.author || 'Unknown Author'}</p>
              )}
            </div>

            {/* ISBN and Publisher */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ISBN</label>
                {isEditing ? (
                  <input
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={editedBook.isbn || ''}
                    onChange={(e) => setEditedBook({ ...editedBook, isbn: e.target.value })}
                    placeholder="978-0-123456-78-9"
                  />
                ) : (
                  <p className="text-gray-900 font-mono">{book.isbn || 'Not available'}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Publisher</label>
                {isEditing ? (
                  <input
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={editedBook.publisher || ''}
                    onChange={(e) => setEditedBook({ ...editedBook, publisher: e.target.value })}
                    placeholder="Publisher name"
                  />
                ) : (
                  <p className="text-gray-900">{book.publisher || 'Unknown'}</p>
                )}
              </div>
            </div>

            {/* Edition and Description */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Edition</label>
                {isEditing ? (
                  <input
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={editedBook.edition || ''}
                    onChange={(e) => setEditedBook({ ...editedBook, edition: e.target.value })}
                    placeholder="e.g. 2nd Edition"
                  />
                ) : (
                  <p className="text-gray-900">{book.edition || 'Not specified'}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Publication Year</label>
                {isEditing ? (
                  <input
                    type="number"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={editedBook.publication_year || ''}
                    onChange={(e) => setEditedBook({ ...editedBook, publication_year: e.target.value ? parseInt(e.target.value) : null })}
                    placeholder="e.g. 2024"
                    min="1900"
                    max={new Date().getFullYear()}
                  />
                ) : (
                  <p className="text-gray-900">{book.publication_year || 'Unknown'}</p>
                )}
              </div>
            </div>

            {/* Description */}
            {(book.description || isEditing) && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                {isEditing ? (
                  <textarea
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={editedBook.description || ''}
                    onChange={(e) => setEditedBook({ ...editedBook, description: e.target.value })}
                    placeholder="Book description..."
                    rows="3"
                  />
                ) : (
                  <p className="text-gray-900 text-sm">{book.description}</p>
                )}
              </div>
            )}

            {/* AI Summary */}
            <div className="pt-2">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">AI Summary</label>
                <div className="flex items-center gap-2">
                  {summary && (
                    <span className="text-xs text-gray-400">
                      {summary.model_name === 'extractive-local' ? 'Excerpt' : 'AI'} · {summary.strategy}
                    </span>
                  )}
                  {summary ? (
                    <button
                      onClick={() => handleGenerateSummary(true)}
                      disabled={loadingSummary}
                      className="px-3 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50"
                    >
                      {loadingSummary ? 'Generating...' : 'Regenerate'}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleGenerateSummary(false)}
                      disabled={loadingSummary}
                      className="px-3 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50"
                    >
                      {loadingSummary ? 'Generating...' : summaryAvailable ? 'Generate AI Summary' : 'Generate Summary'}
                    </button>
                  )}
                </div>
              </div>
              {loadingSummary && (
                <div className="flex items-center gap-2 p-3 bg-purple-50 rounded-md">
                  <div className="w-4 h-4 border-t-2 border-purple-500 border-solid rounded-full animate-spin"></div>
                  <span className="text-sm text-purple-700">Generating summary...</span>
                </div>
              )}
              {summary && !loadingSummary && (
                <div className="p-3 bg-gray-50 rounded-md">
                  {summary.summary_short && (
                    <p className="text-sm font-medium text-gray-800 mb-2 italic">
                      {summary.summary_short}
                    </p>
                  )}
                  <div className="text-sm text-gray-700 whitespace-pre-line">
                    {summary.summary}
                  </div>
                </div>
              )}
              {!summary && !loadingSummary && !summaryAvailable && (
                <p className="text-xs text-gray-400 italic">
                  Set ANTHROPIC_API_KEY in .env for AI-powered summaries, or click Generate for an extractive summary.
                </p>
              )}
            </div>

            {/* Metadata Grid */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
                {isEditing ? (
                  <select
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={editedBook.language || ''}
                    onChange={(e) => setEditedBook({ ...editedBook, language: e.target.value })}
                  >
                    <option value="">Unknown</option>
                    <option value="Russian">Russian</option>
                    <option value="English">English</option>
                    <option value="Ukrainian">Ukrainian</option>
                    <option value="Other">Other</option>
                  </select>
                ) : (
                  <p className="text-gray-900">{book.language || 'Unknown'}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Pages</label>
                <p className="text-gray-900">{book.page_count || 'Unknown'}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">PDF Type</label>
                <p className="text-gray-900">{book.pdf_type || 'Unknown'}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">File Size</label>
                <p className="text-gray-900">
                  {book.file_size ? `${(book.file_size / 1024 / 1024).toFixed(2)} MB` : 'Unknown'}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date Added</label>
                <p className="text-gray-900">
                  {book.date_added ? new Date(book.date_added).toLocaleDateString() : 'Unknown'}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Last Modified</label>
                <p className="text-gray-900">
                  {book.last_modified ? new Date(book.last_modified).toLocaleDateString() : 'Unknown'}
                </p>
              </div>
            </div>

            {/* File Path */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">File Path</label>
              <p className="text-gray-600 text-sm break-all">{book.file_path}</p>
            </div>

            {/* Adult Content Flag */}
            {isEditing && (
              <div className="flex items-center p-3 bg-orange-50 border border-orange-200 rounded-md">
                <input
                  type="checkbox"
                  id="is_adult"
                  checked={editedBook.is_adult === 1}
                  onChange={(e) => setEditedBook({ ...editedBook, is_adult: e.target.checked ? 1 : 0 })}
                  className="h-4 w-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded"
                />
                <label htmlFor="is_adult" className="ml-2 block text-sm text-gray-900">
                  <span className="font-medium">Mark as Adult Content</span>
                  <span className="block text-xs text-gray-500 mt-1">
                    Adult books will be hidden when "Hide Adult Content" is enabled in preferences
                  </span>
                </label>
              </div>
            )}

            {/* Tags */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Tags</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {tags.map(tag => (
                  <span
                    key={tag.id}
                    className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm flex items-center gap-1"
                  >
                    {tag.name}
                    {isEditing && (
                      <button
                        onClick={() => handleRemoveTag(tag.id)}
                        className="ml-1 text-blue-600 hover:text-blue-800"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {isEditing && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Add a tag..."
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAddTag()}
                  />
                  <button
                    onClick={handleAddTag}
                    className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                  >
                    Add
                  </button>
                  <button
                    onClick={fetchTagSuggestions}
                    disabled={loadingSuggestions}
                    className="px-4 py-2 bg-purple-500 text-white rounded-md hover:bg-purple-600 disabled:opacity-50"
                  >
                    {loadingSuggestions ? 'Loading...' : 'Suggest'}
                  </button>
                </div>
              )}

              {/* Tag Suggestions */}
              {tagSuggestions.length > 0 && (
                <div className="mt-3 p-3 bg-purple-50 rounded-md border border-purple-200">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium text-gray-700">Suggested Tags:</span>
                    <button
                      onClick={applyAllSuggestions}
                      className="text-xs px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
                    >
                      Apply All
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {tagSuggestions.map(suggestion => (
                      <button
                        key={suggestion}
                        onClick={() => applyTagSuggestion(suggestion)}
                        className="px-3 py-1 bg-white border border-purple-300 text-purple-800 rounded-full text-sm hover:bg-purple-100 transition-colors"
                        title="Click to add this tag"
                      >
                        + {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Collections */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Collections</label>
              <div className="flex flex-wrap gap-2">
                {collections.map(collection => {
                  const isInCollection = bookCollections.some(c => c.id === collection.id);
                  return (
                    <button
                      key={collection.id}
                      onClick={() => toggleCollection(collection.id)}
                      className={`px-4 py-2 rounded-lg border-2 transition-all ${
                        isInCollection
                          ? 'bg-blue-500 text-white border-blue-500'
                          : 'bg-white text-gray-700 border-gray-300 hover:border-blue-500'
                      }`}
                    >
                      <span className="mr-2">{collection.icon || '📁'}</span>
                      {collection.name}
                      {isInCollection && <span className="ml-2">✓</span>}
                    </button>
                  );
                })}
              </div>
              {collections.length === 0 && (
                <p className="text-gray-500 text-sm italic">No collections available</p>
              )}
            </div>

            {/* Status Indicators */}
            <div className="flex gap-4">
              {book.needs_review === 1 && (
                <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm">
                  ⚠️ Needs Review
                </span>
              )}
              {book.metadata_source && (
                <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">
                  📚 {book.metadata_source}
                </span>
              )}
              {book.average_rating && (
                <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                  ⭐ {book.average_rating.toFixed(1)}
                </span>
              )}
            </div>

            {/* Categories if available */}
            {book.categories && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Categories</label>
                <div className="flex flex-wrap gap-2">
                  {JSON.parse(book.categories).map((category, index) => (
                    <span key={index} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-sm">
                      {category}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Reading Progress Section */}
            {book && (
              <div className="pt-4 border-t">
                <ReadingProgress
                  book={book}
                  onUpdate={() => {
                    // Optionally refresh book data if needed
                    console.log('Progress updated');
                  }}
                />
              </div>
            )}

            {/* Similar Books */}
            {similarBooks.length > 0 && (
              <div className="pt-4 border-t">
                <label className="block text-sm font-medium text-gray-700 mb-2">Similar Books</label>
                <div className="space-y-2">
                  {similarBooks.map(similar => (
                    <div
                      key={similar.id}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => {
                        // Navigate to similar book
                        window.location.href = `#book-${similar.id}`;
                      }}
                    >
                      {similar.thumbnail_path && (
                        <img
                          src={`http://localhost:3001${similar.thumbnail_path}`}
                          alt={similar.title}
                          className="w-8 h-10 object-cover rounded"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{similar.title}</p>
                        {similar.author && (
                          <p className="text-xs text-gray-500 truncate">{similar.author}</p>
                        )}
                      </div>
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs whitespace-nowrap">
                        {Math.round(similar.similarity * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {loadingSimilar && (
              <div className="pt-4 border-t">
                <p className="text-sm text-gray-500">Finding similar books...</p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-between pt-4 border-t">
              <div className="flex gap-2">
                <button
                  onClick={handleOpenFile}
                  className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600"
                >
                  Open PDF
                </button>

                {onRead && (
                  <button
                    onClick={onRead}
                    className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                  >
                    📖 Read
                  </button>
                )}

                <button
                  onClick={handleEnrichMetadata}
                  disabled={isEnrichingMetadata}
                  className={`px-4 py-2 rounded-md text-white ${
                    isEnrichingMetadata
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-purple-500 hover:bg-purple-600'
                  }`}
                >
                  {isEnrichingMetadata ? 'Fetching...' : 'Fetch Metadata'}
                </button>
              </div>

              <div className="flex gap-2">
                {isEditing ? (
                  <>
                    <button
                      onClick={() => setIsEditing(false)}
                      className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600"
                    >
                      Save
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                  >
                    Edit
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default BookDetailModal;