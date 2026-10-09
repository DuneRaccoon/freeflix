import type { Episode, StreamingProgress } from '@/types';
import { parseContentId } from '@/lib/contentId';

export type Mark = 'watched' | 'started';

/** What `watch history` says about each episode of one season of one show. */
export function episodeMarks(
  rows: readonly StreamingProgress[],
  showId: number,
  season: number,
): Map<number, Mark> {
  const marks = new Map<number, Mark>();
  for (const r of rows) {
    if (typeof r?.movie_id !== 'string') continue;
    const p = parseContentId(r.movie_id);
    if (p.kind !== 'tv' || p.showId !== showId || p.season !== season || p.episode === undefined) continue;
    if (r.completed) marks.set(p.episode, 'watched');
    else if (Number(r.percentage) > 0 && marks.get(p.episode) !== 'watched') marks.set(p.episode, 'started');
  }
  return marks;
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
export function nextUnwatched(episodes: readonly Episode[], marks: ReadonlyMap<number, Mark>): Episode | null {
  return episodes.find((e) => marks.get(e.episode_number) !== 'watched') ?? null;
}

/** Every episode watched. A season with no episodes is empty, not finished. */
export function seasonFinished(episodes: readonly Episode[], marks: ReadonlyMap<number, Mark>): boolean {
  return episodes.length > 0 && nextUnwatched(episodes, marks) === null;
}
