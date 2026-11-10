import { describe, it, expect } from 'vitest';
import {
  parseContentId,
  buildContentId,
  resumeUrlFor,
  showNameFromTitle,
  tmdbIdFromContentId,
  titleOfContentId,
  titleOfStream,
} from './contentId';

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
// buildContentId
// ---------------------------------------------------------------------------
describe('buildContentId', () => {
  it('builds a movie content_id', () => {
    expect(buildContentId({ kind: 'movie', tmdbId: 12345 })).toBe('movie:12345');
  });

  it('builds a show-level tv content_id (no season/episode)', () => {
    expect(buildContentId({ kind: 'tv', tmdbId: 67890 })).toBe('tv:67890');
  });

  it('builds an episode-level tv content_id', () => {
    expect(buildContentId({ kind: 'tv', tmdbId: 67890, season: 2, episode: 5 })).toBe('tv:67890:s2:e5');
  });

  it('round-trips: buildContentId → parseContentId for a movie', () => {
    const id = buildContentId({ kind: 'movie', tmdbId: 42 });
    expect(parseContentId(id)).toEqual({ kind: 'movie' });
  });

  it('round-trips: buildContentId → parseContentId for a tv episode', () => {
    const id = buildContentId({ kind: 'tv', tmdbId: 99, season: 3, episode: 7 });
    expect(parseContentId(id)).toEqual({ kind: 'tv', showId: 99, season: 3, episode: 7 });
  });

  it('ignores season/episode when only one is provided (returns show-level id)', () => {
    // season without episode → show-level
    expect(buildContentId({ kind: 'tv', tmdbId: 1, season: 1 })).toBe('tv:1');
    // episode without season → show-level
    expect(buildContentId({ kind: 'tv', tmdbId: 1, episode: 1 })).toBe('tv:1');
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

// ---------------------------------------------------------------------------
// tmdbIdFromContentId
// ---------------------------------------------------------------------------
describe('tmdbIdFromContentId', () => {
  it('extracts the tmdb id from a movie content_id', () => {
    expect(tmdbIdFromContentId('movie:12345')).toBe(12345);
  });

  it('extracts the show tmdb id from a tv episode content_id', () => {
    expect(tmdbIdFromContentId('tv:67890:s2:e5')).toBe(67890);
  });

  it('extracts the show tmdb id from a bare tv content_id', () => {
    expect(tmdbIdFromContentId('tv:99')).toBe(99);
  });

  it('returns undefined for a legacy title-based movie_id', () => {
    expect(tmdbIdFromContentId('Interstellar')).toBeUndefined();
  });

  it('returns undefined when the id segment is non-numeric', () => {
    expect(tmdbIdFromContentId('tv:abc')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// titleOfContentId — which title page a progress row belongs to
//
// toStrictEqual, not toEqual: toEqual reads `{ season: undefined }` as equal to a missing
// key, so a show-level answer that still carried the dropped S/E as undefined would pass.
// ---------------------------------------------------------------------------
describe('titleOfContentId', () => {
  it('names the film for a movie id', () => {
    expect(titleOfContentId('movie:603')).toStrictEqual({ kind: 'movie', tmdbId: 603 });
  });

  it('names the show and the episode for an episode id', () => {
    expect(titleOfContentId('tv:1399:s2:e5')).toStrictEqual({
      kind: 'tv',
      tmdbId: 1399,
      season: 2,
      episode: 5,
    });
  });

  it('names the show alone for a show-level id', () => {
    expect(titleOfContentId('tv:1399')).toStrictEqual({ kind: 'tv', tmdbId: 1399 });
  });

  it('drops season 0, which is never an ask (Specials, and the backend s0 fallback)', () => {
    expect(titleOfContentId('tv:1399:s0:e4')).toStrictEqual({ kind: 'tv', tmdbId: 1399 });
  });

  it('answers null for a legacy title-string id', () => {
    expect(titleOfContentId('Interstellar')).toStrictEqual(null);
  });

  it('answers null for a non-numeric id segment', () => {
    expect(titleOfContentId('movie:abc')).toStrictEqual(null);
  });

  it('answers null for a tmdb id of 0', () => {
    expect(titleOfContentId('movie:0')).toStrictEqual(null);
  });

  it('answers null for a tmdb id past the safe-integer range', () => {
    // parseInt reads it as 1e20; a page built on it would name a title nobody has.
    expect(titleOfContentId('movie:99999999999999999999')).toStrictEqual(null);
  });

  it('answers null for null', () => {
    expect(titleOfContentId(null)).toStrictEqual(null);
  });

  it('answers null for undefined', () => {
    expect(titleOfContentId(undefined)).toStrictEqual(null);
  });

  it('answers null for the empty string', () => {
    expect(titleOfContentId('')).toStrictEqual(null);
  });
});

// ---------------------------------------------------------------------------
// titleOfStream — which title page a download belongs to
// ---------------------------------------------------------------------------
describe('titleOfStream', () => {
  const seasonPack = { tmdb_id: 1399, media_type: 'tv', season: 2, episode: null };

  it('names the episode a single-episode download carries on its own row', () => {
    expect(
      titleOfStream({ tmdb_id: 1399, media_type: 'tv', season: 2, episode: 3 }),
    ).toStrictEqual({ kind: 'tv', tmdbId: 1399, season: 2, episode: 3 });
  });

  it('takes the episode of a season pack from the hint', () => {
    expect(titleOfStream(seasonPack, { season: 2, episode: 5 })).toStrictEqual({
      kind: 'tv',
      tmdbId: 1399,
      season: 2,
      episode: 5,
    });
  });

  it('takes the season of a season pack from the hint too, not the season it was asked under', () => {
    // A multi-season "Complete" pack stored under season 1, playing its S02E01: `/info` keys
    // the web's progress under s2, so the title page must ask for season 2.
    expect(
      titleOfStream(
        { tmdb_id: 1399, media_type: 'tv', season: 1, episode: null },
        { season: 2, episode: 1 },
      ),
    ).toStrictEqual({ kind: 'tv', tmdbId: 1399, season: 2, episode: 1 });
  });

  it("answers show-level when a pack's hint names no season, rather than borrow the row's", () => {
    expect(titleOfStream(seasonPack, { season: null, episode: 4 })).toStrictEqual({
      kind: 'tv',
      tmdbId: 1399,
    });
  });

  it('answers show-level for a season pack with no hint', () => {
    expect(titleOfStream(seasonPack)).toStrictEqual({ kind: 'tv', tmdbId: 1399 });
  });

  it('answers show-level when the hint names season 0', () => {
    // The row names season 2, and it is still not a fallback: a pack's season is the hint's.
    expect(titleOfStream(seasonPack, { season: 0, episode: 4 })).toStrictEqual({
      kind: 'tv',
      tmdbId: 1399,
    });
  });

  it("lets the torrent row's own episode win over the hint, its season with it", () => {
    expect(
      titleOfStream(
        { tmdb_id: 1399, media_type: 'tv', season: 2, episode: 3 },
        { season: 3, episode: 5 },
      ),
    ).toStrictEqual({ kind: 'tv', tmdbId: 1399, season: 2, episode: 3 });
  });

  it("answers show-level when the row names an episode but no season, rather than borrow the hint's", () => {
    // The backend never stores this shape; the row's episode still makes both numbers the row's.
    expect(
      titleOfStream(
        { tmdb_id: 1399, media_type: 'tv', season: null, episode: 3 },
        { season: 2, episode: 5 },
      ),
    ).toStrictEqual({ kind: 'tv', tmdbId: 1399 });
  });

  it('names the film for a movie download', () => {
    expect(titleOfStream({ tmdb_id: 603, media_type: 'movie' })).toStrictEqual({
      kind: 'movie',
      tmdbId: 603,
    });
  });

  it('reads a download with no media_type as a film', () => {
    expect(titleOfStream({ tmdb_id: 603, media_type: null })).toStrictEqual({
      kind: 'movie',
      tmdbId: 603,
    });
  });

  it('lets media_type decide the kind, not the season fields', () => {
    expect(
      titleOfStream({ tmdb_id: 603, media_type: null, season: 2, episode: 3 }, { season: 2, episode: 3 }),
    ).toStrictEqual({ kind: 'movie', tmdbId: 603 });
  });

  it('answers null when the download carries no tmdb id', () => {
    expect(titleOfStream({ tmdb_id: null, media_type: 'tv' })).toStrictEqual(null);
  });

  it('answers null for a tmdb id of 0', () => {
    expect(titleOfStream({ tmdb_id: 0 })).toStrictEqual(null);
  });

  it('answers null for no status at all', () => {
    expect(titleOfStream(null)).toStrictEqual(null);
  });
});
