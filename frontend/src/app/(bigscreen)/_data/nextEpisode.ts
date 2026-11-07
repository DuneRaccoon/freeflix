import type { EpisodeRef, NextEpisodeAnswer } from '@/lib/nextEpisode';
import { requestTitle, resumeTitle, titleStateFor, type TitleAction } from './title';
import { watchHref } from './watchHref';

/**
 * WHAT COMES AFTER THE EPISODE ON SCREEN, on the television: the cell's words, the end
 * prompt, the prefetch and the press.
 *
 * The catalog half (is there a next episode, how long is this one, is the playhead past the
 * owner's threshold) is pure and shared with the web player, so it lives in
 * `@/lib/nextEpisode`. Only its types are imported here.
 *
 * NEVER CLAIM A NEXT EPISODE WITHOUT CHECKING THAT IT EXISTS; `none` AND `unknown` ARE
 * DIFFERENT ANSWERS (a failed lookup must not tell the viewer a series has ended, nor let the
 * prefetch download an episode nobody established exists). `prefetchEpisode` and
 * `whereToWatchEpisode` below obey that: "unknown" may never justify a download.
 *
 * NOTHING HERE POLLS AND NOTHING HERE REJECTS. Every failure is folded into an answer,
 * because a thrown error in the player is a film that stops.
 */

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
