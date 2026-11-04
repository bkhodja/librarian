const { canonicalize, TAG_SET } = require('../server/services/tagVocabulary');

describe('canonicalize', () => {
  test('passes a vocabulary member through', () => {
    expect(canonicalize('python')).toBe('python');
  });

  test('keeps the name when the model echoes the whole prompt line', () => {
    expect(canonicalize('machine-learning — models that learn')).toBe('machine-learning');
  });

  test('folds a version suffix onto the base tag', () => {
    expect(canonicalize('python3')).toBe('python');
  });

  test('folds case', () => {
    expect(canonicalize('Databases')).toBe('databases');
  });

  test('drops tags the model invented', () => {
    expect(canonicalize('basket-weaving')).toBeNull();
    expect(canonicalize('')).toBeNull();
    expect(canonicalize(null)).toBeNull();
  });

  test('never returns anything outside the vocabulary', () => {
    for (const raw of ['Python', 'ML', 'programming', 'Web Development', 'k8s', 'SQL']) {
      const tag = canonicalize(raw);
      if (tag !== null) expect(TAG_SET.has(tag)).toBe(true);
    }
  });
});
