/**
 * TV_RAILS began as a COPY of the web's MIXED_RAILS, so something has to pin it.
 *
 * rails.ts cannot import the web table: `@/lib/buildMixedRailsScreen` pulls the web's
 * BrowseScreen, and with it PosterCard and the Tailwind runtime, into the TV bundle
 * (spec §9). Duplication with nothing pinning it drifts silently, and a TMDB genre id
 * that drifts returns the wrong genre with no error anywhere. A TEST may import from the
 * web surface, since it ships in no bundle, so this does what bigscreen-tokens.test.ts
 * does for the copied colour tokens: parse both sides and compare.
 *
 * WHAT CHANGED, AND WHY THE SHAPE OF THE PIN CHANGED WITH IT. The television no longer
 * draws a fixed lineup: `TV_RAILS` is now a POOL of 31 shelves and `pickRails` draws
 * `RAILS_ON_SCREEN` of them per session, in a random order. So the web table can no longer
 * be "the lineup, less some omissions" — it is a SUBSET of the pool, and the order is the
 * seed's business rather than the web's.
 *
 * What still has to hold, and is what this file now asserts:
 *   1. every web rail still EXISTS in the TV pool, so a rail added to the web is a
 *      decision someone has to make here rather than a silent absence;
 *   2. the ones that exist carry BYTE-IDENTICAL params, which is the genre-id drift this
 *      file was written for;
 *   3. the rails the TV has invented are declared, so the pool cannot grow a shelf nobody
 *      meant to add.
 */
import { describe, expect, it } from 'vitest';
import { MIXED_RAILS } from '@/lib/buildMixedRailsScreen';
import { TV_RAILS } from './rails';

/**
 * Rails the television carries and the web does not.
 *
 * These are the variety the TV's randomised lineup exists to provide; the web home page
 * shows eight rails in a fixed order and does not need them. A new one must be listed here
 * with a word about what it is, which is the whole point: the pool cannot grow by accident.
 */
const TV_ONLY: Record<string, string> = {
  'genre-animation': 'shared genre id 16',
  'genre-documentary': 'shared genre id 99',
  'genre-family': 'shared genre id 10751',
  'genre-mystery': 'shared genre id 9648',
  'genre-western': 'shared genre id 37',
  'genre-horror': 'movies only: tv has no horror genre',
  'genre-thriller': 'movies only: tv has no thriller genre',
  'genre-romance': 'movies only: tv has no romance genre',
  'genre-history': 'movies only: tv has no history genre',
  'genre-war': 'movie 10752 / tv 10768 (War & Politics)',
  'genre-reality': 'television only: genre 10764',
  'genre-kids': 'television only: genre 10762',
  anime: "origin 'anime', which the backend reads as genre 16 + Japanese",
  'origin-kr': 'country shelf',
  'origin-jp': 'country shelf',
  'origin-gb': 'country shelf',
  'origin-fr': 'country shelf',
  'origin-in': 'country shelf',
  'origin-se': 'country shelf',
  'lang-es': 'original-language shelf',
  'newest-films': 'movies only: primary_release_date is a movie column',
  'newest-series': 'television only: first_air_date is a tv column',
  grossing: 'movies only: tv has no revenue column',
};

describe('TV_RAILS against the web MIXED_RAILS', () => {
  const tv = new Map(TV_RAILS.map((r) => [r.key, r]));

  it('carries every rail the web has', () => {
    // A rail added to the web fails here until someone decides whether the TV wants it.
    const missing = MIXED_RAILS.map((r) => r.key).filter((k) => !tv.has(k));
    expect(missing).toEqual([]);
  });

  it('carries the same title, eyebrow and genre / api params as the web, rail by rail', () => {
    for (const w of MIXED_RAILS) {
      const rail = tv.get(w.key)!;
      expect({ key: rail.key, title: rail.title, eyebrow: rail.eyebrow }).toEqual({
        key: w.key,
        title: w.title,
        eyebrow: w.eyebrow,
      });
      expect({ key: rail.key, movie: rail.movieParams }).toEqual({ key: w.key, movie: w.movieParams });
      expect({ key: rail.key, tv: rail.tvParams }).toEqual({ key: w.key, tv: w.tvParams });
    }
  });

  it('declares every rail it has invented', () => {
    const webKeys = new Set(MIXED_RAILS.map((r) => r.key));
    const invented = TV_RAILS.map((r) => r.key).filter((k) => !webKeys.has(k));
    expect(invented.sort()).toEqual(Object.keys(TV_ONLY).sort());
  });

  it('does not claim a web rail is TV-only', () => {
    // The two lists have to disagree, or the declaration above means nothing.
    const webKeys = new Set(MIXED_RAILS.map((r) => r.key));
    for (const key of Object.keys(TV_ONLY)) expect(webKeys.has(key), key).toBe(false);
  });
});
