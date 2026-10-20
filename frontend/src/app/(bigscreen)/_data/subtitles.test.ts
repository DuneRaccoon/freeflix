/**
 * The television's subtitle data module: the track URL, the picker's partition, the cell's
 * words, and the bounded poll.
 *
 * NO REACT HERE, deliberately, and no timers in any row that injects `wait`. Every function
 * under test is pure except the poll, and the poll takes its `read` and its `wait` as
 * arguments — so this file cannot meet the `waitFor` flake whose mechanism this repo has
 * recorded (RTL's `asyncWrapper` disables the act environment for all of `waitFor` while
 * passive effects flush as a separate Scheduler task). The rendering of all of this is tasks
 * 12-14's, and their assertions are in the player's own suites.
 *
 * ONE ROW IS THE EXCEPTION and it is named here so the paragraph above stays true: "the
 * default wait is a real timer" runs the poll with NOTHING injected, because the module's own
 * `sleep` otherwise has no witness at all. It carries no clock and no `waitFor` — it orders a
 * 0 ms macrotask against the poll's own 10 ms one — and there is no React in it either, so
 * the recorded flake has no mechanism to reach it.
 *
 * WHAT THIS FILE NEVER ASSERTS. `pair_source` is an opaque string here: the backend has
 * already folded it into `label` and the taxonomy grows, so nothing below enumerates its
 * values, switches on them, or counts them. The only pairing question asked is
 * `video_index === null`, and one fixture carries exactly that shape because an unmatched
 * sidecar is a NORMAL outcome of the backend's ladder, not an edge case.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SubtitleCoverage, SubtitleList, SubtitleTrack } from '@/types';
import {
  PICKER_ROW_SIZE,
  SUBTITLE_CELL_LABELS,
  SUBTITLE_CELL_STATES,
  SUBTITLE_POLL_ATTEMPTS,
  SUBTITLE_POLL_MS,
  cellLabel,
  chosenCellState,
  notArrivingAfter,
  offerable,
  pickerRowCounts,
  pickerRows,
  pollSubtitles,
  subtitleTrackSrc,
  type SubtitlePollOutcome,
  unsupported,
} from './subtitles';

/**
 * One wire row. The indices in every fixture below are 4 and up, never 0 and 1: the backend
 * measured a 3-file tree coming out of `lt.create_torrent` as `num_files() == 6` with the
 * sidecar at index 4, so a fixture whose indices happen to equal their list positions cannot
 * tell "the torrent's own index" from "the position in this list" — the exact mutation these
 * rows exist to catch.
 */
function track(index: number, over: Partial<SubtitleTrack> = {}): SubtitleTrack {
  return {
    index,
    video_index: 2,
    // DELIBERATELY NOT A REAL RUNG. The backend's taxonomy grows — a sixth entry landed
    // while this was written — and `naming.track_label` has already folded the rung into
    // `label`, so nothing on this surface may read this field. A value no build has ever
    // heard of is the instrument for that: if any row below consulted it, these fixtures
    // would fail rather than quietly agreeing with whatever the list happened to contain.
    pair_source: 'a-rung-this-build-has-never-heard-of',
    season: 1,
    episode: 1,
    lang: 'en',
    label: 'English',
    flags: [],
    format: 'srt',
    size: 40960,
    ready: false,
    convertible: true,
    reason: null,
    url: `/api/v1/streaming/pk/subtitles/${index}`,
    ...over,
  };
}

function list(subtitles: SubtitleTrack[], coverage: SubtitleCoverage = 'listed'): SubtitleList {
  return {
    torrent_id: 'pk',
    state: 'downloading',
    coverage,
    source: coverage === 'unknown' ? null : 'session',
    paired_to: 2,
    subtitles,
  };
}

