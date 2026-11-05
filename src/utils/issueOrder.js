/**
 * Order a magazine's issues newest first, from the dates in their titles.
 *
 * Issues arrive in batches, so the date they were added says nothing, and the
 * titles come from whoever named the files: "The New Yorker - October 12,
 * 2026", "The New Yorker 07.20.2026", "Food & Wine USA 08.2026", "The Economist
 * UK Edition 17th23rd October, 2026", "National Geographic Kids UK Issue 257".
 */

const MONTHS = [
  ['jan'], ['feb'], ['mar'], ['apr'], ['may'], ['jun'],
  ['jul'], ['aug'], ['sep'], ['oct'], ['nov'], ['dec']
];
const SEASONS = { spring: 3, summer: 6, fall: 9, autumn: 9, winter: 12 };

const MONTH_WORD = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;

function monthNumber(word) {
  const prefix = word.slice(0, 3).toLowerCase();
  return MONTHS.findIndex(([m]) => m === prefix) + 1;
}

/** [year, month, day, issue] — zero where the title does not say. */
export function issueKey(title = '') {
  const text = String(title);
  let year = 0;
  let month = 0;
  let day = 0;

  // 2026-08-01
  let m = text.match(/\b((?:19|20)\d\d)-(\d\d)-(\d\d)\b/);
  if (m) [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];

  // 07.20.2026, 08.3.20260 (a stray digit after the year), 08.2026
  if (!year) {
    m = text.match(/\b(\d{1,2})\.(\d{1,2})\.((?:19|20)\d\d)/);
    if (m) [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  if (!year) {
    m = text.match(/\b(\d{1,2})\.((?:19|20)\d\d)\b/);
    if (m) [month, year] = [Number(m[1]), Number(m[2])];
  }

  if (!year) {
    const years = text.match(/(?:19|20)\d\d/g);
    if (years) year = Number(years[years.length - 1]);
  }

  if (!month) {
    const word = text.match(MONTH_WORD);
    if (word) {
      month = monthNumber(word[1]);
      // "October 12" or "12 October" / "17th23rd October" (the first day)
      const after = text.slice(word.index + word[0].length).match(/^\s+(\d{1,2})(?!\d)/);
      const before = text.slice(0, word.index).match(/(\d{1,2})(?:st|nd|rd|th)?(?:\d{1,2}(?:st|nd|rd|th)?)?\s*$/);
      day = Number(after?.[1] || before?.[1] || 0);
    } else {
      const season = text.match(/\b(spring|summer|fall|autumn|winter)\b/i);
      if (season) month = SEASONS[season[1].toLowerCase()];
    }
  }

  const issue = Number(text.match(/\b(?:issue|no\.?)\s*(\d+)/i)?.[1] || 0);
  return [year, month > 12 ? 0 : month, day > 31 ? 0 : day, issue];
}

/** Newest first; issues with no date in the title go last, by title. */
export function compareIssues(a, b) {
  const ka = issueKey(a.title);
  const kb = issueKey(b.title);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return kb[i] - ka[i];
  }
  return (a.title || '').localeCompare(b.title || '');
}
