require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const winston = require('winston');

// Import routes (to be created)
const booksRouter = require('./routes/books');
const scanRouter = require('./routes/scan');
const tagsRouter = require('./routes/tags');
const categoriesRouter = require('./routes/categories');
const processRouter = require('./routes/process');
const collectionsRouter = require('./routes/collections');
const searchRouter = require('./routes/search');
const ocrRouter = require('./routes/ocr');
const progressRouter = require('./routes/progress');
const ocrQueueRouter = require('./routes/ocrQueue');
const duplicatesRouter = require('./routes/duplicates');
const autoTagsRouter = require('./routes/autoTags');
const aiTagsRouter = require('./routes/aiTags');
const askRouter = require('./routes/ask');
const preferencesRouter = require('./routes/preferences');
const semanticSearchRouter = require('./routes/semanticSearch');
const summariesRouter = require('./routes/summaries');
const compareRouter = require('./routes/compare');

// Initialize database
const db = require('./database/init');

// Initialize background task manager
const backgroundTaskManager = require('./services/backgroundTaskManager');
const ocrQueueManager = require('./services/ocrQueueManager');

// Configure logger
//
// The server runs for months under launchd, so the files are capped: each
// rotates at 5MB and keeps three generations (combined.log is the newest).
// Uncapped, a line per request — mostly the UI polling /api/books — grew
// combined.log to 35MB. LOG_LEVEL=debug brings the request lines back.
const rotating = { maxsize: 5 * 1024 * 1024, maxFiles: 3, tailable: true };
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error', ...rotating }),
    new winston.transports.File({ filename: 'combined.log', ...rotating }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// A stray error in a background job used to take the whole server down, with
// the reason visible only in the terminal that launched it — and nothing
// restarts the server, so the app sat dead until relaunched. Log it to
// error.log and carry on: for a personal library a lost thumbnail is far
// cheaper than a dead backend.
process.on('uncaughtException', (error, origin) => {
  logger.error('Uncaught exception (server kept running)', { origin, stack: error.stack });
  console.error('Uncaught exception (server kept running):', error);
});

process.on('unhandledRejection', (reason) => {
  const stack = reason && reason.stack ? reason.stack : String(reason);
  logger.error('Unhandled rejection (server kept running)', { stack });
  console.error('Unhandled rejection (server kept running):', reason);
});

// Create Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Loopback only by default: nothing else on the network should reach the
// library. HOST=0.0.0.0 to share it.
const HOST = process.env.HOST || '127.0.0.1';
const LOOPBACK_ONLY = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const hostnameOf = (host) => (host || '').replace(/:\d+$/, '').toLowerCase();

// Only the app's own pages may use the API: the UI served from this port, and
// the Vite dev server that `npm run ui` loads into Electron. With cors()'s old
// wildcard, any website open in the browser could read the API's responses
// (and through /pdf, any file on disk); a cross-site form POST could reach
// endpoints like bulk delete, which now moves files to the Trash.
const DEV_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);
const isAppOrigin = (origin, host) =>
  DEV_ORIGINS.has(origin) || origin === `http://${host}`;

app.use((req, res, next) => {
  // A DNS-rebinding page reaches 127.0.0.1 under its own hostname; refuse any
  // Host that isn't a loopback name while we're only listening on loopback.
  if (LOOPBACK_ONLY && !LOOPBACK_NAMES.has(hostnameOf(req.headers.host))) {
    return res.status(403).json({ error: 'Forbidden host' });
  }
  // Browsers send Origin on every cross-origin request except plain GETs, and
  // CORS below keeps those GETs' responses unreadable.
  const origin = req.headers.origin;
  if (origin && !isAppOrigin(origin, req.headers.host)) {
    return res.status(403).json({ error: 'Forbidden origin' });
  }
  next();
});

// Any Origin still here is the app's own, so reflecting it is safe.
app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Serve PDF and ePUB files from the books folder, by absolute path
// (/pdf/Volumes/Storage/Books/x.pdf). Anything outside it is refused: this
// route once served any file on the disk to whoever asked.
const BOOKS_FOLDER = path.resolve(process.env.BOOKS_FOLDER || '/Volumes/Storage/Books');
const BOOK_TYPES = { '.pdf': 'application/pdf', '.epub': 'application/epub+zip' };