/** An offer, a format this box will not convert, and an unmatched sidecar — in one list. */
const MIXED = list([
  track(4),
  track(5, { format: 'ass', convertible: false, reason: 'unsupported-format', label: 'Spanish', lang: 'es' }),
  track(6, {
    // The unmatched shape, and it is a NORMAL outcome of the backend's ladder rather than an
    // edge case: three of its five rungs now refuse an ambiguous match and fall through. What
    // makes the row different here is structural — `video_index === null` — never the rung.
    video_index: null,
    season: null,
    episode: null,
    lang: null,
    label: 'Unknown (unmatched)',
  }),
]);

describe('subtitleTrackSrc', () => {
  it('is the torrent id and the torrent\'s own file index, pinned exactly', () => {
    // `toBe` on the whole string, in ONE row. `toContain('/subtitles/')` is satisfied by
    // every index and by either spelling of the segment, so it could not fail for the
    // mistakes that matter; and a separate `not.toBe('.../4/subtitles/pk')` row for an
    // argument swap would be an assertion this one already implies — the swap reddens the
    // line below. `'pk'` and `4` are deliberately not confusable, which is why the fixture
    // id is not numeric.
    expect(subtitleTrackSrc('pk', 4)).toBe('/api/v1/streaming/pk/subtitles/4');

    // The same function against the `url` the backend puts in every row, because task 13
    // mounts a `<track>` from one of the two and a divergence is a load spent on the wrong
    // file. THE LIMIT, WRITTEN DOWN: these fixtures' `url` is hand-typed from
    // `backend/app/api/subtitles.py`'s own format string, so this catches the two halves of
    // the FRONTEND drifting apart and nothing more — no test in this repo fails if the
    // backend changes that string.
    for (const entry of MIXED.subtitles) {
      expect(subtitleTrackSrc(MIXED.torrent_id, entry.index)).toBe(entry.url);
    }
  });
});

describe('the picker partition', () => {
  it('offers the convertible entries and nothing else', () => {
    expect(offerable(MIXED).map((e) => e.index)).toEqual([4, 6]);
  });

  it('keeps the unservable formats as their own group', () => {
    expect(unsupported(MIXED).map((e) => e.index)).toEqual([5]);
  });

  it('gives every listed entry a row, and no entry two', () => {
    // A DIFFERENT SUBJECT from the two rows above: those are the partition functions, this is
    // the row list tied to the LIST's own length. It is what makes "drop the second group"
    // red rather than merely shorter, and it survives a future filter being added to one
    // group — the kind of edit the order row below would also catch but would blame on the
    // order.
    expect.soft(pickerRows(MIXED)).toHaveLength(MIXED.subtitles.length);
    expect.soft([...pickerRows(MIXED)].map((r) => r.index).sort()).toEqual(
      MIXED.subtitles.map((e) => e.index).sort(),
    );
  });

  it('rows are offers first, unservable formats after', () => {
    expect(pickerRows(MIXED).map((r) => r.index)).toEqual([4, 6, 5]);
  });

  it('rows are keyed by the torrent\'s own index, not by their position', () => {
    const rows = pickerRows(MIXED);
    expect.soft(rows[0]?.index).toBe(4);
    expect.soft(rows[1]?.index).toBe(6);
    expect.soft(rows[2]?.index).toBe(5);
  });

  it('renders the label the BACKEND wrote, verbatim', () => {
    // Including the unmatched one. The suffix copy lives in `naming.track_label` and the
    // television never re-derives it, so this is a transcription check and not a copy
    // decision: a row that built its own text would read differently here.
    expect(pickerRows(MIXED).map((r) => r.label)).toEqual([
      'English',
      'Unknown (unmatched)',
      'Spanish',
    ]);
  });

  it('every row carries ITS OWN entry', () => {
    // The row's `entry` is what task 14 answers OK with — a non-convertible row's own
    // `format` and `reason` — and no row above reads it, so a build that handed every row
    // the FIRST listed entry was green (found by review). Identity rather than equality:
    // the row must carry the object the list carried, not a copy that agrees today.
    const byIndex = new Map(MIXED.subtitles.map((e) => [e.index, e]));
    for (const r of pickerRows(MIXED)) {
      expect.soft(r.entry, `row ${r.index}`).toBe(byIndex.get(r.index));
    }
  });

  it('marks only the unservable rows unselectable', () => {
    expect(pickerRows(MIXED).map((r) => r.selectable)).toEqual([true, true, false]);
  });

  it('is no rows at all when there is no list yet', () => {
    // The band renders before the list resolves, so this is the state the screen opens in.
    expect.soft(pickerRows(null)).toEqual([]);
    expect.soft(pickerRows(undefined)).toEqual([]);
    expect.soft(offerable(list([], 'none'))).toEqual([]);
  });
});

