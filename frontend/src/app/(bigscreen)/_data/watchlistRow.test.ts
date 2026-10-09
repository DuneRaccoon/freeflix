import { describe, it, expect } from 'vitest';
import type { WatchlistItem } from '@/services/watchlist';
import { usableWatchlistRow, watchlistCards } from './watchlistRow';

const entry = (over: Partial<WatchlistItem> = {}): WatchlistItem => ({
  id: 'w1',
  user_id: 'u1',
  content_id: 'movie:603',
  tmdb_id: '603',
  media_type: 'movie',
  title: 'The Matrix',
  poster_url: 'https://img.test/p.jpg',
  year: 1999,
  vote_average: 8.2,
  added_at: '2026-10-01T00:00:00',
  created_at: '2026-10-01T00:00:00',
  ...over,
});

describe('usableWatchlistRow', () => {
  it('keeps a movie row and a tv row', () => {
    expect(usableWatchlistRow(entry())).toBe(true);
    expect(usableWatchlistRow(entry({ media_type: 'tv', content_id: 'tv:1399', tmdb_id: '1399' }))).toBe(true);
  });

  it('drops a row whose media_type is neither movie nor tv', () => {
    // `media_type` picks the ROUTE: `catalogItemToCard` sends anything that is not 'tv' to
    // /bigscreen/movie/{id}, so a row of another kind becomes a card that dead-ends on a 404.
    // Nothing upstream stops it — the backend field is a bare `str` and
    // `@/lib/watchlist/toCatalogItem` CASTS rather than validates.
    for (const media_type of ['person', 'movies', 'TV', '', 'episode']) {
      expect(usableWatchlistRow(entry({ media_type })), media_type).toBe(false);
    }
  });

  it('drops a row whose tmdb_id is not a positive whole number', () => {
    for (const tmdb_id of ['abc', '', '0', '-3', '12.5']) {
      expect(usableWatchlistRow(entry({ tmdb_id })), tmdb_id).toBe(false);
    }
  });

  it('drops a row with no content_id, which is the only handle removal has', () => {
    expect(usableWatchlistRow(entry({ content_id: '' }))).toBe(false);
    expect(usableWatchlistRow(entry({ content_id: undefined as unknown as string }))).toBe(false);
  });

  it('drops a null or undefined row rather than throwing on it', () => {
    expect(usableWatchlistRow(null)).toBe(false);
    expect(usableWatchlistRow(undefined)).toBe(false);
  });
});

describe('watchlistCards', () => {
  it('carries the row content_id beside the card, not the card id', () => {
    // The card's id is `{media_type}:{tmdb_id}`; removal takes the row's own content_id.
    const [first] = watchlistCards([entry({ content_id: 'movie:603:legacy' })]);
    expect(first.contentId).toBe('movie:603:legacy');
    expect(first.card.id).toBe('movie:603');
  });

  it('routes a movie to the movie screen and a show to the show screen', () => {
    const cards = watchlistCards([
      entry({ tmdb_id: '603', media_type: 'movie' }),
      entry({ id: 'w2', tmdb_id: '1399', media_type: 'tv', content_id: 'tv:1399', title: 'Thrones', year: 2011 }),
    ]);
    expect(cards.map((w) => w.card.href)).toEqual(['/bigscreen/movie/603', '/bigscreen/show/1399']);
    expect(cards[1].card).toMatchObject({ title: 'Thrones', subtitle: '2011' });
  });

  it('builds poster cards, because a watchlist row carries no backdrop', () => {
    const [first] = watchlistCards([entry()]);
    expect(first.card.artUrl).toBe('https://img.test/p.jpg');
  });

  it('costs a bad row only itself', () => {
    const cards = watchlistCards([
      null,
      entry({ id: 'bad1', tmdb_id: 'abc', title: 'Bad id' }),
      entry({ id: 'bad2', media_type: 'person', title: 'Bad kind' }),
      entry({ id: 'good', tmdb_id: '7', title: 'Fine' }),
    ]);
    expect(cards.map((w) => w.card.title)).toEqual(['Fine']);
  });

  it('counts CARDS against the cap, not rows', () => {
    // A malformed row at the top of the list must not eat one of the cap's places.
    const rows = [
      entry({ id: 'bad', tmdb_id: 'abc', title: 'Bad' }),
      ...Array.from({ length: 5 }, (_, i) => entry({ id: `w${i}`, tmdb_id: String(i + 1), title: `T${i + 1}` })),
    ];
    expect(watchlistCards(rows, 3).map((w) => w.card.title)).toEqual(['T1', 'T2', 'T3']);
  });

  it('is uncapped when no cap is given — the dedicated screen shows the whole list', () => {
    const rows = Array.from({ length: 200 }, (_, i) => entry({ id: `w${i}`, tmdb_id: String(i + 1) }));
    expect(watchlistCards(rows)).toHaveLength(200);
  });
});
