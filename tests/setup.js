// Some services open the database as soon as they are required. Point every
// test run at a throwaway file so nothing a test does can reach the library.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bibliotheka-test-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
process.env.BACKGROUND_TASKS = 'off';
// Folders that cannot exist, so no test can see the real library's files.
process.env.BOOKS_FOLDER = '/test-library/Books';
process.env.MAGAZINES_FOLDER = '/test-library/Magazines';

// The schema setup announces every table and column it creates.
jest.spyOn(console, 'log').mockImplementation(() => {});
