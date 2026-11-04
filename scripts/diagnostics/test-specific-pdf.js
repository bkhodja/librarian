const pdfProcessor = require('../../server/services/pdfProcessor');
const contentExtractor = require('../../server/services/pdfContentExtractor');
const pdf = require('pdf-parse');
const fs = require('fs').promises;
const path = require('path');

async function testPDF(filePath) {
  console.log('\n' + '='.repeat(80));
  console.log(`Testing PDF: ${path.basename(filePath)}`);
  console.log('='.repeat(80));

  try {
    // First, let's see what's in the PDF text
    const dataBuffer = await fs.readFile(filePath);
    const data = await pdf(dataBuffer);

    console.log('\n1. PDF METADATA FROM pdf-parse:');
    console.log('--------------------------------');
    console.log('Title:', data.info?.Title || 'Not found');
    console.log('Author:', data.info?.Author || 'Not found');
    console.log('Subject:', data.info?.Subject || 'Not found');
    console.log('Creator:', data.info?.Creator || 'Not found');
    console.log('Producer:', data.info?.Producer || 'Not found');
    console.log('CreationDate:', data.info?.CreationDate || 'Not found');
    console.log('Pages:', data.numpages);
    console.log('PDF Version:', data.version);

    console.log('\n2. FIRST 2000 CHARACTERS OF TEXT:');
    console.log('-----------------------------------');
    const firstText = data.text.substring(0, 2000);
    console.log(firstText);

    console.log('\n3. CONTENT EXTRACTION RESULTS:');
    console.log('--------------------------------');
    const extractedContent = await contentExtractor.extractFromContent(filePath);
    console.log('ISBN:', extractedContent?.isbn || 'Not found');
    console.log('Publisher:', extractedContent?.publisher || 'Not found');
    console.log('Publication Year:', extractedContent?.publicationYear || 'Not found');
    console.log('Authors:', extractedContent?.authors || 'Not found');
    console.log('Edition:', extractedContent?.edition || 'Not found');
    console.log('Description:', extractedContent?.description ?
      extractedContent.description.substring(0, 200) + '...' : 'Not found');

    // Let's also search for ISBN in the text manually
    console.log('\n4. MANUAL ISBN SEARCH:');
    console.log('-----------------------');
    const isbnMatches = data.text.match(/978[\d\-\s]{10,}/g);
    if (isbnMatches) {
      console.log('Found potential ISBNs:');
      isbnMatches.forEach(isbn => console.log('  -', isbn));
    } else {
      console.log('No ISBN patterns found');
    }

    // Search for publisher patterns
    console.log('\n5. MANUAL PUBLISHER SEARCH:');
    console.log('----------------------------');
    const publisherPatterns = [
      /Published by ([^,\n]+)/i,
      /Publisher:\s*([^,\n]+)/i,
      /©.*?by\s+([^,\n]+)/i,
    ];

    for (const pattern of publisherPatterns) {
      const match = data.text.match(pattern);
      if (match) {
        console.log(`Found with pattern "${pattern.source}":`, match[1]);
        break;
      }
    }

    // Let's look for the ISBN from the filename
    console.log('\n6. FILENAME ANALYSIS:');
    console.log('----------------------');
    const filename = path.basename(filePath);
    console.log('Filename:', filename);
    const filenameISBN = filename.match(/978\d{10}/);
    if (filenameISBN) {
      console.log('ISBN from filename:', filenameISBN[0]);
    }

  } catch (error) {
    console.error('Error processing PDF:', error.message);
  }
}

// Process the specific PDF
const pdfPath = process.argv[2];
if (!pdfPath) {
  console.log('Usage: node test-specific-pdf.js /path/to/pdf');
  console.log('Example: node test-specific-pdf.js /Volumes/Storage/Books/9781806382972-txt.pdf');
} else {
  testPDF(pdfPath);
}