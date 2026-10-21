import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TV_RAILS, type TvRailSpec } from './rails';
import {
  HEADLINE_KEYS,
  MAX_RAIL_PAGE,
  RAILS_ON_SCREEN,
  mulberry32,
  pickRails,
  railPage,
  sessionSeed,
  withPages,
} from './railLineup';

const SEED_KEY = 'bs-rails:seed';
const keys = (specs: readonly TvRailSpec[]) => specs.map((s) => s.key);

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mulberry32', () => {
  it('is deterministic, and two seeds are two streams', () => {
    expect([mulberry32(1)(), mulberry32(1)()]).toEqual([mulberry32(1)(), mulberry32(1)()]);
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('stays in [0, 1)', () => {
    const rand = mulberry32(12345);
    for (let i = 0; i < 500; i++) {
      const n = rand();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });
});

describe('pickRails', () => {
  it('is the same lineup for the same seed, every time', () => {
    // THE PROPERTY THE SCREEN DEPENDS ON. Back from a title screen remounts home, so a
    // lineup that was not a pure function of the seed would reshuffle under the viewer and
    // the restored focus row would point at a different rail.
    expect(keys(pickRails(TV_RAILS, 12, 99))).toEqual(keys(pickRails(TV_RAILS, 12, 99)));
  });

  it('is a different lineup for different seeds', () => {
    const seen = new Set(
      Array.from({ length: 12 }, (_, i) => keys(pickRails(TV_RAILS, 8, i + 1)).join(',')),
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it('draws the headline from the broad feeds, whatever the seed', () => {
    // The hero is built from the FIRST rail's lead and is also the landing focus, so a
    // niche shelf there is the likeliest thing on the screen to be empty.
    for (let seed = 1; seed <= 40; seed++) {
      expect(HEADLINE_KEYS).toContain(pickRails(TV_RAILS, 12, seed)[0].key);
    }
  });

  it('uses more than one of the headline rails across seeds', () => {
    const heads = new Set(
      Array.from({ length: 40 }, (_, i) => pickRails(TV_RAILS, 12, i + 1)[0].key),
    );
    expect(heads.size).toBeGreaterThan(1);
  });

  it('returns the asked-for count, with no repeats', () => {
    const got = pickRails(TV_RAILS, RAILS_ON_SCREEN, 7);
    expect(got).toHaveLength(RAILS_ON_SCREEN);
    expect(new Set(keys(got)).size).toBe(RAILS_ON_SCREEN);
  });

  it('never asks for more rails than the pool holds', () => {
    const pool = TV_RAILS.slice(0, 4);
    expect(pickRails(pool, 99, 3)).toHaveLength(4);
  });

  it('answers nothing for an empty pool or a non-positive count', () => {
    expect(pickRails([], 5, 1)).toEqual([]);
    expect(pickRails(TV_RAILS, 0, 1)).toEqual([]);
    expect(pickRails(TV_RAILS, -2, 1)).toEqual([]);
  });

  it('deduplicates by KEY, because the screen finds rail wrappers by it', () => {
    // Two rails with one `data-rail` would make the home screen's viewport observer
    // ambiguous about which wrapper it just saw.
    const dupe = [...TV_RAILS.slice(0, 3), { ...TV_RAILS[1] }];
    const got = pickRails(dupe, 10, 5);
    expect(new Set(keys(got)).size).toBe(keys(got).length);
    expect(got).toHaveLength(3);
  });

  it('can eventually draw EVERY rail in the pool, so none is decoration', () => {
    // A rail that no seed can reach is a rail nobody will ever see — the pool exists for
    // variety, so this is the assertion that the variety is real.
    const drawn = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) {
      for (const spec of pickRails(TV_RAILS, RAILS_ON_SCREEN, seed)) drawn.add(spec.key);
    }
    expect([...drawn].sort()).toEqual(TV_RAILS.map((r) => r.key).sort());
  });
});

describe('railPage', () => {
  it('keeps the headline on page 1', () => {
    for (let seed = 1; seed <= 30; seed++) expect(railPage(seed, 'trending', true)).toBe(1);
  });

  it('puts everything else somewhere inside the feed', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const p = railPage(seed, 'genre-drama', false);
      expect(Number.isInteger(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(1);
      expect(p).toBeLessThanOrEqual(MAX_RAIL_PAGE);
    }
  });

  it('varies the page across seeds, or the content never changes', () => {
    const pages = new Set(
      Array.from({ length: 40 }, (_, i) => railPage(i + 1, 'genre-drama', false)),
    );
    expect(pages.size).toBeGreaterThan(1);
  });

  it('is a stream PER KEY, so adding a rail does not renumber the others', () => {
    // The page is derived from (seed, key) rather than from the rail's position, which is
    // what keeps a pool edit from silently changing what every other shelf shows.
    expect(railPage(42, 'genre-drama', false)).toBe(railPage(42, 'genre-drama', false));
    const a = railPage(42, 'genre-drama', false);
    const b = railPage(42, 'genre-comedy', false);
    expect([a, b].every((p) => p >= 1 && p <= MAX_RAIL_PAGE)).toBe(true);
  });
});

describe('withPages', () => {
  it('adds the page to each half that exists, and invents neither', () => {
    // THE TRAP: `fetchRail` reads the PRESENCE of `tvParams` as "this rail has a tv half".
    // Adding one to a movie-only rail would ask the tv endpoint for a movie genre id,
    // which is a different genre there and returns the wrong titles with no error.
    const movieOnly = TV_RAILS.find((r) => r.movieParams && !r.tvParams)!;
    const tvOnly = TV_RAILS.find((r) => r.tvParams && !r.movieParams)!;
    const both = TV_RAILS.find((r) => r.movieParams && r.tvParams)!;
    const [m, t, b] = [
      withPages([movieOnly], 5)[0],
      withPages([tvOnly], 5)[0],
      withPages([both], 5)[0],
    ];
    expect(m.tvParams).toBeUndefined();
    expect(m.movieParams!.page).toBeGreaterThanOrEqual(1);
    expect(t.movieParams).toBeUndefined();
    expect(t.tvParams!.page).toBeGreaterThanOrEqual(1);
    expect(b.movieParams!.page).toBe(b.tvParams!.page);
  });

  it('keeps every other param untouched', () => {
    const spec = TV_RAILS.find((r) => r.key === 'genre-scifi')!;
    const out = withPages([spec], 11)[0];
    expect(out.movieParams!.genres).toBe('878');
    expect(out.tvParams!.genres).toBe('10765');
    expect({ key: out.key, title: out.title, shape: out.shape }).toEqual({
      key: spec.key,
      title: spec.title,
      shape: spec.shape,
    });
  });

  it('does not mutate the pool', () => {
    const before = JSON.stringify(TV_RAILS);
    withPages(pickRails(TV_RAILS, RAILS_ON_SCREEN, 3), 3);
    expect(JSON.stringify(TV_RAILS)).toBe(before);
  });

  it('leaves the first rail — the headline — on page 1', () => {
    const lineup = withPages(pickRails(TV_RAILS, RAILS_ON_SCREEN, 17), 17);
    expect(lineup[0].movieParams?.page ?? 1).toBe(1);
    expect(lineup[0].tvParams?.page ?? 1).toBe(1);
  });
});

describe('sessionSeed', () => {
  it('is the same number for the whole sitting', () => {
    const first = sessionSeed();
    expect(sessionSeed()).toBe(first);
    expect(Number(sessionStorage.getItem(SEED_KEY))).toBe(first);
  });

  it('is a positive integer', () => {
    const seed = sessionSeed();
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThan(0);
  });

  it('ignores junk in the store rather than seeding from NaN', () => {
    // A seed of NaN makes every rail page NaN, and `?page=NaN` is a request error on every
    // rail at once — a blank home screen with nothing in the log.
    for (const junk of ['', 'abc', '0', '-5', '1.5', 'null']) {
      sessionStorage.setItem(SEED_KEY, junk);
      const seed = sessionSeed();
      expect(Number.isInteger(seed), junk).toBe(true);
      expect(seed, junk).toBeGreaterThan(0);
    }
  });

  it('still answers a usable seed when the store throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const seed = sessionSeed();
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThan(0);
  });

  it('still answers when the WRITE is refused', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(sessionSeed()).toBeGreaterThan(0);
  });
});

describe('the pool itself', () => {
  it('has a unique key per rail', () => {
    expect(new Set(TV_RAILS.map((r) => r.key)).size).toBe(TV_RAILS.length);
  });

  it('is big enough that a lineup is a real selection', () => {
    expect(TV_RAILS.length).toBeGreaterThan(RAILS_ON_SCREEN * 2);
  });

  it('gives every rail at least one half to fetch', () => {
    for (const r of TV_RAILS) {
      expect(!!(r.movieParams || r.tvParams), r.key).toBe(true);
    }
  });

  it('only sends an `api` a rail is allowed to send', () => {
    // `api` is validated by a different regex per endpoint: `now_playing`/`upcoming` are
    // movies-only and `on_the_air`/`airing_today` tv-only, so a value used on a half that
    // does not accept it is a request error. And on a FILTERED rail `api` is not sent at
    // all (`providers/catalog.py` switches to `discover`), so carrying one there would be
    // a claim the request never makes.
    for (const r of TV_RAILS) {
      for (const half of [r.movieParams, r.tvParams]) {
        if (!half?.api) continue;
        const filtered = !!(half.genres || half.year || half.origin || half.lang || half.provider);
        expect(filtered, `${r.key} carries api AND a filter`).toBe(false);
        expect(['popular', 'top_rated'], r.key).toContain(half.api);
      }
    }
  });

  it('never sends a date sort to the half whose mode does not have that column', () => {
    // `sort` goes straight upstream untranslated: `primary_release_date` is a movie field
    // and `first_air_date` a tv one. The one exception is the inherited web rail, which
    // `railsDrift.test.ts` pins to the web table and so must not be fixed here alone.
    const INHERITED = new Set(['new']);
    for (const r of TV_RAILS) {
      if (INHERITED.has(r.key)) continue;
      expect(r.movieParams?.sort ?? '', r.key).not.toContain('first_air_date');
      expect(r.tvParams?.sort ?? '', r.key).not.toContain('primary_release_date');
    }
  });

  it('gives each half the genre id that MODE uses, where the two differ', () => {
    // TMDB numbers movie and tv genres separately. Reusing one id for both halves returns
    // the wrong genre for one of them, with no error anywhere.
    const byKey = new Map(TV_RAILS.map((r) => [r.key, r]));
    expect(byKey.get('genre-action')!.movieParams!.genres).toBe('28');
    expect(byKey.get('genre-action')!.tvParams!.genres).toBe('10759');
    expect(byKey.get('genre-scifi')!.movieParams!.genres).toBe('878');
    expect(byKey.get('genre-scifi')!.tvParams!.genres).toBe('10765');
    expect(byKey.get('genre-war')!.movieParams!.genres).toBe('10752');
    expect(byKey.get('genre-war')!.tvParams!.genres).toBe('10768');
    // ...and the shared ones really are shared, so they are not "fixed" into a drift.
    for (const key of ['genre-drama', 'genre-comedy', 'genre-crime', 'genre-animation']) {
      const r = byKey.get(key)!;
      expect(r.movieParams!.genres, key).toBe(r.tvParams!.genres);
    }
  });
});
