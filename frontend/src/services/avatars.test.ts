import { describe, it, expect, vi, beforeEach } from 'vitest';

const list = vi.fn();
const getDetail = vi.fn();

vi.mock('./watchlist', () => ({ watchlistService: { list: (...a: unknown[]) => list(...a) } }));
vi.mock('./movies', () => ({ moviesService: { getDetail: (...a: unknown[]) => getDetail(...a) } }));
vi.mock('./api-client', () => ({ default: { post: vi.fn() } }));

import { avatarsService } from './avatars';

const item = (tmdb_id: string, media_type = 'movie', added_at = '2026-01-01') => ({
  id: tmdb_id, user_id: 'u1', content_id: `movie:${tmdb_id}`, tmdb_id, media_type,
  added_at, created_at: added_at,
});

beforeEach(() => {
  list.mockReset();
  getDetail.mockReset();
});

describe('loadLibraryStills', () => {
  it('flattens cast with a profile_path into stills', async () => {
    list.mockResolvedValue([item('1')]);
    getDetail.mockResolvedValue({
      cast: [
        { name: 'Sigourney Weaver', character: 'Ripley', image: 'https://img/w185/a.jpg', profile_path: '/a.jpg' },
        { name: 'No Photo', character: null, image: null, profile_path: null },
      ],
    });

    const stills = await avatarsService.loadLibraryStills('u1');

    expect(stills).toEqual([
      { label: 'Ripley', profilePath: '/a.jpg', previewUrl: 'https://img/w185/a.jpg' },
    ]);
  });

  it('skips tv entries, which carry no cast', async () => {
    list.mockResolvedValue([item('9', 'tv')]);
    const stills = await avatarsService.loadLibraryStills('u1');
    expect(getDetail).not.toHaveBeenCalled();
    expect(stills).toEqual([]);
  });

  it('survives a detail fetch that rejects', async () => {
    list.mockResolvedValue([item('1'), item('2', 'movie', '2026-02-01')]);
    getDetail
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ cast: [{ name: 'A', character: 'B', image: 'u', profile_path: '/p.jpg' }] });

    const stills = await avatarsService.loadLibraryStills('u1');
    expect(stills).toHaveLength(1);
  });

  it('returns an empty list rather than throwing when the watchlist fails', async () => {
    list.mockRejectedValue(new Error('offline'));
    await expect(avatarsService.loadLibraryStills('u1')).resolves.toEqual([]);
  });
});