app.use('/pdf', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next();
  }

  const fs = require('fs');

  // realpath on both sides, so neither `..` nor a symlink inside the folder
  // can lead out of it. It throws for a missing file or unmounted drive, and
  // decodeURIComponent for a malformed escape.
  let realFile, contentType;
  try {
    realFile = fs.realpathSync(path.resolve(decodeURIComponent(req.path)));
    contentType = BOOK_TYPES[path.extname(realFile).toLowerCase()];
    if (!contentType || !realFile.startsWith(fs.realpathSync(BOOKS_FOLDER) + path.sep)) {
      return res.status(404).json({ error: 'File not found' });
    }
  } catch {
    console.log('File not found:', req.path);
    return res.status(404).json({ error: 'File not found' });
  }

  res.setHeader('Content-Type', contentType);
  if (req.method === 'HEAD') {
    res.setHeader('Content-Length', fs.statSync(realFile).size);
    return res.end();
  }
  res.sendFile(realFile);
});

// Request logging
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// API Routes
app.use('/api/books', booksRouter);
app.use('/api/scan', scanRouter);
app.use('/api/tags', tagsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/process', processRouter);
app.use('/api/collections', collectionsRouter);
app.use('/api/search', searchRouter);
app.use('/api/ocr', ocrRouter);
app.use('/api/progress', progressRouter);
app.use('/api/ocr-queue', ocrQueueRouter);
app.use('/api/duplicates', duplicatesRouter);
app.use('/api/auto-tags', autoTagsRouter);
app.use('/api/ai-tags', aiTagsRouter);
app.use('/api/ask', askRouter);
app.use('/api/preferences', preferencesRouter);
app.use('/api/search', semanticSearchRouter);
app.use('/api/summaries', summariesRouter);
app.use('/api/compare', compareRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Statistics endpoint
app.get('/api/stats', (req, res) => {
  try {
    const stats = db.getStats();
    res.json(stats);
  } catch (error) {
    logger.error('Failed to get stats:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

// The built UI (`npm run react:build`), so the always-on backend is also the
// app: http://localhost:3001 works whenever the launchd agent is up, with no
// Vite or Electron running. dist/ is only as fresh as the last build.
const distDir = path.join(__dirname, '../dist');
app.use(express.static(distDir));

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, HOST, async () => {
  logger.info(`Server running on ${HOST}:${PORT}`);
  console.log(`\n🚀 Librarian server running on http://localhost:${PORT}\n`);
  if (!require('fs').existsSync(path.join(distDir, 'index.html'))) {
    console.log('ℹ️  No built UI in dist/ — run `npm run react:build` to serve the app from this port.');
  }

  // Initialize background tasks
  //
  // Off by default against a non-default database: the scanner would re-import
  // every file from the books folder, which turns a deliberately small test
  // fixture back into the whole library, and then spend minutes tagging and
  // thumbnailing it. Set BACKGROUND_TASKS=on to override.
  const backgroundDefault = db.isDefaultDatabase ? 'on' : 'off';
  const backgroundTasks = (process.env.BACKGROUND_TASKS || backgroundDefault).toLowerCase();

  if (backgroundTasks === 'off') {
    console.log('⏸️  Background tasks are off (scanning, tagging, thumbnails). Set BACKGROUND_TASKS=on to enable.');
    logger.info('Background tasks disabled');
    return;
  }

  try {
    await backgroundTaskManager.initialize();
    logger.info('Background tasks initialized');

    // Initialize OCR queue manager - DISABLED due to crashes
    // await ocrQueueManager.initialize();
    // logger.info('OCR queue manager initialized');
  } catch (error) {
    logger.error('Failed to initialize background tasks:', error);
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await backgroundTaskManager.shutdown();
  // await ocrQueueManager.shutdown();
  db.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await backgroundTaskManager.shutdown();
  // await ocrQueueManager.shutdown();
  db.close();
  process.exit(0);
});

module.exports = app;