import React, { useState, useEffect } from 'react';
import BookDetailModal from './components/BookDetailModal';
import BookCard from './components/BookCard';
import BulkActionsModal from './components/BulkActionsModal';
import CollectionsSidebar from './components/CollectionsSidebar';
import FullTextSearch from './components/FullTextSearch';
import ReadingProgress from './components/ReadingProgress';
import ReadingStatsDashboard from './components/ReadingStatsDashboard';
import PDFViewer from './components/PDFViewer';
import EpubViewer from './components/EpubViewer';
import DuplicateManager from './components/DuplicateManager';
import PreferencesModal from './components/PreferencesModal';
import useDarkMode from './hooks/useDarkMode';

const PAGE_SIZE = 60;

// The whole library is fetched in one go because filtering, sorting and the
// filter dropdowns all work across the full set in the browser; a page of
// results would give wrong facets and a wrong sort order. The listing is
// lightweight (about 1KB per book) and only PAGE_SIZE cards are rendered at a
// time, so the cost is the transfer, not the DOM.
const LIBRARY_FETCH_LIMIT = 100000;

function App() {
  const { isDark, toggleDarkMode } = useDarkMode();
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBook, setSelectedBook] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Collections state
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [collectionBooks, setCollectionBooks] = useState([]);

  // Multi-select states
  const [selectedBookIds, setSelectedBookIds] = useState(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isBulkActionsModalOpen, setIsBulkActionsModalOpen] = useState(false);

  // Full-text search state
  const [showFullTextSearch, setShowFullTextSearch] = useState(false);

  // Reading stats state
  const [showReadingStats, setShowReadingStats] = useState(false);

  // PDF Viewer state
  const [pdfViewerOpen, setPdfViewerOpen] = useState(false);
  const [currentPdfBook, setCurrentPdfBook] = useState(null);

  // ePUB Viewer state
  const [epubViewerOpen, setEpubViewerOpen] = useState(false);
  const [currentEpubBook, setCurrentEpubBook] = useState(null);

  const [collectionsRefreshKey, setCollectionsRefreshKey] = useState(0);

  // Preferences modal state
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);

  // Number of cards actually rendered. Mounting the whole library at once
  // meant hundreds of cards and images before anything appeared; render a
  // screenful and extend as the sentinel below the grid scrolls into view.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [totalBooks, setTotalBooks] = useState(0);
  const loadMoreRef = React.useRef(null);

  // User preferences state
  const [userPreferences, setUserPreferences] = useState({
    hide_adult_content: false,
    default_view_mode: 'grid',
    default_sort_by: 'date_added',
    default_sort_order: 'desc',
    books_per_page: 50
  });

  // Advanced filtering states
  const [selectedTag, setSelectedTag] = useState('');
  const [selectedAuthor, setSelectedAuthor] = useState('');
  const [selectedFileType, setSelectedFileType] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState('');
  const [sortBy, setSortBy] = useState('title'); // title, date_added, file_size
  const [sortOrder, setSortOrder] = useState('asc'); // asc, desc

  // Calculate stats
  const unprocessedCount = books.filter(book =>
    !book.language || book.language === 'Not scanned'
  ).length;

  // Function to open PDF externally
  const handleOpenPDF = async (bookId) => {
    try {
      const response = await fetch(`http://localhost:3001/api/books/${bookId}/open`, {
        method: 'POST'
      });
      if (!response.ok) {
        console.error('Failed to open PDF');
      }
    } catch (error) {
      console.error('Error opening PDF:', error);
    }
  };

  // Function to open book in appropriate viewer
  const handleReadBook = (book) => {
    // Determine file type from extension
    const ext = book.file_path?.split('.').pop()?.toLowerCase();

    if (ext === 'pdf') {
      setCurrentPdfBook(book);
      setPdfViewerOpen(true);
    } else if (ext === 'epub') {
      setCurrentEpubBook(book);
      setEpubViewerOpen(true);
    }

    setIsModalOpen(false); // Close detail modal if open
  };

  // Legacy function for backward compatibility
  const handleReadPDF = handleReadBook;

  // Extract unique values for filters
  const allTags = [...new Set(books.flatMap(book => book.tags || []))];
  const allAuthors = [...new Set(books.map(book => book.author).filter(Boolean))].sort();
  const allFileTypes = [...new Set(books.map(book => {
    const ext = book.file_path?.split('.').pop()?.toLowerCase();
    return ext;
  }).filter(Boolean))].sort();
  const allLanguages = [...new Set(books.map(book => book.language).filter(Boolean))].sort();

  // Enhanced filtering and sorting
  const filteredAndSortedBooks = React.useMemo(() => {
    // Apply filters
    let filtered = books.filter(book => {
      // Search query filter
      const query = searchQuery.toLowerCase();
      const matchesSearch = !query ||
        (book.title || '').toLowerCase().includes(query) ||
        (book.author || '').toLowerCase().includes(query);

      // Tag filter
      const matchesTags = !selectedTag || book.tags?.includes(selectedTag);

      // Author filter
      const matchesAuthor = !selectedAuthor ||
        book.author === selectedAuthor;

      // File type filter
      const bookFileType = book.file_path?.split('.').pop()?.toLowerCase();
      const matchesFileType = !selectedFileType ||
        bookFileType === selectedFileType;

      // Language filter
      const matchesLanguage = !selectedLanguage ||
        book.language === selectedLanguage;

      // Adult content filter
      const matchesAdultFilter = !userPreferences.hide_adult_content ||
        !book.is_adult || book.is_adult === 0;

      return matchesSearch && matchesTags && matchesAuthor && matchesFileType && matchesLanguage && matchesAdultFilter;
    });

    // Apply sorting
    filtered.sort((a, b) => {
      let compareValue = 0;

      switch (sortBy) {
        case 'title':
          compareValue = (a.title || '').localeCompare(b.title || '');
          break;
        case 'date_added':
          compareValue = new Date(a.date_added || 0) - new Date(b.date_added || 0);
          break;
        case 'file_size':
          compareValue = (a.file_size || 0) - (b.file_size || 0);
          break;
        case 'author':
          compareValue = (a.author || '').localeCompare(b.author || '');
          break;
        default:
          compareValue = 0;
      }

      return sortOrder === 'asc' ? compareValue : -compareValue;
    });

    return filtered;
  }, [books, searchQuery, selectedTag, selectedAuthor, selectedFileType, selectedLanguage, sortBy, sortOrder, userPreferences]);

  const visibleBooks = React.useMemo(
    () => filteredAndSortedBooks.slice(0, visibleCount),
    [filteredAndSortedBooks, visibleCount]
  );

  // A new filter or sort should start from the top again.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, selectedTag, selectedAuthor, selectedFileType, selectedLanguage, sortBy, sortOrder, selectedCollection]);

  // Extend the rendered slice when the sentinel below the grid comes into view.
  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((count) => count + PAGE_SIZE);
        }
      },
      { rootMargin: '400px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleBooks.length, filteredAndSortedBooks.length]);

  // Fetch user preferences on mount
  useEffect(() => {
    const fetchPreferences = async () => {
      try {
        const response = await fetch('http://localhost:3001/api/preferences');
        const data = await response.json();
        setUserPreferences(data);
      } catch (error) {
        console.error('Failed to fetch preferences:', error);
      }
    };

    fetchPreferences();
  }, []);

  useEffect(() => {
    // Auto-refresh to pick up books added by background tasks. The initial
    // load is handled by the selectedCollection effect below.
    const refreshInterval = setInterval(() => {
      loadBooks();
    }, 30000); // Refresh every 30 seconds

    // Set up listeners for Electron menu events if available
    if (window.electronAPI) {
      window.electronAPI.onImportBooks(() => {
        console.log('Import books triggered');
        // TODO: Implement import functionality
      });

      window.electronAPI.onScanLibrary(() => {
        console.log('Scan library triggered');
        loadBooks(); // Just refresh the book list
      });

      window.electronAPI.onOpenPreferences(() => {
        console.log('Open preferences triggered');
        // TODO: Implement preferences modal
      });

      return () => {
        clearInterval(refreshInterval);
        // Cleanup listeners
        window.electronAPI.removeAllListeners('import-books');
        window.electronAPI.removeAllListeners('scan-library');
        window.electronAPI.removeAllListeners('open-preferences');
      };
    }

    return () => {
      clearInterval(refreshInterval);
    };
  }, [selectedCollection]);

  const handleScanLibrary = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:3001/api/scan?fast=true', {
        method: 'POST',
      });
      const data = await response.json();
      console.log('Scan completed:', data);
      // Reload books after scan
      await loadBooks();
    } catch (error) {
      console.error('Scan failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateThumbnails = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:3001/api/books/thumbnails/batch', {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Thumbnail generation started:', data);

        // Refresh books after a delay to show new thumbnails
        setTimeout(() => {
          loadBooks();
        }, 5000);
      } else {
        console.error('Failed to generate thumbnails');
      }
    } catch (error) {
      console.error('Error generating thumbnails:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleProcessBooks = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:3001/api/process/batch?limit=10', {
        method: 'POST',
      });
      const data = await response.json();
      console.log('Processing completed:', data);
      alert(`Processed ${data.processed} books. ${data.errors} errors.`);
      // Reload books after processing
      await loadBooks();
    } catch (error) {
      console.error('Processing failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadBooks = async () => {
    try {
      // Handle special "currently-reading" collection
      if (selectedCollection === 'currently-reading') {
        // First get all books that have reading progress
        const progressResponse = await fetch('http://localhost:3001/api/progress/reading/all?status=reading');
        const progressData = await progressResponse.json();

        // The API returns books directly with progress data, just use them
        if (progressData.length > 0) {
          // Fetch full book details for the currently reading books
          const bookIds = progressData.map(item => item.id);
          const booksResponse = await fetch(`http://localhost:3001/api/books?limit=${LIBRARY_FETCH_LIMIT}`);
          const booksData = await booksResponse.json();

          // Filter to only currently reading books and merge with progress
          const booksWithProgress = booksData.books
            .filter(book => bookIds.includes(book.id))
            .map(book => {
              const progress = progressData.find(p => p.id === book.id);
              return {
                ...book,
                readingProgress: {
                  current_page: progress.current_page,
                  total_pages: progress.total_pages,
                  percentage: progress.percentage,
                  last_read: progress.last_read,
                  started_reading: progress.started_reading,
                  reading_status: progress.reading_status
                }
              };
            });

          setBooks(booksWithProgress);
          setCollectionBooks(booksWithProgress);
        } else {
          // No books currently being read
          setBooks([]);
          setCollectionBooks([]);
        }
      } else if (selectedCollection) {
        // Regular collection
        const response = await fetch(`http://localhost:3001/api/collections/${selectedCollection}`);
        const data = await response.json();
        console.log('Loaded collection books:', data);
        setBooks(data.books || []);
        setCollectionBooks(data.books || []);
      } else {
        // Load all books
        const response = await fetch(`http://localhost:3001/api/books?limit=${LIBRARY_FETCH_LIMIT}`);
        const data = await response.json();
        setBooks(data.books || []);
        setTotalBooks(data.pagination?.total ?? (data.books || []).length);
        setCollectionBooks([]);
      }
    } catch (error) {
      console.error('Failed to load books:', error);
      setBooks([]);
      setCollectionBooks([]);
    }
  };

  // Multi-select functions
  const toggleBookSelection = (bookId, event) => {
    if (event) {
      event.stopPropagation();
    }

    const newSelection = new Set(selectedBookIds);
    if (newSelection.has(bookId)) {
      newSelection.delete(bookId);
    } else {
      newSelection.add(bookId);
    }

    setSelectedBookIds(newSelection);

    // Enable selection mode if any book is selected
    if (newSelection.size > 0 && !isSelectionMode) {
      setIsSelectionMode(true);
    } else if (newSelection.size === 0) {
      setIsSelectionMode(false);
    }
  };

  const selectAllVisible = () => {
    const newSelection = new Set(filteredAndSortedBooks.map(book => book.id));
    setSelectedBookIds(newSelection);
    setIsSelectionMode(true);
  };

  const clearSelection = () => {
    setSelectedBookIds(new Set());
    setIsSelectionMode(false);
  };

  const handleBulkAction = async (action, params) => {
    const bookIds = Array.from(selectedBookIds);

    try {
      switch (action) {
        case 'addTags':
          const addTagsResponse = await fetch('http://localhost:3001/api/books/bulk/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookIds, tags: params.tags })
          });

          if (addTagsResponse.ok) {
            await loadBooks(); // Reload to show updated tags
            clearSelection();
          }
          break;

        case 'delete':
          const deleteResponse = await fetch('http://localhost:3001/api/books/bulk/delete', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookIds })
          });

          if (deleteResponse.ok) {
            await loadBooks(); // Reload to remove deleted books
            clearSelection();
          }
          break;

        default:
          console.log('Unknown bulk action:', action);
      }
    } catch (error) {
      console.error('Bulk action failed:', error);
    }
  };

  // Remove a book from the current collection
  const removeBookFromCollection = async (bookId) => {
    if (!selectedCollection) return;

    try {
      const response = await fetch(`http://localhost:3001/api/collections/${selectedCollection}/books/${bookId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        await loadBooks(); // Reload to update the list
      }
    } catch (error) {
      console.error('Failed to remove book from collection:', error);
    }
  };

  // Also covers the initial load, so no separate mount effect is needed.
  useEffect(() => {
    loadBooks();
  }, [selectedCollection]);

  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      {/* Collections Sidebar */}
      <CollectionsSidebar
        key={collectionsRefreshKey}
        selectedCollection={selectedCollection}
        onCollectionSelect={setSelectedCollection}
        selectedBookIds={selectedBookIds}
        isSelectionMode={isSelectionMode}
        onBooksAdded={() => {
          // Refresh when books are added from sidebar
          loadBooks();
          setCollectionsRefreshKey(prev => prev + 1);
        }}
      />

      {/* Main Content */}
      <div className="flex-1">
        {/* Header */}
        <header className="sticky top-0 z-50 border-b border-hairline bg-surface/85 shadow-bar backdrop-blur-md">
        <div className="px-6 py-3 lg:px-8">
          <div className="flex items-center justify-between">
            <h1 className="flex items-baseline gap-2 text-lg font-semibold tracking-tight text-ink">
              Librarian
              {selectedCollection && (
                <span className="text-sm font-normal text-ink-faint">/ Collection</span>
              )}
            </h1>
            <div className="flex items-center gap-1.5">
              {/* Multi-select controls */}
              {isSelectionMode && (
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-medium text-accent-ink">
                    {selectedBookIds.size} selected
                  </span>
                  <button
                    onClick={selectAllVisible}
                    className="px-3 py-1 text-sm bg-accent-soft text-blue-700 rounded hover:bg-blue-200"
                  >
                    Select All
                  </button>
                  <button
                    onClick={clearSelection}
                    className="px-3 py-1 text-sm bg-surface-sunken text-ink-muted rounded hover:bg-surface-hover"
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => setIsBulkActionsModalOpen(true)}
                    disabled={selectedBookIds.size === 0}
                    className="px-3 py-1 text-sm bg-emerald-500/100 text-white rounded hover:bg-green-600 disabled:opacity-50"
                  >
                    Bulk Actions
                  </button>
                </div>
              )}

              {/* Duplicate Manager */}
              <DuplicateManager />

              {/* Full-text search toggle */}
              <button
                onClick={() => setShowFullTextSearch(!showFullTextSearch)}
                className={showFullTextSearch ? 'flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-accent-ink transition-colors' : 'flex h-8 w-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink'}
                title={showFullTextSearch ? 'Close full-text search' : 'Open full-text search'}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16h8M8 12h8m-8-4h4M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5z" />
                </svg>
              </button>

              {/* Reading stats toggle */}
              <button
                onClick={() => setShowReadingStats(!showReadingStats)}
                className={showReadingStats ? 'flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-accent-ink transition-colors' : 'flex h-8 w-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink'}
                title={showReadingStats ? 'Close reading statistics' : 'Open reading statistics'}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </button>

              {/* Preferences button */}
              <button
                onClick={() => setIsPreferencesOpen(true)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
                title="Preferences"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>

              {/* Dark mode toggle */}
              <button
                onClick={toggleDarkMode}
                className="flex h-8 w-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
                title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {isDark ? (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                  </svg>
                )}
              </button>

              <span className="hidden shrink-0 text-xs tabular-nums text-ink-faint sm:inline">
                {loading ? 'Loading...' : (searchQuery || selectedTag || selectedAuthor || selectedFileType) ? `${filteredAndSortedBooks.length} of ${books.length}` : `${totalBooks || books.length} books`}
              </span>
              <input
                type="text"
                placeholder="Search books..."
                className="h-8 w-52 rounded-md border border-hairline bg-surface-sunken px-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:bg-surface focus:outline-none"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button
                onClick={() => setIsSelectionMode(!isSelectionMode)}
                className={`h-8 shrink-0 rounded-md px-3 text-sm font-medium transition-colors ${isSelectionMode ? 'bg-accent text-white' : 'text-ink-muted hover:bg-surface-hover hover:text-ink'}`}
              >
                {isSelectionMode ? '✓ Selecting' : 'Select'}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Filter Bar - Also sticky below the header */}
      <div className="sticky top-[3.25rem] z-40 border-b border-hairline bg-canvas/90 px-6 py-2 backdrop-blur-md lg:px-8">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Tag Filter */}
          {allTags.length > 0 && (
            <div className="flex items-center gap-1.5">
              <select
                className="h-7 max-w-[12rem] rounded-md border border-hairline bg-surface px-2 text-xs text-ink transition-colors hover:border-ink-faint focus:border-accent focus:outline-none"
                value={selectedTag}
                onChange={(e) => setSelectedTag(e.target.value)}
              >
                <option value="">All Tags</option>
                {allTags.map(tag => (
                  <option key={tag} value={tag}>{tag}</option>
                ))}
              </select>
            </div>
          )}

          {/* Author Filter */}
          {allAuthors.length > 0 && (
            <div className="flex items-center gap-1.5">
              <select
                className="h-7 max-w-[12rem] rounded-md border border-hairline bg-surface px-2 text-xs text-ink transition-colors hover:border-ink-faint focus:border-accent focus:outline-none"
                value={selectedAuthor}
                onChange={(e) => setSelectedAuthor(e.target.value)}
              >
                <option value="">All Authors</option>
                {allAuthors.map(author => (
                  <option key={author} value={author}>{author}</option>
                ))}
              </select>
            </div>
          )}

          {/* File Type Filter */}
          <div className="flex items-center gap-1.5">
            <select
              className="h-7 max-w-[12rem] rounded-md border border-hairline bg-surface px-2 text-xs text-ink transition-colors hover:border-ink-faint focus:border-accent focus:outline-none"
              value={selectedFileType}
              onChange={(e) => setSelectedFileType(e.target.value)}
            >
              <option value="">All Types</option>
              {allFileTypes.map(type => (
                <option key={type} value={type}>{type.toUpperCase()}</option>
              ))}
            </select>
          </div>

          {/* Language Filter */}
          {allLanguages.length > 0 && (
            <div className="flex items-center gap-1.5">
              <select
                className="h-7 max-w-[12rem] rounded-md border border-hairline bg-surface px-2 text-xs text-ink transition-colors hover:border-ink-faint focus:border-accent focus:outline-none"
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
              >
                <option value="">All Languages</option>
                {allLanguages.map(lang => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
              </select>
            </div>
          )}

          {/* Sort Options */}
          <div className="flex items-center gap-1.5">
            <select
              className="h-7 max-w-[12rem] rounded-md border border-hairline bg-surface px-2 text-xs text-ink transition-colors hover:border-ink-faint focus:border-accent focus:outline-none"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="title">Title</option>
              <option value="author">Author</option>
              <option value="date_added">Date Added</option>
              <option value="file_size">File Size</option>
            </select>
            <button
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-hairline bg-surface text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
              title={`Sort ${sortOrder === 'asc' ? 'Descending' : 'Ascending'}`}
            >
              {sortOrder === 'asc' ? '↑' : '↓'}
            </button>
          </div>

          {/* Clear Filters */}
          {(selectedTag || selectedAuthor || selectedFileType || selectedLanguage) && (
            <button
              onClick={() => {
                setSelectedTag('');
                setSelectedAuthor('');
                setSelectedFileType('');
                setSelectedLanguage('');
              }}
              className="h-7 rounded-md px-2.5 text-xs font-medium text-accent-ink transition-colors hover:bg-accent-soft"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Full-text Search Section */}
      {showFullTextSearch && (
        <div className="px-6 py-4 lg:px-8">
          <FullTextSearch
            isDark={isDark}
            onSearchResults={(results) => {
              // Optional: Handle search results
              console.log('Full-text search results:', results);
            }}
          />
        </div>
      )}

      {/* Reading Statistics Section */}
      {showReadingStats && (
        <div className="px-6 py-4 lg:px-8">
          <ReadingStatsDashboard isDark={isDark} />
        </div>
      )}

      {/* Main Content */}
      <main className="px-6 py-6 lg:px-8">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-sm text-ink-muted">Scanning library…</div>
          </div>
        ) : !books || books.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-sm text-ink-muted">Loading library…</div>
          </div>
        ) : filteredAndSortedBooks.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-sm text-ink-muted">No books match your filters.</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 lg:gap-4">
            {visibleBooks.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                isSelected={selectedBookIds.has(book.id)}
                onSelect={isSelectionMode || selectedBookIds.size > 0 ? (id, checked) => {
                  if (checked) {
                    setSelectedBookIds(new Set([...selectedBookIds, id]));
                  } else {
                    const newSet = new Set(selectedBookIds);
                    newSet.delete(id);
                    setSelectedBookIds(newSet);
                  }
                } : null}
                onDoubleClick={() => handleReadPDF(book)}
                onClick={() => {
                  if (isSelectionMode) {
                    const newSet = new Set(selectedBookIds);
                    if (newSet.has(book.id)) {
                      newSet.delete(book.id);
                    } else {
                      newSet.add(book.id);
                    }
                    setSelectedBookIds(newSet);
                  } else {
                    setSelectedBook(book);
                    setIsModalOpen(true);
                  }
                }}
                onRemoveFromCollection={selectedCollection ? removeBookFromCollection : null}
                selectedCollection={selectedCollection}
              />
            ))}
          </div>
        )}

        {!loading && visibleBooks.length < filteredAndSortedBooks.length && (
          <div ref={loadMoreRef} className="py-10 text-center text-xs text-ink-faint">
            Loading more books…
          </div>
        )}
      </main>

      {/* Book Detail Modal */}
      <BookDetailModal
        book={selectedBook}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedBook(null);
        }}
        onUpdate={(updatedBook) => {
          // Update the book in the list
          setBooks(prevBooks =>
            prevBooks.map(book =>
              book.id === updatedBook.id ? updatedBook : book
            )
          );
          // Update selected book if still open
          if (selectedBook?.id === updatedBook.id) {
            setSelectedBook(updatedBook);
          }
        }}
        onRead={() => handleReadPDF(selectedBook)}
        onCollectionChange={() => {
          // Reload books and refresh sidebar
          loadBooks();
          setCollectionsRefreshKey(prev => prev + 1);
        }}
      />

      <BulkActionsModal
        isOpen={isBulkActionsModalOpen}
        onClose={() => setIsBulkActionsModalOpen(false)}
        selectedBooks={Array.from(selectedBookIds)}
        onBulkAction={handleBulkAction}
        allTags={allTags}
      />

      {/* PDF Viewer */}
      <PDFViewer
        book={currentPdfBook}
        filePath={currentPdfBook?.file_path}
        isOpen={pdfViewerOpen}
        onClose={() => {
          setPdfViewerOpen(false);
          setCurrentPdfBook(null);
        }}
        isDark={isDark}
      />

      {/* ePUB Viewer */}
      {epubViewerOpen && currentEpubBook && (
        <EpubViewer
          bookId={currentEpubBook.id}
          filePath={currentEpubBook.file_path}
          onClose={() => {
            setEpubViewerOpen(false);
            setCurrentEpubBook(null);
            loadBooks(); // Refresh to show updated progress
          }}
        />
      )}

      {/* Preferences Modal */}
      <PreferencesModal
        isOpen={isPreferencesOpen}
        onClose={() => setIsPreferencesOpen(false)}
      />
      </div>
    </div>
  );
}

export default App;