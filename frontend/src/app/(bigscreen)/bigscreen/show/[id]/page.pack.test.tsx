/**
 * The show screen against the REAL `titleStateFor`, with only the HTTP-facing services
 * mocked: this is where a season pack's `file_index` is resolved and either carried to the
 * watch URL, disclosed as unknown, or reported as absent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { SeasonDetail, ShowDetail, TorrentStatus, VideoFile } from '@/types';
import { tvService } from '@/services/tv';
import { streamingService } from '@/services/streaming';
import { torrentsService } from '@/services/torrents';
import { useTvProfile } from '../../../_data/useTvProfile';
import ShowPage from './page';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => ({ id: '1399' }) }));
vi.mock('../../../_data/useTvProfile', () => ({ useTvProfile: vi.fn() }));
vi.mock('@/services/tv', () => ({ tvService: { getShow: vi.fn(), getSeason: vi.fn() } }));
vi.mock('@/services/torrents', () => ({ torrentsService: { listTorrents: vi.fn(), getTorrentStatus: vi.fn(), downloadCatalogMovie: vi.fn(), performTorrentAction: vi.fn() } }));
vi.mock('@/services/streaming', () => ({
  streamingService: { getRecentProgress: vi.fn(), getProgressByMovie: vi.fn(), getFiles: vi.fn() },
}));

const pack = (over: Partial<TorrentStatus> = {}): TorrentStatus =>
  ({ id: 'pk', tmdb_id: 1399, media_type: 'tv', season: 2, episode: null, state: 'finished', progress: 100, ...over }) as TorrentStatus;
const file = (index: number, season: number | null, episode: number | null, size = 100): VideoFile =>
  ({ index, name: `f${index}`, size, downloaded: size, progress: 100, mime_type: 'video/mp4', stream_url: '', season, episode });

const showDetail = {
  tmdb_id: 1399, media_type: 'tv', name: 'Thrones Like', year: 2011, overview: null, poster_url: null, backdrop_url: null,
  genres: [], status: null, first_air_date: null, last_air_date: null, number_of_seasons: 2, vote_average: 0, vote_count: 0,
  seasons: [{ season_number: 2, name: 'Season 2', episode_count: 3, overview: null, poster_url: null, air_date: null }],
} as ShowDetail;
const seasonTwo: SeasonDetail = {
  season_number: 2, name: 'Season 2', overview: null,
  episodes: [1, 2, 3].map((n) => ({ episode_number: n, name: `Ep ${n}`, overview: null, runtime: null, still_url: null, air_date: null, vote_average: 0 })),
};

const epButtons = () => screen.queryAllByRole('button', { name: /^\d+\s/ });

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.mocked(useTvProfile).mockReturnValue({ profile: { id: 'p1', display_name: 'B', avatar: null }, loading: false, select: vi.fn(), clear: vi.fn() });
  vi.mocked(tvService.getShow).mockResolvedValue(showDetail);
  vi.mocked(tvService.getSeason).mockResolvedValue(seasonTwo);
  vi.mocked(streamingService.getRecentProgress).mockResolvedValue([]);
  vi.mocked(streamingService.getProgressByMovie).mockResolvedValue(null);
  vi.mocked(torrentsService.listTorrents).mockResolvedValue([pack()]);
});

async function mountAndSettle() {
  render(<ShowPage />);
  await waitFor(() => expect(epButtons()).toHaveLength(3));
  // let the default control's own lookup land so it cannot race the press under test
  await screen.findByText(/S2 · E1/);
  await waitFor(() => expect(document.querySelector('.bs-title__action button')).not.toBeNull());
}

describe('season packs', () => {
  it('resolves the episode to its file_index and navigates with ?file=', async () => {
    vi.mocked(streamingService.getFiles).mockResolvedValue([file(0, 2, 1), file(1, 2, 2, 50), file(4, 2, 2, 900), file(5, 2, 3)]);
    await mountAndSettle();
    fireEvent.click(epButtons()[1]);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/bigscreen/watch/pk?file=4'));
  });

  it('file 0 is a real index (first file of a pack) and is not dropped', async () => {
    vi.mocked(streamingService.getFiles).mockResolvedValue([file(0, 2, 1), file(1, 2, 2), file(2, 2, 3)]);
    await mountAndSettle();
    fireEvent.click(epButtons()[0]);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/bigscreen/watch/pk?file=0'));
  });

  it('a pack that lacks the episode says so and does NOT navigate to a guessed index', async () => {
    vi.mocked(streamingService.getFiles).mockResolvedValue([file(0, 2, 1), file(1, 2, 3)]);
    await mountAndSettle();
    fireEvent.click(epButtons()[1]); // E2 is not in the pack
    await screen.findByText(/isn.t on the box yet/i);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('an unreadable file list is UNKNOWN, not absent: no download offered, disclosed instead', async () => {
    vi.mocked(streamingService.getFiles).mockRejectedValue(new Error('no list'));
    await mountAndSettle();
    fireEvent.click(epButtons()[1]);
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent(/may be a different episode/i);
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Play anyway' }));
    expect(router.push).toHaveBeenCalledWith('/bigscreen/watch/pk');
  });

  it('a wholly unparsed file list is also unknown', async () => {
    vi.mocked(streamingService.getFiles).mockResolvedValue([file(0, null, null), file(1, null, null)]);
    await mountAndSettle();
    fireEvent.click(epButtons()[2]);
    expect(await screen.findByRole('note')).toHaveTextContent(/may be a different episode/i);
  });

  it('pressing the same unresolved episode again re-asks (that is the recheck)', async () => {
    vi.mocked(streamingService.getFiles).mockRejectedValue(new Error('no list'));
    await mountAndSettle();
    fireEvent.click(epButtons()[1]);
    await screen.findByRole('note');
    vi.mocked(streamingService.getFiles).mockResolvedValue([file(0, 2, 1), file(9, 2, 2)]);
    fireEvent.click(epButtons()[1]);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/bigscreen/watch/pk?file=9'));
  });
});
