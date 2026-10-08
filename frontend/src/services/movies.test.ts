import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./api-client', () => ({ default: { get: vi.fn() } }));

import apiClient from './api-client';
import { moviesService } from './movies';

const get = vi.mocked(apiClient.get);

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ data: { tmdb_id: 603 } });
});

describe('moviesService.getDetail', () => {
  it('sends the same bare request as before when no option is given', async () => {
    await moviesService.getDetail(603);
    expect(get).toHaveBeenCalledWith('/movies/603', undefined);
  });

  it('leaves the request alone for withQualities: true', async () => {
    await moviesService.getDetail(603, { withQualities: true });
    expect(get).toHaveBeenCalledWith('/movies/603', undefined);
  });

  it('asks the backend to skip its torrent search for withQualities: false', async () => {
    await moviesService.getDetail(603, { withQualities: false });
    expect(get).toHaveBeenCalledWith('/movies/603', { params: { with_qualities: false } });
  });
});
