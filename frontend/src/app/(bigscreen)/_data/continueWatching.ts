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
import { RAIL_CAP, catalogItemToCard } from './rails';

export interface ContinueWatchingDeps {
  /** The selected profile's id. Empty means no profile is selected yet. */
  userId: string;
}

/**
 * A profile-scoped rail, and whether its call was refused because the profile is locked.
 *
 * `useTvProfile` trusts a stored profile id without checking it, so the first
 * profile-scoped call is where a passcode lock shows up. Both fetchers RESOLVE on a
 * refusal (Home must render without the rail, not error), which leaves an empty rail
 * looking the same whether the cause is a 423, a 403, or a profile with nothing in it.
 * Home must not guess a lock from an empty array, so the one place that sees the status
 * says so. Always an explicit boolean, like `loading`.
 */
export interface ProfileRail extends RailModel {
  /** True only for a 423: this session has not entered the profile's passcode. */
  locked: boolean;
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

/**
 * How long a card's artwork lookup may take before the card is drawn without it.
 * `apiClient` sets no timeout, and a cold movie detail is a TMDB call and then a torrent
 * search in sequence (about 35s). Waiting on the slowest of six would leave the whole rail
 * a skeleton with no focusable cells while five cards were ready to paint; an artless
 * card is what a failed lookup already produces.
 */
const ARTWORK_BUDGET_MS = 2500;

/**
 * Every rail this file returns says `loading: false` outright. A screen that merges a
 * result over a loading placeholder with `{ ...placeholder, ...result }` keeps
 * `loading: true` if the key is merely omitted, and `railCellCount` then reports 0
 * focusable cells for a full rail: a dead row with nothing erroring anywhere.
 */
const settled = (spec: Omit<RailModel, 'items'>, items: CardItem[], locked = false): ProfileRail => ({
  ...spec,
  items,
  loading: false,
  locked,
});

/** The profile-scoped endpoints refuse (403/404/423) rather than return nothing. */
const empty = (spec: Omit<RailModel, 'items'>): ProfileRail => settled(spec, []);

const statusOf = (err: unknown): number | undefined =>
  (err as { response?: { status?: number } } | null)?.response?.status;

/** An empty rail for a call that threw; `locked` only when the profile's passcode is what stopped it. */
const refused = (spec: Omit<RailModel, 'items'>, err: unknown): ProfileRail =>
  settled(spec, [], statusOf(err) === 423);

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
async function fetchBackdrop(art: NonNullable<Candidate['art']>): Promise<string | null> {
  try {
    const detail =
      art.kind === 'tv'
        ? await tvService.getShow(art.tmdbId)
        : // Artwork only: skip the backend's torrent search, which is most of a movie
          // detail's cost. An older backend ignores the parameter and just answers slowly.
          await moviesService.getDetail(art.tmdbId, { withQualities: false });
    return detail.backdrop_url ?? null;
  } catch {
    return null;
  }
}

/** The lookup, or null once it has had its budget. Never rejects, never outlives its timer. */
function backdropFor(art: NonNullable<Candidate['art']>): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ARTWORK_BUDGET_MS);
    void fetchBackdrop(art).then((url) => {
      clearTimeout(timer);
      resolve(url);
    });
  });
}

/**
 * The card for one progress row, or null when the row offers nothing. Claims the show in
 * `seenShows` only when it returns that show's card.
 */
