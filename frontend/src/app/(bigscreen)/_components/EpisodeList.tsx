import type { Episode } from '@/types';
import type { FocusProps } from '../_focus/useFocusGrid';
import type { EpisodeTrace } from '../_data/showProgress';
import { watchedCount } from '../_data/showProgress';
import { atSize } from './Hero';

/**
 * The episodes of one season, one focus row each. Presentational: every trace arrives as data
 * (`traces`), nothing is fetched here.
 *
 * COUNT EQUALS RENDER. The screen builds its grid's `rowCounts` with `episodeRowCount`, which
 * is the same predicate this component renders by: a list that is loading draws no buttons
 * and counts none. The season line above the list is a `<p>`, not a focus stop, so it is
 * outside that contract — and it must stay that way, or the count and the render part company
 * on a surface with no Tab key.
 *
 * WHAT A ROW SAYS, AND WHY IT IS THIS AND NOT A LIST OF NAMES. Three questions get asked of a
 * season from the sofa — what is this one, have I seen it, and where was I — and the old row
 * (number, name, runtime, one word) answered the first one and a third of the second. So each
 * row now carries TMDB's still, and the trace is drawn where a trace belongs: a filled bar
 * across the foot of the still for a part-watched episode, a tick on it for a finished one,
 * and the words beside it. The season's own tally sits above the list, because "4 of 10
 * watched" is the question the viewer actually arrived with and no single row can answer it.
 *
 * THE ORDER OF THE TEXT IS PART OF THE CONTRACT. A button's accessible name is its contents
 * in DOM order, and this directory's tests read episodes by name (`/1.*Name 1.*42m/`,
 * `/Name 2.*Checking/`): number, title, runtime, air date, overview, then the state. Putting
 * the state first would be a control that announces "Watched" before it says what is watched.
 *
 * EVERYTHING DECORATIVE IS `aria-hidden`. The still, the tick and the bar all restate what
 * the words already say, so announcing them would make every row read twice.
 */

export function episodeRowCount(episodes: readonly Episode[], loading: boolean): number {
  return loading ? 0 : episodes.length;
}

/**
 * The still, at a size this surface actually draws.
 *
 * `w300` is what the backend puts in `still_url` (`providers/catalog.py`), and the box below
 * is 256 CSS px wide — which on a 4K panel is 512 device pixels, so the catalog's own
 * rendition is a 2x upscale on the one screen this code runs on. `atSize` re-points it at
 * `w500`; it leaves anything that is not a TMDB sized path alone.
 */
const STILL_SIZE = 'w500' as const;

const MARK_TEXT: Record<EpisodeTrace['mark'], string> = { watched: 'Watched', started: 'In progress' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * TMDB's `YYYY-MM-DD` as `D Mon YYYY`, or null for anything else.
 *
 * PARSED BY HAND, not by `new Date(...)`. `toLocaleDateString` answers in whatever locale the
 * television is set to — which is not knowable from here and not the same as the one the rest
 * of this surface writes in — and `new Date('2026-11-02')` is parsed as UTC midnight and then
 * formatted in local time, which prints the first of November for anyone west of Greenwich.
 * A date with no time in it should not be able to move by a day.
 */
export function airDateLabel(raw: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw ?? '');
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return null;
  return `${Number(m[3])} ${month} ${m[1]}`;
}

/** The state line for one episode: the mark, plus how much of it is left when that is known. */
function markLabel(trace: EpisodeTrace): string {
  const base = MARK_TEXT[trace.mark];
  if (trace.mark !== 'started' || trace.remainingS === null) return base;
  // Rounded UP, and never to "0 min left": a row 20 seconds from the end has something left,
  // and "0 min left" beside a control that resumes is a readout arguing with itself.
  const minutes = Math.max(1, Math.ceil(trace.remainingS / 60));
  return `${base} · ${minutes} min left`;
}

/** The line above the list. Always something, because "nothing yet" is an answer too. */
export function seasonTally(episodes: readonly Episode[], traces: ReadonlyMap<number, EpisodeTrace>): string {
  if (episodes.length === 0) return '';
  const watched = watchedCount(episodes, traces);
  if (watched === 0) return `${episodes.length} episodes · none watched yet`;
  if (watched === episodes.length) return `${episodes.length} episodes · all watched`;
  return `${episodes.length} episodes · ${watched} watched`;
}

