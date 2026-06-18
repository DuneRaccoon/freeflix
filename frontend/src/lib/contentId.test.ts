import { describe, it, expect } from 'vitest';
import { parseContentId, resumeUrlFor, showNameFromTitle } from './contentId';

// ---------------------------------------------------------------------------
// parseContentId
// ---------------------------------------------------------------------------
describe('parseContentId', () => {
  it('parses a movie content_id', () => {
    expect(parseContentId('movie:12345')).toEqual({ kind: 'movie' });
  });

  it('parses a tv content_id with season and episode', () => {
    expect(parseContentId('tv:67890:s2:e5')).toEqual({
      kind: 'tv',
      showId: 67890,
      season: 2,
      episode: 5,
    });
  });

  it('parses a tv content_id with single-digit season and episode', () => {
    expect(parseContentId('tv:1:s1:e1')).toEqual({
      kind: 'tv',
      showId: 1,
      season: 1,
      episode: 1,
    });
  });

  it('classifies a malformed tv content_id as tv without numeric parts', () => {
    const result = parseContentId('tv:abc');
    expect(result.kind).toBe('tv');
    expect(result.showId).toBeUndefined();
  });

  it('classifies an unrecognised string as movie', () => {
    expect(parseContentId('something:else')).toEqual({ kind: 'movie' });
  });
});

// ---------------------------------------------------------------------------
// resumeUrlFor
// ---------------------------------------------------------------------------
describe('resumeUrlFor', () => {
  it('returns base streaming URL when file_index is null', () => {
    expect(resumeUrlFor({ torrent_id: 'abc123', file_index: null })).toBe('/streaming/abc123');
  });

  it('returns base streaming URL when file_index is undefined', () => {
    expect(resumeUrlFor({ torrent_id: 'abc123' })).toBe('/streaming/abc123');
  });

  it('appends ?file= when file_index is 0', () => {
    expect(resumeUrlFor({ torrent_id: 'abc123', file_index: 0 })).toBe('/streaming/abc123?file=0');
  });

  it('appends ?file= when file_index is a positive integer', () => {
    expect(resumeUrlFor({ torrent_id: 'xyz999', file_index: 3 })).toBe('/streaming/xyz999?file=3');
  });
});

// ---------------------------------------------------------------------------
// showNameFromTitle
// ---------------------------------------------------------------------------
describe('showNameFromTitle', () => {
  it('strips the SxxExx suffix from a title', () => {
    expect(showNameFromTitle('The Boys S01E03 – Some Episode')).toBe('The Boys');
  });

  it('strips just Sxx when there is no episode number', () => {
    expect(showNameFromTitle('Peaky Blinders S05')).toBe('Peaky Blinders');
  });

  it('returns the full title when there is no suffix to strip', () => {
    expect(showNameFromTitle('Inception')).toBe('Inception');
  });

  it('falls back to Show {id} when title is null', () => {
    expect(showNameFromTitle(null, 42)).toBe('Show 42');
  });

  it('falls back to Show {id} when title is undefined', () => {
    expect(showNameFromTitle(undefined, 7)).toBe('Show 7');
  });

  it('falls back to Unknown Show when title and showId are both absent', () => {
    expect(showNameFromTitle(null)).toBe('Unknown Show');
    expect(showNameFromTitle(undefined)).toBe('Unknown Show');
  });

  it('falls back to Unknown Show when title is an empty string', () => {
    // empty string is falsy in JS — treated same as null/undefined
    expect(showNameFromTitle('')).toBe('Unknown Show');
  });
});
