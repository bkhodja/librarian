const { fromPath } = require('pdf2pic');
const fs = require('fs');

async function testPdf2pic() {
  try {
    console.log('Testing pdf2pic...');

    // Get the first PDF from database
    const { db } = require('../../server/database/init');
    const book = db.prepare('SELECT * FROM books WHERE id = 1').get();

    if (!book) {
      console.log('No book found');
      return;
    }

    console.log('Processing:', book.file_path);

    // Check if file exists
    if (!fs.existsSync(book.file_path)) {
      console.log('File does not exist:', book.file_path);
      return;
    }

    const options = {
      density: 100,
      saveFilename: 'test',
      savePath: './public/thumbnails',
      format: 'png',
      width: 600,
      height: 800
    };

    const converter = fromPath(book.file_path, options);

    console.log('Converting page 1...');
    const result = await converter(1);

    console.log('Result:', result);
  } catch (error) {
    console.error('Error:', error);
  }
}

testPdf2pic();