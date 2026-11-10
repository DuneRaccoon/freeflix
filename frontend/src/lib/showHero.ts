import type { StreamingProgress } from '@/types';
import { resumeUrlFor } from './contentId';

/**
 * WHAT THE WEB SHOW PAGE'S ONE PRIMARY BUTTON DOES, decided in one pure function.
 *
 * A Continue Watching show card opens `/tv/{id}?season=&episode=` rather than the player, so the
 * way back into the episode lives on this page — and its hero button must say truthfully which
 * of three things a press will do. The decision is here, apart from the component, because each
 * wrong answer is a different failure: a "Resume" that starts a new download, a "Play" on an
 * episode the profile has already finished, or a press that starts a download while the progress
 * that would have made it a Resume is still on its way.
 *
 * THE ORDER, and every step of it is load-bearing:
 * 1. NO ASKED EPISODE → Play S1·E1. Exactly the page as it was before it could be asked for one,
 *    and decided before anything else so that the page without a query never waits on progress.
 * 2. PROGRESS STILL LOADING → pending. The row that would make this a Resume may be on its way,
 *    and a press now would start a download that Resume would have avoided.
 * 3. AN UNFINISHED ROW WITH A TORRENT, PAST 0% → Resume on that row's own torrent and file
 *    (`resumeUrlFor`, so a season pack's `?file=N` rides along, file 0 included). It never starts
 *    a download, which is the whole difference between Resume and Play.
 * 4. A FINISHED ROW → the next episode, which may be in a later season; pending while that is
 *    still being looked up, and S1·E1 when the catalog says there is none or cannot say.
 * 5. ANYTHING ELSE → Play the asked episode. A row whose torrent is gone, or one at 0%, has no
 *    place to resume to.
 *
 * IMPORTS ONLY `@/types` AND `./contentId`: no React, no context, no catalog. The component
 * supplies the profile's row and the next episode; this only chooses.
 */

/** A season and an episode in it. */
export interface EpisodeAt {
  season: number;
  episode: number;
}

/** `S01·E03` — the code the hero prints, two-digit padded; a longer number is left whole. */
export function episodeCode(at: EpisodeAt): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `S${pad(at.season)}·E${pad(at.episode)}`;
}

/**
 * What a hero press does. `resume` goes to an existing download and starts nothing; `play` starts
 * (or reuses) a download of `at`; `pending` is a button that cannot be pressed yet.
 */
export type ShowHeroAction =
  | { kind: 'resume'; at: EpisodeAt; href: string }
  | { kind: 'play'; at: EpisodeAt }
  | { kind: 'pending' };

/** The page's own default, as it was before it could be asked for an episode. */
const FIRST_EPISODE: EpisodeAt = { season: 1, episode: 1 };

/**
 * The hero's action, by the order in the module header.
 *
 * `next` has three states because "still looking" and "there is none" are different buttons:
 * `undefined` is a lookup still out (pending), `null` is a lookup that answered `none` or
 * `unknown` (S1·E1). It is only read for a finished row.
 */
export function showHeroAction(a: {
  /** The episode the page was asked for, or null without one. */
  focus: EpisodeAt | null;
  /** The profile's row for `focus`. */
  row: StreamingProgress | null;
  /** The episode after a finished `focus`: undefined = still looking; null = none/unknown. */
  next: EpisodeAt | null | undefined;
  progressLoading: boolean;
}): ShowHeroAction {
  const { focus, row, next, progressLoading } = a;
  if (focus === null) return { kind: 'play', at: FIRST_EPISODE };
  if (progressLoading) return { kind: 'pending' };
  if (row && !row.completed && row.torrent_id && row.percentage > 0) {
    return {
      kind: 'resume',
      at: focus,
      href: resumeUrlFor({ torrent_id: row.torrent_id, file_index: row.file_index }),
    };
  }
  if (row?.completed) {
    if (next === undefined) return { kind: 'pending' };
    return { kind: 'play', at: next ?? FIRST_EPISODE };
  }
  return { kind: 'play', at: focus };
}