function candidateFor(row: StreamingProgress, seenShows: Set<number>): Candidate | null {
  if (typeof row.movie_id !== 'string' || !row.movie_id) return null;

  const parsed = parseContentId(row.movie_id);

  if (parsed.kind === 'tv') {
    const { showId, season, episode } = parsed;
    // A tv id that did not parse has no show to group under; skip rather than guess.
    if (showId === undefined || season === undefined || episode === undefined) return null;
    if (seenShows.has(showId)) return null;
    const title = showNameFromTitle(row.title, showId);

    if (row.completed) {
      // Claimed BEFORE any older row can be considered, so a finished latest episode is
      // the show's one card (Up next) instead of an older half-watched episode surfacing
      // behind it. It needs no torrent: it opens the show screen, not a file.
      seenShows.add(showId);
      return {
        art: { kind: 'tv', tmdbId: showId },
        card: {
          // Distinct from the resume card's id, so the two can never be confused.
          id: `tv:${showId}:up-next`,
          href: `/bigscreen/show/${showId}`,
          title,
          subtitle: null,
          badge: UP_NEXT,
          // No progressPct: nothing to resume, and a part-filled bar would be a lie.
        },
      };
    }

    // An unfinished episode with no torrent can never resume, and must not claim the
    // show: an older episode that still can resume is the better card.
    if (!row.torrent_id) return null;
    seenShows.add(showId);
    return {
      art: { kind: 'tv', tmdbId: showId },
      card: {
        id: `tv:${showId}`,
        href: resumeHref(row.torrent_id, row.file_index),
        title,
        subtitle: `S${pad2(season)} · E${pad2(episode)}`,
        progressPct: Math.round(row.percentage),
      },
    };
  }

  // A finished film is not "where you left off", and without a torrent it cannot resume.
  if (row.completed || !row.torrent_id) return null;
  const tmdbId = tmdbIdFromContentId(row.movie_id);
  return {
    art: tmdbId === undefined ? null : { kind: 'movie', tmdbId },
    card: {
      id: row.movie_id,
      href: resumeHref(row.torrent_id, row.file_index),
      // `||`, not `??`: an empty title would draw a blank label.
      title: row.title || 'Untitled',
      subtitle: null,
      progressPct: Math.round(row.percentage),
    },
  };
}

/**
 * The profile's Continue Watching rail. Resolves to an empty rail, and never rejects,
 * when no profile is selected or the call is refused (403 someone else's profile, 404
 * unknown, 423 passcode-locked): Home renders without the rail rather than erroring.
 * A 423 is also reported, as `locked: true`, so Home can send the viewer to the picker.
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
export async function fetchContinueWatching({ userId }: ContinueWatchingDeps): Promise<ProfileRail> {
  if (!userId) return empty(CONTINUE_WATCHING);
  try {
    const rows = (await streamingService.getRecentProgress(userId, FETCH_LIMIT))
      .filter((row) => (row?.percentage ?? 0) > 0)
      .sort((a, b) => watchedAt(b) - watchedAt(a));

    const candidates: Candidate[] = [];
    const seenShows = new Set<number>();
    for (const row of rows) {
      if (candidates.length >= MAX_CARDS) break;
      try {
        const candidate = candidateFor(row, seenShows);
        if (candidate) candidates.push(candidate);
      } catch {
        // One malformed row (a non-string title, say) costs that row, not the rail.
      }
    }

    // Each lookup has its own budget and they run together, so the rail waits for the
    // slowest ONE of them for at most ARTWORK_BUDGET_MS, not for the slowest to finish.
    const artwork = await Promise.all(
      candidates.map((c) => (c.art ? backdropFor(c.art) : Promise.resolve(null))),
    );
    // Each CardItem is built exactly once, here, so the memoised Card sees stable values.
    return settled(
      CONTINUE_WATCHING,
      candidates.map((c, i) => ({ ...c.card, artUrl: artwork[i] })),
    );
  } catch (err) {
    return refused(CONTINUE_WATCHING, err);
  }
}

/**
 * The profile's My List rail, newest first as the backend sends it. Resolves to an
 * empty rail, and never rejects, on the same refusals as Continue Watching.
 *
 * It is a POSTER rail. `watchlistItemToCatalogItem` always nulls `backdrop_url`, so a
 * 16:9 card here would be artless without a detail fetch per item; the stored poster is
 * usually present. `tmdb_id` is a string on a watchlist row, which that mapper turns
 * into a number for the href. Capped like the catalog rails: the full list belongs on a
 * dedicated screen, not in 150 anchors a remote has to cross.
 */
export async function fetchMyList({ userId }: ContinueWatchingDeps): Promise<ProfileRail> {
  if (!userId) return empty(MY_LIST);
  try {
    const items: CardItem[] = [];
    for (const entry of await watchlistService.list(userId)) {
      if (items.length >= RAIL_CAP) break;
      // `tmdb_id` is a string. A value that is not a positive whole number would make
      // `Number()` yield NaN (or 0) and the card link to /bigscreen/movie/NaN. The
      // optional chain makes a null entry fail the same check, so one bad row costs
      // only itself.
      const tmdbId = Number(entry?.tmdb_id);
      if (!Number.isInteger(tmdbId) || tmdbId <= 0) continue;
      items.push(catalogItemToCard(watchlistItemToCatalogItem(entry), 'poster'));
    }
    return settled(MY_LIST, items);
  } catch (err) {
    return refused(MY_LIST, err);
  }
}
