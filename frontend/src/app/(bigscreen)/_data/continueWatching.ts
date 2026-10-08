import type { StreamingProgress } from '@/types';
import { streamingService } from '@/services/streaming';
import { watchlistService } from '@/services/watchlist';
import { moviesService } from '@/services/movies';
import { tvService } from '@/services/tv';
import { parseContentId, showNameFromTitle, tmdbIdFromContentId } from '@/lib/contentId';
import { parseUtc } from '@/lib/parseUtc';
import { watchlistItemToCatalogItem } from '@/lib/watchlist/toCatalogItem';
// Type-only, so erased at build; spelled with the alias for the reason given in rails.ts.
import type { CardItem } from '@/app/(bigscreen)/_components/Card';
import type { RailModel } from '@/app/(bigscreen)/_components/Rail';
import { catalogItemToCard } from './rails';

export interface ContinueWatchingDeps {
  /** The selected profile's id. Empty means no profile is selected yet. */
  userId: string;
}

const CONTINUE_WATCHING: Omit<RailModel, 'items'> = {
  key: 'continue-watching',
  title: 'Continue Watching',
  eyebrow: 'Pick up where you left off',
  shape: 'wide',
};

const MY_LIST: Omit<RailModel, 'items'> = {
  key: 'my-list',
  title: 'My List',
  shape: 'poster',
};

/** How many recent progress rows to ask for. Most of them are filtered out below. */
const FETCH_LIMIT = 24;

/**
 * The most cards the rail will draw. Each card costs one title-detail request for its
 * artwork, so this bounds the fan-out as well as the D-pad presses to cross it. The web
 * caps at 6.
 */
const MAX_CARDS = 10;

/** The profile-scoped endpoints refuse (403/404/423) rather than return nothing. */
const empty = (spec: Omit<RailModel, 'items'>): RailModel => ({ ...spec, items: [] });

interface Candidate {
  /** Whose artwork to look up; null when the title cannot be identified. */
  art: { kind: 'movie' | 'tv'; tmdbId: number } | null;
  card: Omit<CardItem, 'artUrl'>;
}

function watchedAt(row: StreamingProgress): number {
  // The backend sends zone-less UTC; new Date() would read it as local time.
  return parseUtc(row.last_watched_at)?.getTime() ?? 0;
}

/**
 * Where OK resumes. Built here, and NOT with `resumeUrlFor` from `@/lib/contentId`,
 * which answers `/streaming/{id}`: a (web) route that would navigate the television out
 * of its own root layout.
 */