export function EpisodeList({
  episodes,
  traces,
  loading,
  firstRow,
  focusProps,
  onPress,
  busyEpisode,
  nextEpisode,
}: {
  episodes: readonly Episode[];
  traces: ReadonlyMap<number, EpisodeTrace>;
  loading: boolean;
  /** Grid row of the first episode; each following episode is the next row. */
  firstRow: number;
  focusProps: (row: number, col: number) => FocusProps;
  onPress: (episode: Episode) => void;
  /** The episode whose state is being asked right now. */
  busyEpisode: number | null;
  /**
   * The episode the screen would start if the viewer pressed the primary control — badged
   * "Next up" so the list and that control cannot appear to disagree. The screen already
   * computes it (`nextUnwatched`) for exactly that purpose, so it is passed rather than
   * re-derived: two answers to "which one is next" is the defect, not the duplication.
   */
  nextEpisode?: number | null;
}) {
  if (loading) {
    return (
      <p role="status" className="bs-show__status">
        Loading episodes…
      </p>
    );
  }
  const tally = seasonTally(episodes, traces);
  return (
    <>
      {/* A SUMMARY, NOT A LIVE REGION. No `role="status"`: the screen already mounts status
          lines for the things that change under the viewer, and a second live region here
          would have the television announce a tally every time a season opens. */}
      {tally !== '' && <p className="bs-eps__tally">{tally}</p>}
      <ol className="bs-eps">
        {episodes.map((e, i) => {
          const trace = traces.get(e.episode_number);
          const busy = busyEpisode === e.episode_number;
          const still = atSize(e.still_url, STILL_SIZE);
          const air = airDateLabel(e.air_date);
          // Keyed by episode number, against the surface's key-by-index rule, because a
          // season's list is fetched once into a write-once cache: the array never changes
          // under the render, so no refetch can re-key the focused cell. Switching seasons
          // reshapes the grid, and the focus hook's reconciliation re-focuses a clamped cell.
          return (
            <li key={e.episode_number}>
              <button
                type="button"
                className="bs-ep"
                aria-busy={busy}
                {...focusProps(firstRow + i, 0)}
                onClick={() => onPress(e)}
              >
                <span className="bs-ep__still" aria-hidden="true">
                  {still ? (
                    // No onError fallback, deliberately, unlike `Card`: a still that fails to
                    // load leaves the frame's own --surface-2 box, which is what the
                    // still-less case draws anyway. `Card`'s fallback exists because a poster
                    // is the only thing identifying a title in a rail; here the number and
                    // the name are right beside it.
                    <img className="bs-ep__thumb" src={still} alt="" loading="lazy" draggable={false} />
                  ) : (
                    <span className="bs-ep__thumb bs-ep__thumb--blank">{e.episode_number}</span>
                  )}
                  {trace?.mark === 'watched' && <span className="bs-ep__tick">✓</span>}
                  {trace?.mark === 'started' && trace.percentage > 0 && (
                    <span className="bs-ep__bar">
                      <span style={{ width: `${Math.min(trace.percentage, 100)}%` }} />
                    </span>
                  )}
                </span>
                <span className="bs-ep__body">
                  <span className="bs-ep__head">
                    <span className="bs-ep__num">{e.episode_number}</span>
                    <span className="bs-ep__name">{e.name || `Episode ${e.episode_number}`}</span>
                    {nextEpisode != null && nextEpisode === e.episode_number && (
                      <span className="bs-ep__badge">Next up</span>
                    )}
                  </span>
                  {/* RUNTIME ONLY. The air date gets its own element rather than sharing this
                      one: an episode with a date and no runtime would otherwise render a
                      `.bs-ep__meta` holding a date, and "no runtime means no meta element" is
                      a thing this component's suite checks by that class name. */}
                  {e.runtime && e.runtime > 0 ? <span className="bs-ep__meta">{e.runtime}m</span> : null}
                  {air && <span className="bs-ep__air">{air}</span>}
                  {e.overview ? <span className="bs-ep__over">{e.overview}</span> : null}
                  {busy ? (
                    <span className="bs-ep__mark">Checking…</span>
                  ) : trace ? (
                    <span className="bs-ep__mark">{markLabel(trace)}</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}