describe('pickerRowCounts', () => {
  it('is one cell for Off when there is nothing to offer', () => {
    expect(pickerRowCounts(0)).toEqual([1]);
  });

  it('is Off plus the entries, in rows of three', () => {
    expect.soft(pickerRowCounts(1)).toEqual([2]);
    expect.soft(pickerRowCounts(2)).toEqual([3]);
    expect.soft(pickerRowCounts(3)).toEqual([3, 1]);
    expect.soft(pickerRowCounts(20)).toEqual([3, 3, 3, 3, 3, 3, 3]);
    expect.soft(pickerRowCounts(20)).toHaveLength(7);
  });

  it('declares exactly entries + 1 cells, for every count a list could have', () => {
    // The sum is the row an off-by-one in the chunking reddens, and it is checked over a
    // range rather than at one value because a single count can agree with the wrong
    // arithmetic (3 cells in rows of 3 is one row either way).
    for (let entries = 0; entries <= 30; entries += 1) {
      const counts = pickerRowCounts(entries);
      expect(counts.reduce((a, b) => a + b, 0), `${entries} entries`).toBe(entries + 1);
      expect(Math.max(...counts), `${entries} entries`).toBeLessThanOrEqual(PICKER_ROW_SIZE);
    }
  });

  it('leaves the last row SHORT rather than padding it', () => {
    // A padded row declares a cell the render does not produce: the ring lands on a
    // (row, col) no element claims and a remote has no way out.
    expect(pickerRowCounts(3)).toEqual([3, 1]);
  });

  it('never returns no rows, whatever arrives', () => {
    // The Off cell is what keeps "no reachable state leaves nothing focused" true, so a count
    // that arrived as NaN (a length read off something absent) may not take it away.
    expect.soft(pickerRowCounts(Number.NaN)).toEqual([1]);
    expect.soft(pickerRowCounts(-5)).toEqual([1]);
  });
});

describe('the cell\'s words', () => {
  it('has a phrase for exactly the nine states', () => {
    expect.soft(SUBTITLE_CELL_STATES).toHaveLength(9);
    expect.soft(Object.keys(SUBTITLE_CELL_LABELS).sort()).toEqual([...SUBTITLE_CELL_STATES].sort());
  });

  it('says each of the nine things, exactly — and they are distinct and short', () => {
    // The strings are pinned here; the RENDERED row (accessible name, sub-line, measured
    // width) is task 12's.
    //
    // The two properties live in THIS test rather than in rows of their own, deliberately:
    // once the exact strings are pinned, "pairwise distinct" and "<= 22 characters" cannot
    // fail independently of the map above, and a separate row would be an assertion that
    // cannot fail dressed as an instrument. They are asserted here because they are the
    // RULES the strings answer to — distinct, because collapsing `none` onto `unavailable`
    // would make "this release has no subtitles" and "the box cannot see this download's
    // files" one sentence; and short, because the transport row is `flex-wrap: nowrap`, so an
    // overflowed cell is one the D-pad can focus and the viewer cannot see.
    expect.soft(SUBTITLE_CELL_LABELS).toEqual({
      loading: 'checking',
      unavailable: 'unavailable',
      none: 'none in this release',
      off: 'off',
      on: 'on',
      fetching: 'fetching',
      notArriving: 'not arriving',
      unreadable: 'unreadable',
      noCues: 'no cues',
    });
    const labels = SUBTITLE_CELL_STATES.map((s) => cellLabel(s));
    expect.soft(new Set(labels).size).toBe(SUBTITLE_CELL_STATES.length);
    for (const label of labels) expect.soft(label.length, label).toBeLessThanOrEqual(22);
  });

  it('cellLabel reads the record for every state', () => {
    for (const state of SUBTITLE_CELL_STATES) {
      expect(cellLabel(state)).toBe(SUBTITLE_CELL_LABELS[state]);
    }
  });
});

