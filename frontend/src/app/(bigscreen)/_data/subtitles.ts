/**
 * The television's subtitle data: the `<track>` URL, the picker's rows, the cell's words,
 * and the bounded poll that waits for a sidecar's bytes.
 *
 * WHY THIS FILE IMPORTS NO SERVICE, AND WHY THAT IS A RULE RATHER THAN A STYLE.
 * `_player/engineContract.test.ts` forbids `@/services/api-client` and `@/services/streaming`
 * anywhere in `_player/`, because the client's rejection interceptor hard-navigates to
 * `/bigscreen/pair` on a 401 from inside its own handler, before any caller sees the error —
 * a player probing through it is taken out from under itself. **That guard reads DIRECT import
 * specifiers only.** The picker and the transport cell live in `_player/` and will import this
 * module, so one `import { streamingService }` here would put apiClient one hop behind the
 * ban with the ban still green. Everything that talks to the network is therefore INJECTED:
 * `pollSubtitles` takes a `read` function and never builds one.
 *
 * It also keeps the whole module pure and synchronous apart from the poll, which is what lets
 * every row below be tested without React, without jsdom timers, and without the `waitFor`
 * flake this repo has recorded a mechanism for.
 *
 * NOT UNDER `_player/`. `playerSources()` in that same contract test is a FLAT `readdirSync`,
 * so a subdirectory there would EISDIR the whole suite; and this is data, not engine.
 *
 * WHAT THIS MODULE REFUSES TO KNOW. `pair_source` is an opaque string: the backend's
 * `naming.track_label` has already folded it into `label`, which is the only thing a row
 * renders. Nothing here enumerates the pair sources, switches on them, or counts them — the
 * taxonomy grows (a sixth entry landed while this was being written), and "is this paired at
 * all" is `video_index === null`, a structural fact that cannot drift when a rung is added.
 */
import type { SubtitleList, SubtitleTrack } from '@/types';
import { chunk } from './chunk';

/**
 * The WebVTT route's path, spelled once on this side.
 *
 * Transcribed from `backend/app/api/subtitles.py` (`_VTT_URL`, `{api}/streaming/{tid}/
 * subtitles/{index}` with `api_v1_str = "/api/v1"`). THE LIMIT, WRITTEN DOWN: the row the
 * list hands back carries this same string in `url`, and a test here can only pin this
 * function against a hand-typed copy of that contract — nothing in this repo fails if the
 * backend changes its own format string.
 *
 * `index` is the TORRENT'S OWN libtorrent file index and never a row's position in the list:
 * a filtered or deduplicated list renumbers, and a `<track>` that spent its one and only
 * load on the wrong file reports nothing a viewer could act on. The URL is same-origin
 * through `next.config.ts`'s `/api/*` rewrite, which is also why no `crossOrigin` is wanted
 * anywhere near it.
 */
export function subtitleTrackSrc(torrentId: string, index: number): string {
  return `/api/v1/streaming/${torrentId}/subtitles/${index}`;
}

/**
 * The entries the picker may OFFER: the convertible ones.
 *
 * Convertibility is the only permanent fact a row can rest on. `ready` is transient — it
 * flips when the admission's flush lands — so an unready `.srt` is still offered, and
 * choosing it is what sends the POST; while `.ass`/`.ssa` are listed and never converted, so
 * no amount of waiting makes them playable here.
 */
export function offerable(list: SubtitleList | null | undefined): SubtitleTrack[] {
  return (list?.subtitles ?? []).filter((e) => e.convertible);
}

/**
 * The other half of the same partition: listed, visible, and not servable.
 *
 * These rows exist because silence about a file the viewer can see in the release is a lie.
 * They are rendered — focusable, never `aria-disabled` — and OK on one is answered by its own
 * format and reason rather than by nothing happening.
 */
export function unsupported(list: SubtitleList | null | undefined): SubtitleTrack[] {
  return (list?.subtitles ?? []).filter((e) => !e.convertible);
}

/** One picker row per listed entry. `Off` is not here — see `pickerRowCounts`. */
export interface SubtitlePickerRow {
  /** The torrent's own file index: the React key, the `<track>` src and the POST's path. */
  index: number;
  /** The backend's rendered label, verbatim. Never re-derived on this surface. */
  label: string;
  /** False for a non-convertible row. Still focusable; see `unsupported`. */
  selectable: boolean;
  entry: SubtitleTrack;
}

/**
 * Every listed entry as a row, offers first and unservable formats after.
 *
 * The order is the whole point of putting it here: the two groups read differently (an offer,
 * and a statement that the release ships a format this box cannot read), and the grid's row
 * counts are chunked over this list, so the order and the count must come from one call.
 */
export function pickerRows(list: SubtitleList | null | undefined): SubtitlePickerRow[] {
  const row = (entry: SubtitleTrack, selectable: boolean): SubtitlePickerRow => ({
    index: entry.index,
    label: entry.label,
    selectable,
    entry,
  });
  return [
    ...offerable(list).map((e) => row(e, true)),
    ...unsupported(list).map((e) => row(e, false)),
  ];
}

