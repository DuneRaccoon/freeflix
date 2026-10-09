/**
 * TV_RAILS is a COPY of the web's MIXED_RAILS, so something has to pin it.
 *
 * rails.ts cannot import the web table: `@/lib/buildMixedRailsScreen` pulls the web's
 * BrowseScreen, and with it PosterCard and the Tailwind runtime, into the TV bundle
 * (spec §9). Duplication with nothing pinning it drifts silently, and a TMDB genre id
 * that drifts returns the wrong genre with no error anywhere. A TEST may import from the
 * web surface, since it ships in no bundle, so this does what bigscreen-tokens.test.ts
 * does for the copied colour tokens: parse both sides and compare.
 *
 * If a rail is deliberately absent or different on the TV, do not delete the assertion:
 * add it to TV_OMITS (or compare around it) with the reason.
 */
import { describe, expect, it } from 'vitest';
import { MIXED_RAILS } from '@/lib/buildMixedRailsScreen';
import { TV_RAILS } from './rails';

/** Web rails the television deliberately does not carry, and why. */
const TV_OMITS: Record<string, string> = {
  'genre-crime': 'the TV lineup stops at seven rails; the eighth is a long way down a D-pad',
};

describe('TV_RAILS against the web MIXED_RAILS', () => {
  const web = new Map(MIXED_RAILS.map((r) => [r.key, r]));

  it('every TV rail exists on the web', () => {
    for (const rail of TV_RAILS) expect(web.has(rail.key), rail.key).toBe(true);
  });

  it('carries the same title, eyebrow and genre / api params as the web, rail by rail', () => {
    for (const rail of TV_RAILS) {
      const w = web.get(rail.key)!;
      expect({ key: rail.key, title: rail.title, eyebrow: rail.eyebrow }).toEqual({
        key: w.key,
        title: w.title,
        eyebrow: w.eyebrow,
      });
      expect({ key: rail.key, movie: rail.movieParams }).toEqual({ key: w.key, movie: w.movieParams });
      expect({ key: rail.key, tv: rail.tvParams }).toEqual({ key: w.key, tv: w.tvParams });
    }
  });

  it('is the web lineup in the web order, less the rails it deliberately omits', () => {
    const expected = MIXED_RAILS.map((r) => r.key).filter((k) => !(k in TV_OMITS));
    expect(TV_RAILS.map((r) => r.key)).toEqual(expected);
  });

  it('knows every rail the web has that the TV does not carry', () => {
    // A rail added to the web fails here until someone decides whether the TV wants it.
    const tvKeys = new Set(TV_RAILS.map((r) => r.key));
    const missing = MIXED_RAILS.map((r) => r.key).filter((k) => !tvKeys.has(k));
    expect(missing.sort()).toEqual(Object.keys(TV_OMITS).sort());
  });
});
