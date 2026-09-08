import React, { useState, useEffect, useCallback } from 'react';

function ReadingProgress({ book, className = '', compact = false, onUpdate }) {
  const [progress, setProgress] = useState(book?.readingProgress || null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [currentPage, setCurrentPage] = useState(book?.readingProgress?.current_page || 0);

  // The book listing carries progress with it, so a grid of cards costs no
  // extra requests. Only fetch when it was not supplied.
  useEffect(() => {
    if (!book?.id) return;

    if (book.readingProgress) {
      setProgress(book.readingProgress);
      setCurrentPage(book.readingProgress.current_page || 0);
      return;
    }

    fetchProgress();
  }, [book?.id, book?.readingProgress]);

  const fetchProgress = async () => {
    try {
      const response = await fetch(`http://localhost:3001/api/progress/books/${book.id}/progress`);
      const data = await response.json();
      setProgress(data);
      setCurrentPage(data.current_page || 0);
    } catch (error) {
      console.error('Error fetching progress:', error);
    }
  };

  const updateProgress = async (newPage) => {
    setLoading(true);
    try {
      const response = await fetch(`http://localhost:3001/api/progress/books/${book.id}/progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_page: newPage,
          total_pages: book.page_count || progress?.total_pages
        })
      });

      if (response.ok) {
        const data = await response.json();
        setProgress(data);
        setCurrentPage(data.current_page);
        setEditing(false);
        if (onUpdate) onUpdate(data);
      }
    } catch (error) {
      console.error('Error updating progress:', error);
    } finally {
      setLoading(false);
    }
  };

  const markAsStarted = async () => {
    try {
      const response = await fetch(`http://localhost:3001/api/progress/books/${book.id}/progress/start`, {
        method: 'POST'
      });

      if (response.ok) {
        fetchProgress();
      }
    } catch (error) {
      console.error('Error marking as started:', error);
    }
  };

  const markAsFinished = async () => {
    try {
      const response = await fetch(`http://localhost:3001/api/progress/books/${book.id}/progress/finish`, {
        method: 'POST'
      });

      if (response.ok) {
        fetchProgress();
      }
    } catch (error) {
      console.error('Error marking as finished:', error);
    }
  };

  const handlePageSubmit = (e) => {
    e.preventDefault();
    const page = parseInt(currentPage);
    if (!isNaN(page) && page >= 0 && page <= (book.page_count || 0)) {
      updateProgress(page);
    }
  };

  const percentage = progress?.percentage || 0;
  const totalPages = progress?.total_pages || book?.page_count || 0;
  const readingStatus = progress?.finished_reading ? 'finished' :
                       progress?.started_reading ? 'reading' : 'not_started';

  if (compact) {
    // Compact view for book cards
    return (
      <div className={`relative ${className}`}>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                percentage === 100 ? 'bg-green-500' :
                percentage > 0 ? 'bg-blue-500' : 'bg-gray-400'
              }`}
              style={{ width: `${percentage}%` }}
            />
          </div>
          <span className="text-xs text-gray-600 dark:text-gray-400">
            {Math.round(percentage)}%
          </span>
        </div>
        {progress?.current_page > 0 && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Page {progress.current_page} of {totalPages}
          </div>
        )}
      </div>
    );
  }

  // Full view for book detail modal
  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg p-4 ${className}`}>
      <div className="flex justify-between items-start mb-3">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Reading Progress
        </h3>
        <div className="flex gap-2">
          {readingStatus === 'not_started' && (
            <button
              onClick={markAsStarted}
              className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Start Reading
            </button>
          )}
          {readingStatus === 'reading' && !editing && (
            <>
              <button
                onClick={() => setEditing(true)}
                className="px-3 py-1 text-sm bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                Update
              </button>
              <button
                onClick={markAsFinished}
                className="px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600"
              >
                Mark as Finished
              </button>
            </>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
          <span>
            {progress?.current_page || 0} / {totalPages} pages
          </span>
          <span>{Math.round(percentage)}%</span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              percentage === 100 ? 'bg-green-500' :
              percentage > 0 ? 'bg-blue-500' : 'bg-gray-400'
            }`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>

      {/* Status badges */}
      <div className="flex gap-2 mb-3">
        {readingStatus === 'finished' && (
          <span className="px-2 py-1 bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100 text-xs rounded">
            Finished
          </span>
        )}
        {readingStatus === 'reading' && (
          <span className="px-2 py-1 bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-100 text-xs rounded">
            Currently Reading
          </span>
        )}
        {progress?.last_read && (
          <span className="px-2 py-1 bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 text-xs rounded">
            Last read: {new Date(progress.last_read).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Edit form */}
      {editing && (
        <form onSubmit={handlePageSubmit} className="mt-3 flex gap-2">
          <input
            type="number"
            value={currentPage}
            onChange={(e) => setCurrentPage(e.target.value)}
            min="0"
            max={totalPages}
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded
                     bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            placeholder="Current page"
            autoFocus
          />
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setCurrentPage(progress?.current_page || 0);
            }}
            className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Reading dates */}
      {(progress?.started_reading || progress?.finished_reading) && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400">
          {progress.started_reading && (
            <div>Started: {new Date(progress.started_reading).toLocaleDateString()}</div>
          )}
          {progress.finished_reading && (
            <div>Finished: {new Date(progress.finished_reading).toLocaleDateString()}</div>
          )}
          {progress.reading_time_minutes > 0 && (
            <div>Reading time: {Math.round(progress.reading_time_minutes / 60)} hours</div>
          )}
        </div>
      )}
    </div>
  );
}

export default ReadingProgress;