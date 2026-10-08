import type { StreamingProgress } from '@/types';
import { streamingService } from '@/services/streaming';
import { watchlistService } from '@/services/watchlist';
import { moviesService } from '@/services/movies';
import { tvService } from '@/services/tv';
import { parseContentId, showNameFromTitle, tmdbIdFromContentId } from '@/lib/contentId';
import { parseUtc } from '@/lib/parseUtc';
import { watchlistItemToCatalogItem } from '@/lib/watchlist/toCatalogItem';
import type { CardItem } from '../_components/Card';
import type { RailModel } from '../_components/Rail';
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
 * artwork, and spec §9 counts exactly that among the home-request costs the TV trims.
 * Six wide cards are 2568px against 1728px of visible width, so the rail still scrolls
 * past the screen and the viewer never sees its edge. It is also the web's cap.
 */
const MAX_CARDS = 6;

const UP_NEXT = 'Up next';

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
 *   in history but can never resume, so it is not offered as a resume card.
 * - A show is one card, represented by its most recently watched row.
 * - A completed movie is not "where you left off".
 *
 * A COMPLETED EPISODE BECOMES AN "UP NEXT" CARD FOR ITS SHOW. It links to the show's
 * detail route, which is where a viewer picks the next episode, and it carries no
 * progress bar because there is nothing to resume. The web does this differently and
 * wrongly: it badges a card "Up next" for episode + 1 without checking that the episode
 * exists, then leaves the link on the file just finished. Nothing in a progress row
 * says whether episode + 1 exists or where its file is, so this card claims neither. It
 * needs no torrent either, so a finished episode whose torrent was later removed still
 * gets one. The show id comes straight out of the content id; nothing new is fetched.
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
      if (!row.movie_id) continue;

      const parsed = parseContentId(row.movie_id);

      if (parsed.kind === 'tv') {
        const { showId, season, episode } = parsed;
        // A tv id that did not parse has no show to group under; skip rather than guess.
        if (showId === undefined || season === undefined || episode === undefined) continue;
        if (seenShows.has(showId)) continue;
        // An unfinished episode with no torrent can never resume, and must not claim the
        // show: an older episode that still can resume is the better card.
        if (!row.completed && !row.torrent_id) continue;
        // Claim the show BEFORE branching on completed, so a finished latest episode
        // becomes the show's one card (Up next) instead of an older half-watched episode
        // surfacing behind it.
        seenShows.add(showId);
        const title = showNameFromTitle(row.title, showId);
        candidates.push({
          art: { kind: 'tv', tmdbId: showId },
          card: row.completed
            ? {
                // Distinct from the resume card's id, so the two can never be confused.
                id: `tv:${showId}:up-next`,
                href: `/bigscreen/show/${showId}`,
                title,
                subtitle: null,
                badge: UP_NEXT,
                // No progressPct: nothing to resume, and a part-filled bar would be a lie.
              }
            : {
                id: `tv:${showId}`,
                href: resumeHref(row.torrent_id as string, row.file_index),
                title,
                subtitle: `S${pad2(season)} · E${pad2(episode)}`,
                progressPct: Math.round(row.percentage),
              },
        });
      } else {
        // A finished film is not "where you left off", and without a torrent it cannot
        // resume.
        if (row.completed || !row.torrent_id) continue;
        const tmdbId = tmdbIdFromContentId(row.movie_id);
        candidates.push({
          art: tmdbId === undefined ? null : { kind: 'movie', tmdbId },
          card: {
            id: row.movie_id,
            href: resumeHref(row.torrent_id, row.file_index),
            title: row.title ?? 'Untitled',
            subtitle: null,
            progressPct: Math.round(row.percentage),
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
