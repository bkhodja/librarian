const detector = require('../server/services/duplicateDetector');

describe('normalizeTitle', () => {
  test('keeps letters of every script', () => {
    // \w is ASCII-only: every Russian title containing "PHP" once
    // normalised to "php", and eleven unrelated books became one group.
    expect(detector.normalizeTitle('Изучаем PHP 7: руководство')).toBe('изучаем php 7 руководство');
  });

  test('drops punctuation and a leading article', () => {
    expect(detector.normalizeTitle('The Pragmatic Programmer!')).toBe('pragmatic programmer');
  });
});

describe('isMatchableTitle', () => {
  test.each([
    'tit.indd',
    'Урок',
    'Microsoft Word - x.doc',
    'Untitled'
  ])('junk title %p never groups books', (title) => {
    expect(detector.isMatchableTitle(detector.normalizeTitle(title))).toBe(false);
  });

  test('a real title does', () => {
    expect(detector.isMatchableTitle(detector.normalizeTitle('Clean Architecture'))).toBe(true);
  });
});

describe('compare', () => {
  test('identical files match with certainty whatever their titles', () => {
    expect(detector.compare(
      { title: 'scan_0001', file_hash: 'abc' },
      { title: 'Something Else Entirely', file_hash: 'abc' }
    )).toEqual({ confidence: 1, reasons: ['Identical file'] });
  });

  test('unrelated Russian books about one language do not match', () => {
    expect(detector.compare(
      { title: 'Изучаем PHP 7', author: 'Иванов Иван' },
      { title: 'PHP для профессионалов', author: 'Петров Петр' }
    )).toBeNull();
  });

  test('two copies of one book match on title and author', () => {
    const result = detector.compare(
      { title: 'Designing Data-Intensive Applications', author: 'Martin Kleppmann', file_size: 1, page_count: 600 },
      { title: 'Designing Data Intensive Applications', author: 'Martin Kleppmann', file_size: 1, page_count: 600 }
    );
    expect(result.confidence).toBeGreaterThan(0.95);
    expect(result.reasons).toEqual(
      expect.arrayContaining(['Nearly identical title', 'Same author', 'Same file size', 'Same page count'])
    );
  });

  test('same title by different authors does not match', () => {
    expect(detector.compare(
      { title: 'Introduction to Algorithms', author: 'Thomas Cormen' },
      { title: 'Introduction to Algorithms', author: 'Udi Manber' }
    )).toBeNull();
  });
});
