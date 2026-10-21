import type { TvRailSpec } from './rails';

/**
 * Which rails the home screen draws tonight, and in what order.
 *
 * The ask was "randomise the carousels and their content, and give me significantly more
 * variety". The pool in `rails.ts` is 31 rails; a rail is TWO HTTP requests (the movie half
 * and the tv half), so the answer is not to draw all 31 — it is to draw
 * `RAILS_ON_SCREEN` of them, chosen differently each time the app starts. The request count
 * per visit is unchanged from the seven-rail build it replaces plus the five slots' worth
 * the viewer scrolls to; what changes is that tonight's shelf is not last night's.
 *
 * (The web home page does NOT do this, despite being the stated model for it: `MIXED_RAILS`
 * is eight rails in a fixed order and there is no `Math.random` anywhere in `frontend/src`.
 * So this is the television's own behaviour, not a copy, and `railsDrift.test.ts` is now
 * written as "the web lineup is a SUBSET of the TV pool" for that reason.)
 *
 * THE SEED IS PER SESSION, AND THAT IS THE LOAD-BEARING DECISION. Back from a title screen
 * `push`es home (recorded in the stage-6 notes), so the home screen REMOUNTS on every
 * return. A lineup drawn at mount would reshuffle under the viewer every time they looked at
 * something and came back — and the focus grid's saved row would then point at a different
 * rail, which is the one thing worse than reshuffling. So the seed lives in
 * `sessionStorage`, exactly as far as the restored focus position does: one lineup for one
 * sitting, a new one next launch. On webOS, launching the app is a fresh document, so "next
 * launch" is what a viewer experiences as "next time".
 */

/** How many catalog rails are on screen at once, out of the pool of 31. */
export const RAILS_ON_SCREEN = 12;

const SEED_KEY = 'bs-rails:seed';

/**
 * The rails the FIRST slot may be drawn from, and why it is not the whole pool.
 *
 * The first rail is not just the top shelf: the home hero is built from its `lead` (see
 * `CatalogRail.lead`), and the hero is also where the ring lands on arrival. A niche shelf
 * can come back with two titles and no backdrop at all, which would make the biggest element
 * on the screen — and the screen's landing focus — the thing most likely to be empty. So the
 * headline is random, but random among the three broad feeds that are never thin.
 */
export const HEADLINE_KEYS: readonly string[] = ['trending', 'top-rated', 'new'];

/**
 * A 32-bit PRNG (mulberry32), inline because the alternative is a dependency and this
 * surface imports nothing it can write in ten lines. Deterministic: one seed is one lineup,
 * which is what makes the lineup testable at all and what keeps it stable across the
 * remounts described above.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates, on a copy, driven by `rand`. */
function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Tonight's lineup: a headline rail, then a random selection of the rest.
 *
 * Pure, and the only thing it reads is its arguments — so a test fixes the seed and asserts
 * the whole lineup, and the screen gets the same answer on every render of the same sitting.
 *
 * Deduplicated by key rather than by identity, because a pool with a repeated key would
 * otherwise render two rails with the same `data-rail` attribute, which is what the home
 * screen's viewport observer finds its wrappers by.
 */
export function pickRails(
  pool: readonly TvRailSpec[],
  count: number,
  seed: number,
): TvRailSpec[] {
  const byKey = new Map<string, TvRailSpec>();
  for (const spec of pool) if (!byKey.has(spec.key)) byKey.set(spec.key, spec);
  const unique = [...byKey.values()];
  if (count <= 0 || unique.length === 0) return [];

  const rand = mulberry32(seed);
  const headlines = unique.filter((s) => HEADLINE_KEYS.includes(s.key));
  // `rand` is called for the headline FIRST, so the headline choice and the shuffle below
  // are both functions of the seed in a fixed order.
  const headline = headlines.length ? shuffled(headlines, rand)[0] : null;

  const rest = shuffled(
    unique.filter((s) => s.key !== headline?.key),
    rand,
  );
  const chosen = headline ? [headline, ...rest] : rest;
  return chosen.slice(0, Math.min(count, unique.length));
}

/**
 * The TMDB page a rail asks for, which is how the CONTENT varies and not just the shelf.
 *
 * Without this, "Drama" is the same twenty titles every time it is drawn. With it, it is the
 * same shelf showing a different part of the catalog.
 *
 * ONE IS NOT A RANGE BOUND, IT IS THE HEADLINE'S PAGE. The headline rail feeds the hero, and
 * page 3 of `popular` is the 41st most popular title — a real film, with artwork that may
 * well be missing a backdrop. The hero is the one place where "the biggest title" beats
 * "a different title", so the headline stays on page 1 and everything below it roams.
 *
 * The cap is deliberately low: a narrow shelf (`origin: 'SE'`) has far fewer pages than
 * `popular`, and asking past the end returns an empty page, which this surface renders as a
 * rail that simply never arrives. Three is inside every feed in the pool.
 */
export const MAX_RAIL_PAGE = 3;

export function railPage(seed: number, key: string, isHeadline: boolean): number {
  if (isHeadline) return 1;
  // A per-key stream, so adding a rail to the pool does not renumber the pages of the
  // others for a given seed.
  let h = seed >>> 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0);
  return 1 + Math.floor(mulberry32(h)() * MAX_RAIL_PAGE);
}

/**
 * The lineup's specs with their page applied, which is the form the screen fetches.
 *
 * `page` is added to each half that EXISTS: a movie-only rail (`genre-horror`) must not
 * acquire a `tvParams` here, because `fetchRail` reads the presence of that key as "this
 * rail has a tv half" and would ask the tv endpoint for a genre id that means something
 * else entirely.
 */
export function withPages(specs: readonly TvRailSpec[], seed: number): TvRailSpec[] {
  return specs.map((spec, i) => {
    const page = railPage(seed, spec.key, i === 0);
    return {
      ...spec,
      ...(spec.movieParams ? { movieParams: { ...spec.movieParams, page } } : {}),
      ...(spec.tvParams ? { tvParams: { ...spec.tvParams, page } } : {}),
    };
  });
}

/**
 * The session's seed: the same number for the whole sitting, a new one next launch.
 *
 * Read lazily and never at module scope, because `sessionStorage` does not exist while Next
 * prerenders this page and a module-scope read would fail the build. A refused store (a
 * television in a restricted mode throws on access) degrades to a fresh number: the lineup
 * is then redrawn on each remount, which is worse than stable but far better than a screen
 * that throws.
 */
export function sessionSeed(): number {
  const fresh = () => (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
  try {
    if (typeof sessionStorage === 'undefined') return fresh();
    const stored = sessionStorage.getItem(SEED_KEY);
    const parsed = stored === null ? NaN : Number(stored);
    if (Number.isInteger(parsed) && parsed > 0) return parsed >>> 0;
    const seed = fresh();
    sessionStorage.setItem(SEED_KEY, String(seed));
    return seed;
  } catch {
    return fresh();
  }
}
