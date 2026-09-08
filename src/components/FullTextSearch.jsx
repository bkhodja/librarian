import React, { useState, useEffect, useCallback } from 'react';
import debounce from 'lodash.debounce';
import SearchResultsModal from './SearchResultsModal';

function FullTextSearch({ onSearchResults, isDark }) {
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState('any'); // any, all, phrase, semantic, hybrid
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [totalResults, setTotalResults] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedBook, setSelectedBook] = useState(null);
  const [showOccurrencesModal, setShowOccurrencesModal] = useState(false);
  const [embeddingStats, setEmbeddingStats] = useState(null);

  // Fetch embedding stats on mount
  useEffect(() => {
    fetch('http://localhost:3001/api/search/embeddings/stats')
      .then(res => res.json())
      .then(setEmbeddingStats)
      .catch(() => {});
  }, []);

  const isSemanticMode = searchType === 'semantic' || searchType === 'hybrid';

  // Debounced search function
  const performSearch = useCallback(
    debounce(async (searchQuery, matchType) => {
      if (searchQuery.trim().length < 2) {
        setResults([]);
        setShowResults(false);
        return;
      }

      setIsSearching(true);
      try {
        let response;
        if (matchType === 'semantic') {
          response = await fetch(
            `http://localhost:3001/api/search/semantic?q=${encodeURIComponent(searchQuery)}&limit=20`
          );
        } else if (matchType === 'hybrid') {
          response = await fetch(
            `http://localhost:3001/api/search/hybrid?q=${encodeURIComponent(searchQuery)}&limit=20`
          );
        } else {
          response = await fetch(
            `http://localhost:3001/api/search/books?q=${encodeURIComponent(searchQuery)}&matchType=${matchType}&limit=20`
          );
        }
        const data = await response.json();

        setResults(data.results || []);
        setTotalResults(data.total || 0);
        setShowResults(true);

        // Pass results to parent component if callback provided
        if (onSearchResults) {
          onSearchResults(data.results || []);
        }
      } catch (error) {
        console.error('Search error:', error);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300),
    [onSearchResults]
  );

  // Debounced suggestions function
  const fetchSuggestions = useCallback(
    debounce(async (searchQuery) => {
      if (searchQuery.trim().length < 2) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }

      try {
        const response = await fetch(
          `http://localhost:3001/api/search/suggestions?q=${encodeURIComponent(searchQuery)}`
        );
        const data = await response.json();
        setSuggestions(data || []);
        setShowSuggestions(data.length > 0);
      } catch (error) {
        console.error('Suggestions error:', error);
        setSuggestions([]);
      }
    }, 200),
    []
  );

  useEffect(() => {
    if (query) {
      performSearch(query, searchType);
      fetchSuggestions(query);
    } else {
      setResults([]);
      setShowResults(false);
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [query, searchType, performSearch, fetchSuggestions]);

  const handleSuggestionClick = (suggestion) => {
    setQuery(suggestion);
    setShowSuggestions(false);
  };

  const handleViewOccurrences = (book) => {
    setSelectedBook(book);
    setShowOccurrencesModal(true);
  };

  const highlightMatch = (text, searchQuery) => {
    if (!text || !searchQuery) return text;

    const parts = text.split(new RegExp(`(${searchQuery})`, 'gi'));
    return parts.map((part, index) =>
      part.toLowerCase() === searchQuery.toLowerCase() ? (
        <mark key={index} className="bg-yellow-300 dark:bg-yellow-600 font-semibold">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  return (
    <div className="relative w-full max-w-4xl mx-auto">
      {/* Search Input */}
      <div className="relative">
        <div className="flex items-center gap-2 p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md">
          {/* Search Icon */}
          <svg
            className="w-6 h-6 text-gray-400"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>

          {/* Search Input */}
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search within PDF content..."
            className="flex-1 px-2 py-1 bg-transparent text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none"
          />

          {/* Search Type Selector */}
          <select
            value={searchType}
            onChange={(e) => setSearchType(e.target.value)}
            className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="any">Any words</option>
            <option value="all">All words</option>
            <option value="phrase">Exact phrase</option>
            <option value="semantic">Smart Search</option>
            <option value="hybrid">Hybrid (Best)</option>
          </select>

          {/* Loading Indicator */}
          {isSearching && (
            <div className="w-5 h-5 border-t-2 border-blue-500 border-solid rounded-full animate-spin"></div>
          )}

          {/* Clear Button */}
          {query && (
            <button
              onClick={() => setQuery('')}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              ✕
            </button>
          )}
        </div>

        {/* Suggestions Dropdown */}
        {showSuggestions && (
          <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
            {suggestions.map((suggestion, index) => (
              <button
                key={index}
                onClick={() => handleSuggestionClick(suggestion.suggestion)}
                className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-between"
              >
                <span className="text-gray-800 dark:text-gray-200">
                  {highlightMatch(suggestion.suggestion, query)}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {suggestion.type}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Search Results */}
      {showResults && (
        <div className="mt-4 bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
          {/* Results Header */}
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
              {totalResults > 0 ? (
                <>
                  Found {totalResults} result{totalResults !== 1 ? 's' : ''} for "{query}"
                </>
              ) : (
                <>No results found for "{query}"</>
              )}
            </h3>
            <button
              onClick={() => setShowResults(false)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              ✕
            </button>
          </div>

          {/* Results List */}
          {results.length > 0 && (
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {results.map((result) => (
                <div
                  key={result.id}
                  className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                  onClick={() => {
                    // Open book detail modal or navigate to book
                    window.location.href = `#book-${result.id}`;
                  }}
                >
                  <div className="flex items-start gap-3">
                    {/* Book Thumbnail */}
                    {result.thumbnail_path && (
                      <img
                        src={`http://localhost:3001/${result.thumbnail_path}`}
                        alt={result.title}
                        className="w-16 h-20 object-cover rounded"
                      />
                    )}

                    {/* Book Details */}
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-800 dark:text-gray-200">
                        {result.title || 'Untitled'}
                      </h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {result.author || 'Unknown Author'}
                      </p>

                      {/* Snippet with highlights */}
                      {result.snippet && (
                        <div
                          className="mt-2 text-sm text-gray-700 dark:text-gray-300 line-clamp-2"
                          dangerouslySetInnerHTML={{ __html: result.snippet }}
                        />
                      )}

                      {/* Additional Metadata */}
                      <div className="mt-2 flex gap-4 text-xs text-gray-500 dark:text-gray-400">
                        {result.publication_year && (
                          <span>Year: {result.publication_year}</span>
                        )}
                        {result.publisher && (
                          <span>Publisher: {result.publisher}</span>
                        )}
                        {result.isbn && (
                          <span>ISBN: {result.isbn}</span>
                        )}
                      </div>

                      {/* Semantic search indicators */}
                      {isSemanticMode && (
                        <div className="mt-2 flex items-center gap-2">
                          {result.similarity != null && (
                            <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 rounded text-xs">
                              {Math.round(result.similarity * 100)}% match
                            </span>
                          )}
                          {result.matchType === 'both' && (
                            <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded text-xs">
                              keyword + semantic
                            </span>
                          )}
                          {result.matchType === 'semantic' && (
                            <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded text-xs">
                              semantic
                            </span>
                          )}
                          {result.matchType === 'keyword' && (
                            <span className="px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 rounded text-xs">
                              keyword
                            </span>
                          )}
                          {result.score != null && (
                            <span className="text-xs text-gray-400">
                              score: {result.score.toFixed(3)}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Action Buttons */}
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewOccurrences(result);
                          }}
                          className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-1"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                          View Occurrences
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            window.location.href = `#book-${result.id}`;
                          }}
                          className="px-3 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
                        >
                          Open Book
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Load More */}
          {results.length < totalResults && (
            <div className="mt-4 text-center">
              <button
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                onClick={() => {
                  // Load more results
                  performSearch(query, searchType);
                }}
              >
                Load More Results
              </button>
            </div>
          )}
        </div>
      )}

      {/* Search Tips */}
      {!query && (
        <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Search Tips:
          </h4>
          <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
            <li>• <strong>Any words</strong> — find books containing any of your search terms</li>
            <li>• <strong>All words</strong> — find books containing all of your search terms</li>
            <li>• <strong>Exact phrase</strong> — find books with the exact sequence of words</li>
            <li>• <strong>Smart Search</strong> — AI-powered semantic search by meaning, not just keywords</li>
            <li>• <strong>Hybrid (Best)</strong> — combines keyword + semantic for best results</li>
            <li>• Minimum 2 characters required to search</li>
          </ul>
          {embeddingStats && (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {embeddingStats.embeddedBooks}/{embeddingStats.totalBooks} books indexed for smart search ({embeddingStats.coverage}%)
            </p>
          )}
        </div>
      )}

      {/* Search Results Modal */}
      {showOccurrencesModal && (
        <SearchResultsModal
          isOpen={showOccurrencesModal}
          onClose={() => {
            setShowOccurrencesModal(false);
            setSelectedBook(null);
          }}
          book={selectedBook}
          searchQuery={query}
          searchType={searchType}
          isDark={isDark}
        />
      )}
    </div>
  );
}

export default FullTextSearch;