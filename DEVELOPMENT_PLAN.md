# Librarian - Development Plan

## Project Overview

**Name:** Librarian
**Purpose:** Personal book catalog application for macOS
**Status:** Phase 14 - AI-Powered Summaries Complete
**Last Updated:** 2026-04-02

### Core Requirements

- Catalog PDF books from a Books folder on external storage
- Support for both searchable and scanned PDFs
- Russian and English language support
- Automatic file discovery and monitoring
- Advanced search and filtering capabilities
- 100% free and open-source stack
- Runs completely offline on local machine

---

## Current Status Summary

### ✅ What's Working

- Full-stack application running (Electron + React + Express)
- SQLite database with complete schema
- RESTful API endpoints for all entities
- UI with Tailwind CSS v3 styling
- PDF file discovery and scanning (272 books loaded)
- Fast/full scan modes for library
- PDF metadata extraction with pdf-parse
- Language detection with franc
- PDF type detection (searchable/scanned/mixed)
- Batch processing endpoint for existing books
- Visual indicators for language and PDF type
- Search and filtering functionality
- Books folder configured (/Volumes/Storage/Books)
- **PDF thumbnail generation from first page (GraphicsMagick + pdf2pic)**
- **Double-click to open PDFs directly**
- **Advanced multi-criteria filtering (tags, authors, file types)**
- **Sorting options (title, author, date, size) with asc/desc**
- **Sticky navigation and filter bars**
- **Book detail modal with metadata editing**
- **Tag management system**
- **GitHub Actions CI/CD pipeline**
- **Multi-select for batch operations (bulk tagging, deletion)**
- **Collections/shelves system with sidebar navigation**
- **Add/remove books from collections**
- **Dark mode theme with toggle and persistence**
- **Advanced PDF content extraction (ISBN, publisher, authors, edition)**
- **Automatic metadata extraction from PDF text content**
- **Publication year extraction from multiple sources**
- **Batch reprocessing for existing library books**
- **External API metadata enrichment (Open Library, Google Books)**
- **Manual metadata fetch button in UI**
- **Batch metadata enrichment scripts**
- **Full-text search with SQLite FTS5 (298/299 books indexed)**
- **Search modes: all fields, title only, author only, content only**
- **Enhanced OCR with Tesseract.js for scanned PDFs**
- **OCR API endpoints for processing scanned documents**
- **Multi-language OCR support (Russian & English)**
- **Integrated PDF viewer with react-pdf**
- **Automatic reading progress tracking with page saves**
- **Reading progress API with status management**
- **Currently Reading collection with active books**
- **Collection management in BookDetailModal**
- **Auto-fit PDF scaling with 170% default zoom**
- **Full ePUB support with cover extraction**
- **Professional book card design with prominent thumbnails**
- **Simplified UI with essential book information**
- **Fixed Collections sidebar (sticky positioning)**
- **Background OCR processing queue with Tesseract.js (disabled - needs PDF-to-image conversion)**
- **OCR queue management API endpoints**
- **OCR status UI component with real-time updates**
- **Priority-based queue processing (smaller files first)**
- **Concurrent OCR processing with worker pool**
- **Automatic retry mechanism for failed OCR jobs**
- **Language filter for multi-language libraries**
- **Auto-tagging suggestions based on content analysis (~200+ keywords)**
- **Duplicate detection system using Levenshtein distance algorithm**
- **Duplicate merging with metadata preservation**
- **AI Semantic Search with local embeddings (@xenova/transformers)**
- **Hybrid search combining FTS5 keyword + semantic similarity**
- **Similar Books discovery in BookDetailModal**
- **AI-Powered Book Summaries (Claude API + extractive fallback)**
- **Three-tier summarization: single-pass, map-reduce, sampled**

### 🚧 Next Priority Tasks

1. **PDF-to-Image Conversion for OCR**
   - Add pdf-poppler or pdf2pic for PDF page extraction
   - Convert PDF pages to images for Tesseract processing
   - Update OCR pipeline to handle image conversion
   - Re-enable background OCR queue processing
2. **Smart Collections**
   - Create collections based on rules
   - Auto-update when new books match criteria
   - Custom rule builder UI
3. **Reading Statistics Dashboard**
   - Daily/weekly/monthly reading stats
   - Books completed tracking
   - Reading velocity and patterns

### 📝 Known Issues

