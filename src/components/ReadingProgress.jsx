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
          <div className="flex-1 bg-surface-sunken rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                percentage === 100 ? 'bg-emerald-500/100' :
                percentage > 0 ? 'bg-accent' : 'bg-ink-faint'
              }`}
              style={{ width: `${percentage}%` }}
            />
          </div>
          <span className="text-xs text-ink-muted">
            {Math.round(percentage)}%
          </span>
        </div>
        {progress?.current_page > 0 && (
          <div className="text-xs text-ink-faint mt-1">
            Page {progress.current_page} of {totalPages}
          </div>
        )}
      </div>
    );
  }

  // Full view for book detail modal
  return (
    <div className={`rounded-lg bg-surface ring-1 ring-hairline p-4 ${className}`}>
      <div className="flex justify-between items-start mb-3">
        <h3 className="text-lg font-semibold text-ink">
          Reading Progress
        </h3>
        <div className="flex gap-2">
          {readingStatus === 'not_started' && (
            <button
              onClick={markAsStarted}
              className="px-3 py-1 text-sm bg-accent text-white rounded hover:bg-accent-hover"
            >
              Start Reading
            </button>
          )}
          {readingStatus === 'reading' && !editing && (
            <>
              <button
                onClick={() => setEditing(true)}
                className="px-3 py-1 rounded border border-hairline text-sm text-ink-muted hover:bg-surface-hover hover:text-ink"
              >
                Update
              </button>
              <button
                onClick={markAsFinished}
                className="px-3 py-1 text-sm bg-emerald-500/100 text-white rounded hover:bg-green-600"
              >
                Mark as Finished
              </button>
            </>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="flex justify-between text-sm text-ink-muted mb-2">
          <span>
            {progress?.current_page || 0} / {totalPages} pages
          </span>
          <span>{Math.round(percentage)}%</span>
        </div>
        <div className="w-full bg-surface-sunken rounded-full h-3 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              percentage === 100 ? 'bg-emerald-500/100' :
              percentage > 0 ? 'bg-accent' : 'bg-ink-faint'
            }`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>

      {/* Status badges */}
      <div className="flex gap-2 mb-3">
        {readingStatus === 'finished' && (
          <span className="px-2 py-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 dark:bg-green-800 dark:text-green-100 text-xs rounded">
            Finished
          </span>
        )}
        {readingStatus === 'reading' && (
          <span className="px-2 py-1 bg-accent-soft text-accent-ink dark:bg-blue-800 dark:text-accent-ink text-xs rounded">
            Currently Reading
          </span>
        )}
        {progress?.last_read && (
          <span className="px-2 py-1 bg-surface-sunken text-ink-muted text-xs rounded">
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
            className="flex-1 px-3 py-2 border border-hairline rounded bg-surface text-ink"
            placeholder="Current page"
            autoFocus
          />
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setCurrentPage(progress?.current_page || 0);
            }}
            className="px-4 py-2 rounded border border-hairline text-ink-muted hover:bg-surface-hover hover:text-ink"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Reading dates */}
      {(progress?.started_reading || progress?.finished_reading) && (
        <div className="mt-3 pt-3 border-t border-hairline text-sm text-ink-muted">
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