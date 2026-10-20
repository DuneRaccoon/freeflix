import type { Episode, SeasonSummary, ShowDetail } from '@/types';
import { tvService } from '@/services/tv';
import { parseContentId } from '@/lib/contentId';
import { requestTitle, resumeTitle, titleStateFor, type TitleAction } from './title';
import { watchHref } from './watchHref';

/**
 * WHAT COMES AFTER THE EPISODE ON SCREEN, and how to get there.
 *
 * THE RULE THIS MODULE EXISTS TO OBEY: never claim a next episode without checking that it
 * exists. `_data/continueWatching.ts` records the web app doing the opposite — it badges a
 * card "Up next" for `episode + 1` without asking anybody whether episode + 1 is a thing, and
 * then leaves the link on the episode just finished. Nothing in a progress row, a torrent row
 * or a file name says what follows an episode. Only the catalog does, so this asks it.
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
 * time-driven behaviours — start the next download at 80%, offer the next episode near the
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

/** `S02 · E04`, the one spelling of an episode's number on this surface. */
export function episodeTag({ season, episode }: { season: number; episode: number }): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `S${pad(season)} · E${pad(episode)}`;
}

/**
 * The five things the Next-episode cell can be in. An `as const` ARRAY as well as a union, the
 * shape `SUBTITLE_CELL_STATES` uses: the type is derived from the array, so a state cannot be
 * added to one without the other, and a test can walk every one of them.
 */
export const NEXT_CELL_STATES = ['checking', 'ready', 'starting', 'none', 'unknown'] as const;
export type NextCellStateId = (typeof NEXT_CELL_STATES)[number];

/**
 * The four states whose words do not depend on anything. `ready` is the fifth and is the
 * episode's own number, which is why it is not in here — a `Record` with a template in it
 * would be a phrasing nobody could read off the table.
 */
const STATIC_LABELS: Record<Exclude<NextCellStateId, 'ready'>, string> = {
  checking: 'looking…',
  // The press is out. A provider search can take tens of seconds, and silence for that long
  // after an OK press is what this surface refuses everywhere else.
  starting: 'starting…',
  // NOT "the series has ended": TMDB lists nothing after this episode, which is also what an
  // unannounced next season looks like.
  none: 'nothing after this',
  unknown: 'couldn’t check',
};

/**
 * What the Next-episode cell says under its icon, and the machine-readable twin of it.
 *
 * TWO FIELDS FROM ONE PLACE, which is the contract `SubtitleCellView` sets out: the component
 * renders the words verbatim so there is exactly one place the phrasings live, and the state
 * rides along as `data-next` so a test can read which state the screen believes it is in
 * without matching prose.
 *
 * `starting` OUTRANKS EVERYTHING, including a lookup that has not answered: it is the answer
 * to a press, and a press that appears to do nothing is the defect.
 *
 * Lower case, like the subtitle cell's words: these sit under an icon as a state, not as a
 * label — the label is the cell's own name, which the stylesheet shows on focus.
 */
export function nextCellView(
  answer: NextEpisodeAnswer | null,
  starting: boolean,
): { stateId: NextCellStateId; note: string } {
  if (starting) return { stateId: 'starting', note: STATIC_LABELS.starting };
  if (answer === null) return { stateId: 'checking', note: STATIC_LABELS.checking };
  switch (answer.verdict.k) {
    case 'ready':
      return { stateId: 'ready', note: episodeTag(answer.verdict.next) };
    case 'none':
      return { stateId: 'none', note: STATIC_LABELS.none };
    case 'unknown':
      return { stateId: 'unknown', note: STATIC_LABELS.unknown };
    default:
      return assertNever(answer.verdict);
  }
}

