/**
 * The home screen against the REAL rail picker.
 *
 * `page.test.tsx` mocks `pickRails` to the head of the pool, because a hundred of its
 * assertions are about what the screen does with a lineup rather than which lineup it got.
 * That mock is also a hole: a regression that ignored the lineup entirely — went back to
 * rendering the whole pool, or drew a fresh lineup on every render — would pass every row
 * in that file. This one closes it, and it is the only place the two are wired together.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { TV_RAILS, fetchRail } from '../_data/rails';
import { MAX_RAIL_PAGE, RAILS_ON_SCREEN, pickRails, withPages } from '../_data/railLineup';
import { fetchContinueWatching, fetchMyList } from '../_data/continueWatching';
import { useTvProfile } from '../_data/useTvProfile';
import HomePage from './page';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/bigscreen' }));
vi.mock('../_data/rails', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../_data/rails')>()),
  fetchRail: vi.fn(),
}));
vi.mock('../_data/continueWatching', () => ({ fetchContinueWatching: vi.fn(), fetchMyList: vi.fn() }));
vi.mock('../_data/useTvProfile', () => ({ useTvProfile: vi.fn() }));

const SEED_KEY = 'bs-rails:seed';
const fetchRailMock = vi.mocked(fetchRail);

const railTitles = () => [...document.querySelectorAll('.bs-rail__title')].map((h) => h.textContent);
const fetchedKeys = () => fetchRailMock.mock.calls.map(([spec]) => spec.key);
/** Mount and let the layout effect's seed land. */
const mount = async () => {
  const out = render(<HomePage />);
  await act(async () => {});
  return out;
};

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  // Never resolves: the rail HEADS render from the placeholders, which is all this file
  // reads, and an unresolved fetch keeps the screen in one shape.
  fetchRailMock.mockReturnValue(new Promise(() => {}));
  vi.mocked(fetchContinueWatching).mockReturnValue(new Promise(() => {}));
  vi.mocked(fetchMyList).mockReturnValue(new Promise(() => {}));
  vi.mocked(useTvProfile).mockReturnValue({
    profile: { id: 'p1', display_name: 'Ben', avatar: null },
    loading: false,
    select: vi.fn(),
    clear: vi.fn(),
  });
});

const seeded = (seed: number) => {
  sessionStorage.setItem(SEED_KEY, String(seed));
  return withPages(pickRails(TV_RAILS, RAILS_ON_SCREEN, seed), seed);
};

describe('the home lineup', () => {
  it('draws the rails the picker chose for this session, in that order', async () => {
    const expected = seeded(4242);
    await mount();
    expect(railTitles()).toEqual(expected.map((s) => s.title));
  });

  it('draws a DIFFERENT lineup for a different session', async () => {
    seeded(11);
    await mount();
    const first = railTitles();
    cleanup();
    seeded(987654);
    await mount();
    expect(railTitles()).not.toEqual(first);
  });

  it('draws RAILS_ON_SCREEN of the pool and not the whole pool', async () => {
    // The pool is 31 rails and each is two HTTP requests. Rendering all of them is the
    // regression this row exists to catch.
    seeded(7);
    await mount();
    expect(railTitles()).toHaveLength(RAILS_ON_SCREEN);
    expect(TV_RAILS.length).toBeGreaterThan(RAILS_ON_SCREEN);
  });

  it('keeps the SAME lineup across a remount, which is what Back from a title does', async () => {
    // Back from a detail screen pushes home, so the screen remounts. A lineup drawn per
    // mount would reshuffle every time the viewer looked at something and came back, and
    // the focus grid's saved row would then name a different rail.
    seeded(31337);
    await mount();
    const first = railTitles();
    cleanup();
    await mount();
    expect(railTitles()).toEqual(first);
  });

  it('asks for the headline rail first, on page 1', async () => {
    const expected = seeded(5150);
    await mount();
    expect(fetchedKeys()[0]).toBe(expected[0].key);
    const [spec] = fetchRailMock.mock.calls[0];
    expect(spec.movieParams?.page ?? 1).toBe(1);
    expect(spec.tvParams?.page ?? 1).toBe(1);
  });

  it('carries a page into the REQUESTS, so the CONTENT varies and not just the shelf', async () => {
    // Read off what the screen asked for, not off a lineup this test computed: the first
    // version of this row asserted on its own `expected` array and so would have passed
    // with `withPages` deleted from the screen entirely.
    seeded(24680);
    await mount();
    const asked = fetchRailMock.mock.calls.map(([spec]) => spec);
    expect(asked.length).toBeGreaterThan(1);
    for (const spec of asked) {
      for (const half of [spec.movieParams, spec.tvParams]) {
        if (!half) continue;
        expect(typeof half.page, spec.key).toBe('number');
        expect(half.page, spec.key).toBeGreaterThanOrEqual(1);
        expect(half.page, spec.key).toBeLessThanOrEqual(MAX_RAIL_PAGE);
      }
    }
    // ...and they are not all page 1, or the content would never move.
    const pages = new Set(asked.flatMap((s) => [s.movieParams?.page, s.tvParams?.page]).filter(Boolean));
    expect(pages.size).toBeGreaterThan(1);
  });

  it('never gives a one-sided rail the other half', async () => {
    // `fetchRail` reads the PRESENCE of a half as "fetch this endpoint". A movie-only rail
    // that acquired tvParams would ask the tv endpoint for a movie genre id.
    seeded(60);
    await mount();
    for (const [spec] of fetchRailMock.mock.calls) {
      const pool = TV_RAILS.find((r) => r.key === spec.key)!;
      expect(!!spec.movieParams, spec.key).toBe(!!pool.movieParams);
      expect(!!spec.tvParams, spec.key).toBe(!!pool.tvParams);
    }
  });
});
