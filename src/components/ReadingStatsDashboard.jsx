import React, { useState, useEffect } from 'react';

function ReadingStatsDashboard({ isDark }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentlyReadingBooks, setCurrentlyReadingBooks] = useState([]);
  const [recentlyReadBooks, setRecentlyReadBooks] = useState([]);

  useEffect(() => {
    fetchStats();
    fetchCurrentlyReading();
  }, []);

  const fetchStats = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/progress/reading/stats');
      const data = await response.json();
      setStats(data);
      setRecentlyReadBooks(data.recently_read || []);
    } catch (error) {
      console.error('Error fetching reading stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCurrentlyReading = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/progress/reading/all?status=reading');
      const data = await response.json();
      setCurrentlyReadingBooks(data);
    } catch (error) {
      console.error('Error fetching currently reading books:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-lg text-ink-faint">Loading reading statistics...</div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="text-center text-ink-faint">
        No reading statistics available
      </div>
    );
  }

  const completionRate = stats.books_started > 0 ?
    Math.round((stats.books_finished / stats.books_started) * 100) : 0;

  const averageReadingTime = stats.books_finished > 0 ?
    Math.round(stats.total_reading_time / stats.books_finished) : 0;

  return (
    <div className="rounded-xl bg-surface ring-1 ring-hairline shadow-card p-6">
      <h2 className="text-2xl font-bold text-ink mb-6">
        📊 Reading Statistics
      </h2>

      {/* Summary Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-accent-soft/20 p-4 rounded-lg">
          <div className="text-accent-ink text-sm font-medium mb-1">
            Currently Reading
          </div>
          <div className="text-3xl font-bold text-blue-900 dark:text-accent-ink">
            {stats.currently_reading || 0}
          </div>
        </div>

        <div className="bg-emerald-500/10/20 p-4 rounded-lg">
          <div className="text-green-600 dark:text-green-400 text-sm font-medium mb-1">
            Books Finished
          </div>
          <div className="text-3xl font-bold text-green-900 dark:text-green-100">
            {stats.books_finished || 0}
          </div>
        </div>

        <div className="bg-accent-soft dark:bg-accent/20 p-4 rounded-lg">
          <div className="text-accent-ink dark:text-accent-ink text-sm font-medium mb-1">
            Total Pages Read
          </div>
          <div className="text-3xl font-bold text-accent-ink dark:text-accent-ink">
            {stats.total_pages_read?.toLocaleString() || 0}
          </div>
        </div>

        <div className="bg-orange-500/100/10/20 p-4 rounded-lg">
          <div className="text-orange-600 dark:text-orange-400 text-sm font-medium mb-1">
            Completion Rate
          </div>
          <div className="text-3xl font-bold text-orange-900 dark:text-orange-100">
            {completionRate}%
          </div>
        </div>
      </div>

      {/* Additional Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="text-center p-4 border border-hairline rounded-lg">
          <div className="text-4xl mb-2">📚</div>
          <div className="text-2xl font-bold text-ink">
            {stats.books_started || 0}
          </div>
          <div className="text-sm text-ink-muted">Books Started</div>
        </div>

        <div className="text-center p-4 border border-hairline rounded-lg">
          <div className="text-4xl mb-2">⏱️</div>
          <div className="text-2xl font-bold text-ink">
            {Math.round(stats.total_reading_time / 60) || 0}h
          </div>
          <div className="text-sm text-ink-muted">Total Reading Time</div>
        </div>

        <div className="text-center p-4 border border-hairline rounded-lg">
          <div className="text-4xl mb-2">📈</div>
          <div className="text-2xl font-bold text-ink">
            {Math.round(stats.average_completion) || 0}%
          </div>
          <div className="text-sm text-ink-muted">Average Progress</div>
        </div>
      </div>

      {/* Currently Reading Section */}
      {currentlyReadingBooks.length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-ink mb-4">
            📖 Currently Reading
          </h3>
          <div className="space-y-3">
            {currentlyReadingBooks.slice(0, 5).map(book => (
              <div
                key={book.id}
                className="flex items-center justify-between p-3 bg-surface-sunken rounded-lg"
              >
                <div className="flex-1">
                  <div className="font-medium text-ink">
                    {book.title}
                  </div>
                  <div className="text-sm text-ink-muted">
                    {book.author} • Page {book.current_page || 0} of {book.total_pages || 0}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-lg font-bold text-accent-ink">
                      {Math.round(book.percentage || 0)}%
                    </div>
                  </div>
                  <div className="w-24 bg-surface-sunken rounded-full h-2">
                    <div
                      className="bg-accent h-2 rounded-full"
                      style={{ width: `${book.percentage || 0}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recently Read Section */}
      {recentlyReadBooks.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-ink mb-4">
            🕒 Recently Read
          </h3>
          <div className="space-y-2">
            {recentlyReadBooks.map(book => (
              <div
                key={book.id}
                className="flex items-center justify-between p-2 hover:bg-surface-hover rounded"
              >
                <div>
                  <div className="font-medium text-ink text-sm">
                    {book.title}
                  </div>
                  <div className="text-xs text-ink-faint">
                    {book.author}
                  </div>
                </div>
                <div className="text-sm text-ink-muted">
                  {new Date(book.last_read).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No reading activity message */}
      {stats.books_started === 0 && (
        <div className="text-center py-8">
          <div className="text-6xl mb-4">📚</div>
          <div className="text-xl text-ink-muted">
            Start reading a book to see your statistics!
          </div>
          <div className="text-sm text-ink-faint mt-2">
            Click on any book and use the "Start Reading" button to begin tracking your progress.
          </div>
        </div>
      )}
    </div>
  );
}

export default ReadingStatsDashboard;