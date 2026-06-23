import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPatch = vi.fn();
vi.mock('./api-client', () => ({
  default: { patch: (...a: unknown[]) => mockPatch(...a) },
}));

import { watchlistService } from './watchlist';

describe('watchlistService.update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('PATCHes the URL-encoded content_id with the metadata patch', async () => {
    mockPatch.mockResolvedValue({ data: { id: 'w1', content_id: 'movie:550' } });
    await watchlistService.update('user-1', 'movie:550', { year: 1999, vote_average: 8.4 });
    expect(mockPatch).toHaveBeenCalledWith(
      '/watchlist/user-1/movie%3A550',
      { year: 1999, vote_average: 8.4 },
    );
  });
});