/**
 * The four states a CHOSEN sidecar reaches. The cell's other half.
 *
 * It lives here, as a pure function, for the reason the `<track>` element lives in its own
 * component: nothing on the television could choose a sidecar until the picker landed, so a
 * chosen-state branch written inside the route would have shipped unreachable from every test
 * that rendered the route. The picker and the fetch are now both built, so the route's own
 * suites see all four through the screen — these rows are the function's contract, which is
 * where the arm ORDER lives.
 */
describe('the chosen sidecar’s own cell state', () => {
  it('answers null when nothing is chosen, whatever else is true', () => {
    // ALL THREE second-and-third arms, because both of them are latches the route clears with
    // the choice: a version that asked about the fault — or about the fetch verdict — BEFORE
    // asking whether anything is chosen would say `unreadable` or `not arriving` over an Off
    // cell, and one arm cannot see the other.
    expect.soft(chosenCellState(null, false, false), 'nothing chosen').toBeNull();
    expect.soft(chosenCellState(null, true, false), 'nothing chosen, stale fault').toBeNull();
    expect.soft(chosenCellState(null, false, true), 'nothing chosen, stale verdict').toBeNull();
  });

  it('is `on` when the bytes are here, `notArriving` when they are not coming, `fetching` while waiting', () => {
    // THE THREE ARE NOT INTERCHANGEABLE AND THE VIEWER'S NEXT PRESS IS DIFFERENT FOR EACH:
    // nothing (it is showing), the same entry again (the retry — which is why the POST is sent
    // by a handler and not by an effect keyed on the choice), or Off. Three inputs, three
    // outputs, in one row: a second row for the verdict would have had to restate one of
    // these two lines, and a restated assertion cannot fail independently of the one it
    // copies.
    expect.soft(chosenCellState(track(4, { ready: true }), false, false)).toBe('on');
    expect.soft(chosenCellState(track(4, { ready: false }), false, true)).toBe('notArriving');
    expect.soft(chosenCellState(track(4, { ready: false }), false, false)).toBe('fetching');
  });

  it('the element’s own failure outranks readiness, both ways round', () => {
    // By the time the `<track>` has failed, `ready` is a measurement that has been overtaken:
    // the bytes were there and the load still produced nothing. BOTH readiness values,
    // because the ready one alone is also green under "drop the fault check and return `on`".
    expect.soft(chosenCellState(track(4, { ready: true }), true, false), 'ready and failed').toBe('unreadable');
    expect.soft(chosenCellState(track(4, { ready: false }), true, false), 'unready and failed').toBe('unreadable');
  });

  // REFUSED, AND NAMED SO IT IS NOT ADDED BACK: a row asserting that none of the four
  // answers is one of the four states a list alone decides. The rows above already pin
  // the exact values, so that assertion is logically implied by them — every mutation it
  // could catch reddens them first — and it would be a row that cannot fail dressed
  // as the contract with the caller. The contract is in `chosenCellState`'s own header.
  //
  // REFUSED FOR A SECOND REASON, AND IT IS THE INTERESTING ONE: the two precedences the
  // verdict is involved in are UNDISCRIMINABLE through this television, so no row defends
  // them. `fault` and `ready` are both asked BEFORE the verdict, and both pairs are
  // unreachable together — a poll only answers `exhausted` or `error` with its last list
  // still unready (a ready entry ends it at `ready`, which is not a verdict), and `fault`
  // needs an element that MOUNTED, which needs `ready`. A row would have to construct a
  // state the route cannot produce; the order is kept because it is the only one that cannot
  // put a mounted `<track>` beside a cell reading `not arriving`, and that reason is written
  // in the function.
  //
  // MEASURED, AND NOT AS NEATLY AS "both swaps are green": three arms in a total order
  // cannot have one pair exchanged alone. Swapping `fault` with the verdict carries `ready`
  // between them and reddens TWO rows — both about `fault` outranking `ready`, a claim the
  // row above already defends. The isolated pairs (a `fault && notArriving` arm ahead of
  // everything; `ready` and the verdict exchanged) are GREEN on all 1543 rows of `test:tv`.
});

