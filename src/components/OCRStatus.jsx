import React, { useState, useEffect } from 'react';

const OCRStatus = () => {
  const [stats, setStats] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [queueItems, setQueueItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(null);

  useEffect(() => {
    fetchStats();

    // Auto-refresh every 5 seconds when there are processing jobs
    const interval = setInterval(() => {
      fetchStats();
    }, 5000);
    setRefreshInterval(interval);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, []);

  const fetchStats = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/ocr-queue/stats');
      const data = await response.json();
      setStats(data);
    } catch (error) {
      console.error('Failed to fetch OCR stats:', error);
    }
  };

  const fetchQueueItems = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/ocr-queue/items');
      const data = await response.json();
      setQueueItems(data.items || []);
    } catch (error) {
      console.error('Failed to fetch queue items:', error);
    }
  };

  const startBatchOCR = async () => {
    if (!confirm('Start OCR processing for all scanned PDFs? This may take a while.')) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('http://localhost:3001/api/ocr-queue/batch', {
        method: 'POST'
      });
      const data = await response.json();

      if (data.success) {
        alert(`Added ${data.queued} books to OCR queue`);
        fetchStats();
      } else {
        alert(data.message || 'Failed to start batch OCR');
      }
    } catch (error) {
      console.error('Failed to start batch OCR:', error);
      alert('Failed to start batch OCR');
    } finally {
      setLoading(false);
    }
  };

  const clearCompleted = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/ocr-queue/clear-completed', {
        method: 'POST'
      });
      const data = await response.json();

      if (data.success) {
        alert(`Cleared ${data.cleared} completed jobs`);
        fetchStats();
        fetchQueueItems();
      }
    } catch (error) {
      console.error('Failed to clear completed jobs:', error);
    }
  };

  const resetFailed = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/ocr-queue/reset-failed', {
        method: 'POST'
      });
      const data = await response.json();

      if (data.success) {
        alert('Reset failed jobs for retry');
        fetchStats();
        fetchQueueItems();
      }
    } catch (error) {
      console.error('Failed to reset failed jobs:', error);
    }
  };

  const removeFromQueue = async (bookId) => {
    try {
      const response = await fetch(`http://localhost:3001/api/ocr-queue/remove/${bookId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        fetchStats();
        fetchQueueItems();
      }
    } catch (error) {
      console.error('Failed to remove from queue:', error);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'processing': return 'text-blue-600';
      case 'completed': return 'text-green-600';
      case 'failed': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'processing': return '⚙️';
      case 'completed': return '✅';
      case 'failed': return '❌';
      default: return '⏳';
    }
  };

  if (!stats) return null;

  const totalInQueue = stats.queue.pending + stats.queue.processing;
  const hasActivity = stats.queue.processing > 0;

  return (
    <>
      {/* OCR Status Indicator */}
      <div className="flex items-center space-x-4">
        <button
          onClick={() => {
            setShowDetails(true);
            fetchQueueItems();
          }}
          className="flex items-center space-x-2 px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
        >
          <div className="flex items-center space-x-2">
            {hasActivity && (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></div>
            )}
            <span className="text-sm font-medium">
              OCR Queue
            </span>
            {totalInQueue > 0 && (
              <span className="px-2 py-0.5 text-xs bg-blue-500 text-white rounded-full">
                {totalInQueue}
              </span>
            )}
          </div>
        </button>

        {stats.booksNeedingOCR > 0 && (
          <button
            onClick={startBatchOCR}
            disabled={loading}
            className="px-3 py-1 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Starting...' : `Start OCR (${stats.booksNeedingOCR} books)`}
          </button>
        )}
      </div>

      {/* OCR Queue Details Modal */}
      {showDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                OCR Processing Queue
              </h2>
              <button
                onClick={() => setShowDetails(false)}
                className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Statistics */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded">
                <div className="text-2xl font-bold text-yellow-600">{stats.queue.pending}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Pending</div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded">
                <div className="text-2xl font-bold text-blue-600">{stats.queue.processing}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Processing</div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded">
                <div className="text-2xl font-bold text-green-600">{stats.queue.completed}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Completed</div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded">
                <div className="text-2xl font-bold text-red-600">{stats.queue.failed}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Failed</div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex space-x-2 mb-4">
              {stats.queue.completed > 0 && (
                <button
                  onClick={clearCompleted}
                  className="px-3 py-1 bg-green-500 text-white text-sm rounded hover:bg-green-600"
                >
                  Clear Completed
                </button>
              )}
              {stats.queue.failed > 0 && (
                <button
                  onClick={resetFailed}
                  className="px-3 py-1 bg-orange-500 text-white text-sm rounded hover:bg-orange-600"
                >
                  Retry Failed
                </button>
              )}
              <button
                onClick={() => {
                  fetchStats();
                  fetchQueueItems();
                }}
                className="px-3 py-1 bg-gray-500 text-white text-sm rounded hover:bg-gray-600"
              >
                Refresh
              </button>
            </div>

            {/* Queue Items */}
            <div className="flex-1 overflow-y-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b dark:border-gray-700">
                    <th className="text-left py-2">Status</th>
                    <th className="text-left py-2">Title</th>
                    <th className="text-left py-2">Author</th>
                    <th className="text-left py-2">Type</th>
                    <th className="text-left py-2">Confidence</th>
                    <th className="text-left py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {queueItems.map(item => (
                    <tr key={item.id} className="border-b dark:border-gray-700">
                      <td className="py-2">
                        <span className={`${getStatusColor(item.status)} font-medium`}>
                          {getStatusIcon(item.status)} {item.status}
                        </span>
                      </td>
                      <td className="py-2 text-sm">{item.title}</td>
                      <td className="py-2 text-sm">{item.author || '-'}</td>
                      <td className="py-2 text-sm">{item.pdf_type}</td>
                      <td className="py-2 text-sm">
                        {item.ocr_confidence ? `${item.ocr_confidence}%` : '-'}
                      </td>
                      <td className="py-2">
                        {item.status !== 'completed' && (
                          <button
                            onClick={() => removeFromQueue(item.book_id)}
                            className="text-red-500 hover:text-red-700 text-sm"
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {queueItems.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  No items in queue
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default OCRStatus;