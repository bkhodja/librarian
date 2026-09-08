import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import ModalPortal from './ModalPortal';

// Configure worker from local file
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

function PDFViewer({ book, filePath, isOpen, onClose, isDark, searchTerm = null, onProgressUpdate }) {
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.7); // Start with 170% as default for better readability
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pageWidth, setPageWidth] = useState(null);
  const [autoFitMode, setAutoFitMode] = useState(false);
  const containerRef = useRef(null);
  const lastSaveRef = useRef(Date.now());
  const autoSaveTimerRef = useRef(null);

  // Fetch initial progress
  useEffect(() => {
    if (book?.id && isOpen) {
      fetchProgress();
    }
  }, [book?.id, isOpen]);

  // Auto-save timer
  useEffect(() => {
    if (isOpen && book?.id) {
      // Save progress every 30 seconds
      autoSaveTimerRef.current = setInterval(() => {
        saveProgress(pageNumber);
      }, 30000);

      return () => {
        if (autoSaveTimerRef.current) {
          clearInterval(autoSaveTimerRef.current);
        }
        // Save on unmount
        saveProgress(pageNumber);
      };
    }
  }, [isOpen, book?.id, pageNumber]);

  const fetchProgress = async () => {
    try {
      const response = await fetch(`http://localhost:3001/api/progress/books/${book.id}/progress`);
      const data = await response.json();
      setProgress(data);

      // Resume from last read page
      if (data.current_page && data.current_page > 0) {
        setPageNumber(data.current_page);
      }
    } catch (error) {
      console.error('Error fetching progress:', error);
    }
  };

  const saveProgress = useCallback(async (currentPage) => {
    // Debounce saves - don't save more than once every 5 seconds
    const now = Date.now();
    if (now - lastSaveRef.current < 5000) return;

    if (!book?.id || !numPages) return;

    setIsSaving(true);
    lastSaveRef.current = now;

    try {
      await fetch(`http://localhost:3001/api/progress/books/${book.id}/progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_page: currentPage,
          total_pages: numPages
        })
      });

      // Update local progress
      const percentage = (currentPage / numPages) * 100;
      setProgress(prev => ({
        ...prev,
        current_page: currentPage,
        total_pages: numPages,
        percentage
      }));
    } catch (error) {
      console.error('Error saving progress:', error);
    } finally {
      setIsSaving(false);
    }
  }, [book?.id, numPages]);

  // Calculate optimal page width and scale based on container
  useEffect(() => {
    if (containerRef.current && isOpen) {
      const updatePageDimensions = () => {
        const containerWidth = containerRef.current.clientWidth - 80; // Subtract padding
        const containerHeight = containerRef.current.clientHeight - 40; // Subtract padding
        setPageWidth(containerWidth);

        // Calculate optimal scale for the screen
        // For wider screens, we want to fill more of the width
        // For smaller screens, we need more conservative scaling
        const screenWidth = window.innerWidth;
        let targetWidthRatio;

        if (screenWidth > 1920) {
          targetWidthRatio = 0.7; // 70% of container for very large screens
        } else if (screenWidth > 1440) {
          targetWidthRatio = 0.8; // 80% for large screens
        } else if (screenWidth > 1024) {
          targetWidthRatio = 0.9; // 90% for medium screens
        } else {
          targetWidthRatio = 0.95; // 95% for small screens
        }

        const optimalScale = (containerWidth / 612) * targetWidthRatio; // 612 is standard PDF page width

        // If in auto-fit mode, update the scale
        if (autoFitMode) {
          setScale(Math.max(0.5, Math.min(3.0, optimalScale)));
        }
      };

      updatePageDimensions();
      window.addEventListener('resize', updatePageDimensions);
      return () => window.removeEventListener('resize', updatePageDimensions);
    }
  }, [isOpen, autoFitMode]);

  const onDocumentLoadSuccess = ({ numPages }) => {
    setNumPages(numPages);
    setLoading(false);

    // Update total pages if different
    if (book?.page_count !== numPages) {
      // Optionally update book's page count in database
      console.log('Actual pages:', numPages, 'vs recorded:', book?.page_count);
    }
  };

  const changePage = (offset) => {
    const newPage = pageNumber + offset;
    if (newPage >= 1 && newPage <= numPages) {
      setPageNumber(newPage);
      // Save progress after page change
      setTimeout(() => saveProgress(newPage), 1000);
    }
  };

  const goToPage = (page) => {
    if (page >= 1 && page <= numPages) {
      setPageNumber(page);
      setTimeout(() => saveProgress(page), 1000);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (!isOpen) return;

      switch(e.key) {
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          changePage(-1);
          break;
        case 'ArrowRight':
        case 'PageDown':
        case ' ': // Spacebar
          e.preventDefault();
          changePage(1);
          break;
        case 'Home':
          e.preventDefault();
          goToPage(1);
          break;
        case 'End':
          e.preventDefault();
          goToPage(numPages);
          break;
        case 'Escape':
          e.preventDefault();
          handleClose();
          break;
        case '+':
        case '=':
          e.preventDefault();
          setAutoFitMode(false);
          setScale(s => Math.min(s + 0.1, 2.5));
          break;
        case '-':
        case '_':
          e.preventDefault();
          setAutoFitMode(false);
          setScale(s => Math.max(s - 0.1, 0.5));
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isOpen, pageNumber, numPages]);

  const handleClose = async () => {
    // Save progress before closing
    await saveProgress(pageNumber);

    // Notify parent component that progress was updated
    if (onProgressUpdate) {
      onProgressUpdate(book.id, {
        current_page: pageNumber,
        total_pages: numPages,
        percentage: numPages ? (pageNumber / numPages) * 100 : 0
      });
    }

    onClose();
  };

  if (!isOpen) return null;

  const pdfUrl = `http://localhost:3001/pdf${filePath}`;
  const progressPercentage = numPages ? (pageNumber / numPages) * 100 : 0;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
      {/* Header */}
      <div className="bg-[#16181d] text-white px-4 py-3 flex items-center justify-between border-b border-white/10">
        <div className="flex items-center gap-4">
          <button
            onClick={handleClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            title="Close (Esc)"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div>
            <h2 className="text-lg font-semibold">{book?.title || 'PDF Viewer'}</h2>
            <div className="text-sm text-ink-faint">
              {book?.author && <span>{book.author} • </span>}
              Page {pageNumber} of {numPages || '...'}
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-ink-faint">Progress:</span>
            <div className="w-32 bg-white/15 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
            <span className="text-sm font-medium">{Math.round(progressPercentage)}%</span>
          </div>
          {isSaving && (
            <span className="text-xs text-green-400">Saving...</span>
          )}
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setAutoFitMode(false);
              setScale(s => Math.max(s - 0.1, 0.5));
            }}
            className="p-2 hover:bg-white/10 rounded"
            title="Zoom Out (-)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <span className="text-sm w-16 text-center">
            {autoFitMode ? 'Auto' : `${Math.round(scale * 100)}%`}
          </span>
          <button
            onClick={() => {
              setAutoFitMode(false);
              setScale(s => Math.min(s + 0.1, 2.5));
            }}
            className="p-2 hover:bg-white/10 rounded"
            title="Zoom In (+)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={() => {
              setAutoFitMode(true);
              // Trigger a resize event to recalculate optimal scale
              window.dispatchEvent(new Event('resize'));
            }}
            className={`px-3 py-1 text-sm rounded ${autoFitMode ? 'bg-accent' : 'hover:bg-white/10'}`}
          >
            Auto Fit
          </button>
        </div>
      </div>

      {/* PDF Content */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-[#1f2229] flex justify-center items-start p-6"
      >
        <Document
          file={pdfUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={setError}
          loading={
            <div className="text-white text-center p-8">
              <div className="text-xl mb-2">Loading PDF...</div>
              <div className="text-ink-faint">Please wait</div>
            </div>
          }
          error={
            <div className="text-red-400 text-center p-8">
              <div className="text-xl mb-2">Error loading PDF</div>
              <div className="text-sm">{error?.message || 'Unknown error'}</div>
            </div>
          }
        >
          <Page
            pageNumber={pageNumber}
            scale={scale}
            renderTextLayer={true}
            renderAnnotationLayer={true}
            className="shadow-2xl"
          />
        </Document>
      </div>

      {/* Navigation Footer */}
      <div className="bg-[#16181d] text-white px-4 py-3 flex items-center justify-between border-t border-white/10">
        <div className="flex items-center gap-4">
          <button
            onClick={() => changePage(-1)}
            disabled={pageNumber <= 1}
            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Previous
          </button>

          <div className="flex items-center gap-2">
            <input
              type="number"
              value={pageNumber}
              onChange={(e) => {
                const page = parseInt(e.target.value) || 1;
                goToPage(page);
              }}
              min="1"
              max={numPages}
              className="w-16 px-2 py-1 bg-white/10 border border-white/15 rounded text-center"
            />
            <span className="text-ink-faint">/ {numPages}</span>
          </div>

          <button
            onClick={() => changePage(1)}
            disabled={pageNumber >= numPages}
            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2"
          >
            Next
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Reading Info */}
        <div className="text-sm text-ink-faint">
          {progress?.started_reading && (
            <span>
              Started: {new Date(progress.started_reading).toLocaleDateString()}
              {progress.reading_time_minutes > 0 && (
                <span> • Reading time: {Math.round(progress.reading_time_minutes / 60)}h</span>
              )}
            </span>
          )}
        </div>

        {/* Keyboard Shortcuts Help */}
        <div className="text-xs text-ink-faint">
          Use ← → or Space to navigate • +/- to zoom • Esc to close
        </div>
      </div>
      </div>
    </ModalPortal>
  );
}

export default PDFViewer;