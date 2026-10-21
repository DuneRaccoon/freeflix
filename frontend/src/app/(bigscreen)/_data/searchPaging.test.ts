import { describe, it, expect } from 'vitest';
import type { CatalogItem, CatalogPage } from '@/types';
import { RESULT_COLUMNS, appendResults, morePages } from './searchPaging';

const item = (id: number, over: Partial<CatalogItem> = {}): CatalogItem =>
  ({
    tmdb_id: id,
    media_type: 'movie',
    title: `T${id}`,
    year: 2020,
    poster_url: null,
    backdrop_url: null,
    popularity: id,
    ...over,
  }) as CatalogItem;

const page = (results: CatalogItem[], over: Partial<CatalogPage> = {}): CatalogPage =>
  ({ page: 1, total_pages: 5, total_results: results.length, results, ...over }) as CatalogPage;

const ids = (items: readonly CatalogItem[]) => items.map((i) => i.tmdb_id);

describe('appendResults', () => {
  it('keeps what is already on screen in exactly the order it is in', () => {
    // THE PROPERTY THE RING DEPENDS ON. `mergeDedupe` sorts the whole list by popularity,
    // which for a second page means cards the viewer is looking at move — and the ring is
    // at a (row, col), so it would land on a different film with no press behind it.
    const existing = [item(1), item(9), item(4)];
    const out = appendResults(existing, [page([item(50), item(7)])]);
    expect(ids(out).slice(0, 3)).toEqual([1, 9, 4]);
  });

  it('sorts the NEW rows among themselves and appends them', () => {
    const out = appendResults([item(1)], [page([item(3), item(80), item(20)])]);
    expect(ids(out)).toEqual([1, 80, 20, 3]);
  });

  it('merges both halves of one request', () => {
    const out = appendResults([], [page([item(10)]), page([item(20, { media_type: 'tv' })])]);
    expect(out).toHaveLength(2);
  });

  it('drops a title it is already showing', () => {
    // TMDB repeats titles across pages often enough to matter.
    const out = appendResults([item(5), item(6)], [page([item(5), item(7)])]);
    expect(ids(out)).toEqual([5, 6, 7]);
  });

  it('keeps a movie and a show that share a tmdb id', () => {
    const out = appendResults([item(42)], [page([item(42, { media_type: 'tv' })])]);
    expect(out).toHaveLength(2);
  });

  it('drops a repeat WITHIN the incoming pages too', () => {
    const out = appendResults([], [page([item(3), item(3)])]);
    expect(ids(out)).toEqual([3]);
  });

  it('re-validates the rows, because page 2 came off the wire exactly as page 1 did', () => {
    const junk = [
      item(0),
      { ...item(5), tmdb_id: null } as unknown as CatalogItem,
      { ...item(6), media_type: 'person' } as unknown as CatalogItem,
      { ...item(7), tmdb_id: 1.5 } as unknown as CatalogItem,
      item(8),
    ];
    expect(ids(appendResults([], [page(junk)]))).toEqual([8]);
  });

  it('answers the SAME array when a page adds nothing', () => {
    // So a page of nothing but repeats cannot re-render the grid, and so cannot move the
    // ring. Identity, not equality: this is what a `useMemo` or a dep array would compare.
    const existing = [item(1), item(2)];
    expect(appendResults(existing, [page([item(1)])])).toBe(existing);
    expect(appendResults(existing, [page([])])).toBe(existing);
    expect(appendResults(existing, [])).toBe(existing);
  });

  it('survives a page whose results are missing entirely', () => {
    const broken = { page: 2, total_pages: 5, total_results: 0 } as unknown as CatalogPage;
    expect(appendResults([item(1)], [broken])).toEqual([item(1)]);
  });

  it('does not mutate what it was given', () => {
    const existing = [item(1)];
    appendResults(existing, [page([item(2)])]);
    expect(ids(existing)).toEqual([1]);
  });

  it('treats a missing popularity as the bottom rather than as NaN', () => {
    // One undefined makes every comparison NaN, and the sort silently stops sorting.
    const nameless = { ...item(4), popularity: undefined } as unknown as CatalogItem;
    const out = appendResults([], [page([nameless, item(9)])]);
    expect(ids(out)).toEqual([9, 4]);
  });
});

describe('morePages', () => {
  it('is true while either half has another page', () => {
    expect(morePages([page([], { page: 1, total_pages: 3 })])).toBe(true);
    expect(
      morePages([
        page([], { page: 1, total_pages: 1 }),
        page([], { page: 1, total_pages: 9 }),
      ]),
    ).toBe(true);
  });

  it('is false when every half is finished', () => {
    expect(
      morePages([
        page([], { page: 2, total_pages: 2 }),
        page([], { page: 2, total_pages: 1 }),
      ]),
    ).toBe(false);
  });

  it('is false for nothing at all', () => {
    expect(morePages([])).toBe(false);
  });

  it('reads an absent count as finished rather than as infinite', () => {
    // An endless "load more" that never loads anything is a screen that never settles.
    const broken = { results: [] } as unknown as CatalogPage;
    expect(morePages([broken])).toBe(false);
  });
});

describe('RESULT_COLUMNS', () => {
  it('is the number the stylesheet is written for', () => {
    expect(RESULT_COLUMNS).toBe(3);
  });
});
