import React, { useState, useEffect } from 'react';

function SearchResultsModal({ isOpen, onClose, book, searchQuery, searchType = 'any', isDark }) {
  const [occurrences, setOccurrences] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedPage, setSelectedPage] = useState(null);
  const [pageOffset, setPageOffset] = useState(0);

  useEffect(() => {
    if (isOpen && book && searchQuery) {
      fetchOccurrences();
    }
  }, [isOpen, book, searchQuery, searchType]);

  const fetchOccurrences = async () => {
    setLoading(true);
    try {
      // Use phrase search for "Exact phrase" mode or multi-word queries
      const matchType = searchType === 'phrase' || searchQuery.includes(' ') ? 'phrase' : searchType;
      const response = await fetch(
        `http://localhost:3001/api/search/books/${book.id}/occurrences?q=${encodeURIComponent(searchQuery)}&matchType=${matchType}`
      );
      const data = await response.json();
      console.log('Occurrences data:', data);
      setOccurrences(data.occurrences || []);
      setPageOffset(data.pageOffset || 0);
    } catch (error) {
      console.error('Error fetching occurrences:', error);
      setOccurrences([]);
    } finally {
      setLoading(false);
    }
  };


  const openPDFAtPage = (pageNumber) => {
    // pageNumber is the physical page from database
    // Simply open at that page number without any adjustments
    const pdfPath = book.file_path || book.filePath || '';
    if (pdfPath) {
      // Use the /pdf/ route to serve the PDF file
      // Add search parameter to highlight the search term
      const searchParam = searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : '';
      window.open(`http://localhost:3001/pdf${pdfPath}#page=${pageNumber}${searchParam}`, '_blank');
    } else {
      console.error('No file path available for book');
    }
    setSelectedPage(pageNumber);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-sm">
      <div
        className={`
          bg-surface text-ink
          rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-hidden
        `}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-hairline">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-semibold">
                Search Results in "{book?.title || 'Untitled'}"
              </h2>
              <p className="text-sm text-ink-faint mt-1">
                Found "{searchQuery}" in {occurrences.length} pages
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-ink-faint transition-colors hover:text-ink"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto" style={{ maxHeight: 'calc(80vh - 120px)' }}>
          {loading ? (
            <div className="flex justify-center items-center py-8">
              <div className="w-8 h-8 border-t-2 border-accent border-solid rounded-full animate-spin"></div>
            </div>
          ) : (
            <div className="space-y-4">
              {occurrences.length === 0 ? (
                <p className="text-center text-ink-faint py-8">
                  No occurrences found
                </p>
              ) : (
                occurrences.map((occurrence, index) => (
                  <div
                    key={index}
                    className={`
                      p-4 rounded-lg border cursor-pointer transition-all
                      border-hairline hover:bg-surface-hover
                      ${selectedPage === occurrence.pageNumber ? 'ring-2 ring-blue-500' : ''}
                    `}
                    onClick={() => openPDFAtPage(occurrence.pageNumber)}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-sm font-semibold text-accent-ink">
                        Page {occurrence.pageNumber}
                      </span>
                      <span className="text-xs text-ink-faint">
                        {occurrence.occurrenceCount} occurrence{occurrence.occurrenceCount !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {/* Snippet with highlighted search terms */}
                    <div
                      className="text-sm text-ink-muted line-clamp-3"
                      dangerouslySetInnerHTML={{ __html: occurrence.snippet }}
                    />

                    <button
                      className="mt-2 text-xs text-blue-500 hover:text-accent-ink flex items-center gap-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        openPDFAtPage(occurrence.pageNumber);
                      }}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      Open at this page
                    </button>
                  </div>
                ))
              )}

              {occurrences.length > 0 && occurrences.length >= 50 && (
                <div className="text-center py-4">
                  <p className="text-sm text-ink-faint">
                    Showing first 50 occurrences. Open the book to see all results.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-hairline flex justify-between items-center">
          <div className="text-sm text-ink-faint">
            {occurrences.reduce((sum, o) => sum + (o.occurrenceCount || 1), 0)} total occurrences
          </div>
          <button
            onClick={() => {
              const pdfPath = book.file_path || book.filePath || '';
              if (pdfPath) {
                window.open(`http://localhost:3001/pdf${pdfPath}`, '_blank');
              }
            }}
            className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-hover"
          >
            Open Book
          </button>
        </div>
      </div>
    </div>
  );
}

export default SearchResultsModal;