# Librarian - Personal Book Catalog

A powerful desktop application for cataloging and managing your personal PDF book collection on macOS.

## Features

### Core Features
- 📚 **PDF Discovery & Import** - Automatically scan and import PDFs from your Books folder
- 📰 **Magazines** - a second section fed from a Magazines folder (one folder
  per magazine, its issues inside). Same covers, text, tags and search as
  books; the sidebar lists each magazine, its issues newest first. Collections
  can hold both
- 🔄 **Looks after itself** - runs as a background service; every book that
  lands in the folder gets a cover, metadata, subject tags and its full text
  (OCR for scans) without being asked. Cards flag what is still pending
- 🗑️ **Deleting a book moves its file to the Trash** - select one or many
  (books or magazines) and press Delete, or use Delete in a book's details;
  a confirmation lists what will go. Merging duplicates removes the copies
  from disk too (recoverable from the Trash)
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
- 🗨️ **Library chat** — "I want to learn PostgreSQL: where do I start, and
  what next?" gets a reading path through the books you own, easiest first,
  with a line on why each one follows. Every book is profiled in the
  background (level 1-5, audience, prerequisites) from its opening pages; the
  chat skips what you have finished, picks up what you are reading, answers in
  your language, and keeps past conversations. Cited books open with a click
- 📖 **Compare across books** — "how do my books explain gradient descent?"
  puts one passage from each book that teaches it side by side, with the page
  numbers, so you can see which treatment suits you before opening anything
- 📚 **Smart collections** — shelves proposed from what your library actually
  contains
- 📝 **Summaries** and **metadata repair** — run-together filenames turned back
  into titles, missing authors read off the front matter
- 🧠 **Semantic search** and **Similar Books** over local, multilingual
  embeddings — a Russian query finds English books and back. Every book is
  embedded in the background; the model (~145MB) is fetched once into
  `data/models/` on first use

Setup:

```bash
brew install ollama && ollama serve
ollama pull qwen3.6:35b-a3b   # summaries, Ask, compare, tagging (~24GB RAM)
ollama pull gemma3:4b         # cheap first pass of the adult-content check
```

On a machine that cannot hold the larger model, set `OLLAMA_MODEL=gemma3:4b`
in `.env`; everything works, with shorter, less precise answers.

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

- **Frontend**: React 19 + Vite + Tailwind CSS
- **Desktop**: Electron 40
- **Backend**: Express.js + Node.js
- **Database**: SQLite with better-sqlite3
- **PDF Processing**:
  - pdf-parse (metadata extraction)
  - Apple Vision (OCR for scanned PDFs on macOS; Tesseract.js elsewhere)
  - pdf2pic + GraphicsMagick (thumbnail generation)
- **Local AI**: Ollama
- **Tests**: Jest
- **Build System**: GitHub Actions CI/CD

## Getting Started

### Prerequisites

- Node.js 22 LTS
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
```bash
cp .env.example .env
# then set BOOKS_FOLDER=/path/to/your/Books
# and, optionally, MAGAZINES_FOLDER=/path/to/your/Magazines
```
`.env.example` documents every other setting (port, database, OCR, Ollama
models, batch sizes).

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

## Running the backend all the time (macOS)

The backend can run as a launchd agent so new books are ingested whenever they
land, whether or not the window is open. The agent definition is in
`launchd/com.khodjayevb.bibliotheka.plist` (adjust the paths for your machine):

```bash
ln -sf "$PWD/launchd/com.khodjayevb.bibliotheka.plist" ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.khodjayevb.bibliotheka.plist
launchctl kickstart -k gui/$(id -u)/com.khodjayevb.bibliotheka   # restart
launchctl bootout gui/$(id -u)/com.khodjayevb.bibliotheka        # stop
```

Logs go to `logs/server.log` and `logs/server.err.log`. The server also
writes `combined.log` and `error.log` in the project root; each rotates at 5MB
and keeps three files. Requests are not logged unless `LOG_LEVEL=debug`.
`logs/server.log` is launchd's own capture of the console and is not rotated;
it grows by a few MB a month and is safe to truncate.

Two things to know:

- **Grant `node` Full Disk Access** (System Settings → Privacy & Security →
  Full Disk Access → "+", then ⌘⇧G and paste the path from the plist). In a
  terminal, `node` inherits the terminal's access to external volumes; under
  launchd it has none, and the very first `readdir` of the books folder blocks
  forever with no error. The grant is tied to that exact binary, so re-grant
  after a Node upgrade.
- **Start the window with `npm run ui`, not `npm start`.** `npm start` launches
  its own backend and collides with the agent on port 3001.

### The app at http://localhost:3001

The agent also serves the built UI, so the library is always one bookmark
away — no Vite, no Electron, nothing to start (the same arrangement as
pdf-grabber's dashboard on :8765). In Safari, File → Add to Dock turns it into
an app with its own icon and window.

It serves whatever is in `dist/`, so rebuild after changing the frontend, and
restart the agent after changing the server (it runs plain `node`, not
nodemon):

```bash
npm run react:build                                        # frontend changes
launchctl kickstart -k gui/$(id -u)/com.khodjayevb.bibliotheka   # server changes
```

The server listens on 127.0.0.1 only; set `HOST=0.0.0.0` in `.env` to reach it
from other devices. Only the app's own pages (this port, and Vite on 5173) may
call the API — other websites get a 403 — and `/pdf` serves only `.pdf` and
`.epub` files inside `BOOKS_FOLDER` or `MAGAZINES_FOLDER`.

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
├── scripts/        # Maintenance scripts (run from the project root)
│   └── diagnostics/ # One-off investigation scripts against the live library
├── tests/          # Jest unit tests (npm test)
├── tools/visionocr/ # Swift OCR helper, built on first use
├── launchd/        # The always-on agent definition
└── data/           # SQLite database files (generated)
```

### Maintenance scripts

Run from the project root, e.g. `node scripts/retag-books.js --dry-run`. Each
opens the database `DATABASE_PATH` selects, so try them on a copy first.

- `scripts/index-pages.js` - index book pages for search (`--ocr` forces OCR)
- `scripts/retag-books.js` - normalise tags and tag untagged books
- `scripts/profile-books.js` - profile books for the library chat
  (`--tag=databases`, `--ids=12,40`, `--limit=50`)
- `scripts/repair-metadata.js` / `scripts/repair-with-ai.js` - fix titles and authors
- `scripts/enrich-all-metadata.js` - look books up on Open Library / Google Books
- `scripts/reprocess-books.js`, `scripts/reprocess-epub.js`,
  `scripts/regenerate-epub-thumbnails.js`, `scripts/index-books-fts.js`

### Available Scripts

- `npm start` - Start all components
- `npm run ui` - Frontend and Electron only (backend already running as a launchd agent)
- `npm run server` - Start backend server only
- `npm run react:start` - Start React dev server
- `npm run electron:dev` - Start Electron (requires React running)
- `npm test` - Run the unit tests (against a throwaway database, never the library)
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

Phases 6-10 and 13-18 (collections, dark mode, full-text search and OCR,
the reader, semantic search, summaries, local AI, always on, library chat,
magazines) are recorded in
[DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md).

### Next Steps

🚧 **Upcoming Features**:
- Daily/weekly/monthly reading statistics
- Export/import functionality
- A vocabulary decision for the 11 books no model can tag

## License

MIT

## Contributing

This is currently a personal project, but contributions are welcome! Feel free to open issues or submit pull requests.

## Author

Bibliotheka Dev Team

---

*Built with ❤️ for book lovers who value privacy and simplicity*