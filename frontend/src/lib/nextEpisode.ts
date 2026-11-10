import type { Episode, SeasonSummary, ShowDetail } from '@/types';
import { tvService } from '@/services/tv';
import { parseContentId } from './contentId';

/**
 * WHAT COMES AFTER THE EPISODE ON SCREEN, and how to get there.
 *
 * THE RULE THIS MODULE EXISTS TO OBEY: never claim a next episode without checking that it
 * exists. The web's Continue Watching card (`components/browse/ContinueWatchingRow.tsx`) still
 * breaks it in its label alone: it badges a card "Up next" for `episode + 1` without asking
 * anybody whether episode + 1 is a thing. Its link claims nothing — it opens the show page on
 * the episode just finished, and the show page asks this module. Nothing in a progress row, a
 * torrent row or a file name says what follows an episode. Only the catalog does, so this asks it.
 *
 * TMDB IS ASKED AT MOST TWICE, and the second question is cheap because the first answer
 * contains it. `getSeason` lists this season's episodes; the next one is the lowest listed
 * number ABOVE the current one (not `+ 1`: a season may skip, and a double episode is listed
 * once). If there is none, `getShow`'s season summaries carry `episode_count`, so the first
 * later REGULAR season that actually has episodes is identified without fetching anything,
 * and only that one is fetched.
 *
 * `none` AND `unknown` ARE DIFFERENT ANSWERS and the difference is load-bearing twice: a
 * failed lookup must not tell the viewer a series has ended, and it must not let the prefetch
 * start a download for an episode nobody has established exists. Both are refusals; only one
 * of them is a fact. (The same distinction `lookupEpisodeFile` draws in `_data/title.ts`
 * between `absent` and `unknown`, for the same reason: "unknown" may never justify a
 * download.)
 *
 * THE CURRENT EPISODE'S RUNTIME RIDES ALONG, and that is not a convenience. The player's two
 * time-driven behaviours — start the next download at the owner's threshold, offer the next episode near the
 * end — both need to know how long this episode is, and on this television `video.duration`
 * is routinely NOT a finite number for an in-progress stream (`ScrubBar`'s header: the scrub
 * row "does not exist until `<video>` reports a finite duration — never yet observed for an
 * in-progress stream on this set"). The season read already has TMDB's runtime in hand, so it
 * is carried here rather than fetched again, and `episodeScaleSeconds` says in one place which
 * of the three available scales wins.
 *
 * NOTHING HERE POLLS AND NOTHING HERE REJECTS. One lookup per episode, every failure folded
 * into an answer, because a thrown error in the player is a film that stops.
 */

/** An episode this module is prepared to send the viewer to. */
export interface NextUp {
  season: number;
  episode: number;
  /** TMDB's title, or '' when it lists none. The cell never prints it; the band may. */
  name: string;
}

/**
 * What is after this episode. A union rather than `NextUp | null`, because `null` would be
 * "the series has ended" and "nobody could tell" at once — and those are a different sentence
 * on the cell and a different decision in the prefetch.
 */
export type NextUpVerdict =
  | { k: 'ready'; next: NextUp }
  /** TMDB lists nothing after this episode, in this season or any later one. */
  | { k: 'none' }
  /** The lookup could not answer. NOT a claim that there is nothing. */
  | { k: 'unknown' };

export interface NextEpisodeAnswer {
  verdict: NextUpVerdict;
  /**
   * The CURRENT episode's runtime in SECONDS, when TMDB listed one and the season read
   * succeeded. Null otherwise — never 0, which is a length.
   */
  runtimeS: number | null;
}

/** The episode now playing, from the watch-identity key. Null for anything that is not one. */
export interface EpisodeRef {
  tmdbId: number;
  season: number;
  episode: number;
}

/**
 * The episode a content id names, or null.
 *
 * READ FROM THE CONTENT ID, deliberately, rather than from the torrent row and the `/files`
 * entry. `useWatchProgress.watchIdentity` already resolves those two against each other — the
 * row names its own episode, a season pack carries `episode: null` so only the file can say
 * which one, and `media_type` decides the kind — and a second copy of that precedence here is
 * a second thing to keep in step. The id it produces is the one key both surfaces build.
 *
 * A SHOW-LEVEL `tv:{id}` IS NOT AN EPISODE. That is what a pack whose file could not be
 * resolved is keyed as, and there is no "current episode" to count from, so there is no next
 * one either. A movie is not one either, which is what makes this the whole of the test for
 * "does this title have a next episode at all".
 */
export function episodeRefOf(contentId: string | null | undefined): EpisodeRef | null {
  if (!contentId) return null;
  const p = parseContentId(contentId);
  if (p.kind !== 'tv') return null;
  if (p.showId === undefined || p.season === undefined || p.episode === undefined) return null;
  return { tmdbId: p.showId, season: p.season, episode: p.episode };
}

/** `name` is `''` rather than a fallback: only the band prints it, and it says so itself. */
const toNextUp = (season: number, e: Episode | null): NextUp | null =>
  e === null ? null : { season, episode: e.episode_number, name: e.name || '' };

const episodesOf = (d: { episodes?: Episode[] } | null | undefined): readonly Episode[] =>
  Array.isArray(d?.episodes) ? (d as { episodes: Episode[] }).episodes : [];

/** The lowest listed episode number strictly above `after`, or null. */
function lowestAbove(episodes: readonly Episode[], after: number): Episode | null {
  let best: Episode | null = null;
  for (const e of episodes) {
    if (!Number.isInteger(e?.episode_number) || e.episode_number <= after) continue;
    if (best === null || e.episode_number < best.episode_number) best = e;
  }
  return best;
}