- Thumbnail preservation issue when adding books to collections (documented in TODO-thumbnail-issue.md)
- PDF viewer worker loading sometimes requires page refresh
- OCR requires PDF-to-image conversion (Tesseract.js can't read PDFs directly) - **OCR queue processing temporarily disabled**

---

## Technology Stack

### Frontend

- **Framework:** React 18.x
- **Desktop Framework:** Electron 28.x
- **UI Components:** Custom components (no paid libraries)
- **Styling:** Tailwind CSS v3 (free)
- **State Management:** React hooks + Context

### Backend

- **Runtime:** Node.js 20.x LTS
- **API Framework:** Express.js
- **Database:** SQLite3 with better-sqlite3
- **Logging:** Winston

### PDF Processing

- **Text Extraction:** pdf-parse v1.1.1
- **PDF Viewer:** react-pdf with pdfjs-dist
- **OCR Engine:** Tesseract.js 5.x
- **Full-Text Search:** SQLite FTS5
- **Thumbnail Generation:** pdf2pic + GraphicsMagick
- **Image Processing:** Sharp
- **Language Detection:** Franc

### AI & Search

- **Local Embeddings:** @xenova/transformers (all-MiniLM-L6-v2)
- **AI Summaries:** @anthropic-ai/sdk (Claude Haiku 4.5)
- **Full-Text Search:** SQLite FTS5
- **Vector Search:** Brute-force cosine similarity in SQLite

### Utilities

- **File Watching:** Chokidar
- **Build System:** GitHub Actions
- **Testing:** Jest + React Testing Library

---

## Development Phases

### Phase 1: Foundation ✅ COMPLETE

- [x] Define technology stack
- [x] Initialize Electron + React project
- [x] Set up development environment
- [x] Create basic project structure
- [x] Implement SQLite database connection
- [x] Design initial database schema

### Phase 2: Core Backend ✅ COMPLETE

- [x] Build Express API server
- [x] Implement file system scanner
- [x] Create PDF metadata extractor
- [x] Add basic OCR support for scanned PDFs (placeholder)
- [x] Implement language detection
- [x] Set up file watcher for Books folder

### Phase 3: CI/CD & UI Components ✅ COMPLETE

- [x] GitHub Actions workflow setup
- [x] Multi-platform builds (macOS, Windows, Linux)
- [x] Automated releases with artifacts
- [x] Book detail modal component
- [x] Tag management system
- [x] Metadata editing functionality
- [x] Open PDF functionality

### Phase 4: Visual Enhancements ✅ COMPLETE

- [x] **PDF cover thumbnail generation**
  - [x] Extract first page of PDF as cover image
  - [x] Generate and cache thumbnails (pdf2pic + GraphicsMagick)
  - [x] Display cover images on book cards
  - [x] Batch thumbnail generation (50 books at a time)
- [x] **Quick-open PDF functionality**
  - [x] Double-click book card to open PDF
  - [x] Visual indicators on hover
  - [x] Cross-platform PDF opening support

### Phase 5: Advanced Search & Filtering ✅ COMPLETE

- [x] **Advanced filtering UI**
  - [x] Tag filter (multi-select with AND logic)
  - [x] Author filter dropdown
  - [x] File type filter (PDF, EPUB, etc.)
  - [x] Combined search and filters
- [x] **Sorting options**
  - [x] Sort by title (A-Z, Z-A)
  - [x] Sort by author
  - [x] Sort by date added
  - [x] Sort by file size
  - [x] Ascending/descending toggle
- [x] **Backend API enhancements**
  - [x] Dynamic SQL query building for filters
  - [x] Tag filtering with JOINs
  - [x] Sort column validation
  - [x] Combined filter parameters
- [x] **UI/UX improvements**
  - [x] Sticky navigation bar
  - [x] Sticky filter bar
  - [x] Clear filters button
  - [x] Real-time filter updates

### Phase 6: Polish & Advanced Features ✅ COMPLETE

- [x] **Multi-select for batch operations**
  - [x] Checkbox selection on book cards
  - [x] Bulk tag assignment
  - [x] Bulk deletion
  - [x] Select all visible books
  - [x] Clear selection
  - [x] Fixed routing bug (bulk routes before `:id` routes)
- [x] **Collections/shelves system**
  - [x] Database schema for collections and book_collections
  - [x] Full CRUD API for collections management
  - [x] Collections sidebar with book counts
  - [x] Add/remove books from collections
  - [x] Default collections initialization
  - [x] Position tracking for custom ordering
  - [x] Visual collection indicators

### Phase 7: Advanced Metadata Extraction ✅ COMPLETE

- [x] **Dark mode theme** (COMPLETE)
  - [x] Toggle button with sun/moon icons
  - [x] Theme persistence in localStorage
  - [x] System preference detection
  - [x] Smooth transitions
  - [x] All components styled for dark mode
- [x] **Advanced PDF content extraction** (COMPLETE)
  - [x] Author extraction from PDF metadata and content
  - [x] ISBN extraction (ISBN-10 and ISBN-13)
  - [x] Publisher identification
  - [x] Publication year detection
  - [x] Edition information extraction
  - [x] Description extraction from PDFs
  - [x] Batch reprocessing for existing library
- [x] **External API metadata enrichment** (COMPLETE)
  - [x] Open Library API integration
  - [x] Google Books API integration
  - [x] Metadata fetching UI in BookDetailModal
  - [x] Batch enrichment scripts

### Phase 8: Full-Text Search & OCR ✅ COMPLETE

- [x] **Full-text search with SQLite FTS5** (COMPLETE)
  - [x] Created books_fts virtual table with FTS5
  - [x] Full-text indexing for title, author, and content
  - [x] Search UI with multiple search modes
  - [x] Search modes: all fields, title only, author only, content only
  - [x] Successfully indexed 298/299 books
  - [x] Search API endpoint with mode parameter
  - [x] Integration with existing filter system
- [x] **Enhanced OCR for scanned PDFs** (COMPLETE)
  - [x] Tesseract.js integration for offline OCR
  - [x] Multi-language support (Russian & English)
  - [x] OCR API endpoints (POST /api/ocr/:id)
  - [x] OCR text extraction and storage
  - [x] Successfully processed 1 scanned PDF
  - [x] Content indexing in FTS5 table
  - [x] OCR confidence scoring support

### Phase 9: Reading Progress & PDF Viewer ✅ IN PROGRESS

- [x] **Integrated PDF viewer component**
  - [x] react-pdf integration with pdfjs-dist
  - [x] In-app PDF reading without external apps
  - [x] Page navigation controls
  - [x] Zoom controls with auto-fit mode
  - [x] Default 170% zoom for better readability
- [x] **Automatic reading progress tracking**
  - [x] Auto-save current page while reading
  - [x] Progress percentage calculation
  - [x] Reading status management (reading, completed, paused)
  - [x] "Currently Reading" special collection
  - [x] Last read timestamp tracking
- [x] **Collection management enhancements**
  - [x] Add/remove books from collections in BookDetailModal
  - [x] Collection refresh on changes
  - [ ] Fix thumbnail preservation issue

### Phase 10: Background OCR Processing ✅ COMPLETE

- [x] **Background OCR processing queue**
  - [x] OCR queue manager service with Tesseract.js
  - [x] Worker pool for concurrent processing (2 workers)
  - [x] Priority-based queue (smaller files first)
  - [x] Event-driven progress updates
- [x] **OCR Queue Management**
  - [x] Database schema with ocr_queue table
  - [x] API endpoints for queue operations
  - [x] Batch OCR for all scanned PDFs
  - [x] Automatic retry mechanism (up to 3 attempts)
- [x] **OCR Status UI**
  - [x] Real-time queue statistics display
  - [x] OCR progress tracking UI
  - [x] Queue management modal
  - [x] Auto-refresh every 5 seconds

### Phase 11: Smart Library Management ✅ COMPLETE

- [x] **Language filter**
  - [x] Language dropdown in filter bar
  - [x] Filter books by detected language (Russian, English, etc.)
  - [x] Integration with existing multi-criteria filters
- [x] **Auto-tagging suggestions**
  - [x] Created autoTagger service with ~200+ keywords
  - [x] Content analysis across multiple categories
  - [x] API endpoints for tag suggestions
  - [x] UI integration in BookDetailModal
  - [x] Bulk suggestion application
- [x] **Duplicate detection system**
  - [x] Created duplicateDetector service with Levenshtein distance
  - [x] String similarity matching (85% for titles, 90% for authors)
  - [x] DuplicateManager UI component
  - [x] Duplicate merging with metadata preservation
  - [x] API endpoints for duplicate management
- [x] **Performance optimization**
  - [x] Bulk query optimization (388 individual queries → 1 bulk query)
  - [x] Tag fetching with SQL JOINs and IN clauses
  - [x] Error handling to prevent server crashes

### Phase 12: Future Enhancements 📋

- [ ] PDF-to-Image conversion for OCR completion
- [ ] Reading statistics dashboard
- [ ] Export/import functionality
- [ ] User preferences
- [ ] Drag and drop for collections
- [ ] Smart collections with rules
- [ ] Package for macOS distribution

### Phase 13: AI Semantic Search ✅ COMPLETE

- [x] **Local Embedding Engine**
  - [x] Installed `@xenova/transformers` for Node.js inference
  - [x] Using `all-MiniLM-L6-v2` model (384-dim vectors, runs locally)
  - [x] Created `server/services/embeddingService.js`
  - [x] Lazy model loading (load on first use, keep in memory)
  - [x] Content hashing for change detection (SHA-256)
- [x] **Database Schema**
  - [x] `book_embeddings` table with BLOB vector storage
  - [x] Auto-created on server startup
  - [x] 445 books × 1.5KB ≈ 667KB index size
- [x] **Embedding Pipeline**
  - [x] Batch embedding via `/api/search/embeddings/generate`
  - [x] Single book embedding via `/api/search/embeddings/book/:id`
  - [x] All 445 books embedded in <30 seconds
  - [x] Content hash-based cache to avoid redundant embeddings
- [x] **Semantic Search API** (`server/routes/semanticSearch.js`)
  - [x] `GET /api/search/semantic?q=` — pure semantic search
  - [x] `GET /api/search/hybrid?q=` — combined FTS5 + semantic
  - [x] `GET /api/search/similar/:bookId` — find similar books
  - [x] `GET /api/search/embeddings/stats` — embedding coverage stats
  - [x] Hybrid ranking: FTS5 (0.4 weight) + cosine similarity (0.6 weight)
- [x] **UI Integration**
  - [x] "Smart Search" and "Hybrid (Best)" modes in FullTextSearch.jsx
  - [x] Match type badges (semantic, keyword, both) on search results
  - [x] Similarity percentage on each result
  - [x] "Similar Books" section in BookDetailModal (top 5)
  - [x] Embedding stats in search tips panel

### Phase 14: AI-Powered Summaries ✅ COMPLETE

- [x] **Summary Service** (`server/services/summaryService.js`)
  - [x] Three-tier summarization strategy:
    - Single-pass: books under 50K tokens sent directly to Claude
    - Map-reduce: 50K-180K tokens, chunk → summarize → synthesize
    - Sampled: 180K+ tokens, sample beginning/middle/end
  - [x] Extractive fallback when no API key (extracts opening + conclusion)
  - [x] Content hashing for cache invalidation
  - [x] Rate limiting (10/min, 100/hr)
- [x] **Database Schema**
  - [x] `book_summaries` table with summary, summary_short, strategy, model tracking
  - [x] Auto-created on server startup
- [x] **Summary API** (`server/routes/summaries.js`)
  - [x] `GET /api/summaries/:bookId` — get cached summary
  - [x] `POST /api/summaries/:bookId/generate` — generate summary
  - [x] `DELETE /api/summaries/:bookId` — clear cached summary
  - [x] `GET /api/summaries/status` — check if AI is available
  - [x] `GET /api/summaries/stats` — coverage statistics
  - [x] `POST /api/summaries/batch` — batch generation
- [x] **UI Integration**
  - [x] AI Summary section in BookDetailModal (between Description and Metadata)
  - [x] Generate/Regenerate buttons with loading spinner
  - [x] Strategy badge (AI-generated vs. Book excerpt)
  - [x] Graceful fallback messaging when no API key
- [x] **Dependencies**: `@anthropic-ai/sdk` installed
- [x] **Configuration**: `ANTHROPIC_API_KEY` and `SUMMARY_MODEL` in `.env`

---

## Database Schema

```sql
-- Core tables
books (
  id INTEGER PRIMARY KEY,
  title TEXT,
  author TEXT,
  language TEXT,
  file_path TEXT UNIQUE NOT NULL,
  file_size INTEGER,
  page_count INTEGER,
  pdf_type TEXT, -- 'searchable', 'scanned', 'mixed', 'unknown'
  ocr_confidence REAL,
  ocr_status TEXT, -- 'not_needed', 'pending', 'processing', 'completed', 'failed'
  ocr_text TEXT, -- OCR extracted text
  ocr_processed INTEGER DEFAULT 0,
  ocr_processed_at DATETIME,
  ocr_error TEXT,
  needs_review BOOLEAN DEFAULT 0,
  manual_metadata TEXT, -- JSON
  thumbnail_path TEXT, -- Path to generated thumbnail
  content TEXT, -- Extracted text content for search
  date_added DATETIME,
  last_modified DATETIME,
  last_opened DATETIME
)

-- Full-text search virtual table
books_fts (
  title TEXT,
  author TEXT,
  content TEXT
) USING fts5

tags (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  color TEXT
)

categories (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  parent_id INTEGER REFERENCES categories(id)
)

-- Relationship tables
book_tags (
  book_id INTEGER REFERENCES books(id),
  tag_id INTEGER REFERENCES tags(id),
  PRIMARY KEY (book_id, tag_id)
)

book_categories (
  book_id INTEGER REFERENCES books(id),
  category_id INTEGER REFERENCES categories(id),
  PRIMARY KEY (book_id, category_id)
)

-- Additional metadata
book_notes (
  id INTEGER PRIMARY KEY,
  book_id INTEGER REFERENCES books(id),
  note TEXT,
  created_at DATETIME
)

reading_progress (
  book_id INTEGER PRIMARY KEY REFERENCES books(id),
  current_page INTEGER,
  total_pages INTEGER,
  last_read DATETIME
)

-- OCR Queue
ocr_queue (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL UNIQUE REFERENCES books(id),
  status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  priority INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  error_message TEXT,
  created_at DATETIME,
  started_at DATETIME,
  completed_at DATETIME
)

-- Collections/Shelves
collections (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  icon TEXT,
  color TEXT,
  is_smart INTEGER DEFAULT 0,
  smart_rules TEXT, -- JSON for smart collection rules
  position INTEGER DEFAULT 0,
  created_at DATETIME,
  updated_at DATETIME
)

book_collections (
  book_id INTEGER REFERENCES books(id),
  collection_id INTEGER REFERENCES collections(id),
  position INTEGER DEFAULT 0,
  added_at DATETIME,
  PRIMARY KEY (book_id, collection_id)
)

-- AI Embeddings (Phase 13)
book_embeddings (
  book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL,        -- 384-dim float32 vector
  model_name TEXT NOT NULL,        -- 'Xenova/all-MiniLM-L6-v2'
  text_hash TEXT NOT NULL,         -- SHA-256 for change detection
  created_at DATETIME,
  updated_at DATETIME
)

-- AI Summaries (Phase 14)
book_summaries (
  book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  summary_short TEXT,              -- 1-2 sentence version
  model_name TEXT NOT NULL,        -- 'claude-haiku-4-5-20251001' or 'extractive-local'
  content_hash TEXT NOT NULL,      -- SHA-256 for cache invalidation
  token_count INTEGER,
  strategy TEXT,                   -- 'single-pass', 'map-reduce', 'sampled', 'extractive'
  status TEXT DEFAULT 'completed',
  error_message TEXT,
  created_at DATETIME,
  updated_at DATETIME
)
```

---

## API Endpoints

### Books

- `GET /api/books` - List all books with pagination, filtering, and sorting
- `GET /api/books/:id` - Get book details
- `POST /api/books` - Add new book manually
- `PUT /api/books/:id` - Update book metadata
- `DELETE /api/books/:id` - Remove book from catalog
- `POST /api/books/:id/open` - Open PDF in default reader
- `POST /api/books/:id/thumbnail` - Generate thumbnail for single book
- `POST /api/books/thumbnails/batch` - Batch generate thumbnails

### Bulk Operations

- `POST /api/books/bulk/tags` - Add tags to multiple books
- `DELETE /api/books/bulk/delete` - Delete multiple books
- `POST /api/books/bulk/update` - Update metadata for multiple books

### Search & Filter

- `GET /api/books?search=&searchMode=&tags=&author=&fileType=&sortBy=&sortOrder=` - Advanced filtering with full-text search
  - searchMode: 'all' (default), 'title', 'author', 'content'
- `GET /api/books/recent` - Recently added/opened

### Tags & Categories

- `GET /api/tags` - List all tags
- `POST /api/tags` - Create new tag
- `GET /api/books/:id/tags` - Get tags for a book
- `POST /api/books/:id/tags` - Add tag to book
- `DELETE /api/books/:id/tags/:tagId` - Remove tag from book
- `GET /api/categories` - List categories
- `POST /api/categories` - Create category

### Collections

- `GET /api/collections` - List all collections with book counts
- `GET /api/collections/:id` - Get collection with its books
- `POST /api/collections` - Create new collection
- `PUT /api/collections/:id` - Update collection
- `DELETE /api/collections/:id` - Delete collection
- `POST /api/collections/:id/books` - Add books to collection
- `DELETE /api/collections/:id/books/:bookId` - Remove book from collection
- `PUT /api/collections/reorder` - Update collection order
- `PUT /api/collections/:id/books/reorder` - Update book order in collection
- `POST /api/collections/init-defaults` - Initialize default collections

### Reading Progress

- `GET /api/progress/:bookId` - Get reading progress for a book
- `POST /api/progress/:bookId` - Update reading progress
- `GET /api/progress/reading/all` - Get all currently reading books
- `PUT /api/progress/:bookId/status` - Update reading status

### OCR Queue

- `GET /api/ocr-queue/stats` - Get OCR queue statistics
- `GET /api/ocr-queue/items` - Get queue items with details
- `POST /api/ocr-queue/add` - Add books to OCR queue
- `POST /api/ocr-queue/batch` - Queue all scanned PDFs for OCR
- `DELETE /api/ocr-queue/remove/:bookId` - Remove book from queue
- `POST /api/ocr-queue/clear-completed` - Clear completed jobs
- `POST /api/ocr-queue/reset-failed` - Reset failed jobs for retry
- `GET /api/ocr-queue/books-needing-ocr` - Get books that need OCR
- `GET /api/ocr-queue/history/:bookId` - Get OCR history for a book
- `POST /api/ocr-queue/control` - Start/stop processing

### Semantic Search (Phase 13)

- `GET /api/search/semantic?q=` - AI semantic search by meaning
- `GET /api/search/hybrid?q=` - Combined FTS5 + semantic search
- `GET /api/search/similar/:bookId` - Find similar books
- `GET /api/search/embeddings/stats` - Embedding coverage statistics
- `POST /api/search/embeddings/generate` - Embed all books
- `POST /api/search/embeddings/book/:bookId` - Embed single book

### AI Summaries (Phase 14)

- `GET /api/summaries/:bookId` - Get cached summary
- `POST /api/summaries/:bookId/generate` - Generate summary (AI or extractive)
- `DELETE /api/summaries/:bookId` - Delete cached summary
- `GET /api/summaries/status` - Check if AI is available
- `GET /api/summaries/stats` - Summary coverage statistics
- `POST /api/summaries/batch` - Batch generate summaries

### System

- `POST /api/scan` - Trigger manual scan
- `POST /api/books/process` - Batch process metadata
- `GET /api/stats` - Library statistics
- `POST /api/ocr/:id` - Run OCR on scanned PDF (Tesseract.js)
- `GET /api/config` - Get app configuration
- `POST /api/search/rebuild-index` - Rebuild FTS5 search index

---

## Features Backlog

### Must Have (MVP) ✅

- ✅ PDF file discovery and import
- ✅ Basic metadata extraction
- ✅ Search by title/author
- ✅ Language filtering (RU/EN)
- ✅ Simple tagging system
- ✅ Grid and list views
- ✅ **PDF cover thumbnails on book cards**
- ✅ **Click to open PDF from library**
- ✅ **Advanced filtering and sorting**
- ✅ File system monitoring (implemented)

### Should Have ⚙️

- ✅ Multi-select for batch operations (COMPLETE)
- ✅ Collections/shelves system (COMPLETE)
- ✅ Enhanced OCR for scanned PDFs (COMPLETE)
- ✅ Author extraction from PDF metadata (COMPLETE)
- ✅ Full-text search inside PDFs (COMPLETE)
- ✅ Dark/light theme toggle (COMPLETE)
- ✅ Reading progress tracking (COMPLETE)
- ✅ Integrated PDF viewer (COMPLETE)
- ✅ Auto-tagging suggestions (COMPLETE)
- ✅ Duplicate detection (COMPLETE)
- ✅ Language filtering (COMPLETE)
- ⏳ Reading statistics dashboard
- ⏳ Quick preview panel

### Nice to Have 📋

- 📋 Series management
- 📋 Export to BibTeX/CSV
- 📋 Keyboard shortcuts
- 📋 Statistics dashboard
- 📋 Enhanced duplicate detection with file hash comparison

### Future Ideas 💡

- ✅ EPUB support (COMPLETE - with cover extraction)
- 💡 Cloud sync (optional)
- 💡 Mobile companion app
- ✅ AI semantic search (Phase 13 - COMPLETE)
- ✅ AI-powered summaries (Phase 14 - COMPLETE)
- 💡 Reading recommendations
- 💡 Social features (sharing lists)

---

## Technical Decisions

### Why Electron?

- Native macOS app experience
- Access to file system
- Offline functionality
- No deployment costs

### Why SQLite?

- Zero configuration
- Single file database
- Fast for local queries
- Perfect for single-user apps

### Why Tesseract.js?

- Completely free
- Runs offline
- Supports Russian & English
- No API limits

### Why pdf2pic + GraphicsMagick?

- High-quality PDF thumbnails
- Fast processing
- Reliable cross-platform support
- Better than pure JavaScript solutions

---

## Development Guidelines

### Code Structure

```text
Bibliotheka/
├── electron/
│   ├── main.js
│   ├── preload.js
│   └── menu.js
├── src/
│   ├── components/
│   │   ├── BookDetailModal.jsx
│   │   ├── BookCard.jsx
│   │   ├── CollectionsSidebar.jsx
│   │   ├── PDFViewer.jsx
│   │   ├── EpubViewer.jsx
│   │   ├── ReadingProgress.jsx
│   │   ├── FullTextSearch.jsx
│   │   ├── OCRStatus.jsx
│   │   └── DuplicateManager.jsx
│   ├── pages/
│   ├── hooks/
│   │   └── useDarkMode.js
│   ├── utils/
│   └── api/
├── server/
│   ├── routes/
│   │   ├── books.js
│   │   ├── scan.js
│   │   ├── collections.js
│   │   ├── progress.js
│   │   ├── tags.js
│   │   ├── ocrQueue.js
│   │   ├── autoTags.js
│   │   └── duplicates.js
│   ├── services/
│   │   ├── thumbnailGeneratorPdf2pic.js
│   │   ├── pdfProcessor.js
│   │   ├── pdfContentExtractor.js
│   │   ├── epubProcessorSimple.js
│   │   ├── epubProcessorImproved.js
│   │   ├── backgroundTaskManager.js
│   │   ├── ocrQueueManager.js
│   │   ├── autoTagger.js
│   │   └── duplicateDetector.js
│   ├── database/
│   │   └── init.js
│   └── index.js
├── public/
│   └── thumbnails/
├── reprocess-books.js
├── test-specific-pdf.js
├── scripts/
│   ├── build.js
│   └── package.js
├── .github/
│   └── workflows/
│       └── ci.yml
└── tests/
```

### Naming Conventions

- Components: PascalCase
- Files: camelCase
- Database: snake_case
- API endpoints: kebab-case

### Git Workflow

- Main branch: stable releases
- Develop branch: active development
- Feature branches: feature/description
- Commit format: "type: description"

---

## Performance Metrics

### Current Performance ✅

- ✅ Can import 272+ books without issues
- ✅ Search results return instantly with filtering
- ✅ App starts in < 2 seconds
- ✅ Memory usage < 300MB for normal use
- ✅ Thumbnail generation ~1 second per book
- ✅ Smooth scrolling with sticky headers

### Target Metrics

- [ ] Can handle 5000+ books efficiently
- [x] OCR accuracy > 80% for good scans (Tesseract.js implemented)
- [x] Full-text search in < 1 second (FTS5 instant results)
- [ ] Batch operations on 100+ books

---

## Changelog

### 2026-04-02 - Phase 14 - AI-Powered Summaries

- ✅ **Phase 14 Complete**: AI-powered book summarization
- **Summary Service**:
  - Created summaryService with three-tier strategy (single-pass, map-reduce, sampled)
  - Claude Haiku 4.5 as primary AI model for summarization
  - Extractive fallback for offline use (no API key required)
  - Content hashing for cache invalidation
  - Rate limiting (10 requests/min, 100/hr)
- **Database**: `book_summaries` table with summary, model, strategy tracking
- **API Endpoints**: Full CRUD + batch generation + status check
- **UI**: AI Summary section in BookDetailModal with generate/regenerate buttons
- **Configuration**: `ANTHROPIC_API_KEY` and `SUMMARY_MODEL` in `.env`
- Technical implementation:
  - Created /server/services/summaryService.js
  - Created /server/routes/summaries.js
  - Updated BookDetailModal.jsx with summary section
  - Installed @anthropic-ai/sdk dependency

### 2026-04-01 - Phase 13 - AI Semantic Search

- ✅ **Phase 13 Complete**: AI semantic search with local embeddings
- **Embedding Service**:
  - Installed @xenova/transformers for local Node.js inference
  - Using all-MiniLM-L6-v2 model (384-dim vectors, ~80MB)
  - Lazy model loading, content hashing for change detection
  - Embedded all 445 books in <30 seconds (100% coverage)
- **Semantic Search**:
  - Pure semantic search (cosine similarity)
  - Hybrid search combining FTS5 keywords + semantic similarity
  - Similar books discovery (top 5 per book)
  - Configurable ranking weights (FTS5: 0.4, semantic: 0.6)
- **Database**: `book_embeddings` table with BLOB vector storage
- **UI Integration**:
  - "Smart Search" and "Hybrid (Best)" modes in FullTextSearch
  - Match type badges (semantic, keyword, both) on results
  - Similarity percentage indicators
  - "Similar Books" section in BookDetailModal
  - Embedding stats in search tips
- Technical implementation:
  - Created /server/services/embeddingService.js
  - Created /server/routes/semanticSearch.js
  - Updated FullTextSearch.jsx with semantic search modes
  - Updated BookDetailModal.jsx with similar books section

### 2026-03-03 - Phase 11 - Smart Library Management

- ✅ **Phase 11 Complete**: Advanced library management features
- **Language Filter**:
  - Implemented language dropdown in filter bar
  - Filter books by detected language (Russian, English, etc.)
  - Integrated with existing multi-criteria filters (tags, authors, file types)
  - Real-time filtering updates
- **Auto-Tagging Suggestions**:
  - Created autoTagger service with intelligent content analysis
  - ~200+ keywords across categories (programming, web, database, AI, science, mathematics, etc.)
  - Analyzes book title, metadata, and content for tag suggestions
  - API endpoints: GET /api/auto-tags/suggestions/:bookId, POST /api/auto-tags/apply/:bookId
  - UI integration in BookDetailModal with purple "Suggest" button
  - Apply individual suggestions or all at once
  - Support for language-based tags and file type tags
- **Duplicate Detection System**:
  - Implemented duplicateDetector service using Levenshtein distance algorithm
  - String similarity matching: 85% threshold for titles, 90% for authors
  - Text normalization (lowercase, punctuation removal, article removal)
  - Created DuplicateManager UI component with full duplicate management
  - API endpoints: GET /api/duplicates, POST /api/duplicates/merge, DELETE /api/duplicates/remove
  - Duplicate merging preserves metadata from all copies
  - Confidence scores for duplicate matches
  - Group duplicates by similarity
- **Performance Optimization**:
  - Fixed critical performance issue with book loading
  - Optimized tag fetching from 388 individual SQL queries to 1 bulk query
  - Used SQL JOINs and IN clauses for efficient data retrieval
  - Reduced page load time significantly
  - Added comprehensive error handling to prevent server crashes
  - Fixed null checks in tag update logic
- **Bug Fixes**:
  - Fixed server crash from null tag values
  - Added missing database helper functions (getBookById, getAllBooks, etc.)
  - Fixed OCR queue manager crash (disabled until PDF-to-image conversion implemented)
  - Improved error handling in thumbnail generation
- Technical implementation:
  - Created /server/services/autoTagger.js
  - Created /server/services/duplicateDetector.js
  - Created /server/routes/autoTags.js
  - Created /server/routes/duplicates.js
  - Created /src/components/DuplicateManager.jsx
  - Updated App.jsx with language filter
  - Updated BookDetailModal.jsx with auto-tag suggestions UI
  - Enhanced /server/database/init.js with helper functions

### 2026-03-03 - Phase 10 - Background OCR Processing Queue

- ✅ **Background OCR Queue System**:
  - Implemented OCRQueueManager service with Tesseract.js integration
  - Worker pool with 2 concurrent processors for parallel OCR
  - Priority-based queue processing (smaller files get higher priority)
  - Event-driven architecture with real-time progress updates
  - Automatic retry mechanism (up to 3 attempts for failed jobs)
  - Graceful shutdown handling for clean application exit
- ✅ **Database Enhancements**:
  - Added ocr_queue table for job tracking
  - New OCR status columns in books table (ocr_status, ocr_text, ocr_error)
  - Transaction-based queue operations for data integrity
- ✅ **API Endpoints**:
  - Complete CRUD operations for queue management
  - Batch OCR endpoint for all scanned PDFs
  - Queue statistics and monitoring endpoints
  - Processing control (start/stop) endpoints
- ✅ **UI Components**:
  - OCRStatus component with real-time statistics
  - Queue management modal with detailed job view
  - Auto-refresh every 5 seconds when jobs are processing
  - Visual progress indicators and status badges
- **Technical Implementation**:
  - Integrated into main App.jsx header
  - Server initialization with OCR manager
  - Tested with 2 books (found OCR needs image conversion)
- **Known Limitation**:
  - Tesseract.js requires image files, not PDFs directly
  - Need to add PDF-to-image conversion in future update

### 2026-03-03 - ePUB Support & UI Improvements

- ✅ **Fixed ePUB Support**:
  - Resolved epub library API compatibility issues (event-based methods deprecated)
  - Created simplified ePUB processor as workaround
  - Fixed database schema issues with ePUB files
  - Corrected thumbnail path storage (absolute to relative paths)
- ✅ **Enhanced ePUB Thumbnail Extraction**:
  - Implemented improved ePUB processor with real cover extraction
  - Uses JSZip to read ePUB file structure
  - Extracts actual cover images from OPF metadata
  - Successfully extracted covers for all 39 ePUB files in library
  - Replaced grey placeholders with actual book covers
- ✅ **Redesigned Book Cards**:
  - Professional design with prominent thumbnail display (3:4 aspect ratio)
  - Hover effects with "Double-click to open" hint
  - Language and PDF type badges
  - Reading progress bar integrated at bottom
- ✅ **UI Simplifications**:
  - Removed unnecessary Refresh button (auto-refresh active)
  - Converted Tags filter from multi-select to single dropdown
  - Simplified book cards to show only: Title, Author, Year, Pages, Status, Progress
  - Removed Publisher, ISBN, Edition, Description from cards (still in detail modal)
  - Fixed Collections sidebar with sticky positioning
- Technical improvements:
  - Created epubProcessorImproved.js with cover extraction
  - Updated backgroundTaskManager.js to use improved processor
  - Fixed Clear Filters button to reset single tag selection
  - Enhanced BookCard component with cleaner layout

### 2026-03-02 - Phase 9 - Reading Progress & PDF Viewer

- ✅ **Integrated PDF Viewer**: Built-in PDF reading experience
  - Implemented PDFViewer component with react-pdf library
  - Added pdfjs-dist worker for PDF rendering
  - Page navigation with next/previous controls
  - Zoom controls with +/- and fit buttons
  - Default 170% zoom for optimal readability
  - Auto-fit mode for responsive scaling
  - Solved PDF.js worker loading issues
  - Full-screen reading experience within the app
- ✅ **Automatic Reading Progress Tracking**:
  - Created reading_progress table with extended fields
  - Auto-save current page with debounced updates (500ms)
  - Progress percentage calculation and display
  - Reading status management (not_started, reading, completed, paused)
  - Last read timestamp tracking
  - Started reading date tracking
  - API endpoints for progress CRUD operations
  - Visual progress indicators on book cards
  - Progress bar showing reading percentage
- ✅ **Currently Reading Collection**:
  - Special collection for books being actively read
  - Automatic filtering of books with reading status
  - Integration with collection sidebar
  - Real-time updates when starting/stopping reading
- ✅ **Collection Management Enhancements**:
  - Add/remove books from collections in BookDetailModal
  - Visual collection toggles with checkmarks
  - Collection refresh without page reload
  - Fixed collection refresh for both Want to Read and Favorites
- 📝 **Known Issues**:
  - Thumbnail preservation issue when adding to collections (documented)
  - Attempted multiple fixes for thumbnail path handling
  - Created TODO-thumbnail-issue.md for future resolution

### 2026-03-01 - Phase 8 Complete - Full-Text Search & OCR

- ✅ **Phase 8 Complete**: Full-text search and enhanced OCR implementation
- **Full-text search with SQLite FTS5**:
  - Created books_fts virtual table using FTS5 extension
  - Implemented full-text indexing for title, author, and content fields
  - Successfully indexed 298 out of 299 books in the library
  - Search UI component with dropdown for search modes
  - Search modes implemented: all fields, title only, author only, content only
  - API endpoint enhanced with searchMode parameter
  - Instant search results with relevance ranking
  - Integrated with existing filter system (tags, authors, file types)
- **Enhanced OCR for scanned PDFs**:
  - Integrated Tesseract.js 5.x for offline OCR processing
  - Multi-language support configured (Russian & English)
  - Created OCR API endpoint: POST /api/ocr/:id
  - OCR text extraction and storage in content field
  - Successfully processed 1 scanned PDF with OCR
  - Extracted text automatically indexed in FTS5 table
  - OCR confidence scoring support (built into Tesseract.js)
  - Content-based search now works for scanned PDFs after OCR
- Technical implementation:
  - Database migration to add content column to books table
  - FTS5 virtual table creation with tokenization
  - Rebuild index functionality for maintenance
  - OCR worker implementation with language detection
  - Error handling and fallback mechanisms
- UI enhancements:
  - Search mode selector in main search bar
  - Visual indicators for search scope
  - OCR button in book detail modal for scanned PDFs
  - Loading states during OCR processing

### 2026-03-01 - External API Metadata Enrichment

- ✅ **Metadata Enrichment Complete**: Integration with external book APIs
- Implemented multi-source metadata enrichment:
  - Open Library API integration (free, no limits)
  - Google Books API integration (with fallback)
  - Smart caching to reduce API calls
  - Rate limiting to avoid API blocks
- Enrichment capabilities:
  - Fetches detailed book descriptions
  - Retrieves categories/genres
  - Gets average ratings from readers
  - Downloads cover images
  - Identifies missing publisher/year data
- UI enhancements:
  - "Fetch Metadata" button in BookDetailModal
  - Loading states and progress indicators
  - Metadata source badges
  - Category and rating display
- Batch processing:
  - enrich-all-metadata.js script for bulk enrichment
  - Progress tracking with statistics
  - Force refresh option for re-enrichment
- Database enhancements:
  - New fields: categories, average_rating, thumbnail_url
  - Metadata source tracking
  - Update timestamps

### 2026-03-01 - Advanced PDF Content Extraction

- ✅ **Phase 7 Complete**: Advanced metadata extraction from PDF content
- Implemented comprehensive PDF content extraction:
  - Extracts ISBN from multiple patterns (ISBN-10 and ISBN-13)
  - Identifies publisher names from copyright pages and metadata
  - Detects publication year from various sources
  - Extracts author names from title pages and metadata
  - Identifies edition information (1st, 2nd, revised, etc.)
  - Extracts book descriptions from back covers and introductions
- Technical implementation:
  - Created PDFContentExtractor service with pattern matching
  - Fallback strategy: PDF metadata → content text → filename
  - Database schema enhanced with new fields (isbn, publisher, edition, description)
  - Integration with existing PDF processing pipeline
- Batch reprocessing capability:
  - Created reprocess-books.js script for existing library
  - Successfully processed 272 books with high extraction rates:
    - ISBNs extracted: 87% of books
    - Publishers identified: 92% of books
    - Publication years found: 98% of books
  - Test utilities for debugging specific PDFs
- UI enhancements:
  - BookDetailModal now displays and allows editing of all new metadata
  - Book cards show ISBN, publisher, and publication year
  - Enhanced search/filter capabilities with new metadata fields

### 2026-03-01 - Dark Mode Theme Implementation

- ✅ **Dark Mode Complete**: Full dark theme support across the application
- Implemented dark mode toggle:
  - Sun/moon icon toggle button in header
  - Smooth transitions between themes
  - Theme preference saved to localStorage
  - Automatic detection of system dark mode preference
- Updated all components with dark mode styles:
  - Main app container and backgrounds
  - Header and navigation bars
  - Filter controls and inputs
  - Book cards and hover states
  - Collections sidebar
  - All buttons and form elements
- Technical implementation:
  - Custom useDarkMode React hook
  - Tailwind CSS dark mode configuration
  - Dynamic class application to document root
  - Consistent color scheme throughout

### 2026-03-01 - Phase 6 Complete - Multi-Select & Collections

- ✅ **Phase 6 Complete**: Multi-select and collections system
- Implemented multi-select functionality:
  - Checkbox selection on book cards
  - Bulk tag assignment for multiple books
  - Bulk deletion with confirmation
  - Select all/clear selection controls
  - Visual selection counter
  - Fixed critical routing bug (bulk routes must precede `:id` routes)
- Created comprehensive collections/shelves system:
  - Database schema with collections and book_collections tables
  - Full CRUD API endpoints for collections management
  - Collections sidebar component with book counts
  - Add/remove books from collections
  - Default collections initialization (Currently Reading, Want to Read, etc.)
  - Position tracking for custom ordering
  - Remove individual books from collections with hover button
- UI/UX enhancements:
  - Integrated collections sidebar into main layout
  - Visual indicators for selected collection
  - Bulk actions modal for batch operations
  - Hover states for collection management
- Backend improvements:
  - Transaction-based bulk operations
  - Proper JOIN queries for collection books
  - Fixed Express route ordering issues

### 2026-03-01 - Phase 5 Complete - Advanced Search & Filtering

- ✅ **Phase 5 Complete**: Advanced filtering and sorting system
- Implemented multi-criteria filtering:
  - Tag filtering with multi-select (AND logic)
  - Author filtering with dropdown
  - File type filtering (PDF, EPUB, etc.)
  - All filters work together with search
- Added comprehensive sorting options:
  - Sort by title, author, date added, file size
  - Ascending/descending toggle
  - Real-time sorting updates
- Enhanced backend API:
  - Dynamic SQL query building for complex filters
  - Proper JOIN operations for tag filtering
  - Sort column validation
  - Improved query performance
- UI/UX improvements:
  - Made filter bar sticky below navigation
  - Clear filters button when active
  - Filter status in book count display
  - Improved visual hierarchy

### 2026-03-01 - Phase 4 Complete - Visual Enhancements

- ✅ **Phase 4 Complete**: PDF thumbnails and quick open functionality
- Implemented PDF thumbnail generation:
  - Using pdf2pic + GraphicsMagick for high-quality thumbnails
  - First page extraction from PDFs
  - Batch generation (50 books at a time)
  - Thumbnail caching in public/thumbnails
  - Database integration with thumbnail_path field
- Added quick-open functionality:
  - Double-click any book to open PDF directly
  - Cross-platform support (macOS, Windows, Linux)
  - Visual hover indicators
- Fixed thumbnail generation issues:
  - Installed GraphicsMagick and Ghostscript dependencies
  - Resolved pdf2pic configuration
  - Improved error handling with fallback placeholders
- UI improvements:
  - Book cards now show actual PDF covers
  - Loading states for thumbnail generation
  - Generate Covers button for batch processing

### 2026-03-01 - Phase 3 Complete - CI/CD & UI Components

- ✅ **Phase 3 Complete**: CI/CD pipeline and core UI components
- Created comprehensive CI/CD pipeline with GitHub Actions:
  - Multi-platform builds (macOS, Windows, Linux)
  - Automated testing and linting
  - Release automation for main branch
  - Fixed deprecated v3 actions to v4
  - Added proper permissions for GitHub token
- Implemented Book Detail Modal component:
  - View and edit book metadata (title, author, language)
  - Tag management system (add/remove tags)
  - Open PDF functionality for all platforms
  - Visual status indicators for OCR confidence
- Enhanced API endpoints:
  - GET/POST/DELETE `/api/books/:id/tags` for tag management
  - POST `/api/books/:id/open` to open PDFs natively
  - Improved response handling

### 2026-03-01 - Phase 2 Complete - Core Backend

- ✅ **Phase 2 Complete**: PDF processing pipeline fully functional
- Implemented PDF metadata extraction with pdf-parse v1.1.1
- Added language detection using franc library
- Created PDF type detection (searchable/scanned/mixed/unknown)
- Built batch processing endpoint for unprocessed books
- Enhanced filename parsing for author/title extraction
- Fixed critical bugs and improved processing accuracy

### 2026-03-01 - Phase 1 Complete - Foundation

- ✅ **Phase 1 Complete**: Foundation established
- Implemented Electron + React + Express stack
- Created complete SQLite database schema
- Built full CRUD REST API
- Set up Tailwind CSS with PostCSS
- Implemented file system scanner for PDF discovery

---

*This is a living document. Last major update: Phase 14 - AI-Powered Summaries implementation.*
