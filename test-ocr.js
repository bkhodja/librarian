const fetch = require('node-fetch');

async function testOCRQueue() {
  const baseUrl = 'http://localhost:3001';

  try {
    // 1. Get OCR stats
    console.log('📊 Getting OCR queue statistics...');
    const statsResponse = await fetch(`${baseUrl}/api/ocr-queue/stats`);
    const stats = await statsResponse.json();
    console.log('OCR Queue Stats:', stats);

    // 2. Get books that need OCR
    console.log('\n🔍 Finding books that need OCR...');
    const needsOCRResponse = await fetch(`${baseUrl}/api/ocr-queue/books-needing-ocr`);
    const needsOCR = await needsOCRResponse.json();
    console.log(`Found ${needsOCR.total} books needing OCR`);

    if (needsOCR.books && needsOCR.books.length > 0) {
      // 3. Add first 3 scanned books to OCR queue
      const booksToProcess = needsOCR.books.slice(0, 3);
      const bookIds = booksToProcess.map(b => b.id);

      console.log('\n📚 Adding books to OCR queue:');
      booksToProcess.forEach(book => {
        console.log(`  - ${book.title} (ID: ${book.id}, Type: ${book.pdf_type})`);
      });

      const addResponse = await fetch(`${baseUrl}/api/ocr-queue/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookIds })
      });

      const addResult = await addResponse.json();
      console.log('\nAdd result:', addResult);

      // 4. Check queue status again
      console.log('\n📊 Updated queue statistics:');
      const updatedStatsResponse = await fetch(`${baseUrl}/api/ocr-queue/stats`);
      const updatedStats = await updatedStatsResponse.json();
      console.log('Updated stats:', updatedStats);

      // 5. Monitor progress for a few seconds
      console.log('\n⏳ Monitoring OCR progress for 30 seconds...');
      let monitorCount = 0;
      const monitorInterval = setInterval(async () => {
        monitorCount++;

        const progressResponse = await fetch(`${baseUrl}/api/ocr-queue/stats`);
        const progressStats = await progressResponse.json();

        console.log(`\n[${new Date().toLocaleTimeString()}] Queue status:`);
        console.log(`  Pending: ${progressStats.queue.pending}`);
        console.log(`  Processing: ${progressStats.queue.processing}`);
        console.log(`  Completed: ${progressStats.queue.completed}`);
        console.log(`  Failed: ${progressStats.queue.failed}`);

        if (monitorCount >= 6 || progressStats.queue.pending === 0 && progressStats.queue.processing === 0) {
          clearInterval(monitorInterval);
          console.log('\n✅ OCR test completed!');
        }
      }, 5000);

    } else {
      console.log('No scanned PDFs found. All books may already be searchable.');

      // Try to find any book and check its OCR status
      const allBooksResponse = await fetch(`${baseUrl}/api/books?limit=10`);
      const allBooks = await allBooksResponse.json();

      if (allBooks.books && allBooks.books.length > 0) {
        console.log('\nSample books and their OCR status:');
        allBooks.books.slice(0, 5).forEach(book => {
          console.log(`  - ${book.title}: pdf_type=${book.pdf_type}, ocr_status=${book.ocr_status || 'N/A'}`);
        });
      }
    }

  } catch (error) {
    console.error('❌ Error testing OCR:', error);
  }
}

// Run the test
testOCRQueue();