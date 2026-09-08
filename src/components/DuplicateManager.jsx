import React, { useState, useEffect } from 'react';

const DuplicateManager = () => {
  const [duplicateGroups, setDuplicateGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [keepBookId, setKeepBookId] = useState(null);

  useEffect(() => {
    if (showModal) {
      fetchDuplicates();
    }
  }, [showModal]);

  const fetchDuplicates = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:3001/api/duplicates');
      const data = await response.json();

      if (data.success) {
        setDuplicateGroups(data.groups || []);
      }
    } catch (error) {
      console.error('Failed to fetch duplicates:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMerge = async (group) => {
    if (!keepBookId) {
      alert('Please select a book to keep');
      return;
    }

    const removeBookIds = group.duplicates
      .filter(d => d.book.id !== keepBookId)
      .map(d => d.book.id);

    if (removeBookIds.length === 0) {
      alert('No duplicates to merge');
      return;
    }

    if (!confirm(`Merge ${removeBookIds.length} duplicate(s) into the selected book? This cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch('http://localhost:3001/api/duplicates/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keepBookId,
          removeBookIds
        })
      });

      const data = await response.json();

      if (data.success) {
        alert(data.message);
        fetchDuplicates(); // Refresh the list
        setSelectedGroup(null);
        setKeepBookId(null);
      } else {
        alert(data.error || 'Failed to merge duplicates');
      }
    } catch (error) {
      console.error('Failed to merge duplicates:', error);
      alert('Failed to merge duplicates');
    }
  };

  const handleRemove = async (bookId) => {
    if (!confirm('Remove this book from the library? This cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch('http://localhost:3001/api/duplicates/remove', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookIds: [bookId]
        })
      });

      const data = await response.json();

      if (data.success) {
        alert(data.message);
        fetchDuplicates(); // Refresh the list
      } else {
        alert(data.error || 'Failed to remove book');
      }
    } catch (error) {
      console.error('Failed to remove book:', error);
      alert('Failed to remove book');
    }
  };

  const getConfidenceColor = (confidence) => {
    if (confidence >= 0.9) return 'text-red-600 dark:text-red-400';
    if (confidence >= 0.8) return 'text-orange-600 dark:text-orange-400';
    if (confidence >= 0.7) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-gray-600 dark:text-gray-400';
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '-';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  return (
    <>
      {/* Duplicate Detection Button */}
      <button
        onClick={() => setShowModal(true)}
        className="px-3 py-1 bg-purple-500 dark:bg-purple-600 text-white rounded-md text-sm hover:bg-purple-600 dark:hover:bg-purple-700 transition-colors"
      >
        Find Duplicates
      </button>

      {/* Duplicate Manager Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b dark:border-gray-700">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  Duplicate Book Finder
                </h2>
                <button
                  onClick={() => {
                    setShowModal(false);
                    setSelectedGroup(null);
                    setKeepBookId(null);
                  }}
                  className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {loading && (
                <div className="mt-4 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
                  <p className="mt-2 text-gray-600 dark:text-gray-400">Scanning for duplicates...</p>
                </div>
              )}

              {!loading && duplicateGroups.length === 0 && (
                <div className="mt-8 text-center text-gray-600 dark:text-gray-400">
                  <svg className="w-16 h-16 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-lg">No duplicates found!</p>
                  <p className="text-sm mt-2">Your library is clean and organized.</p>
                </div>
              )}

              {!loading && duplicateGroups.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Found {duplicateGroups.length} group(s) with potential duplicates
                  </p>
                </div>
              )}
            </div>

            {!loading && duplicateGroups.length > 0 && (
              <div className="flex-1 overflow-y-auto p-6">
                {duplicateGroups.map((group, index) => (
                  <div key={group.groupId} className="mb-6 border dark:border-gray-700 rounded-lg p-4">
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                        Duplicate Group #{index + 1} ({group.count} books)
                      </h3>
                      {selectedGroup === group.groupId ? (
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleMerge(group)}
                            className="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600"
                          >
                            Merge Selected
                          </button>
                          <button
                            onClick={() => {
                              setSelectedGroup(null);
                              setKeepBookId(null);
                            }}
                            className="px-3 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setSelectedGroup(group.groupId);
                            setKeepBookId(group.duplicates[0].book.id);
                          }}
                          className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
                        >
                          Manage
                        </button>
                      )}
                    </div>

                    <div className="space-y-2">
                      {group.duplicates.map((duplicate) => (
                        <div
                          key={duplicate.book.id}
                          className={`p-3 rounded-lg border ${
                            selectedGroup === group.groupId
                              ? keepBookId === duplicate.book.id
                                ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                                : 'border-gray-300 dark:border-gray-600'
                              : 'border-gray-300 dark:border-gray-600'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-start space-x-3 flex-1">
                              {selectedGroup === group.groupId && (
                                <input
                                  type="radio"
                                  name={`keep-${group.groupId}`}
                                  checked={keepBookId === duplicate.book.id}
                                  onChange={() => setKeepBookId(duplicate.book.id)}
                                  className="mt-1"
                                />
                              )}

                              <div className="flex-1">
                                <div className="flex items-center space-x-2">
                                  <h4 className="font-medium text-gray-900 dark:text-gray-100">
                                    {duplicate.book.title || 'Untitled'}
                                  </h4>
                                  {duplicate.confidence < 1.0 && (
                                    <span className={`text-xs font-medium ${getConfidenceColor(duplicate.confidence)}`}>
                                      {Math.round(duplicate.confidence * 100)}% match
                                    </span>
                                  )}
                                </div>

                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                  {duplicate.book.author || 'Unknown Author'}
                                </p>

                                <div className="flex flex-wrap gap-2 mt-2">
                                  <span className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded">
                                    {duplicate.book.page_count || 0} pages
                                  </span>
                                  <span className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded">
                                    {formatFileSize(duplicate.book.file_size)}
                                  </span>
                                  {duplicate.book.language && (
                                    <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded">
                                      {duplicate.book.language}
                                    </span>
                                  )}
                                  {duplicate.book.pdf_type && (
                                    <span className="text-xs px-2 py-1 bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded">
                                      {duplicate.book.pdf_type}
                                    </span>
                                  )}
                                </div>

                                {duplicate.reasons.length > 0 && (
                                  <div className="mt-2">
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                      Reasons: {duplicate.reasons.join(', ')}
                                    </span>
                                  </div>
                                )}

                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                                  {duplicate.book.file_path}
                                </p>
                              </div>
                            </div>

                            {selectedGroup === group.groupId && keepBookId !== duplicate.book.id && (
                              <button
                                onClick={() => handleRemove(duplicate.book.id)}
                                className="ml-2 text-red-500 hover:text-red-700"
                                title="Remove this book"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {selectedGroup === group.groupId && (
                      <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded">
                        <p className="text-sm text-yellow-800 dark:text-yellow-200">
                          <strong>Instructions:</strong> Select the book you want to keep (green border), then click "Merge Selected".
                          The metadata from removed books will be merged into the kept book.
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default DuplicateManager;