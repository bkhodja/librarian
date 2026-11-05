# Bibliotheka: a personal library for books and magazines

A desktop library for a large collection of PDF and ePUB books and magazines
on macOS. Drop files into a folder and they turn up with a cover, clean
metadata, subject tags and full, searchable text, scanned books included.
Read them in the app, search inside them, and ask a local AI what to read and
in what order.

Everything runs on your own machine. There are no accounts and no API keys,
and nothing is uploaded; the AI is a local model through
[Ollama](https://ollama.com). It is built for a real library: about 5,300
books, mostly Russian and English, plus 200 magazine issues.

- [Core features](#core-features)
- [Architecture at a glance](#architecture-at-a-glance)
- [Getting started](#getting-started)
- [Running it all the time](#running-it-all-the-time-macos)
- [Configuration](#configuration)
- [Testing against a copy of your library](#testing-against-a-copy-of-your-library)
- [Development](#development)
- [Documentation](#documentation)

## Core features

### A library that looks after itself

- **Books and magazines.** Two sections, each fed by its own folder
  (`BOOKS_FOLDER`, `MAGAZINES_FOLDER`). Magazines are organised one folder
  per magazine, with its issues inside. The sidebar lists every magazine, and
  a magazine shows its issues newest first, by the date in each file name.
- **Automatic ingestion.** A file that lands in either folder is picked up
  within seconds by a watcher, and an hourly scan catches anything the
  watcher missed. It then gets:
  - a cover from its first page (or the ePUB's own cover),
  - title, author, language, ISBN, year and page count,
  - a file fingerprint for spotting duplicates,
  - the full text of every page,
  - subject tags,
  - an adult-content check,
  - a semantic embedding,
  - for books, a difficulty profile.

  All of it runs in the background. Cards flag what is still pending
  (*Unscanned*, *Untagged*, *No text*).
- **Scanned books become searchable.** Scans are read with Apple's Vision
  framework (Tesseract elsewhere), in a low-priority background process, one
  book at a time, fewest pages first.
- **Metadata that reads like metadata.** Run-together file names
  (`architectingpowerbisolutions`), ISBNs, "Untitled", "Microsoft Word -
  x.doc" and download-site names are rejected as titles in favour of the
  best alternative. A book with a poor title but a good ISBN is looked up
  on Open Library or Google Books.
- **Subject tags from a fixed vocabulary** of 83 subjects (python, databases,
  machine-learning, security, cooking…). That way "Python", "python3" and
  "python-programming" can't become three different tags.
- **Collections.** Shelves you create; they can hold books and magazines.
  *Suggest shelves* proposes groupings from what your library actually holds.
- **Duplicates.** Found by identical file or by similar title and author,
  across scripts ("Изучаем PHP" never matches an unrelated PHP book). You
  choose the copy to keep, and the others go to the Trash.
- **Delete.** Three ways to delete:
  - on a card (hover),
  - at the top of a book's details,
  - from the header for several at once.

  A confirmation lists what will go. The item leaves the library and its file
  goes to the Trash, from where it can still be restored.

### Reading

- **In-app readers** for PDF and ePUB, with zoom and keyboard navigation.
  Reading progress is saved as you turn pages. *Currently Reading* lists
  books in progress; a dashboard shows reading statistics.
- **Hide adult content** with one preference. Flags need two models to agree,
  because hiding the wrong book is a visible mistake.

### Finding things

- **Filters and sort** over the whole section: tags (all must match), author,
  language, file type, title, date added and size. They update as you type.
- **Ask (header box).** A sentence such as "russian books about business added
  recently" sets the filters it means, and you can see and adjust them.
- **Full-text search** inside every page, with snippets, page numbers, match
  counts and a per-book heatmap of where a term appears.
- **Semantic search and Similar Books** over multilingual embeddings: a
  Russian query finds English books and back. Similar Books stays in its own
  section.

### Local AI

All local, through Ollama. Without it the app still runs: AI features say
they are unavailable and tagging falls back to keyword matching.

- **Library chat.** A panel you can open from any view.
  - Ask "I want to learn PostgreSQL. Where do I start, and what next?" and
    get a reading path through *your* books, easiest first, with a line on
    why each one comes next.
  - It knows each book's level (1–5), audience and prerequisites. It skips
    what you've finished, suggests finishing what you're halfway through,
    and offers magazines as extra reading.
  - It answers in your language and keeps past conversations. Each book it
    cites is a chip you can click to open.
- **Ask a book.** A question answered from that book's own pages, with the
  pages cited, and a plain "not answered by this book" when it isn't.
- **Compare across books.** "How do my books explain gradient descent?" puts
  the best passage from each book side by side, with page numbers.
- **Summaries** of a whole book, scaled to its length.
- **Difficulty profiles.** Every book's opening pages (contents, preface)
  are read once in the background to judge its level, kind (intro,
  tutorial, reference, internals…), audience and prerequisites.

## Architecture at a glance

```
 Browser (:3001) / Electron ──REST + SSE──▶ Express server  (launchd agent, always on)
                                              ├─ Background tasks: watcher, scans, covers, metadata,
                                              │   page text, OCR (nice'd child), tags, embeddings, profiles
                                              ├─ Worker threads: PDF/ePUB parsing, page extraction
                                              ├─ transformers.js: multilingual embeddings (in-process)
                                              ├─▶ Ollama :11434  (qwen3.6:35b-a3b, gemma3:4b)
                                              ├─▶ SQLite  data/librarian.db  (catalogue, page text, FTS5, vectors, chat)
                                              └─▶ /Volumes/Storage/{Books,Magazines}  (files; deletes go to the Trash)
```

| Layer | Technology |
|---|---|
| Interface | React 19, Vite 7, Tailwind CSS 3, react-pdf, react-reader, react-markdown |
| Desktop shell | Electron 45 (or any browser at http://localhost:3001) |
| Server | Node.js 22, Express 5, winston |
| Storage | SQLite (better-sqlite3), FTS5 full-text indexes, WAL |
| Documents | pdf-parse, pdf.js, pdf2pic + GraphicsMagick/Ghostscript, sharp, franc |
| OCR | Apple Vision (Swift helper in `tools/visionocr`), Tesseract.js fallback |
| AI | Ollama (`qwen3.6:35b-a3b`, `gemma3:4b`); `@huggingface/transformers` with `paraphrase-multilingual-MiniLM-L12-v2` |
| Quality | Jest, GitHub Actions (tests, audit, Electron builds for macOS/Windows/Linux) |

The details are in **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**:
processes, the ingestion pipeline, every background task, the data model,
search, the AI pipelines, the chat, the interface, security and design
decisions.

## Getting started

### Prerequisites

- macOS (the primary platform), Node.js 22 and npm 11
- GraphicsMagick and Ghostscript for covers:
  ```bash
  brew install graphicsmagick ghostscript
  ```
- Xcode command-line tools, optional, for Apple Vision OCR. The helper is
  compiled on first use; without it OCR uses Tesseract.
- Ollama, optional but recommended, for the AI features:
  ```bash
  brew install ollama && ollama serve
  ollama pull qwen3.6:35b-a3b   # tagging, summaries, Ask, compare, profiles, chat (~24 GB RAM)
  ollama pull gemma3:4b         # cheap first pass of the adult-content check
  ```
  On a machine that can't hold the larger model, set `OLLAMA_MODEL=gemma3:4b`;
  everything works, with shorter, less precise answers.

The embedding model (about 145 MB) downloads itself into `data/models/` on
first use.

### Install and run

```bash
git clone https://github.com/bkhodja/librarian.git Bibliotheka
cd Bibliotheka
npm install
cp .env.example .env     # set BOOKS_FOLDER, and MAGAZINES_FOLDER if you have one
npm start                # backend (:3001) + Electron
```

Or run the parts separately:

```bash
npm run server        # backend API on :3001 (nodemon)
npm run react:start   # interface on :5173 (Vite)
npm run electron:dev  # Electron window (needs Vite running)
```

## Running it all the time (macOS)

The backend can run as a launchd agent, so new books are ingested whenever
they land, whether or not a window is open. The agent definition is
`launchd/com.khodjayevb.bibliotheka.plist`; adjust its paths for your
machine.

```bash
ln -sf "$PWD/launchd/com.khodjayevb.bibliotheka.plist" ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.khodjayevb.bibliotheka.plist
launchctl kickstart -k gui/$(id -u)/com.khodjayevb.bibliotheka   # restart
launchctl bootout gui/$(id -u)/com.khodjayevb.bibliotheka        # stop
```

Two things to know:

- **Grant `node` Full Disk Access.** Go to System Settings → Privacy &
  Security → Full Disk Access → "+", then press ⌘⇧G and paste the path from
  the plist. In a terminal, `node` inherits the terminal's access to external
  drives. Under launchd it has none, and the first `readdir` of the books
  folder hangs forever with no error. The grant is tied to that exact binary,
  so grant it again after a Node upgrade.
- **Start the window with `npm run ui`, not `npm start`.** `npm start`
  launches its own backend, which collides with the agent on port 3001.

### The app at http://localhost:3001

The agent also serves the built interface, so the library is always one
bookmark away, with nothing to start. In Safari, File → Add to Dock turns it
into an app with its own icon and window.

It serves whatever is in `dist/`. Rebuild after changing the interface, and
restart the agent after changing the server, since it runs plain `node`, not
nodemon:

```bash
npm run react:build                                              # interface changes
launchctl kickstart -k gui/$(id -u)/com.khodjayevb.bibliotheka   # server changes
```

Logs are in `logs/server.log` and `logs/server.err.log` (launchd's capture),
plus `combined.log` and `error.log` (winston, rotated at 5 MB, three kept).
Requests are logged only with `LOG_LEVEL=debug`.

## Configuration

`.env.example` documents every setting. The main ones:

| Setting | Default | |
|---|---|---|
| `BOOKS_FOLDER` | `/Volumes/Storage/Books` | Where books live |
| `MAGAZINES_FOLDER` | `/Volumes/Storage/Magazines` | One folder per magazine (optional) |
| `DATABASE_PATH` | `./data/librarian.db` | Point at a copy for experiments |
| `PORT` / `HOST` | `3001` / `127.0.0.1` | `HOST=0.0.0.0` makes it reachable from other devices |
| `OLLAMA_MODEL` | `qwen3.6:35b-a3b` | The local model for every AI feature; `CHAT_MODEL`, `PROFILE_MODEL`, `SUMMARY_MODEL` override per feature |
| `OCR_BACKGROUND` | `on` | Read scanned books in the background |
| `BACKGROUND_TASKS` | on for the main database | Off by default for any copy, so it isn't refilled from disk |
| `GOOGLE_BOOKS_API_KEY` | — | Optional; raises the Google Books quota for ISBN lookups |

Security:
- The server listens on loopback only.
- Only the app's own pages may call the API; other websites get a 403.
- `/pdf` serves only `.pdf` and `.epub` files inside the two library folders.

## Testing against a copy of your library

Anything that deletes or merges books should be tried on a copy first.

```bash
npm run db:test        # 60-book sample copied from the live database
npm run db:test:full   # or the whole thing
npm run db:status      # what each database holds
npm run server:test    # run the API against the copy
```

The server prints which database it opened. Background tasks switch off
against a non-default database; set `BACKGROUND_TASKS=on` if you want them.
To copy a database the server is busy writing to, use
`sqlite3 data/librarian.db "VACUUM INTO 'data/copy.db'"`. The shell's
`.backup` restarts every time the source changes and may never finish.

## Development

### Project structure

```
Bibliotheka/
├── server/            Express API: routes/, services/ (one concern each), database/init.js
├── src/               React interface: App.jsx, components/, hooks/, utils/
├── electron/          Electron main process and preload bridge
├── scripts/           Maintenance scripts (diagnostics/ for one-off checks)
├── tests/             Jest unit tests, always against a throwaway database
├── tools/visionocr/   Swift OCR helper, compiled on first use
├── launchd/           The always-on agent definition
├── docs/              Architecture and design notes
└── data/              Database, test copies, downloaded embedding model
```

### npm scripts

| Script | |
|---|---|
| `npm start` | Backend and Electron |
| `npm run ui` | Vite and Electron only, when the backend runs as the launchd agent |
| `npm run server` / `server:prod` | Backend with nodemon / plain node |
| `npm run react:start` / `react:build` | Vite dev server / build to `dist/` |
| `npm test` | Unit tests |
| `npm run build` | Interface plus Electron package |
| `npm run package:mac` / `:win` / `:linux` | Platform packages |

### Maintenance scripts

Run from the project root, e.g. `node scripts/retag-books.js --normalize`.
Each opens whichever database `DATABASE_PATH` selects, so try them on a copy
first.

- `scripts/index-pages.js`: extract page text for search (`--ocr` forces OCR)
- `scripts/retag-books.js`: normalise tags and tag untagged books
- `scripts/profile-books.js`: difficulty profiles for the library chat
  (`--tag=databases`, `--ids=12,40`, `--limit=50`)
- `scripts/repair-metadata.js`: fix titles and authors locally, then by ISBN
  (`--local`, `--dry-run`)
- `scripts/repair-with-ai.js`: fix titles and authors with the local model
- `scripts/enrich-all-metadata.js`: look books up on Open Library / Google Books
- `scripts/reprocess-books.js`, `scripts/reprocess-epub.js`,
  `scripts/regenerate-epub-thumbnails.js`, `scripts/index-books-fts.js`

### Tests and CI

`npm test` runs Jest against a temporary database and fake library folders,
with Ollama and the embedding model mocked where needed. Every push to `main`
runs GitHub Actions:
- the tests,
- the build,
- `npm audit --audit-level=high`,
- Electron packages for macOS, Windows and Linux,
- a draft release.

## Documentation

| Document | What it covers |
|---|---|
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | How it works: processes, pipeline, background tasks, data model, search, AI, chat, interface, security, configuration, design decisions |
| [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) | History: every phase, what was found and fixed, the changelog |
| [docs/PAGE_SEARCH_IMPLEMENTATION.md](./docs/PAGE_SEARCH_IMPLEMENTATION.md) | Notes on page-level search |
| [.env.example](./.env.example) | Every setting, with comments |

### What's next

- Daily, weekly and monthly reading statistics
- Export and import
- A vocabulary decision for the 11 books no model can tag

## License

MIT. A personal project; issues and pull requests are welcome.
