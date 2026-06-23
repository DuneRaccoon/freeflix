// frontend/src/lib/feedThemes/resolveFeedTheme.test.ts
import { describe, it, expect } from 'vitest';
import {
  feedIdentityFromParams,
  feedIdentityFromKey,
  resolveFeedTheme,
} from './resolveFeedTheme';

describe('feedIdentityFromParams', () => {
  it('reads company / collection / provider ids as strings', () => {
    expect(feedIdentityFromParams({ company: 420 })).toEqual({ type: 'company', id: '420' });
    expect(feedIdentityFromParams({ collection: '748' })).toEqual({ type: 'collection', id: '748' });
    expect(feedIdentityFromParams({ provider: 8 })).toEqual({ type: 'provider', id: '8' });
  });

  it('prefers company over collection over provider', () => {
    expect(feedIdentityFromParams({ company: 420, collection: 748, provider: 8 }))
      .toEqual({ type: 'company', id: '420' });
  });

  it('treats 0 / "0" / missing as unset', () => {
    expect(feedIdentityFromParams({ company: 0 })).toBeUndefined();
    expect(feedIdentityFromParams({ provider: '0' })).toBeUndefined();
    expect(feedIdentityFromParams({ api: 'popular' })).toBeUndefined();
    expect(feedIdentityFromParams(undefined)).toBeUndefined();
  });

  it('prefers explicit marquee feeds over a genre', () => {
    // company/collection/provider win over the genre param
    expect(feedIdentityFromParams({ company: 420, genres: '27' }))
      .toEqual({ type: 'company', id: '420' });
  });

  it('maps a themed genre id to its canonical slug', () => {
    expect(feedIdentityFromParams({ genres: '27' })).toEqual({ type: 'genre', id: 'horror' });
    expect(feedIdentityFromParams({ genres: '878' })).toEqual({ type: 'genre', id: 'scifi' });
    expect(feedIdentityFromParams({ genres: '80' })).toEqual({ type: 'genre', id: 'crime' });
  });

  it('folds movie and TV ids of the same genre into one slug', () => {
    // Action is movie genre 28 but TV genre 10759
    expect(feedIdentityFromParams({ genres: '28' })).toEqual({ type: 'genre', id: 'action' });
    expect(feedIdentityFromParams({ genres: '10759' })).toEqual({ type: 'genre', id: 'action' });
    // Sci-Fi is movie 878 but TV "Sci-Fi & Fantasy" 10765
    expect(feedIdentityFromParams({ genres: '10765' })).toEqual({ type: 'genre', id: 'scifi' });
  });

  it('reads the first id from a multi-genre CSV and the legacy single genre', () => {
    expect(feedIdentityFromParams({ genres: '27,53' })).toEqual({ type: 'genre', id: 'horror' });
    expect(feedIdentityFromParams({ genre: 35 })).toEqual({ type: 'genre', id: 'comedy' });
  });

  it('leaves unthemed genres neutral (undefined)', () => {
    expect(feedIdentityFromParams({ genres: '18' })).toBeUndefined(); // Drama
    expect(feedIdentityFromParams({ genres: '99' })).toBeUndefined(); // Documentary
  });
});

describe('feedIdentityFromKey', () => {
  it('parses known prefixes only', () => {
    expect(feedIdentityFromKey('company-420')).toEqual({ type: 'company', id: '420' });
    expect(feedIdentityFromKey('collection-748')).toEqual({ type: 'collection', id: '748' });
    expect(feedIdentityFromKey('provider-8')).toEqual({ type: 'provider', id: '8' });
  });

  it('ignores non-feed keys (no mis-parse of hyphenated words)', () => {
    expect(feedIdentityFromKey('top-rated')).toBeUndefined();
    expect(feedIdentityFromKey('trending')).toBeUndefined();
    expect(feedIdentityFromKey(undefined)).toBeUndefined();
  });

  it('parses themed genre keys by id and by slug', () => {
    expect(feedIdentityFromKey('genre-27')).toEqual({ type: 'genre', id: 'horror' });
    expect(feedIdentityFromKey('genre-28')).toEqual({ type: 'genre', id: 'action' });
    // home rails key by slug (e.g. "genre-action", "genre-scifi")
    expect(feedIdentityFromKey('genre-action')).toEqual({ type: 'genre', id: 'action' });
    expect(feedIdentityFromKey('genre-scifi')).toEqual({ type: 'genre', id: 'scifi' });
    // personalized "Because you watch …" rails
    expect(feedIdentityFromKey('taste-genre-878')).toEqual({ type: 'genre', id: 'scifi' });
  });

  it('leaves unthemed genre keys neutral', () => {
    expect(feedIdentityFromKey('genre-18')).toBeUndefined(); // Drama
    expect(feedIdentityFromKey('taste-genre-18')).toBeUndefined();
  });
});

describe('resolveFeedTheme', () => {
  it('resolves curated marquee feeds to their theme', () => {
    expect(resolveFeedTheme({ type: 'company', id: '420' })?.id).toBe('marvel-studios');
    expect(resolveFeedTheme({ type: 'provider', id: '8' })?.id).toBe('netflix');
    expect(resolveFeedTheme({ type: 'collection', id: '748' })?.id).toBe('x-men');
  });

  it('resolves curated genre feeds to their theme', () => {
    expect(resolveFeedTheme({ type: 'genre', id: 'horror' })?.id).toBe('horror');
    expect(resolveFeedTheme({ type: 'genre', id: 'scifi' })?.id).toBe('scifi');
    expect(resolveFeedTheme({ type: 'genre', id: 'western' })?.id).toBe('western');
  });

  it('returns null for unmapped ids and undefined identity', () => {
    expect(resolveFeedTheme({ type: 'company', id: '99999' })).toBeNull();
    expect(resolveFeedTheme({ type: 'genre', id: 'drama' })).toBeNull();
    expect(resolveFeedTheme(undefined)).toBeNull();
  });
});

describe('genre theme registry coverage', () => {
  const SLUGS = ['horror', 'scifi', 'action', 'romance', 'crime', 'comedy', 'fantasy', 'western'];
  const MOTIFS = ['none', 'wordmark', 'beams', 'starfield', 'arcs', 'halftone', 'grain', 'grid', 'bokeh', 'sparkle', 'slats'];

  it('every curated genre slug resolves to a well-formed theme', () => {
    for (const slug of SLUGS) {
      const theme = resolveFeedTheme({ type: 'genre', id: slug });
      expect(theme, slug).not.toBeNull();
      expect(theme!.accent).toMatch(/^#/);
      expect(theme!.band).toContain('gradient');
      expect(theme!.eyebrowOverride).toBeTruthy();
      if (theme!.motif) expect(MOTIFS).toContain(theme!.motif.kind);
    }
  });
});
