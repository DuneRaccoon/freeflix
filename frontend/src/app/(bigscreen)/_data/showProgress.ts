import type { Episode, StreamingProgress } from '@/types';
import { parseContentId } from '@/lib/contentId';

export type Mark = 'watched' | 'started';

/**
 * What watch history says about ONE episode: the mark, and the two numbers the episode list
 * draws a trace from.
 *
 * ONE FUNCTION PRODUCES ALL THREE, which is why this replaced the `Map<number, Mark>` that
 * came before it rather than sitting beside it. The filter is the hard part (a content id
 * that is this show, this season, an episode, with a completed row beating a started
 * duplicate) and two functions walking the same rows under the same filter is two things to
 * keep in step — and the SECOND one, added later for a progress bar, is the one that would
 * quietly disagree. `nextUnwatched` and `seasonFinished` read `.mark` off this; nothing on
 * this surface reads a bare mark map any more.
 */
export interface EpisodeTrace {
  mark: Mark;
  /** 0-100, rounded, clamped. 100 for a completed row whatever it stored. */
  percentage: number;
  /**
   * Seconds left, when the row stored a usable duration. NULL means "the row never recorded
   * a length", which is a real state — `useWatchProgress` writes `duration: null` for a file
   * whose length the media element never reported, and this television does that routinely
   * for an in-progress stream. Never 0 as a stand-in: 0 is "at the end".
   */
  remainingS: number | null;
}

/** Seconds left in a row, or null when it stored no usable length. */
function remainingOf(row: StreamingProgress): number | null {
  const total = Number(row.duration);
  const at = Number(row.current_time);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(at) || at < 0) return null;
  return Math.max(0, Math.round(total - at));
}

const pct = (row: StreamingProgress): number =>
  Math.round(Math.max(0, Math.min(100, Number(row.percentage) || 0)));

/** What `watch history` says about each episode of one season of one show. */
export function episodeTraces(
  rows: readonly StreamingProgress[],
  showId: number,
  season: number,
): Map<number, EpisodeTrace> {
  const traces = new Map<number, EpisodeTrace>();
  for (const r of rows) {
    if (typeof r?.movie_id !== 'string') continue;
    const p = parseContentId(r.movie_id);
    if (p.kind !== 'tv' || p.showId !== showId || p.season !== season || p.episode === undefined) continue;
    if (r.completed) {
      // A completed row wins outright, including over a started duplicate that is newer:
      // finished is finished, and a second row at 30% is a re-watch nobody asked us to show
      // as unfinished. 100 rather than `pct(r)`, because `completed` is set at the 95%
      // cut-off (`title.ts`'s FINISHED_PCT) and a bar at 95 under the word "Watched" is a
      // readout disagreeing with itself.
      traces.set(p.episode, { mark: 'watched', percentage: 100, remainingS: null });
    } else if (pct(r) > 0 && traces.get(p.episode)?.mark !== 'watched') {
      traces.set(p.episode, { mark: 'started', percentage: pct(r), remainingS: remainingOf(r) });
    }
  }
  return traces;
}

/** The season of the show's most recent row. `rows` are newest first, as the backend sends them. */
export function latestSeasonWatched(rows: readonly StreamingProgress[], showId: number): number | null {
  for (const r of rows) {
    if (typeof r?.movie_id !== 'string') continue;
    const p = parseContentId(r.movie_id);
    if (p.kind === 'tv' && p.showId === showId && p.season !== undefined) return p.season;
  }
  return null;
}

/** First episode, in order, that is not finished. Null when there is none (or no episodes). */
export function nextUnwatched(
  episodes: readonly Episode[],
  traces: ReadonlyMap<number, EpisodeTrace>,
): Episode | null {
  return episodes.find((e) => traces.get(e.episode_number)?.mark !== 'watched') ?? null;
}

/** Every episode watched. A season with no episodes is empty, not finished. */
export function seasonFinished(
  episodes: readonly Episode[],
  traces: ReadonlyMap<number, EpisodeTrace>,
): boolean {
  return episodes.length > 0 && nextUnwatched(episodes, traces) === null;
}

/**
 * How much of a season has been watched, for the line above the episode list.
 *
 * COUNTED OVER THE EPISODES THAT ARE LISTED, not over the trace map: history can hold a row
 * for an episode TMDB no longer lists (a renumbered season, a special that moved), and a
 * season showing "11 of 10 watched" is a readout that cannot be true.
 */
export function watchedCount(
  episodes: readonly Episode[],
  traces: ReadonlyMap<number, EpisodeTrace>,
): number {
  return episodes.reduce((n, e) => n + (traces.get(e.episode_number)?.mark === 'watched' ? 1 : 0), 0);
}
