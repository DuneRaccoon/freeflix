import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MAX_RECENT, readRecent, rememberSearch } from './recentSearches';

const KEY = 'bs-search:recent';
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? 'null');

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recent searches', () => {
  it('is empty before anything has been searched for', () => {
    expect(readRecent()).toEqual([]);
  });

  it('keeps the newest first', () => {
    rememberSearch('BATMAN');
    rememberSearch('ALIEN');
    expect(readRecent()).toEqual(['ALIEN', 'BATMAN']);
  });

  it('answers the new list, so the caller need not read it back', () => {
    expect(rememberSearch('BATMAN')).toEqual(['BATMAN']);
  });

  it('moves a repeat to the front instead of storing it twice', () => {
    rememberSearch('BATMAN');
    rememberSearch('ALIEN');
    rememberSearch('BATMAN');
    expect(readRecent()).toEqual(['BATMAN', 'ALIEN']);
  });

  it('treats one query in two cases as one query, and keeps the NEWEST spelling', () => {
    // The keyboard is upper case and a query restored from a stored entry is not, so
    // "BATMAN" and "Batman" are one search to a viewer and two rows of it is the list eating
    // itself. Keeping the newest means pressing a stored entry and searching again does not
    // rewrite it into something the viewer did not type.
    rememberSearch('BATMAN');
    rememberSearch('Batman');
    expect(readRecent()).toEqual(['Batman']);
  });

  it('drops the oldest past the cap', () => {
    for (let i = 1; i <= MAX_RECENT + 3; i++) rememberSearch(`Q${i}`);
    const out = readRecent();
    expect(out).toHaveLength(MAX_RECENT);
    expect(out[0]).toBe(`Q${MAX_RECENT + 3}`);
    expect(out).not.toContain('Q1');
  });

  it('stores a trimmed query, and refuses an empty one', () => {
    expect(rememberSearch('  BATMAN  ')).toEqual(['BATMAN']);
    expect(rememberSearch('   ')).toEqual(['BATMAN']);
    expect(rememberSearch('')).toEqual(['BATMAN']);
    expect(stored()).toEqual(['BATMAN']);
  });

  it('bounds what it stores, so a stuck key cannot fill the disk', () => {
    const long = 'A'.repeat(500);
    rememberSearch(long);
    expect(readRecent()[0]).toHaveLength(60);
  });

  it('does not trust what comes back out', () => {
    // Another build may have written it, and a browser may hand back something truncated —
    // the same posture the search screen takes with its restored results.
    localStorage.setItem(KEY, JSON.stringify(['OK', 42, null, '', '   ', { q: 'no' }, 'OK']));
    expect(readRecent()).toEqual(['OK']);
  });

  it('survives junk, a non-array, and a store that throws', () => {
    localStorage.setItem(KEY, 'not json at all');
    expect(readRecent()).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify({ not: 'an array' }));
    expect(readRecent()).toEqual([]);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readRecent()).toEqual([]);
  });

  it('still answers the new list when the write is refused', () => {
    // A television in a restricted mode throws on access. Losing the list is harmless; a
    // screen that cannot draw the row it just built is not.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(rememberSearch('BATMAN')).toEqual(['BATMAN']);
  });

  it('reads back no more than the cap, whatever is in storage', () => {
    localStorage.setItem(KEY, JSON.stringify(Array.from({ length: 50 }, (_, i) => `Q${i}`)));
    expect(readRecent()).toHaveLength(MAX_RECENT);
  });
});
