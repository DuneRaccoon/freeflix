import { describe, it, expect } from 'vitest';
import { mergeDedupe, hasMoreResults } from './mergeCatalog';
import type { CatalogItem, CatalogPage } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(
  media_type: 'movie' | 'tv',
  tmdb_id: number,
  popularity: number,
  title = `Item ${tmdb_id}`,
): CatalogItem {
  return {
    tmdb_id,
    media_type,
    title,
    year: 2024,
    overview: null,
    poster_url: null,
    backdrop_url: null,
    genre_ids: [],
    genres: [],
    vote_average: 7.0,
    vote_count: 100,
    popularity,
    original_language: 'en',
  };
}

function makePage(
  items: CatalogItem[],
  page = 1,
  total_pages = 1,
): CatalogPage {
  return {
    page,
    results: items,
    total_pages,
    total_results: items.length,
  };
}

// ---------------------------------------------------------------------------
// mergeDedupe
// ---------------------------------------------------------------------------

describe('mergeDedupe', () => {
  it('returns an empty array for no pages', () => {
    expect(mergeDedupe([])).toEqual([]);
  });

  it('returns an empty array for a single empty page', () => {
    expect(mergeDedupe([makePage([])])).toEqual([]);
  });

  it('flattens a single page into a sorted array', () => {
    const a = makeItem('movie', 1, 80);
    const b = makeItem('movie', 2, 95);
    const c = makeItem('movie', 3, 60);
    const result = mergeDedupe([makePage([a, b, c])]);
    expect(result.map((i) => i.tmdb_id)).toEqual([2, 1, 3]);
  });

  it('collapses exact duplicates (same media_type + tmdb_id)', () => {
    const a = makeItem('movie', 42, 70);
    const aDup = makeItem('movie', 42, 70, 'Duplicate');
    const b = makeItem('movie', 99, 50);
    const result = mergeDedupe([makePage([a, b]), makePage([aDup])]);
    // Only one entry for movie:42
    expect(result.filter((i) => i.tmdb_id === 42 && i.media_type === 'movie')).toHaveLength(1);
    expect(result[0].title).toBe(`Item 42`); // first occurrence wins
  });

  it('keeps same tmdb_id when media_type differs (movie vs tv)', () => {
    const movie = makeItem('movie', 100, 80);
    const tv = makeItem('tv', 100, 70);
    const result = mergeDedupe([makePage([movie]), makePage([tv])]);
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.media_type)).toEqual(['movie', 'tv']);
  });

  it('sorts by popularity descending across pages', () => {
    const items1 = [makeItem('movie', 1, 30), makeItem('movie', 2, 90)];
    const items2 = [makeItem('tv', 3, 60), makeItem('tv', 4, 120)];
    const result = mergeDedupe([makePage(items1), makePage(items2)]);
    const pops = result.map((i) => i.popularity);
    expect(pops).toEqual([120, 90, 60, 30]);
  });

  it('de-dupes a mixed movie+tv set and sorts by popularity', () => {
    const movie1 = makeItem('movie', 10, 50);
    const movie1Dup = makeItem('movie', 10, 50, 'Dup');
    const tv1 = makeItem('tv', 10, 80); // same tmdb_id, different type → keep
    const tv2 = makeItem('tv', 20, 40);
    const result = mergeDedupe([
      makePage([movie1, tv1]),
      makePage([movie1Dup, tv2]),
    ]);
    // movie:10, tv:10, tv:20 — three unique items
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ media_type: 'tv', tmdb_id: 10, popularity: 80 });
    expect(result[1]).toMatchObject({ media_type: 'movie', tmdb_id: 10, popularity: 50 });
    expect(result[2]).toMatchObject({ media_type: 'tv', tmdb_id: 20, popularity: 40 });
  });
});

// ---------------------------------------------------------------------------
// hasMoreResults
// ---------------------------------------------------------------------------

describe('hasMoreResults', () => {
  it('returns false for an empty array', () => {
    expect(hasMoreResults([])).toBe(false);
  });

  it('returns false when all pages are at their last page', () => {
    const p1 = makePage([], 3, 3);
    const p2 = makePage([], 1, 1);
    expect(hasMoreResults([p1, p2])).toBe(false);
  });

  it('returns true when at least one page has more', () => {
    const p1 = makePage([], 1, 3);
    const p2 = makePage([], 2, 2);
    expect(hasMoreResults([p1, p2])).toBe(true);
  });

  it('returns true when the only page is page 1 of 2', () => {
    expect(hasMoreResults([makePage([], 1, 2)])).toBe(true);
  });

  it('returns false when the only page is page 2 of 2', () => {
    expect(hasMoreResults([makePage([], 2, 2)])).toBe(false);
  });
});