/** Regular seasons only: season 0 is the specials bucket and is never "next". */
const regularSeasons = (show: ShowDetail): SeasonSummary[] =>
  (Array.isArray(show?.seasons) ? show.seasons : []).filter((s) => s?.season_number > 0);

/** TMDB's minutes as seconds, or null. `> 0` so a 0 or a NaN is "not listed", not a length. */
function runtimeSecondsOf(episodes: readonly Episode[], episode: number): number | null {
  const here = episodes.find((e) => e?.episode_number === episode);
  const minutes = Number(here?.runtime);
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : null;
}

const UNKNOWN: NextEpisodeAnswer = { verdict: { k: 'unknown' }, runtimeS: null };

/**
 * What follows `ref`, asked of the catalog. Resolves always; never throws.
 *
 * The season read is the one that can make the whole answer `unknown`: without this season's
 * episode list there is no way to say what is after the current episode AND no runtime to
 * carry, so a failure there is total. A failure in the LATER-season read is narrower — the
 * runtime is already in hand — so it keeps it.
 */
export async function findNextEpisode(ref: EpisodeRef): Promise<NextEpisodeAnswer> {
  let here: readonly Episode[];
  try {
    here = episodesOf(await tvService.getSeason(ref.tmdbId, ref.season));
  } catch {
    return UNKNOWN;
  }
  const runtimeS = runtimeSecondsOf(here, ref.episode);

  // NOT `episode + 1`. A season's numbering can skip (a double episode is listed once), and
  // the viewer is where they are, not where arithmetic says they are.
  const inThisSeason = toNextUp(ref.season, lowestAbove(here, ref.episode));
  if (inThisSeason) return { verdict: { k: 'ready', next: inThisSeason }, runtimeS };

  try {
    const show = await tvService.getShow(ref.tmdbId);
    // `episode_count` is in the summary, so the season to ask about is chosen without
    // fetching any of them: a show with three unaired later seasons costs one request, not
    // three. A season listed with no episodes is skipped rather than answered `none`.
    const later = regularSeasons(show)
      .filter((s) => s.season_number > ref.season && Number(s.episode_count) > 0)
      .sort((a, b) => a.season_number - b.season_number)[0];
    if (!later) return { verdict: { k: 'none' }, runtimeS };

    const listed = episodesOf(await tvService.getSeason(ref.tmdbId, later.season_number));
    // `lowestAbove(…, 0)` is "the first real episode": a regular season numbers from 1, and a
    // 0 in one is the specials bucket leaking, which is never what comes next.
    const first = toNextUp(later.season_number, lowestAbove(listed, 0));
    // The summary promised episodes and the season listed none: a disagreement inside the
    // catalog is not knowledge, so it is `unknown` rather than the end of the series.
    if (!first) return { verdict: { k: 'unknown' }, runtimeS };
    return { verdict: { k: 'ready', next: first }, runtimeS };
  } catch {
    return { verdict: { k: 'unknown' }, runtimeS };
  }
}

/**
 * How long the episode on screen is, in seconds, or null when nothing can say.
 *
 * THE PRECEDENCE, AND WHY IT IS NOT JUST `video.duration`. The element's own duration is the
 * truth about the file and wins whenever it exists — but on this television it routinely does
 * not: `/info` serves a stream whose length the media element never reports for an in-progress
 * torrent, which is why the scrub row can be absent for a whole film. The progress row's
 * stored duration is the next best thing (it was measured by a previous watch of the same
 * file). TMDB's runtime is last and is an APPROXIMATION — it is rounded to whole minutes and
 * describes the programme rather than the release, so a file with 90 seconds of recap and a
 * distributor's logo is longer than its runtime says.
 *
 * Everything that reads this is a threshold ("past the owner's threshold", "within the last 45 seconds"), and
 * being a minute out moves a threshold by a minute. Nothing here is a readout: the scrub bar
 * still refuses to draw itself without a real duration, and nothing in this precedence is
 * allowed to feed it.
 */
export function episodeScaleSeconds(opts: {
  /** `video.duration`. `NaN` before metadata, and often never finite on this set. */
  duration: number;
  /** The progress row's own duration, from a previous watch. */
  storedSeconds: number | null | undefined;
  /** TMDB's runtime for this episode, in seconds. */
  runtimeS: number | null | undefined;
}): number | null {
  const live = Number(opts.duration);
  if (Number.isFinite(live) && live > 0) return live;
  const stored = Number(opts.storedSeconds);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const listed = Number(opts.runtimeS);
  if (Number.isFinite(listed) && listed > 0) return listed;
  return null;
}

/**
 * Is the playhead far enough in to start the next episode downloading?
 *
 * `threshold` is a fraction (0.8 for 80%), the owner's setting. It is a fraction rather than
 * "N minutes from the end" because the point is to leave time for the download, and how much
 * time that buys scales with the episode: 80% of a 22-minute comedy is four minutes and of a
 * 70-minute drama fourteen, which is the right way round.
 */
export function pastAutoNextPoint(position: number, scaleSeconds: number | null, threshold: number): boolean {
  if (scaleSeconds === null || !(scaleSeconds > 0)) return false;
  if (!(threshold > 0)) return false;
  const at = Number(position);
  if (!Number.isFinite(at) || at <= 0) return false;
  return at / scaleSeconds >= threshold;
}
