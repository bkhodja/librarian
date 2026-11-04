const { toMatchQuery, toTerms } = require('../server/services/ftsQuery');

describe('toMatchQuery', () => {
  test('reduces a question to its quoted topic terms', () => {
    expect(toMatchQuery('What does the book say about gradient descent?'))
      .toBe('"gradient" OR "descent"');
  });

  test('keeps Cyrillic words', () => {
    expect(toMatchQuery('Как работает индекс в PostgreSQL?'))
      .toBe('"как" OR "работает" OR "индекс" OR "postgresql"');
  });

  test('strips punctuation FTS5 would read as operators', () => {
    expect(toMatchQuery('"monads" (haskell) -- NEAR*')).toBe('"monads" OR "haskell" OR "near"');
  });

  test('repeats a term only once', () => {
    expect(toMatchQuery('descent descent')).toBe('"descent"');
  });

  test('returns null when nothing is left to match', () => {
    expect(toMatchQuery('how is it?')).toBeNull();
    expect(toMatchQuery('')).toBeNull();
    expect(toMatchQuery(undefined)).toBeNull();
  });
});

describe('toTerms', () => {
  test('returns the same terms, unquoted', () => {
    expect(toTerms('Explain recursion in Lisp')).toEqual(['recursion', 'lisp']);
  });
});