describe('notArrivingAfter', () => {
  it('is true for exactly the two outcomes that leave the entry unready with nothing coming', () => {
    // THE TABLE IS HAND-WRITTEN HERE, NOT READ OFF THE MODULE. A test that asserted against
    // the same map it is checking checks nothing — the shape the transport cell's own
    // "renders the words it is HANDED" row exists for.
    //
    // A `Record` OVER THE UNION rather than seven loose lines, so that an eighth outcome
    // cannot be added to the poll without `tsc` stopping on BOTH tables: the production
    // decision and this one. That is C7's lesson in the type system — the seam that round
    // existed for was one nobody was assigned, and a seam that cannot compile needs no owner.
    const expected: Record<SubtitlePollOutcome, boolean> = {
      exhausted: true,
      error: true,
      ready: false,
      cancelled: false,
      none: false,
      unknown: false,
      gone: false,
    };
    const rows = Object.entries(expected) as Array<[SubtitlePollOutcome, boolean]>;
    // THE POSITIVE CONTROL FOR THE LOOP ITSELF: a `for` over an empty table asserts nothing
    // and passes, which is this branch's most-found shape.
    expect.soft(rows, 'every outcome got a row').toHaveLength(7);
    // ONE ASSERTION PER OUTCOME, never a filter over the true ones: `exhausted` and `error`
    // are two separate production decisions and one of them cannot discriminate the other.
    for (const [outcome, want] of rows) {
      expect.soft(notArrivingAfter(outcome), outcome).toBe(want);
    }
  });

  it('answers `notArriving` only through a state the cell actually renders', () => {
    // THE JOIN, in one line, because the two halves are owned by different functions: the
    // verdict is a boolean the route holds and this is the state it becomes. Without this the
    // two could drift — `notArrivingAfter` could be right about every outcome while the cell
    // said `fetching` — and the route's own suite is where the WIRE is proved
    // (`page.fetch.test.tsx`), not here.
    expect.soft(chosenCellState(track(4, { ready: false }), false, notArrivingAfter('exhausted'))).toBe(
      'notArriving',
    );
    expect.soft(chosenCellState(track(4, { ready: false }), false, notArrivingAfter('cancelled'))).toBe(
      'fetching',
    );
  });
});

