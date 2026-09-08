# Librarian - Personal Book Catalog

A powerful desktop application for cataloging and managing your personal PDF book collection on macOS.

## Features

### Core Features
- 📚 **PDF Discovery & Import** - Automatically scan and import PDFs from your Books folder
- 🔍 **Smart Search** - Search by title, author, or content
- 🏷️ **Tagging System** - Organize books with custom tags and categories
- 🌍 **Multi-language Support** - Built for Russian and English books with automatic language detection
- 🖥️ **Native Desktop App** - Electron-based macOS application
- 🔒 **100% Offline** - All data stays on your machine
- 🆓 **Completely Free** - Open source, no subscriptions or API costs

### Local AI (no API keys, works offline)

Everything AI runs on your own machine through [Ollama](https://ollama.com).
There is no account, no per-token cost, and nothing leaves the laptop.

- 🏷️ **Automatic tagging** — books are tagged by subject as they arrive, from a
  controlled vocabulary so the tag filter stays usable
- 💬 **Ask a book** — questions answered from that book's own pages, with the
  pages cited, and an honest "not answered by this book" when it isn't
- 🔎 **Ask the library** — "russian books about business added recently" sets
  the filters it means, so you can see and adjust the interpretation
- 📚 **Smart collections** — shelves proposed from what your library actually
  contains
- 📝 **Summaries** and **metadata repair** — run-together filenames turned back
  into titles, missing authors read off the front matter
- 🧠 **Semantic search** over local embeddings

Setup:

```bash
brew install ollama && ollama serve
ollama pull gemma3:4b
```

Without Ollama the app still runs; AI features report that it is unavailable
and tagging falls back to keyword matching.

### Advanced Features (NEW!)
- 🖼️ **PDF Thumbnails** - Automatic generation of book cover thumbnails from PDF first pages
- 📖 **Quick Open** - Double-click any book to open it directly in your default PDF reader
- 🔍 **Advanced Filtering** - Filter by:
  - Multiple tags (AND logic)
  - Authors
  - Languages (Russian, English, etc.)
  - File types (PDF, EPUB, etc.)
  - Combined with search
- 📊 **Sorting Options** - Sort your library by:
  - Title (A-Z or Z-A)
  - Author name
  - Date added
  - File size
- 📝 **Book Metadata Editor** - Edit title, author, and manage tags directly in the app
- 🎯 **Sticky Navigation** - Header and filter bars stay visible while scrolling
- 🚀 **Batch Processing** - Process metadata for multiple books at once
- 📸 **Batch Thumbnail Generation** - Generate covers for all books with one click
- 🏷️ **Auto-Tagging Suggestions** - Intelligent tag recommendations based on book content and metadata analysis (~200+ keywords)
- 🔍 **Duplicate Detection** - Find and merge duplicate books using advanced string similarity algorithms (Levenshtein distance)

## Tech Stack

- **Frontend**: React 18 + Tailwind CSS
- **Desktop**: Electron 28
- **Backend**: Express.js + Node.js
- **Database**: SQLite with better-sqlite3
- **PDF Processing**:
  - pdf-parse (metadata extraction)
  - Tesseract.js (OCR for scanned PDFs)
  - pdf2pic + GraphicsMagick (thumbnail generation)
- **Build System**: GitHub Actions CI/CD

## Getting Started

### Prerequisites

- Node.js 20+ LTS
- npm or yarn
- macOS (primary target platform)
- GraphicsMagick (for thumbnail generation)
  ```bash
  brew install graphicsmagick
  ```
- Ghostscript (for PDF processing)
  ```bash
  brew install ghostscript
  ```

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/Bibliotheka.git
cd Bibliotheka
```

2. Install dependencies:
```bash
npm install
```

3. Configure your Books folder path:
Edit `server/routes/scan.js` line 8:
```javascript
const BOOKS_FOLDER = '/path/to/your/Books';
```

4. Start the application:
```bash
npm start
```

Or run components separately:
```bash
npm run server       # Backend API (port 3001)
npm run react:start  # Frontend (port 5173)
npm run electron:dev # Electron app
```

## Testing against a copy of your library

Anything that deletes or merges books should be tried against a copy, not the
library itself.

```bash
npm run db:test        # 60-book sample copied from the live database
npm run db:test:full   # or the whole thing
npm run db:status      # what each database currently holds
npm run server:test    # run the API against the copy
```

The server prints which database it opened on startup, and background tasks
(scanning, tagging, thumbnails) switch off automatically against a non-default
database — otherwise the scanner would re-import every file and turn the sample
back into the full library. Set `BACKGROUND_TASKS=on` if you want them.

`DATABASE_PATH` selects the file, relative to the project root:

```bash
DATABASE_PATH=./data/test.librarian.db node server/index.js
```

Re-run `npm run db:test` at any point to throw the copy away and start again.

## Development

See [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) for detailed development roadmap and architecture.

### Project Structure

```
Bibliotheka/
├── electron/        # Electron main process
├── src/            # React frontend
├── server/         # Express backend
│   ├── routes/     # API endpoints
│   └── database/   # SQLite setup
├── scripts/        # Build and utility scripts
└── data/          # SQLite database files (generated)
```

### Available Scripts

- `npm start` - Start all components
- `npm run server` - Start backend server only
- `npm run react:start` - Start React dev server
- `npm run electron:dev` - Start Electron (requires React running)
- `npm test` - Run tests
- `npm run build` - Build for production

## Current Status

### Completed Phases

✅ **Phase 1**: Foundation
- Full-stack application running
- Database schema with books, tags, and relationships
- Basic UI with search functionality
- PDF file discovery from Books folder

✅ **Phase 2**: Book Management
- PDF metadata extraction (title, author, page count)
- Language detection (Russian/English)
- Book detail modal with metadata editing
- Tag management system
- Batch processing for metadata extraction

✅ **Phase 3**: CI/CD
- GitHub Actions workflow
- Multi-platform builds (macOS, Windows, Linux)
- Automated releases with artifacts

✅ **Phase 4**: Visual Enhancements
- PDF thumbnail generation from first page
- Double-click to open PDFs
- Visual book cards with covers
- Batch thumbnail generation

✅ **Phase 5**: Advanced Search & Filtering
- Multi-criteria filtering (tags, authors, languages, file types)
- Advanced sorting options (title, author, date, size)
- Combined search and filter functionality
- Sticky navigation and filter bars
- Real-time filtering updates
- Language filter dropdown for multi-language libraries

✅ **Phase 11**: Smart Library Management
- Auto-tagging suggestions with content analysis
- Duplicate detection and merging system
- Language-based filtering

### Next Steps

🚧 **Upcoming Features**:
- PDF-to-image conversion for OCR completion
- Smart collections with rule-based filtering
- Reading statistics dashboard
- Export/import functionality
- Enhanced duplicate detection with file hash comparison

## License

MIT

## Contributing

This is currently a personal project, but contributions are welcome! Feel free to open issues or submit pull requests.

## Author

Bibliotheka Dev Team

---

*Built with ❤️ for book lovers who value privacy and simplicity*