/** Cells per picker row. Three fits the band's width at the television's own font. */
export const PICKER_ROW_SIZE = 3;

/**
 * The focus grid's row counts for an open picker: `entryCount + 1` cells, in rows of three.
 *
 * THE `+ 1` IS `Off`, AND IT IS WHAT MAKES THE SCREEN SAFE. It is always the first cell, so
 * no reachable state of this picker leaves nothing focused — not an empty list, not a list
 * that shrank under a refresh. A declared count must equal the cells rendered, so the caller
 * passes `pickerRows(list).length` and not the offer count alone: a non-convertible row IS
 * rendered and IS focusable, and a count that left it out would declare a grid smaller than
 * the DOM it describes.
 *
 * The last row is SHORT rather than padded (`chunk`'s own rule): a padded row declares a cell
 * the render does not produce, and the ring then lands on a (row, col) no element claims,
 * which a remote has no way to recover from.
 *
 * A non-finite or negative count is treated as zero entries rather than trusted, because the
 * one thing this function may never return is no rows at all.
 */
export function pickerRowCounts(entryCount: number): number[] {
  const entries = Number.isFinite(entryCount) ? Math.max(0, Math.trunc(entryCount)) : 0;
  const cells = Array.from({ length: entries + 1 }, (_, i) => i);
  return chunk(cells, PICKER_ROW_SIZE).map((r) => r.length);
}

/**
 * Every state the Subtitles cell can be in. EXACTLY EIGHT, and the count is deliberate:
 * collapsing any two of them would make the television say one sentence about two different
 * situations, and the viewer's next press would differ between them.
 *
 * `loading` and `fetching` are different waits: the first is the list not resolved yet (the
 * band can be on screen before it answers), the second is a sidecar chosen whose bytes are
 * not here. `unavailable` and `none` are the two the backend is most careful to separate —
 * the box cannot see this download's files at all, versus this release ships nothing to show.
 */
export const SUBTITLE_CELL_STATES = [
  'loading',
  'unavailable',
  'none',
  'off',
  'on',
  'fetching',
  'unreadable',
  'noCues',
] as const;

export type SubtitleCellState = (typeof SUBTITLE_CELL_STATES)[number];

/**
 * The cell's sub-line, one short phrase per state.
 *
 * The cell's own accessible name stays exactly `Subtitles` — this text rides in an
 * `aria-hidden` sub-line — so these phrases are read, not announced, and they are bounded
 * because the transport row is `flex-wrap: nowrap`: an overflowed cell is one the D-pad can
 * focus and the viewer cannot see.
 *
 * NO LANGUAGE IS INTERPOLATED, and the signature is what forecloses it: `cellLabel` is given
 * a state and nothing else. The chosen language is visible in the picker, where there is room
 * for it.
 */
export const SUBTITLE_CELL_LABELS: Record<SubtitleCellState, string> = {
  // The list has not answered yet. Says nothing about what it will say.
  loading: 'checking',
  // `coverage: "unknown"` — no live handle, so the file list is unenumerable. The permanent
  // answer for everything already in the library.
  unavailable: 'unavailable',
  // `coverage: "none"` — a live torrent with no listable sidecar.
  none: 'none in this release',
  off: 'off',
  on: 'on',
  // Chosen, admitted, and the bytes are not here yet.
  fetching: 'fetching',
  // A 415 the box cannot decode, or the `<track>` element's own error.
  unreadable: 'unreadable',
  // Decoded and converted, and there was nothing in it. Its own state because a WebVTT body
  // with no cues loads successfully and fires no event at all — the television is the only
  // place this can be said.
  noCues: 'no cues',
};

/** The cell's sub-line for one state. */
export function cellLabel(state: SubtitleCellState): string {
  return SUBTITLE_CELL_LABELS[state];
}

/**
 * The three cell states a CHOSEN sidecar reaches, or `null` when nothing is chosen.
 *
 * `null` rather than a state, so the caller's own list-derived answer (`loading`,
 * `unavailable`, `none`, `off`) stays the single source for the unchosen case instead of
 * being restated here. The cell therefore has exactly one chooser of states, and this
 * function's whole job is the part that depends on the choice.
 *
 * `fault` IS THE `<track>` ELEMENT'S OWN ERROR and it outranks readiness, because by the
 * time the element has failed, `ready` is a measurement that has been overtaken: the bytes
 * were there and the load still did not produce cues. A 415 the box cannot decode reads the
 * same way to the viewer and the same way here.
 *
 * NOT CONSULTED: `convertible`. A non-convertible entry is rendered in the picker as a
 * focusable row that is not selectable, so it never becomes the chosen one — the rule lives
 * there and in the element's own mount gate, and stating it a third time here would make
 * each of the three deletable without a red test. Named rather than duplicated.
 */
export function chosenCellState(
  chosen: SubtitleTrack | null,
  fault: boolean,
): SubtitleCellState | null {
  if (chosen === null) return null;
  if (fault) return 'unreadable';
  return chosen.ready ? 'on' : 'fetching';
}