function resumeHref(torrentId: string, fileIndex: number | null | undefined): string {
  const base = `/bigscreen/watch/${torrentId}`;
  // `!= null`, not truthiness: file 0 is the first file of a season pack.
  return fileIndex != null ? `${base}?file=${fileIndex}` : base;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** A progress row has no artwork, so ask the title itself. Cosmetic, hence never throws. */
async function backdropFor(art: NonNullable<Candidate['art']>): Promise<string | null> {
  try {
    const detail =
      art.kind === 'tv'
        ? await tvService.getShow(art.tmdbId)
        : await moviesService.getDetail(art.tmdbId);
    return detail.backdrop_url ?? null;
  } catch {
    return null;
  }
}

/**
 * The profile's Continue Watching rail. Resolves to an empty rail, and never rejects,
 * when no profile is selected or the call is refused (403 someone else's profile, 404
 * unknown, 423 passcode-locked): Home renders without the rail rather than erroring.
 *
 * Rules, each of which a naive rewrite gets wrong:
 * - The content id is `movie_id`. The ORM row also has `content_id`, but the response
 *   model exposes only `movie_id`, so reading `content_id` is `undefined` on every row.
 * - A row whose torrent was removed (`torrent_id` NULL, FK ON DELETE SET NULL) is kept
 *   in history but can never resume, so it is not offered.
 * - A show is one card, represented by its most recently watched row.
 * - A completed movie is not "where you left off".
 *
 * UP NEXT IS DELIBERATELY ABSENT. The web turns a completed episode into an "Up next"
 * card for episode + 1, without checking that the episode exists, and leaves the link
 * on the file just finished. Doing it honestly needs two things this function does not
 * have: the show's season data (to know episode + 1 exists) and a torrent or file for
 * that episode (to resume anything). A progress row carries neither, and `deps` is just
 * a profile id. A card that replays the finished episode is a bug the viewer blames on
 * the app, so a show whose latest episode is complete is left out until the viewer
 * starts another. When a screen has the season data, the right card links to the show's
 * detail route, not to a watch route; add it then, with its inputs injected here.
 */
export async function fetchContinueWatching({ userId }: ContinueWatchingDeps): Promise<RailModel> {
  if (!userId) return empty(CONTINUE_WATCHING);
  try {
    const rows = (await streamingService.getRecentProgress(userId, FETCH_LIMIT))
      .filter((row) => row.percentage > 0)
      .sort((a, b) => watchedAt(b) - watchedAt(a));

    const candidates: Candidate[] = [];
    const seenShows = new Set<number>();

    for (const row of rows) {
      if (candidates.length >= MAX_CARDS) break;
      if (!row.torrent_id || !row.movie_id) continue;

      const parsed = parseContentId(row.movie_id);
      const progressPct = Math.round(row.percentage);
      const href = resumeHref(row.torrent_id, row.file_index);

      if (parsed.kind === 'tv') {
        const { showId, season, episode } = parsed;
        // A tv id that did not parse has no show to group under; skip rather than guess.
        if (showId === undefined || season === undefined || episode === undefined) continue;
        if (seenShows.has(showId)) continue;
        // Claim the show BEFORE the completed check, so a finished latest episode hides
        // the show instead of letting an older half-watched one surface behind it.
        seenShows.add(showId);
        if (row.completed) continue;
        candidates.push({
          art: { kind: 'tv', tmdbId: showId },
          card: {
            id: `tv:${showId}`,
            href,
            title: showNameFromTitle(row.title, showId),
            subtitle: `S${pad2(season)} · E${pad2(episode)}`,
            progressPct,
          },
        });
      } else {
        if (row.completed) continue;
        const tmdbId = tmdbIdFromContentId(row.movie_id);
        candidates.push({
          art: tmdbId === undefined ? null : { kind: 'movie', tmdbId },
          card: {
            id: row.movie_id,
            href,
            title: row.title ?? 'Untitled',
            subtitle: null,
            progressPct,
          },
        });
      }
    }

    const artwork = await Promise.all(
      candidates.map((c) => (c.art ? backdropFor(c.art) : Promise.resolve(null))),
    );
    // Each CardItem is built exactly once, here, so the memoised Card sees stable values.
    const items: CardItem[] = candidates.map((c, i) => ({ ...c.card, artUrl: artwork[i] }));
    return { ...CONTINUE_WATCHING, items };
  } catch {
    return empty(CONTINUE_WATCHING);
  }
}

/**
 * The profile's My List rail, newest first as the backend sends it. Resolves to an
 * empty rail, and never rejects, on the same refusals as Continue Watching.
 *
 * It is a POSTER rail. `watchlistItemToCatalogItem` always nulls `backdrop_url`, so a
 * 16:9 card here would be artless without a detail fetch per item; the stored poster is
 * usually present. `tmdb_id` is a string on a watchlist row, which that mapper turns
 * into a number for the href.
 */
export async function fetchMyList({ userId }: ContinueWatchingDeps): Promise<RailModel> {
  if (!userId) return empty(MY_LIST);
  try {
    const saved = await watchlistService.list(userId);
    const items = saved.map((entry) => catalogItemToCard(watchlistItemToCatalogItem(entry), 'poster'));
    return { ...MY_LIST, items };
  } catch {
    return empty(MY_LIST);
  }
}
