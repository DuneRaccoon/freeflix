import { describe, it, expect } from 'vitest';
import { interleave, MIXED_RAILS } from './buildMixedRailsScreen';

describe('interleave', () => {
  it('alternates starting with the first list (movies)', () => {
    expect(interleave(['m1', 'm2', 'm3'], ['t1', 't2', 't3']))
      .toEqual(['m1', 't1', 'm2', 't2', 'm3', 't3']);
  });

  it('appends the remainder when lists differ in length', () => {
    expect(interleave(['m1', 'm2', 'm3'], ['t1'])).toEqual(['m1', 't1', 'm2', 'm3']);
    expect(interleave(['m1'], ['t1', 't2', 't3'])).toEqual(['m1', 't1', 't2', 't3']);
  });

  it('degrades to the non-empty list when one side is empty', () => {
    expect(interleave(['m1', 'm2'], [])).toEqual(['m1', 'm2']);
    expect(interleave([], ['t1', 't2'])).toEqual(['t1', 't2']);
    expect(interleave([], [])).toEqual([]);
  });

  it('respects the cap', () => {
    const a = Array.from({ length: 30 }, (_, i) => `m${i}`);
    const b = Array.from({ length: 30 }, (_, i) => `t${i}`);
    expect(interleave(a, b, 5)).toEqual(['m0', 't0', 'm1', 't1', 'm2']);
  });
});

describe('MIXED_RAILS', () => {
  it('maps genre ids per media type (movie vs tv differ)', () => {
    const byKey = Object.fromEntries(MIXED_RAILS.map((r) => [r.key, r]));
    expect(byKey['genre-action'].movieParams.genres).toBe('28');
    expect(byKey['genre-action'].tvParams.genres).toBe('10759');
    expect(byKey['genre-scifi'].movieParams.genres).toBe('878');
    expect(byKey['genre-scifi'].tvParams.genres).toBe('10765');
    expect(byKey['genre-drama'].movieParams.genres).toBe('18');
    expect(byKey['genre-drama'].tvParams.genres).toBe('18');
  });

  it('uses noun-free titles (no "Movies"/"Series")', () => {
    for (const rail of MIXED_RAILS) {
      expect(rail.title).not.toMatch(/movies|series/i);
    }
  });

  it('leads with trending and has a ranked top-rated rail', () => {
    expect(MIXED_RAILS[0].key).toBe('trending');
    expect(MIXED_RAILS.find((r) => r.key === 'top-rated')?.variant).toBe('ranked');
  });
});
