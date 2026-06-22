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
    expect(feedIdentityFromParams({ company: 0, genres: '28' })).toBeUndefined();
    expect(feedIdentityFromParams({ provider: '0' })).toBeUndefined();
    expect(feedIdentityFromParams({ api: 'popular' })).toBeUndefined();
    expect(feedIdentityFromParams(undefined)).toBeUndefined();
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
    expect(feedIdentityFromKey('genre-28')).toBeUndefined();
    expect(feedIdentityFromKey('trending')).toBeUndefined();
    expect(feedIdentityFromKey(undefined)).toBeUndefined();
  });
});

describe('resolveFeedTheme', () => {
  it('resolves curated marquee feeds to their theme', () => {
    expect(resolveFeedTheme({ type: 'company', id: '420' })?.id).toBe('marvel-studios');
    expect(resolveFeedTheme({ type: 'provider', id: '8' })?.id).toBe('netflix');
    expect(resolveFeedTheme({ type: 'collection', id: '748' })?.id).toBe('x-men');
  });

  it('returns null for unmapped ids and undefined identity', () => {
    expect(resolveFeedTheme({ type: 'company', id: '99999' })).toBeNull();
    expect(resolveFeedTheme(undefined)).toBeNull();
  });
});
