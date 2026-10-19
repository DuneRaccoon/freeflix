/**
 * The television's subtitle data module: the track URL, the picker's partition, the cell's
 * words, and the bounded poll.
 *
 * NO REACT AND NO TIMERS HERE, deliberately. Every function under test is pure except the
 * poll, and the poll takes its `read` and its `wait` as arguments — so this file cannot meet
 * the `waitFor` flake whose mechanism this repo has recorded (RTL's `asyncWrapper` disables
 * the act environment for all of `waitFor` while passive effects flush as a separate
 * Scheduler task). The rendering of all of this is tasks 12-14's, and their assertions are in
 * the player's own suites.
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
  offerable,
  pickerRowCounts,
  pickerRows,
  pollSubtitles,
  subtitleTrackSrc,
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
  it('has a phrase for exactly the eight states', () => {
    expect.soft(SUBTITLE_CELL_STATES).toHaveLength(8);
    expect.soft(Object.keys(SUBTITLE_CELL_LABELS).sort()).toEqual([...SUBTITLE_CELL_STATES].sort());
  });

  it('says each of the eight things, exactly — and they are distinct and short', () => {
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
  });
});

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
    expect.soft(specifiers).not.toContain('@/services/api-client');
    expect.soft(specifiers).not.toContain('@/services/streaming');
  });
});