function assertNever(x: never): never {
  throw new Error(`Unhandled next-episode verdict: ${JSON.stringify(x)}`);
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
 * Everything that reads this is a threshold ("past 80%", "within the last 45 seconds"), and
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
 * 0.8 is the figure the feature was asked for. It is a fraction rather than "N minutes from
 * the end" because the point is to leave time for the download, and how much time that buys
 * scales with the episode: 80% of a 22-minute comedy is four minutes and of a 70-minute drama
 * fourteen, which is the right way round.
 */
export const AUTO_NEXT_AT = 0.8;

export function pastAutoNextPoint(position: number, scaleSeconds: number | null): boolean {
  if (scaleSeconds === null || !(scaleSeconds > 0)) return false;
  const at = Number(position);
  if (!Number.isFinite(at) || at <= 0) return false;
  return at / scaleSeconds >= AUTO_NEXT_AT;
}

/**
 * How close to the end the "next episode" prompt appears.
 *
 * THIS IS NOT CREDITS DETECTION, and there is no honest way to make it one. Nothing in this
 * system knows where an episode's credits start: TMDB publishes no chapter or credit markers,
 * a torrent carries none, and the only thing the box could do about it — decode the picture
 * and look for a scroll — is not something a Raspberry Pi serving a 1080p stream is going to
 * do. So this is a fixed window measured back from the end, which is where credits usually
 * are, and it is named as a guess rather than dressed up as a measurement.
 *
 * 45 seconds, because the band it pins is 480px over the bottom of the picture: long enough
 * to notice and act on at three metres, short enough that it is not sitting over the last
 * scene of the episode. It can only appear at all when something could say how long the
 * episode is (`episodeScaleSeconds`), so on an in-progress stream with no duration from any
 * of the three sources there is no prompt — silence rather than a guess at where the end is.
 */
export const END_PROMPT_S = 45;

export function nearTheEnd(position: number, scaleSeconds: number | null): boolean {
  if (scaleSeconds === null || !(scaleSeconds > 0)) return false;
  const at = Number(position);
  if (!Number.isFinite(at) || at <= 0) return false;
  return scaleSeconds - at <= END_PROMPT_S;
}

/**
 * Start the next episode downloading, unless something already covers it.
 *
 * `titleStateFor` FIRST, ALWAYS, and it is the whole safety of this function. `POST
 * /torrents/download` mints a fresh uuid and does no magnet or infohash dedupe, so every
 * press starts a NEW multi-gigabyte download and the ARM build allows two at once. The common
 * case here is the one that must not download: the episode on screen came from a SEASON PACK,
 * so `covers()` matches the pack for the next episode too and the answer is `open` or
 * `preparing` — already here, nothing to do. Only `play`, which means nothing on the box
 * covers it, may start anything.
 *
 * Resolves `true` when a download now exists or already existed, `false` when the box refused
 * or could not be reached. The three outcomes collapse to two deliberately: "I started it" and
 * "it was already here" are the same fact to the viewer, because the press that follows runs
 * `titleStateFor` again either way.
 *
 * IT IS NOT A PRESS, so it says nothing and shows nothing. A background refusal (the box is
 * busy with two downloads, no source exists for the episode) is reported to the caller for
 * the one sentence that is worth saying at the end of the episode, and nothing else.
 */
export async function prefetchEpisode(args: EpisodeRef & { userId: string | null }): Promise<boolean> {
  const { tmdbId, season, episode, userId } = args;
  try {
    const state = await titleStateFor({ mediaType: 'tv', tmdbId, season, episode, userId });
    // A locked profile is a refusal, not an invitation to download: `titleStateFor` answers
    // `blocked` with `locked: true` and never `play`, so this arm is the same as any other
    // non-`play` answer and is here to be read rather than to branch.
    if (state.action.kind !== 'play') return true;
    const result = await requestTitle({ mediaType: 'tv', tmdbId, season, episode });
    return result.ok;
  } catch {
    // TOTAL, and the try/catch belongs HERE rather than at the call site. Both awaits above
    // are documented as resolving rather than rejecting, so this is unreachable today — but
    // the caller fires this from an effect with `void`, where a rejection is an unhandled
    // promise rejection in a television's browser rather than a message anyone will read.
    // One guard at the source beats one at every call.
    return false;
  }
}

/**
 * Where the Next-episode press should send the viewer, or why it cannot.
 *
 * ITS OWN EXHAUSTIVE SWITCH, and it is deliberately STRICTER than the show screen's
 * `placeToWatch`. Two kinds mean something different inside a player:
 *
 *  - `unresolvedEpisode` carries an href, and the show screen offers it behind a disclosure
 *    the viewer reads first ("this plays a file from the season, which may be a different
 *    episode"). There is nowhere to print that on a transport cell, and following it would
 *    take a viewer who pressed "Next episode" to some other episode without a word — the
 *    exact defect that kind exists to prevent. So it refuses, in words.
 *  - `preparing` with `fileUnknown` is the same hazard one step earlier: the pack is on its
 *    way and nothing can say which file the episode is, so a bare URL plays the pack's
 *    default file, which is episode 1.
 *
 * `paused` is resumed rather than refused: a download that exists and is stopped is one
 * `resume` away from playable, and offering nothing would make the press dead on exactly the
 * episode the box already has most of.
 */
export async function whereToWatchEpisode(
  args: EpisodeRef & { userId: string | null },
): Promise<{ ok: true; href: string } | { ok: false; reason: string }> {
  const { tmdbId, season, episode, userId } = args;
  let action: TitleAction;
  try {
    action = (await titleStateFor({ mediaType: 'tv', tmdbId, season, episode, userId })).action;
  } catch {
    return { ok: false, reason: 'Couldn’t reach the box. Check that it is on.' };
  }
  switch (action.kind) {
    case 'open':
    case 'resume':
      return { ok: true, href: action.href };
    case 'preparing':
      return action.fileUnknown
        ? { ok: false, reason: 'The box can’t tell which file holds that episode yet. Try again in a moment.' }
        : { ok: true, href: watchHref(action.torrentId, action.fileIndex) };
    case 'paused': {
      if (action.fileUnknown) {
        return { ok: false, reason: 'The box can’t tell which file holds that episode yet. Try again in a moment.' };
      }
      const resumed = await resumeTitle(action.torrentId);
      return resumed.ok
        ? { ok: true, href: watchHref(action.torrentId, action.fileIndex) }
        : { ok: false, reason: resumed.reason };
    }
    case 'play': {
      const started = await requestTitle({ mediaType: 'tv', tmdbId, season, episode });
      if (!started.ok) return { ok: false, reason: started.reason };
      // The box answered with a season pack and which file is this episode could not be read.
      // Same refusal as `unresolvedEpisode`, one step earlier.
      if (started.unresolved) {
        return { ok: false, reason: 'Started the download, but the box can’t tell yet which file is that episode.' };
      }
      return { ok: true, href: watchHref(started.torrentId, started.fileIndex) };
    }
    case 'unresolvedEpisode':
      return {
        ok: false,
        reason: 'The box can’t tell which file holds that episode, so this would play the wrong one.',
      };
    case 'blocked':
      return { ok: false, reason: action.reason };
    default:
      return assertNever(action);
  }
}