/** How long between polls. The backend sends `Retry-After: 2` on its own not-ready answer. */
export const SUBTITLE_POLL_MS = 2000;

/**
 * How many reads before the poll gives up.
 *
 * 25 reads is one immediate read plus 24 waits of 2 s = 48 s, which outlives the backend's
 * own `subtitle_admit_budget_ms` (45 s by default) by one tick — so the poll cannot stop
 * while the admission is still running, and the last read is the one that sees the
 * retraction. A poll that gave up first would leave the cell saying `fetching` over a box
 * that had already finished.
 */
export const SUBTITLE_POLL_ATTEMPTS = 25;

export type SubtitlePollOutcome =
  /** The waited-for entry reports `ready`. */
  | 'ready'
  /** `coverage: "none"` — nothing to wait for. */
  | 'none'
  /** `coverage: "unknown"`, or any coverage this build does not recognise. */
  | 'unknown'
  /** The entry is no longer in the list, so it can never become ready. */
  | 'gone'
  /** A read threw. */
  | 'error'
  /** The attempt budget ran out with the entry still not ready. */
  | 'exhausted'
  /** The caller asked to stop (the route unmounted, or the viewer chose again). */
  | 'cancelled';

export interface SubtitlePollResult {
  outcome: SubtitlePollOutcome;
  /** How many reads were issued. The instrument for "the poll stopped". */
  reads: number;
  /** The last answer, or null if none arrived. */
  list: SubtitleList | null;
  /** The waited-for entry as the last answer described it. */
  entry: SubtitleTrack | null;
  /** Set only for `error`. */
  error?: unknown;
}

export interface SubtitlePollOptions {
  /**
   * One list read. INJECTED, never built here — see this module's header for why nothing in
   * `_data` may import the api-client when `_player` imports `_data`.
   */
  read: () => Promise<SubtitleList>;
  /** The torrent's own file index being waited on. */
  index: number;
  attempts?: number;
  delayMs?: number;
  /** The wait between reads. Injected so tests need no timers. */
  wait?: (ms: number) => Promise<void>;
  /** Checked before every read and after every answer. */
  isCancelled?: () => boolean;
  /** Each answer, as it arrives, so the screen can re-render mid-poll. */
  onList?: (list: SubtitleList) => void;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Wait for one sidecar to become readable, and STOP.
 *
 * THIS IS A READ LOOP AND NOTHING ELSE. It never admits: admission is a POST the route sends
 * once, on the press, and the television learns the outcome here — that split is what keeps a
 * poll from re-deadlining libtorrent's pieces on every tick, and this module cannot send it
 * anyway, having no service to send it with.
 *
 * Five of the six exits are reached BEFORE the budget: a ready entry, `none`, `unknown`, an
 * entry that has left the list, and a read that threw. Only a sidecar that stays unready
 * reaches `exhausted`. The three that look alike on a status line are kept apart on purpose:
 * `none` and `unknown` are different sentences on the cell, and `gone` is the difference
 * between one read and twenty-four more against a row that cannot change.
 */
export async function pollSubtitles(options: SubtitlePollOptions): Promise<SubtitlePollResult> {
  const {
    read,
    index,
    attempts = SUBTITLE_POLL_ATTEMPTS,
    delayMs = SUBTITLE_POLL_MS,
    wait = sleep,
    isCancelled,
    onList,
  } = options;

  let reads = 0;
  let list: SubtitleList | null = null;
  let entry: SubtitleTrack | null = null;
  const done = (
    outcome: SubtitlePollOutcome,
    extra?: { error: unknown },
  ): SubtitlePollResult => ({ outcome, reads, list, entry, ...extra });

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (isCancelled?.()) return done('cancelled');
    reads += 1;
    try {
      list = await read();
    } catch (error) {
      // A failed read is not retried. A 404 means the torrent went away, a 401 is a dead
      // session the interceptor was told not to act on, and a 5xx will not be fixed by
      // asking again 24 times.
      return done('error', { error });
    }
    onList?.(list);
    // Checked again here: a read takes time, and the viewer may have left the player or
    // chosen a different track while it was in flight.
    if (isCancelled?.()) return done('cancelled');
    if (list.coverage !== 'listed') {
      // Anything that is not `listed` is final. `none` and `unknown` are the two values the
      // backend defines; a value this build does not know is reported as `unknown` and still
      // stops, because the one outcome that must not be possible is polling forever.
      return done(list.coverage === 'none' ? 'none' : 'unknown');
    }
    entry = list.subtitles.find((e) => e.index === index) ?? null;
    if (entry === null) return done('gone');
    // Readiness is read off THIS entry. A sibling's readiness says nothing about the one the
    // viewer chose, and on a pack the sibling is another episode's sidecar entirely.
    if (entry.ready) return done('ready');
    if (attempt + 1 < attempts) await wait(delayMs);
  }
  return done('exhausted');
}
