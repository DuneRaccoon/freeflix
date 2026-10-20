import { describe, it, expect } from 'vitest';
import { MAX_QUERY, MIN_AUTO_QUERY, TYPING_PAUSE_MS, autoSearchQuery } from './searchQuery';

describe('autoSearchQuery', () => {
  it('answers the trimmed query once it is long enough', () => {
    expect(autoSearchQuery('BAT', '')).toBe('BAT');
    // The Space key is a character like any other, so a trailing one must not make `BAT `
    // a different question from `BAT`.
    expect(autoSearchQuery('BAT ', '')).toBe('BAT');
    expect(autoSearchQuery('  BATMAN  ', '')).toBe('BATMAN');
  });

  it('waits for a query worth asking about', () => {
    // Two characters match a large fraction of the catalog and the answer is useless. A
    // viewer who really wants `UP` presses Search, which is what that control is for now.
    expect(autoSearchQuery('', '')).toBeNull();
    expect(autoSearchQuery('B', '')).toBeNull();
    expect(autoSearchQuery('BA', '')).toBeNull();
    expect(autoSearchQuery('  BA  ', '')).toBeNull();
    expect('BAT'.length).toBe(MIN_AUTO_QUERY);
  });

  it('does not ask again for a query that has already been ASKED', () => {
    // THE LOOP THIS CLOSES. A failed search leaves the query on screen unchanged, so the
    // condition that armed the timer is still true — without this the screen re-asks a dead
    // box every pause, for ever. "Asked" and "answered" are different facts, and only the
    // first one stops it.
    expect(autoSearchQuery('BATMAN', 'BATMAN')).toBeNull();
    // Trimmed on both sides of the comparison, or `BATMAN ` would re-ask for `BATMAN`.
    expect(autoSearchQuery('BATMAN ', 'BATMAN')).toBeNull();
  });

  it('asks again as soon as the query actually changes', () => {
    expect(autoSearchQuery('BATMA', 'BATMAN')).toBe('BATMA');
    expect(autoSearchQuery('BATMANN', 'BATMAN')).toBe('BATMANN');
  });

  it('is case-sensitive, because the keyboard only produces one case', () => {
    // Not a judgement about search: the only text entry on this surface is the on-screen
    // keyboard, which emits upper case. A lower-case query can only come from storage, and
    // re-asking for it once is cheaper than a comparison that pretends to know better.
    expect(autoSearchQuery('batman', 'BATMAN')).toBe('batman');
  });

  it('keeps its three numbers here, where there is exactly one copy of each', () => {
    // A page module cannot export a constant (Next rejects anything but its own known
    // fields), so a test that re-typed `500` beside the page's own would be two numbers to
    // keep in step — the drift this surface keeps finding.
    expect(TYPING_PAUSE_MS).toBeGreaterThan(0);
    expect(MIN_AUTO_QUERY).toBeGreaterThan(1);
    expect(MAX_QUERY).toBeGreaterThan(MIN_AUTO_QUERY);
  });
});
