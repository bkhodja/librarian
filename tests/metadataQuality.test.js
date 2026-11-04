const quality = require('../server/services/metadataQuality');

describe('isPlausibleTitle', () => {
  test.each([
    'Clean Code',
    'Базы данных на Python'
  ])('accepts %p', (title) => {
    expect(quality.isPlausibleTitle(title)).toBe(true);
  });

  test.each([
    'architectingpowerbisolutionsinmicrosoftfabric',
    'expertdatamodelingwithpowerbi 2nd edition',
    'Untitled',
    '9781492032649'
  ])('rejects %p', (title) => {
    expect(quality.isPlausibleTitle(title)).toBe(false);
  });
});

describe('cleanTitle', () => {
  test('drops a leading ISBN, the extension and underscores', () => {
    expect(quality.cleanTitle('9781492032649 - Hands_On_Machine_Learning.pdf'))
      .toBe('Hands On Machine Learning');
  });
});

describe('cleanAuthor', () => {
  test('keeps a name with an initial', () => {
    expect(quality.cleanAuthor('David K. Rensin')).toBe('David K. Rensin');
  });

  test('splits and rejoins several people', () => {
    expect(quality.cleanAuthor('Martin Fowler and Kent Beck')).toBe('Martin Fowler, Kent Beck');
  });

  test('rejects a truncated scrape', () => {
    expect(quality.cleanAuthor('San F')).toBeNull();
  });

  test('rejects a name that is part of the title', () => {
    expect(quality.cleanAuthor('Kent Beck', { title: 'Kent Beck on TDD' })).toBeNull();
  });
});
