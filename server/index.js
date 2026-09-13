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
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
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

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Serve PDF and ePUB files - using middleware approach
app.use('/pdf', (req, res, next) => {
  // Handle both GET and HEAD requests for PDFs and ePUBs
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next();
  }

  // req.path gives us everything after /pdf, but we need the full path
  // Since the paths in the database start with /, we just use req.path directly
  const fullPath = decodeURIComponent(req.path);

  // Check if file exists and send it
  const fs = require('fs');
  if (fs.existsSync(fullPath)) {
    // Determine content type based on file extension
    const ext = path.extname(fullPath).toLowerCase();
    let contentType = 'application/octet-stream';

    if (ext === '.pdf') {
      contentType = 'application/pdf';
    } else if (ext === '.epub') {
      contentType = 'application/epub+zip';
    }

    // Set appropriate headers
    res.setHeader('Content-Type', contentType);

    if (req.method === 'HEAD') {
      // For HEAD requests, just send headers without body
      const stats = fs.statSync(fullPath);
      res.setHeader('Content-Length', stats.size);
      res.end();
    } else {
      // For GET requests, send the file
      const absolutePath = path.resolve(fullPath);
      res.sendFile(absolutePath);
    }
  } else {
    console.log('File not found:', fullPath);
    res.status(404).json({ error: 'File not found', path: fullPath });
  }
});

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
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
app.listen(PORT, async () => {
  logger.info(`Server running on port ${PORT}`);
  console.log(`\n🚀 Librarian server running on http://localhost:${PORT}\n`);

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