/** A reader over a script of answers, recording every call and every wait. */
function script(answers: Array<SubtitleList | Error>) {
  const reads: number[] = [];
  const waits: number[] = [];
  const lists: SubtitleList[] = [];
  const read = vi.fn(async () => {
    const answer = answers[Math.min(reads.length, answers.length - 1)];
    reads.push(reads.length);
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return {
    read,
    waits,
    lists,
    wait: async (ms: number) => {
      waits.push(ms);
    },
    onList: (l: SubtitleList) => {
      lists.push(l);
    },
  };
}

const NOT_READY = list([track(4), track(5, { ready: true, lang: 'es', label: 'Spanish' })]);
const READY = list([track(4, { ready: true }), track(5, { ready: true, lang: 'es', label: 'Spanish' })]);

describe('pollSubtitles', () => {
  it('stops the moment the chosen entry reports ready', async () => {
    const s = script([NOT_READY, NOT_READY, READY]);

    const result = await pollSubtitles({ read: s.read, index: 4, wait: s.wait, onList: s.onList });

    expect.soft(result.outcome).toBe('ready');
    expect.soft(result.reads).toBe(3);
    expect.soft(result.entry?.index).toBe(4);
    // The wait happens BETWEEN reads and never after the last one: a trailing wait would hold
    // the picker's "fetching" line up for one interval after the answer had arrived.
    expect.soft(s.waits).toEqual([SUBTITLE_POLL_MS, SUBTITLE_POLL_MS]);
  });

  it('reads readiness off the chosen entry and not off a sibling', async () => {
    // Index 5 is ready in every answer above. On a pack that sibling is another episode's
    // sidecar entirely, so "some entry is ready" is not an answer about anything the viewer
    // asked for. Two attempts, so the row can only end `exhausted` if index 4 was the one
    // consulted.
    const s = script([NOT_READY]);

    const result = await pollSubtitles({ read: s.read, index: 4, attempts: 2, wait: s.wait });

    expect.soft(result.outcome).toBe('exhausted');
    expect.soft(result.reads).toBe(2);
  });

  it('stops on coverage "none", in one read', async () => {
    const s = script([list([], 'none')]);

    const result = await pollSubtitles({ read: s.read, index: 4, wait: s.wait });

    expect.soft(result.outcome).toBe('none');
    expect.soft(result.reads).toBe(1);
    expect.soft(s.read).toHaveBeenCalledTimes(1);
  });

  it('stops on coverage "unknown", in one read', async () => {
    // THE OUTCOME IS THE INSTRUMENT HERE, NOT THE READ COUNT, and that is a correction to the
    // plan's prescription ("assert the call count stops growing"). An evicted torrent answers
    // `unknown` with an EMPTY list, so a build that dropped this stop would fall through to
    // the entry lookup, find nothing, and stop at `gone` after one read as well — the count
    // is identical and only the outcome differs. The cell says two different sentences for
    // these two, so the difference is not cosmetic.
    const s = script([list([], 'unknown')]);

    const result = await pollSubtitles({ read: s.read, index: 4, wait: s.wait });

    expect.soft(result.outcome).toBe('unknown');
    expect.soft(result.reads).toBe(1);
  });

  it('stops on a coverage value this build has never heard of', async () => {
    // DEFAULT-DENY, which is the module's own written claim ("anything that is not
    // `listed` is final") and which no row could observe: enumerating the two known
    // values instead of testing `!== 'listed'` was GREEN (found by review). The fixture
    // CARRIES the chosen entry, unready, so that enumeration really does fall through —
    // a build that polls 25 times against an envelope that already said it could not
    // answer ends `exhausted`, and the cell then says `fetching` for 48 seconds about a
    // list that will never change.
    const s = script([{ ...list([track(4)]), coverage: 'partial' as SubtitleCoverage }]);

    const result = await pollSubtitles({ read: s.read, index: 4, wait: s.wait });

    expect.soft(result.outcome).toBe('unknown');
    expect.soft(result.reads).toBe(1);
  });

  it('stops when the entry has left the list', async () => {
    const s = script([list([track(5, { ready: true })])]);

    const result = await pollSubtitles({ read: s.read, index: 4, wait: s.wait });

    expect.soft(result.outcome).toBe('gone');
    expect.soft(result.reads).toBe(1);
    expect.soft(result.entry).toBeNull();
  });

  it('stops when a read throws, and hands the error back', async () => {
    const boom = new Error('Request failed with status code 404');
    const s = script([boom]);

    const result = await pollSubtitles({ read: s.read, index: 4, wait: s.wait });

    expect.soft(result.outcome).toBe('error');
    expect.soft(result.reads).toBe(1);
    expect.soft(result.error).toBe(boom);
    expect.soft(result.list).toBeNull();
  });

  it('gives up after the attempt budget, with no wait after the last read', async () => {
    const s = script([NOT_READY]);

    const result = await pollSubtitles({ read: s.read, index: 4, attempts: 4, wait: s.wait });

    expect.soft(result.outcome).toBe('exhausted');
    expect.soft(result.reads).toBe(4);
    expect.soft(s.waits).toHaveLength(3);
  });

  it('stops as soon as the caller cancels, without waiting first', async () => {
    // Cancelled the moment the second answer lands: the route unmounted, or the viewer chose
    // a different track while a read was in flight.
    const s = script([NOT_READY]);

    const result = await pollSubtitles({
      read: s.read,
      index: 4,
      wait: s.wait,
      isCancelled: () => s.read.mock.calls.length >= 2,
    });

    expect.soft(result.outcome).toBe('cancelled');
    expect.soft(result.reads).toBe(2);
    // THE WAIT COUNT IS WHAT DISCRIMINATES the check AFTER the answer from the one before the
    // next read: with both checks there is one wait (between the two reads); with only the
    // pre-read check the poll sleeps a whole interval first and then cancels with the same
    // outcome and the same read count. One wait, so the cancel was seen where it happened.
    expect.soft(s.waits).toHaveLength(1);
  });

  it('issues nothing at all if it is cancelled before the first read', async () => {
    const s = script([NOT_READY]);

    const result = await pollSubtitles({
      read: s.read,
      index: 4,
      wait: s.wait,
      isCancelled: () => true,
    });

    expect.soft(result.outcome).toBe('cancelled');
    expect.soft(result.reads).toBe(0);
    expect.soft(s.read).not.toHaveBeenCalled();
  });

  it('hands every answer to the caller as it arrives', async () => {
    // The positive control for `onList`: the screen re-renders from these, so a poll that
    // collected them and reported only at the end would leave the cell stale for 48 seconds.
    const s = script([NOT_READY, READY]);

    await pollSubtitles({ read: s.read, index: 4, wait: s.wait, onList: s.onList });

    expect.soft(s.lists).toHaveLength(2);
    expect.soft(s.lists[0]).toBe(NOT_READY);
    expect.soft(s.lists[1]).toBe(READY);
  });

  it('reads its attempt budget and its interval from its own defaults', async () => {
    // Every other row here passes `attempts` explicitly, so a default hard-coded to 3 would
    // leave all of them green while the poll gave up after six seconds and the cell sat on
    // `fetching`. The wait is injected, so the full budget costs nothing here.
    const s = script([NOT_READY]);

    const result = await pollSubtitles({ read: s.read, index: 4, wait: s.wait });

    expect.soft(result.outcome).toBe('exhausted');
    expect.soft(result.reads).toBe(SUBTITLE_POLL_ATTEMPTS);
    expect.soft(s.waits).toHaveLength(SUBTITLE_POLL_ATTEMPTS - 1);
    expect.soft(new Set(s.waits)).toEqual(new Set([SUBTITLE_POLL_MS]));
  });

  it('the default wait is a real timer, not a resolved promise', async () => {
    // Every other poll row INJECTS `wait`, so the module's one real timer had no witness:
    // replacing `sleep`'s `setTimeout` with `Promise.resolve()` was GREEN (found by
    // review), and that build fires all 25 list reads inside a single tick — at a box that
    // caps itself at two downloads and re-enumerates a torrent's files on every read.
    //
    // THE INSTRUMENT IS A MACROTASK, NOT A MEASURED DURATION, so there is no clock in it
    // to flake: a 0 ms timer runs after every pending microtask and before the poll's own
    // 10 ms one, so a `sleep` that resolved without a timer would already have finished
    // the second read by the time this line resumes.
    const s = script([NOT_READY]);
    let settled = false;
    const poll = pollSubtitles({ read: s.read, index: 4, attempts: 2, delayMs: 10 });
    void poll.then(() => {
      settled = true;
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect.soft(settled).toBe(false);
    expect.soft(s.read).toHaveBeenCalledTimes(1);
    expect.soft((await poll).reads).toBe(2);
  });

  it('outlives the backend\'s own admission budget by one tick', () => {
    // The arithmetic the module's comment claims, with an instrument: 24 waits of 2 s is 48 s
    // against the backend's 45 s `subtitle_admit_budget_ms` (`backend/app/config.py:199`). A
    // poll that gave up first would leave the cell saying `fetching` over a box that had
    // already retracted.
    //
    // The interval is anchored ABSOLUTELY rather than against the constant it is, because the
    // backend answers its own not-ready with `Retry-After: 2` and this is the number that has
    // to match it. The attempt count is NOT pinned absolutely: the inequality is the rule, and
    // leaving it as the only constraint is what lets the two rows fail independently.
    expect.soft(SUBTITLE_POLL_MS).toBe(2000);
    expect.soft((SUBTITLE_POLL_ATTEMPTS - 1) * SUBTITLE_POLL_MS).toBeGreaterThan(45_000);
    // AND NOT BY MUCH — the half that had no instrument: 60 attempts satisfies the line
    // above too (GREEN, found by review), and a poll that outlived the retraction by
    // minutes would hold `fetching` on the cell long after the box had given up. The bound
    // is the module's own phrase, "by one tick", read generously as "within two".
    expect.soft((SUBTITLE_POLL_ATTEMPTS - 1) * SUBTITLE_POLL_MS).toBeLessThanOrEqual(
      45_000 + 2 * SUBTITLE_POLL_MS,
    );
  });
});

/** Either spelling of either banned module, matched on what it resolves to. */
const BANNED_SERVICE = /(^|\/)services\/(api-client|streaming)$/;

describe('the module\'s edges', () => {
  it('imports neither the api-client nor the streaming service', () => {
    // WHY: `_player/engineContract.test.ts` bans both specifiers in `_player/`, because the
    // client's rejection interceptor hard-navigates on a 401 from inside its own handler. It
    // reads DIRECT specifiers only, and `_player/` imports this module — so one import here
    // would put the api-client one hop behind that ban with the ban still green.
    const source = readFileSync(
      join(process.cwd(), 'src/app/(bigscreen)/_data/subtitles.ts'),
      'utf8',
    );
    // Comments stripped first: this module's own header NAMES both specifiers in order to
    // explain why it does not import them, and a raw-text scan would therefore be
    // permanently red for the wrong reason. (The same reason the backend's zero-touch gates
    // scan code rather than file text.)
    const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    const specifiers: string[] = [];
    const re = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) specifiers.push(m[1]);

    // The positive control, without which a broken scanner passes by finding nothing: the
    // module's real imports must be in the list.
    expect.soft(specifiers).toContain('./chunk');
    expect.soft(specifiers).toContain('@/types');
    // Banned by the module a specifier RESOLVES TO, never by its spelling:
    // `../../../services/api-client` is the same module as `@/services/api-client` and is
    // equally one hop behind `_player`'s ban, and the `not.toContain` pair this replaces
    // was GREEN on it (found by review).
    expect.soft(specifiers.filter((sp) => BANNED_SERVICE.test(sp))).toEqual([]);
    // The PATTERN's own positive control. The row above is an `== []` over a filter, so a
    // typo in the regex would make it permanently green all by itself.
    expect.soft(
      ['@/services/api-client', '../../../services/streaming', './services/api-client']
        .filter((sp) => BANNED_SERVICE.test(sp)),
    ).toHaveLength(3);
  });
});
