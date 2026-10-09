import type { Episode } from '@/types';
import type { FocusProps } from '../_focus/useFocusGrid';
import type { Mark } from '../_data/showProgress';

/**
 * The episodes of one season, one focus row each. Presentational: markers arrive as data
 * (`marks`), nothing is fetched here.
 *
 * COUNT EQUALS RENDER. The screen builds its grid's `rowCounts` with `episodeRowCount`, which
 * is the same predicate this component renders by: a list that is loading draws no buttons
 * and counts none.
 */

export function episodeRowCount(episodes: readonly Episode[], loading: boolean): number {
  return loading ? 0 : episodes.length;
}

const MARK_TEXT: Record<Mark, string> = { watched: 'Watched', started: 'In progress' };

export function EpisodeList({
  episodes,
  marks,
  loading,
  firstRow,
  focusProps,
  onPress,
  busyEpisode,
}: {
  episodes: readonly Episode[];
  marks: ReadonlyMap<number, Mark>;
  loading: boolean;
  /** Grid row of the first episode; each following episode is the next row. */
  firstRow: number;
  focusProps: (row: number, col: number) => FocusProps;
  onPress: (episode: Episode) => void;
  /** The episode whose state is being asked right now. */
  busyEpisode: number | null;
}) {
  if (loading) {
    return (
      <p role="status" className="bs-show__status">
        Loading episodes…
      </p>
    );
  }
  return (
    <ol className="bs-eps">
      {episodes.map((e, i) => {
        const mark = marks.get(e.episode_number);
        const busy = busyEpisode === e.episode_number;
        // Keyed by episode number, against the surface's key-by-index rule, because a season's
        // list is fetched once into a write-once cache: the array never changes under the
        // render, so no refetch can re-key the focused cell. Switching seasons reshapes the
        // grid, and the focus hook's reconciliation re-focuses a clamped cell.
        return (
          <li key={e.episode_number}>
            <button
              type="button"
              className="bs-ep"
              aria-busy={busy}
              {...focusProps(firstRow + i, 0)}
              onClick={() => onPress(e)}
            >
              <span className="bs-ep__num">{e.episode_number}</span>
              <span className="bs-ep__name">{e.name || `Episode ${e.episode_number}`}</span>
              {e.runtime && e.runtime > 0 ? <span className="bs-ep__meta">{e.runtime}m</span> : null}
              {busy ? (
                <span className="bs-ep__mark">Checking…</span>
              ) : mark ? (
                <span className="bs-ep__mark">{MARK_TEXT[mark]}</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
