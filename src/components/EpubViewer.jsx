import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ReactReader } from 'react-reader';
import { FaTimes } from 'react-icons/fa';
import debounce from 'lodash/debounce';
import ModalPortal from './ModalPortal';

const EpubViewer = ({ bookId, filePath, onClose }) => {
  const [location, setLocation] = useState(null);
  const [firstRenderDone, setFirstRenderDone] = useState(false);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const renditionRef = useRef(null);
  const tocRef = useRef([]);

  // Load saved progress on mount
  useEffect(() => {
    // A missing or failed lookup here just means starting at the beginning,
    // so it stays silent on purpose.
    const loadProgress = async () => {
      try {
        const response = await fetch(`http://localhost:3001/api/progress/${bookId}`);
        if (response.ok) {
          const progress = await response.json();
          if (progress && progress.location) {
            // Set the saved location (cfi string for ePUB)
            setLocation(progress.location);
          }
        }
      } catch (error) {
        console.error('Error loading progress:', error);
      }
    };

    loadProgress();
  }, [bookId]);

  // Save progress when location changes
  const saveProgress = useCallback(
    debounce(async (epubcfi) => {
      if (!epubcfi || !firstRenderDone) return;

      try {
        // Calculate approximate page from CFI location
        const pageProgress = renditionRef.current
          ? renditionRef.current.currentLocation().start.percentage
          : 0;

        await fetch(`http://localhost:3001/api/progress/${bookId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            location: epubcfi, // Save the CFI for accurate positioning
            current_page: Math.floor(pageProgress * 100), // Percentage as "page"
            total_pages: 100, // Use 100 as total for percentage
            reading_status: 'reading',
            percentage: Math.floor(pageProgress * 100)
          })
        });
      } catch (error) {
        console.error('Error saving progress:', error);
      }
    }, 500),
    [bookId, firstRenderDone]
  );

  const locationChanged = (epubcfi) => {
    if (!firstRenderDone) {
      setFirstRenderDone(true);
    }

    setLocation(epubcfi);

    // Update current page display
    if (renditionRef.current) {
      const currentLocation = renditionRef.current.currentLocation();
      if (currentLocation) {
        const percentage = currentLocation.start.percentage;
        setCurrentPage(Math.floor(percentage * 100));
      }
    }

    // Save progress
    saveProgress(epubcfi);
  };

  const handleRendition = (rendition) => {
    renditionRef.current = rendition;

    // Set themes for better readability
    rendition.themes.default({
      '::selection': {
        'background': 'rgba(255, 255, 0, 0.3)'
      },
      'body': {
        'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        'line-height': '1.6',
        'padding': '0 20px'
      }
    });

    // Register themes
    rendition.themes.register('dark', {
      'body': {
        'background': '#1e1e1e',
        'color': '#e0e0e0'
      },
      'a': {
        'color': '#6db3f2'
      }
    });
  };

  const handleTocChange = (toc) => {
    tocRef.current = toc;
    setTotalPages(toc.length);
  };

  // Handle closing with final save
  const handleClose = async () => {
    if (location) {
      await saveProgress(location);
      saveProgress.flush(); // Flush any pending saves
    }
    onClose();
  };

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [location]);

  return (
    <ModalPortal>
      <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex flex-col">
      {/* Header */}
      <div className="bg-[#16181d] text-white px-4 py-3 flex justify-between items-center border-b border-white/10">
        <div className="flex items-center space-x-4">
          <span className="text-lg font-semibold">ePUB Reader</span>
          <span className="text-sm text-ink-faint">
            {currentPage > 0 && `${currentPage}% read`}
          </span>
        </div>
        <button
          onClick={handleClose}
          className="p-2 hover:bg-white/10 rounded transition-colors"
          title="Close (Esc)"
        >
          <FaTimes />
        </button>
      </div>

      {/* Reader */}
      <div className="flex-1 relative bg-surface">
        <ReactReader
          url={`http://localhost:3001/pdf${filePath}`}
          location={location}
          locationChanged={locationChanged}
          getRendition={handleRendition}
          tocChanged={handleTocChange}
          epubOptions={{
            flow: 'paginated',
            manager: 'continuous',
            spread: 'auto'
          }}
          styles={{
            ...ReactReaderStyle,
            arrow: {
              ...ReactReaderStyle.arrow,
              color: '#333'
            }
          }}
        />
      </div>

      {/* Footer */}
      <div className="bg-[#16181d] text-white p-2 text-center text-xs border-t border-white/10">
        <span className="text-ink-faint">
          Use arrow keys to navigate • Press Esc to exit
        </span>
      </div>
      </div>
    </ModalPortal>
  );
};

// Custom styles for ReactReader
const ReactReaderStyle = {
  container: {
    width: '100%',
    height: '100%',
    overflow: 'hidden'
  },
  reader: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    right: 0
  },
  arrow: {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    fontSize: '2rem',
    cursor: 'pointer',
    userSelect: 'none',
    zIndex: 1,
    padding: '20px',
    background: 'rgba(255, 255, 255, 0.8)',
    borderRadius: '4px',
    margin: '0 10px'
  }
};

export default EpubViewer;