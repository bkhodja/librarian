// Test script for ePUB functionality
const fs = require('fs');
const path = require('path');

console.log('🧪 Testing ePUB Support...\n');

// Check if ePUB processor exists
console.log('1. Checking ePUB processor...');
try {
  const epubProcessor = require('./server/services/epubProcessor');
  console.log('✅ ePUB processor loaded successfully');
} catch (error) {
  console.error('❌ Failed to load ePUB processor:', error.message);
  process.exit(1);
}

// Check if required dependencies are installed
console.log('\n2. Checking dependencies...');
const dependencies = ['epub', 'epub-parser', 'jszip', 'xml2js'];
let allDepsFound = true;

dependencies.forEach(dep => {
  try {
    require(dep);
    console.log(`✅ ${dep} found`);
  } catch (error) {
    console.error(`❌ ${dep} not found`);
    allDepsFound = false;
  }
});

if (!allDepsFound) {
  console.error('\n❌ Some dependencies are missing. Run: npm install');
  process.exit(1);
}

// Check if background task manager handles ePUB files
console.log('\n3. Checking background task manager...');
const bgManagerPath = './server/services/backgroundTaskManager.js';
const bgManagerContent = fs.readFileSync(bgManagerPath, 'utf8');

if (bgManagerContent.includes('epubProcessor')) {
  console.log('✅ Background task manager configured for ePUB files');
} else {
  console.log('❌ Background task manager not configured for ePUB files');
}

// Check if server can serve ePUB files
console.log('\n4. Checking server configuration...');
const serverPath = './server/index.js';
const serverContent = fs.readFileSync(serverPath, 'utf8');

if (serverContent.includes('application/epub+zip')) {
  console.log('✅ Server configured to serve ePUB files');
} else {
  console.log('❌ Server not configured to serve ePUB files');
}

// Check if frontend has ePUB viewer
console.log('\n5. Checking frontend components...');
const epubViewerPath = './src/components/EpubViewer.jsx';

if (fs.existsSync(epubViewerPath)) {
  console.log('✅ ePUB viewer component exists');
} else {
  console.log('❌ ePUB viewer component not found');
}

// Check if App.jsx integrates ePUB viewer
const appPath = './src/App.jsx';
const appContent = fs.readFileSync(appPath, 'utf8');

if (appContent.includes('EpubViewer')) {
  console.log('✅ ePUB viewer integrated in App.jsx');
} else {
  console.log('❌ ePUB viewer not integrated in App.jsx');
}

// Test ePUB processor with a sample path (if exists)
console.log('\n6. Testing ePUB processor functionality...');
const epubProcessor = require('./server/services/epubProcessor');

// Create a test to see if the processor methods exist
if (
  typeof epubProcessor.processEpub === 'function' &&
  typeof epubProcessor.extractMetadata === 'function' &&
  typeof epubProcessor.extractContent === 'function' &&
  typeof epubProcessor.generateThumbnail === 'function'
) {
  console.log('✅ All ePUB processor methods are defined');
} else {
  console.log('❌ Some ePUB processor methods are missing');
}

console.log('\n✨ ePUB support testing complete!');
console.log('\nNext steps:');
console.log('1. Place some .epub files in /Volumes/Storage/Books');
console.log('2. Restart the server to trigger the background scanner');
console.log('3. Check if ePUB files appear in the library');
console.log('4. Try opening an ePUB file to test the viewer');