/**
 * The subtitle picker, through the route that owns it: one grid, one Back ladder, two
 * explicit focus moves.
 *
 * WHY IT IS A SEPARATE FILE. `page.test.tsx` is the arrival states, the paint-only hide and
 * the Back escalation; these rows are a second shape of the same screen — the band's rows
 * REPLACED — and they need their own `openPicker()` walk rather than its `playing()`. The
 * cell's own rows (what the nine states say, that the list is read once per episode, that
 * the cell is unconditional) stay there, and the POST that a press on an unready entry sends
 * is `page.fetch.test.tsx`.
 *
 * FOUR HARNESS FACTS, EACH OF WHICH COST SOMETHING TO LEARN:
 *
 *  - A PRESS IS FIRED AT `document.activeElement`, never at `window`: the house `arrow()`
 *    helper dispatches at `window`, which sits ABOVE the React root container, so no React
 *    `onKeyDown` would see it (`_focus/nestedArrowClaim.test.tsx` pins that asymmetry) and
 *    the scrub cell's own arrow claim — which this file needs for the edit-rung row — would
 *    be invisible.
 *  - OK IS A CLICK, NOT `Enter`. Neither `useFocusGrid` nor `useMediaKeys` claims Enter; on
 *    the television the browser turns OK into a native click, and jsdom implements no such
 *    default action. `fireEvent.click` also fires NO focus event, which is why every row
 *    below walks the ring with arrows first and then clicks: the model's focus and DOM focus
 *    are moved by the walk, and the click only presses.
 *  - ONE `act()` PER SLICE when advancing timers. React commits queued updates only when
 *    `act()` exits, so a single long advance cannot observe a re-render.
 *  - MOUNTED WITHOUT METADATA, deliberately, in most rows. `scrubRowCount` returns 0 until
 *    the element reports a finite duration — never yet observed for an in-progress stream on
 *    this set — so `rowCounts` is `[0, 6]` and the transport row is the only row. That is
 *    both the television's normal state and the shape in which `firstTarget` answers
 *    Play/Pause, which is the mechanism the close-restore row is written against.
 *
 * WHAT THESE ROWS DO NOT TOUCH. `pair_source` is an OPAQUE STRING: the backend's
 * `naming.track_label` has already folded the provenance into `label`, the taxonomy grows (a
 * sixth source landed while this stage was being implemented), and nothing here enumerates,
 * switches on or counts its values. One row renders a `pair_source` this build has never
 * heard of and requires the row to behave exactly like any other; another scans the two
 * source files for the words. "Is this paired at all" is `video_index === null`.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  StreamingInfo,
  SubtitleCoverage,
  SubtitleList,
  SubtitleTrack,
  TorrentStatus,
  VideoFile,
} from '@/types';
import { streamingService } from '@/services/streaming';
import { torrentsService } from '@/services/torrents';
import { tvService } from '@/services/tv';
import { usersService } from '@/services/users';
import { pickerRowCounts } from '../../../_data/subtitles';
import { transportCells } from '../../../_player/TransportBar';
import { REVEAL_HIDE_MS } from '../../../_focus/useRevealOnKey';
import { useTvProfile } from '../../../_data/useTvProfile';
import WatchPage from './page';

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
  params: { current: { id: 'pk' } as Record<string, string> },
  search: { current: new URLSearchParams() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  useParams: () => nav.params.current,
  usePathname: () => '/bigscreen/watch/pk',
  useSearchParams: () => nav.search.current,
}));
vi.mock('@/services/streaming', () => ({
  streamingService: {
    getStreamingInfo: vi.fn(),
    getFiles: vi.fn(),
    getProgressByMovie: vi.fn(),
    getProgressByTorrent: vi.fn(),
    saveProgress: vi.fn(),
    updateProgress: vi.fn(),
    getSubtitles: vi.fn(),
    // ADDED BY TASK 17, AND ITS ABSENCE WAS NOT A HARMLESS OMISSION. The route now sends the
    // admission POST from the press that chooses an unready entry, and most fixtures here are
    // unready — so with this key missing the handler called `undefined`, the TypeError landed
    // in its own `catch`, and the cell read `not arriving` instead of `fetching`. A mock
    // factory that lists fewer methods than the route calls is a passing suite describing a
    // route that threw. The POST's own rows are in `page.fetch.test.tsx`.
    fetchSubtitle: vi.fn(),
  },
}));
vi.mock('@/services/torrents', () => ({
  torrentsService: { getTorrentStatus: vi.fn(), listTorrents: vi.fn(), downloadCatalogMovie: vi.fn() },
}));

/**
 * THE TWO SERVICES THE NEXT-EPISODE WORK ADDED, mocked here because an unmocked service
 * method on this surface is a REAL XHR out of jsdom: a network error, a console full of
 * axios, and an answer that depends on what else happens to be listening on localhost.
 *
 * THE SETTING DEFAULTS TO OFF IN THIS FILE, and that is a fixture decision rather than the
 * product's: the background prefetch starts a DOWNLOAD, so leaving it on here would have
 * every row in a file about subtitles, arrival and Back also exercising `titleStateFor` and
 * `downloadCatalogMovie` on a timer. The rows that are about the prefetch turn it on
 * explicitly. (The product default is ON — `autoNextFrom` and the backend's NULL column are
 * where that is pinned.)
 */
vi.mock('@/services/tv', () => ({ tvService: { getShow: vi.fn(), getSeason: vi.fn() } }));
vi.mock('@/services/users', () => ({
  usersService: { getUserSettings: vi.fn(), updateUserSettings: vi.fn() },
}));
vi.mock('../../../_data/useTvProfile', () => ({ useTvProfile: vi.fn() }));

const svc = vi.mocked(streamingService);
const torrents = vi.mocked(torrentsService);
const profileHook = vi.mocked(useTvProfile);

// --- fixtures ----------------------------------------------------------------------

const PACK = 'pk';
const HOME = '/bigscreen';
const FILE_SIZE = 2_000_000_000;

const statusRow = (over: Record<string, unknown> = {}): TorrentStatus =>
  ({
    id: PACK,
    movie_title: 'Show 1399 S02',
    // 1080p, so `messageFor`'s arrival disclosure says NOTHING: it speaks only for a
    // bucket this television never asks for. A row that needs the line non-empty asks
    // for 720p and says so.
    quality: '1080p',
    state: 'downloading',
    progress: 42,
    num_peers: 4,
    download_rate: 1_500_000,
    tmdb_id: 1399,
    media_type: 'tv',
    season: 2,
    episode: null,
    ...over,
  }) as TorrentStatus;

const file = (index: number, episode: number): VideoFile => ({
  index,
  name: `show.s02e0${episode}.mkv`,
  size: FILE_SIZE,
  downloaded: FILE_SIZE / 2,
  progress: 50,
  mime_type: 'video/x-matroska',
  stream_url: `/api/v1/streaming/${PACK}/video?file_index=${index}`,
  season: 2,
  episode,
});

/** Already season/episode sorted, as the backend sends it: the played file is index 4. */
const FILES = [file(4, 1), file(0, 2), file(7, 3)];

const infoRow = (): StreamingInfo =>
  ({
    torrent_id: PACK,
    movie_title: 'Show 1399 S02',
    quality: '1080p',
    progress: 42,
    total_progress: 42,
    state: 'downloading',
    content_id: 'tv:1399:s2:e1',
    season: 2,
    episode: 1,
    file_index: 4,
    video_file: {
      name: 'show.s02e01.mkv',
      size: FILE_SIZE,
      downloaded: FILE_SIZE / 2,
      progress: 50,
      mime_type: 'video/x-matroska',
      stream_url: `/api/v1/streaming/${PACK}/video`,
      contiguous: {
        file_index: 4,
        file_size: FILE_SIZE,
        piece_length: 4_194_304,
        run_start: 0,
        run_end: 1_200_000_000,
        complete: false,
        measured_against: 'metadata',
      },
    },
  }) as StreamingInfo;

/**
 * One listed sidecar.
 *
 * `index` (the torrent's own file index), `video_index` and the row's POSITION in the list
 * are three different numbers on purpose: a fixture where they agreed could not tell an
 * off-by-one from a correct build.
 */
const track = (over: Partial<SubtitleTrack> = {}): SubtitleTrack => ({
  index: 9,
  video_index: 4,
  pair_source: 'stem',
  season: 2,
  episode: 1,
  lang: 'en',
  label: 'English',
  flags: [],
  format: 'srt',
  size: 42_000,
  ready: false,
  convertible: true,
  reason: null,
  url: `/api/v1/streaming/${PACK}/subtitles/9`,
  ...over,
});

const listOf = (
  subtitles: SubtitleTrack[],
  coverage: SubtitleCoverage = 'listed',
): SubtitleList => ({
  torrent_id: PACK,
  state: 'downloading',
  coverage,
  source: coverage === 'unknown' ? null : 'session',
  paired_to: 4,
  subtitles,
});

/** `n` convertible entries, with distinct labels and distinct torrent indices. */
const manyTracks = (n: number): SubtitleTrack[] =>
  Array.from({ length: n }, (_, i) =>
    // Indices start at 9 and step by 2, so no entry's index equals its position.
    track({ index: 9 + i * 2, label: `Lang ${i + 1}`, lang: null }),
  );

/**
 * The route's own `/info` re-measure cadence, copied rather than imported: Next validates a
 * page module's exports and rejects anything but its own known fields, so `page.tsx` cannot
 * hand this to its test. Used to drive a ROUTE re-render while the picker is open — the one
 * thing that hands the picker a fresh `rows` array with unchanged contents.
 */
const INFO_REFRESH_MS = 10_000;

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status, data: {} } });

// --- DOM helpers -------------------------------------------------------------------

const ring = () => Array.from(document.querySelectorAll('[tabindex="0"]'));
const band = () => document.querySelector('.bs-player__bar') as HTMLElement | null;
const hidden = () => !!band()?.classList.contains('bs-player__bar--hidden');
const navCalls = () => [...nav.push.mock.calls, ...nav.replace.mock.calls].map(([to]) => to);
const cell = (name: string | RegExp) => screen.getByRole('button', { name });
const maybeCell = (name: string | RegExp) => screen.queryByRole('button', { name });
const transportRow = () => screen.queryByRole('group', { name: 'Playback controls' });
const scrubCell = () => document.querySelector('.bs-player__scrub') as HTMLElement | null;
const trackEls = () => [...document.querySelectorAll('track')];

/**
 * THE BAND'S `role="status"` LINES — i.e. the route's `message`, and nothing else.
 *
 * `mayHide` is `playing && !editOpen && !pickerOpen && message === ''`, so "the picker said
 * nothing in the band's one message line" is the assertion that keeps the new `!pickerOpen`
 * conjunct discriminating: if opening the picker put a sentence there, the PRE-EXISTING
 * `message === ''` clause would already refuse the hide and the new conjunct would be dead
 * code. The picker's own hint deliberately carries no role, which is what makes the two
 * separable here; `says why it is empty` is the positive control that this helper can be
 * non-empty at all.
 */
const statusLines = () =>
  Array.from(band()?.querySelectorAll('[role="status"]') ?? []).map((el) => el.textContent ?? '');

/** The picker's own hint: a `.bs-player__hint` with NO role. Never the band's message. */
const pickerHint = () =>
  Array.from(document.querySelectorAll('.bs-player__hint'))
    .filter((el) => !el.hasAttribute('role'))
    .map((el) => el.textContent ?? '')
    .join('|');

/** Every `.bs-player__row` in the band, as its buttons. */
const rowEls = () => [...(band()?.querySelectorAll('.bs-player__row') ?? [])];
const pickerCells = () => rowEls().flatMap((r) => [...r.querySelectorAll('button')]);

/** The device's shape: a keydown at the focused element, bubbling up to `window`. */
function press(init: KeyboardEventInit) {
  const target = document.activeElement ?? document.body;
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}
const back = () => press({ key: 'Backspace' });
const right = () => press({ key: 'ArrowRight' });
const left = () => press({ key: 'ArrowLeft' });
const down = () => press({ key: 'ArrowDown' });
const up = () => press({ key: 'ArrowUp' });

/** One `act()` per slice; see the header. */
async function tick(ms: number, slices = 4) {
  for (let i = 0; i < slices; i++) {
    await act(async () => {
      vi.advanceTimersByTime(Math.ceil(ms / slices));
    });
  }
}

async function clickOn(el: Element) {
  await act(async () => {
    fireEvent.click(el);
  });
}

beforeAll(() => {
  window.HTMLMediaElement.prototype.load = vi.fn();
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
});


/**
 * The season the route's next-episode lookup reads. Episodes 1-3, matching `FILES`, so the
 * default arrival (file 0 = episode 2) has episode 3 after it.
 */
const SEASON = {
  season_number: 2,
  name: 'Season 2',
  overview: null,
  episodes: [1, 2, 3].map((n) => ({
    episode_number: n,
    name: `Episode ${n}`,
    overview: null,
    runtime: 50,
    still_url: null,
    air_date: null,
    vote_average: 0,
  })),
};

/** One season, so "nothing after this" is reachable from the last episode of it. */
const SHOW = {
  tmdb_id: 1399,
  media_type: 'tv',
  name: 'Show',
  year: 2011,
  overview: null,
  poster_url: null,
  backdrop_url: null,
  genres: [],
  status: null,
  first_air_date: null,
  last_air_date: null,
  number_of_seasons: 1,
  vote_average: 0,
  vote_count: 0,
  seasons: [{ season_number: 2, name: 'Season 2', episode_count: 3, overview: null, poster_url: null, air_date: null }],
};

const settingsRow = (autoNext: boolean) =>
  ({
    id: 's1',
    user_id: 'p1',
    maturity_restriction: 'none',
    require_passcode: false,
    has_passcode: false,
    passcode_len: null,
    theme: 'dark',
    default_quality: '1080p',
    auto_next_episode: autoNext,
  }) as unknown as Awaited<ReturnType<typeof usersService.getUserSettings>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  sessionStorage.clear();
  localStorage.clear();
  nav.params.current = { id: PACK };
  nav.search.current = new URLSearchParams();
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(tvService).getSeason.mockResolvedValue(SEASON as never);
  vi.mocked(tvService).getShow.mockResolvedValue(SHOW as never);
  vi.mocked(usersService).getUserSettings.mockResolvedValue(settingsRow(false));
  profileHook.mockReturnValue({
    profile: { id: 'p1', display_name: 'Ben', avatar: null },
    loading: false,
    select: vi.fn(),
    clear: vi.fn(),
  });
  torrents.getTorrentStatus.mockResolvedValue(statusRow());
  svc.getFiles.mockResolvedValue(FILES);
  svc.getStreamingInfo.mockResolvedValue(infoRow());
  svc.getProgressByMovie.mockResolvedValue(null);
  svc.saveProgress.mockResolvedValue(null as never);
  svc.getSubtitles.mockResolvedValue(listOf([track()]));
  svc.fetchSubtitle.mockResolvedValue({ admitted: 1, budget_ms: 45_000 });
});

afterEach(async () => {
  // In an ASYNC act, before testing-library's cleanup: draining the pending `/info` timer
  // starts a request whose promise settles a turn later, outside any act() unless awaited.
  await act(async () => {
    vi.runOnlyPendingTimers();
  });
  vi.useRealTimers();
});

/** Mount and settle the arrival chain: four turns, one per link. */
async function mount() {
  const view = render(<WatchPage />);
  for (let i = 0; i < 4; i++) await act(async () => {});
  return view;
}

/**
 * Wait, boundedly, for the ring to come to rest on a cell whose text matches.
 *
 * The belt `page.test.tsx` carries, for the reason recorded there: `mount()` resolves after a
 * fixed number of MICROTASK flushes while the grid places the ring in a PASSIVE effect React
 * schedules as a MACROTASK, so no number of `await act(async () => {})` guarantees it has
 * run. It WAITS; it does not assert — a timeout returns quietly and leaves the caller's own
 * assertions to fail with the real diagnostic.
 *
 * NOT `waitFor`: under this file's fake timers it polls a clock nothing advances and dies at
 * its own 5s limit instead of failing with the assertion. 50ms in total, well short of the 1s
 * stall tick and the 10s re-measure, so it cannot perturb what the rows are about.
 */
async function untilRingOn(label: RegExp, tries = 50) {
  for (let i = 0; i < tries; i++) {
    const el = document.activeElement as HTMLElement | null;
    if (ring().length === 1 && ring()[0] === el && label.test(el?.textContent ?? '')) return;
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
  }
}

/**
 * How many Right presses it takes to walk from Play/Pause to the Subtitles cell.
 *
 * DERIVED, not written as a number. It was `4` until the Next-episode cell was inserted after
 * `forward60`, which made it 5 for this fixture — a TV season pack, so the row HAS that cell.
 * Reading it off `transportCells` means the walk follows a reorder instead of silently
 * landing on whichever cell now occupies column 4, which is the failure that would look like
 * a focus bug rather than a stale constant.
 */
const SUBTITLES_COLUMN = transportCells({ retry: false, next: true }).findIndex(
  (c) => c.id === 'subtitles',
);

/**
 * Mount, walk the ring to the Subtitles cell, and press it.
 *
 * THE WALK IS NOT DECORATION. `fireEvent.click` fires no focus event, so the grid's model
 * only knows where the ring is because the arrows put it there — and the open move's whole
 * claim is that it does NOT use that position. It is also the column the mid-row-insertion
 * defect is visible from.
 */
async function openPicker() {
  const view = await mount();
  await untilRingOn(/Pause/);
  for (let i = 0; i < SUBTITLES_COLUMN; i++) right();
  const sub = cell('Subtitles');
  expect(document.activeElement, 'the walk ended on the Subtitles cell').toBe(sub);
  await clickOn(sub);
  return view;
}

// ===================================================================================
// 1. The picker REPLACES the band's rows
// ===================================================================================

describe('the picker replaces the band’s rows', () => {
  it('takes the transport row and the scrub cell with it, and leaves the band up', async () => {
    svc.getSubtitles.mockResolvedValue(listOf(manyTracks(3)));
    await openPicker();
    // An OVERLAY would need a second `useFocusGrid` (which the hook forbids — of two, the
    // INCOMING one is the dead one) or a `rowCounts` declaring the transport row AND the
    // picker, which puts four more reachable (row, col) pairs on a screen where a ring on a
    // cell no element claims looks exactly like nothing being focused.
    expect.soft(transportRow(), 'the transport row is gone').toBeNull();
    expect.soft(maybeCell('Subtitles'), 'and so is the cell that opened it').toBeNull();
    // The scrub cell claims the horizontal arrows while focused, which are the picker's own.
    expect.soft(scrubCell(), 'and the scrub cell with it').toBeNull();
    // The band itself is NOT unmounted and NOT faded: it is the thing the picker is in.
    expect.soft(band(), 'the band is still mounted').not.toBeNull();
    expect.soft(hidden(), 'and still visible').toBe(false);
    // Off plus one cell per listed entry.
    expect.soft(pickerCells().map((b) => b.firstChild?.textContent)).toEqual([
      'Off',
      'Lang 1',
      'Lang 2',
      'Lang 3',
    ]);
  });

  it('declares exactly the cells it renders, at every width the chunking produces', async () => {
    // THE HOUSE INVARIANT — a row's declared count equals the cells rendered — read from the
    // DOM. The route declares `pickerRowCounts(rows.length)` and the component lays its cells
    // out from the SAME call, so this row is what makes that one call observable: a component
    // that chunked by four against a grid declared in threes would render a cell the grid
    // cannot reach and declare one no element claims, and nothing else here would see it.
    for (const n of [0, 1, 2, 3, 5, 20]) {
      svc.getSubtitles.mockResolvedValue(
        n === 0 ? listOf([], 'none') : listOf(manyTracks(n)),
      );
      const view = await openPicker();
      const want = pickerRowCounts(n);
      expect.soft(rowEls().map((r) => r.querySelectorAll('button').length), `n=${n}`).toEqual(
        [...want],
      );
      expect.soft(pickerCells(), `n=${n}: Off plus every entry`).toHaveLength(n + 1);
      view.unmount();
    }
  });

  it('is walkable end to end, and no reachable cell leaves nothing focused', async () => {
    // NINETEEN entries, not twenty, AND THAT IS A MEASURED CORRECTION. 19 is 20 cells in
    // seven rows whose LAST ROW IS SHORT (two cells); 20 is 21 cells in seven FULL rows,
    // where no boundary between "declared" and "rendered" is reachable at all. Measured: with
    // the 20-entry fixture, declaring one cell too many in the route
    // (`pickerRowCounts(length + 1)`) left all 19 rows GREEN — the walk was driven by the
    // count the TEST computed, so it never visited the phantom row. The fixture now reaches
    // the boundary and the walk SATURATES past both ends, which is what sees it.
    //
    // The ring invariant (`journeys.test.tsx:918-919`) is asserted at EVERY step, not only at
    // the end: a walk that lost the ring in the middle and recovered by the end would pass an
    // end-state check.
    svc.getSubtitles.mockResolvedValue(listOf(manyTracks(19)));
    await openPicker();
    const counts = pickerRowCounts(19);
    expect(counts, 'seven rows, the last one short').toEqual([3, 3, 3, 3, 3, 3, 2]);
    const seen = new Set<Element>();
    for (let r = 0; r < counts.length; r++) {
      if (r > 0) {
        down();
        // BACK TO COLUMN 0 EXPLICITLY. `move` lands a vertical press on the column that row
        // last held, else on the one it came from, clamped — so a walk that assumed column 0
        // after `down()` would skip the first cells of every row but the first. Left never
        // wraps, so `counts[r]` presses is "go to the start" whatever the memory said.
        for (let i = 0; i < counts[r]; i++) left();
      }
      for (let c = 0; c < counts[r]; c++) {
        if (c > 0) right();
        const el = document.activeElement as HTMLElement;
        expect.soft(ring(), `row ${r} col ${c}: exactly one ring`).toHaveLength(1);
        expect.soft(ring()[0], `row ${r} col ${c}: and it is the focused one`).toBe(el);
        expect.soft(pickerCells(), `row ${r} col ${c}: a picker cell`).toContain(el);
        seen.add(el);
      }
    }
    expect.soft(seen.size, 'every cell was reached exactly once').toBe(20);

    // SATURATING, PAST BOTH ENDS, and this is the only instrument for a grid that declares
    // more than the picker renders. `move` never wraps, so these presses are no-ops on a
    // correct grid — while a declared row or column with no element behind it takes the ring
    // somewhere `go` cannot focus (it bails on a missing node) and leaves `ring()` EMPTY,
    // which is indistinguishable on the television from nothing being focused.
    const last = document.activeElement;
    for (let i = 0; i < 3; i++) {
      right();
      expect.soft(ring(), `right past the short last row (${i})`).toHaveLength(1);
      expect.soft(ring()[0], 'still the focused cell').toBe(document.activeElement);
    }
    for (let i = 0; i < 3; i++) {
      down();
      expect.soft(ring(), `down past the last row (${i})`).toHaveLength(1);
      expect.soft(ring()[0], 'still the focused cell').toBe(document.activeElement);
    }
    expect.soft(document.activeElement, 'and it never left the grid').toBe(last);
    expect.soft(pickerCells(), 'which is a cell that exists').toContain(document.activeElement);
  });
});

// ===================================================================================
// 2. The two explicit focus moves
// ===================================================================================

describe('the two explicit focus moves', () => {
  it('opens onto the current selection, not onto the clamp’s answer', async () => {
    // FIVE ENTRIES, so the picker is [3, 3] and the selection below sits in ROW 1. That is
    // what makes this row discriminating: the ring arrives from the transport row's column 4,
    // and `clampTarget` would answer `clamp(4, 0, 2)` = row 1 column 2 — the FIFTH entry.
    // The truth is row 1 column 0, the third. A fixture whose selection happened to be the
    // clamp's answer would pass with the focus move deleted.
    svc.getSubtitles.mockResolvedValue(listOf(manyTracks(5)));
    await openPicker();
    // FIRST OPEN, nothing chosen: Off, which is cell 0 — also not the clamp's answer.
    expect.soft(document.activeElement, 'the first open lands on Off').toBe(cell('Off'));
    expect.soft(ring(), 'and exactly one cell holds the ring').toHaveLength(1);
    expect.soft(ring()[0]).toBe(document.activeElement);

    await clickOn(cell('Lang 3'));
    expect.soft(transportRow(), 'the choice closed the picker').not.toBeNull();

    await clickOn(cell('Subtitles'));
    const third = cell('Lang 3');
    expect.soft(document.activeElement, 'reopening lands on the chosen entry').toBe(third);
    expect
      .soft(document.activeElement, 'and NOT on clampTarget’s row 1 column 2')
      .not.toBe(cell('Lang 5'));
    expect.soft(ring()).toHaveLength(1);
    expect.soft(ring()[0]).toBe(third);
  });

  it('closes back onto the Subtitles cell — after a choice, and after Back', async () => {
    // BOTH EXITS, because they are two different code paths into one restore and either one
    // alone leaves the other's mutation green. Without the restore, `firstTarget` answers the
    // first POPULATED row — and with no finite duration the scrub row is empty
    // (`ScrubBar.tsx:62`), so that is the transport row's column 0: Play/Pause.
    svc.getSubtitles.mockResolvedValue(listOf(manyTracks(3)));
    await openPicker();
    await clickOn(cell('Lang 2'));
    const sub = cell('Subtitles');
    expect.soft(document.activeElement, 'a choice puts the ring back on the cell').toBe(sub);
    expect.soft(document.activeElement, 'and not on firstTarget').not.toBe(cell(/^Pause|^Play/));
    expect.soft(ring()).toHaveLength(1);
    expect.soft(ring()[0]).toBe(sub);

    await clickOn(sub);
    expect.soft(transportRow(), 'open again').toBeNull();
    back();
    const again = cell('Subtitles');
    expect.soft(document.activeElement, 'Back puts it back too').toBe(again);
    expect.soft(ring()).toHaveLength(1);
    expect.soft(ring()[0]).toBe(again);
  });

  it('survives a refresh that shrinks the list with the ring still somewhere real', async () => {
    // `?file=` MOVES WITH NO NEW ARRIVAL (the show screen pushes a new watch URL for the same
    // torrent), so the list is re-read and can come back shorter under an OPEN picker. NO
    // SHRINK RESCUE IS PRESCRIBED AND NONE IS ADDED: `clampTarget` already pulls a column
    // into a shorter row and falls back to `firstTarget` for a row that has gone, so there is
    // no line to delete and no mutation to run — this row is the measurement that says so.
    svc.getSubtitles.mockResolvedValue(listOf(manyTracks(5)));
    const view = await openPicker();
    down();
    right();
    right();
    expect.soft(document.activeElement, 'the ring is in the second row').toBe(cell('Lang 5'));

    svc.getSubtitles.mockResolvedValue(listOf([track({ label: 'Only one' })]));
    nav.search.current = new URLSearchParams('file=7');
    await act(async () => {
      view.rerender(<WatchPage />);
    });
    for (let i = 0; i < 4; i++) await act(async () => {});
    expect.soft(pickerCells(), 'the picker shrank with the list').toHaveLength(2);
    expect.soft(ring(), 'exactly one cell still holds the ring').toHaveLength(1);
    expect.soft(ring()[0], 'and it is the focused one').toBe(document.activeElement);
    expect.soft(pickerCells(), 'which is a cell that exists').toContain(document.activeElement);
  });
});

// ===================================================================================
// 3. The Back ladder
// ===================================================================================

describe('the Back ladder with the picker in it', () => {
  it('closes the picker, then hides the band, then leaves the player', async () => {
    // THE RUNG IS MANDATORY, NOT OPTIONAL. `mayHide` guards only the auto-hide TIMER, while
    // the ladder's second rung calls `setVisible(false)` DIRECTLY — so without a rung ahead
    // of it, one Back press fades an open, focused menu to `opacity: 0` (the hide is paint
    // only) and the next press leaves the film.
    svc.getSubtitles.mockResolvedValue(listOf(manyTracks(3)));
    await openPicker();
    const navsBefore = navCalls().length;

    back();
    expect.soft(transportRow(), 'rung 1 closed the picker').not.toBeNull();
    expect.soft(hidden(), 'and left the band visible').toBe(false);
    expect.soft(navCalls().length, 'and went nowhere').toBe(navsBefore);

    back();
    expect.soft(hidden(), 'rung 2 hid the band').toBe(true);
    expect.soft(navCalls().length, 'still nowhere').toBe(navsBefore);

    back();
    expect.soft(navCalls(), 'rung 3 left the player').toContain(HOME);
  });

  it('is ahead of the scrub edit’s rung, which the picker’s own unmount can leave stale', async () => {
    // NOT PRESCRIBED, AND REACHABLE. The scrub cell UNMOUNTS when the picker replaces the
    // band's rows, and its `onEditOpen` effect has no cleanup — so a pending edit is still
    // reported OPEN while the picker is up. On the television that state is reached with the
    // gyro cursor, which can click one control while another holds focus (the route's own
    // pointer-reveal effect exists for exactly that remote). With the edit rung first, this
    // Back press blurs and refocuses a cell that is no longer on screen and RETURNS, and the
    // picker has no way out at all.
    svc.getSubtitles.mockResolvedValue(listOf(manyTracks(3)));
    const view = await mount();
    await untilRingOn(/Pause/);
    // The scrub row needs a finite duration to exist at all.
    const el = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(el, 'currentTime', { configurable: true, get: () => 0, set: () => {} });
    Object.defineProperty(el, 'duration', { configurable: true, get: () => 2400 });
    await act(async () => {
      fireEvent.loadedMetadata(el);
    });
    up();
    expect(document.activeElement, 'the ring is on the scrub cell').toBe(scrubCell());
    right();
    expect(
      scrubCell()?.querySelector('.bs-player__commit')?.textContent,
      'and an edit is pending',
    ).toMatch(/OK/);

    await clickOn(cell('Subtitles'));
    expect(transportRow(), 'the picker is open over a stale edit flag').toBeNull();
    back();
    expect.soft(transportRow(), 'and Back still closes the picker').not.toBeNull();
    expect.soft(hidden(), 'without hiding the band').toBe(false);
    view.unmount();
  });
});

// ===================================================================================
// 4. The auto-hide
// ===================================================================================

describe('the auto-hide with the picker open', () => {
  it('refuses the hide for as long as the picker is up, and says nothing to do it', async () => {
    // `message === ''` IS WHAT KEEPS THIS DISCRIMINATING. If opening the picker put a
    // sentence in the band's one message line, the PRE-EXISTING clause would already refuse
    // the hide and `!pickerOpen` would be dead code — stage 8's "a 1080p press landing 1080p
    // must say nothing" lesson, load-bearing twice over. The refusal is also RE-SERVED rather
    // than spent (`useRevealOnKey`'s contract), which is why the second advance is here.
    svc.getSubtitles.mockResolvedValue(listOf(manyTracks(3)));
    await openPicker();
    expect.soft(statusLines(), 'the band says nothing to begin with').toEqual([]);

    await tick(REVEAL_HIDE_MS + 100);
    expect.soft(hidden(), 'the quiet period did not take the menu').toBe(false);
    expect.soft(statusLines(), 'and nothing was said to stop it').toEqual([]);

    await tick(REVEAL_HIDE_MS + 100);
    expect.soft(hidden(), 'nor the one after it').toBe(false);
    expect.soft(statusLines()).toEqual([]);

    // AND THE CLAUSE IS THE ONLY THING REFUSING: close the picker and the very next period
    // puts the band away. Without this arm a band that could never hide for some other
    // reason would pass the three assertions above.
    back();
    await tick(REVEAL_HIDE_MS + 100);
    expect.soft(hidden(), 'with the picker closed the band fades').toBe(true);
  });

  it('the message line this row reads can be non-empty', async () => {
    // THE POSITIVE CONTROL for `statusLines()`. An `toEqual([])` against a selector that had
    // been broken by a rename would pass for ever; this is the row that fails instead.
    torrents.getTorrentStatus.mockResolvedValue(statusRow({ quality: '720p' }));
    await mount();
    expect(statusLines()).toEqual([
      'Playing the 720p release — lower than this television asked for.',
    ]);
  });
});

// ===================================================================================
// 5. The rows this box will not serve
// ===================================================================================

describe('a listed format this box cannot convert', () => {
  const ASS = (over: Partial<SubtitleTrack> = {}) =>
    track({
      index: 11,
      label: 'German',
      lang: 'de',
      format: 'ass',
      convertible: false,
      reason: 'unsupported-format',
      ...over,
    });

  it('is focusable, is never dressed as disabled, and answers its own press', async () => {
    // D17 / the stage-8 shape: a VISIBLE ROW WITH EFFECT NONE, carrying its own reason.
    // Silence about a file the viewer can see in the release is a lie, and `aria-disabled` is
    // the web CC button's anti-pattern (`VideoPlayer.tsx:1816-1831`) — worse on a remote,
    // where the ring stops here whatever the attribute says, so the attribute removes only
    // the explanation.
    svc.getSubtitles.mockResolvedValue(listOf([track(), ASS()]));
    await openPicker();
    const unservable = cell(/^German/);
    expect.soft(unservable.getAttribute('aria-disabled'), 'not dressed as disabled').toBeNull();
    expect.soft(unservable).not.toBeDisabled();
    expect.soft(unservable.hasAttribute('tabindex'), 'and it is in the grid').toBe(true);
    // The format is on the row itself, announced rather than aria-hidden: no exact-name
    // contract exists on a picker row, and the format is the part the viewer can act on.
    expect.soft(unservable.textContent, 'with its format').toContain('.ass');
    expect.soft(pickerHint(), 'and the hint is empty until it is pressed').toBe('');
    // AND THE LINE IS HELD OPEN WHILE IT IS EMPTY, which is a geometry claim the component
    // makes in a comment and nothing measured: rendering the `<p>` only when there is
    // something to say was GREEN on all 19 rows. `.bs-player__hint` reserves one line
    // (`min-height`), so a refusal arriving does not nudge the control the ring is sitting
    // on — on a remote that reads as the screen moving under you. jsdom computes nothing
    // from a linked stylesheet, so this is the element's presence plus the rule's text.
    expect
      .soft(document.querySelectorAll('.bs-player__hint:not([role])'), 'the empty line is still there')
      .toHaveLength(1);

    await clickOn(unservable);
    // THE PRESS IS ANSWERED, and the hint is a DIFFERENT string from the row's own text, so
    // this assertion cannot be satisfied by finding the row again.
    expect.soft(pickerHint(), 'the press was answered').toMatch(/\.ass/);
    expect.soft(pickerHint(), 'with what the box will do about it').toMatch(/cannot convert/);
    // AND IT STAYS UP THROUGH THE ROUTE'S OWN BACKGROUND WORK. The `/info` re-measure
    // re-renders the route every 10s, which hands the picker a fresh `rows` ARRAY with the
    // same contents — so a refusal cleared on `[rows]` rather than on the entry indices
    // evaporates a few seconds after the viewer reads it, with nothing anywhere to notice.
    // Measured: that mutation was GREEN until this advance was added, because the press
    // itself re-renders only the picker and the array identity survives it.
    await tick(INFO_REFRESH_MS + 500);
    expect.soft(pickerHint(), 'and it survives the /info cadence').toMatch(/\.ass/);
    expect.soft(transportRow(), 'and the picker is still open').toBeNull();
    expect.soft(cell('Off'), 'with Off still in it').toBeDefined();
    // NOTHING WAS CHOSEN. The element's own mount gate reads `convertible` too, so this is
    // the route's half: a refused row must not become the chosen one.
    expect.soft(trackEls(), 'no track was mounted').toHaveLength(0);
    back();
    expect
      .soft(cell('Subtitles').getAttribute('data-subtitles'), 'and the cell still says off')
      .toBe('off');
  });

  it('names the format whatever reason the backend put on the row', async () => {
    // THREE REASONS, AND THE THIRD IS THE POINT. `unsupported-format` is the ordinary one;
    // `unreadable` is a shape the backend really does send on a non-convertible row (the
    // lister fills `unsupported-format` only `if reason is None`, so an `.ass` whose stat
    // raised ENAMETOOLONG arrives as `{format: ass, convertible: false, reason: unreadable}`
    // — measured in the backend's own review round); and a code this build has never heard
    // of is what the fallback is for. Without this arm the fallback is dead code, and the
    // row would then say `undefined` on the day the backend adds a reason.
    for (const [reason, words] of [
      ['unsupported-format', /cannot convert/],
      ['unreadable', /could not read/],
      ['a-reason-from-a-later-stage', /cannot show/],
    ] as const) {
      svc.getSubtitles.mockResolvedValue(listOf([track(), ASS({ reason })]));
      const view = await openPicker();
      await clickOn(cell(/^German/));
      expect.soft(pickerHint(), `${reason}: the format`).toMatch(/\.ass/);
      expect.soft(pickerHint(), `${reason}: and what follows from it`).toMatch(words);
      expect.soft(pickerHint(), `${reason}: never a hole in the sentence`).not.toMatch(/undefined/);
      view.unmount();
    }
  });

  it('forgets its refusal when the list underneath it changes', async () => {
    // The hint names a FORMAT, and a format that belongs to an entry the list no longer
    // carries is a sentence about nothing — reachable on a pack, where `?file=` re-reads the
    // list with no new arrival. Keyed on the entry indices rather than on the array, because
    // the route rebuilds the array every render and `[rows]` would clear the refusal in the
    // very commit the press caused it.
    svc.getSubtitles.mockResolvedValue(listOf([track(), ASS()]));
    const view = await openPicker();
    await clickOn(cell(/^German/));
    expect(pickerHint(), 'the refusal is up').toMatch(/\.ass/);

    svc.getSubtitles.mockResolvedValue(listOf([track({ index: 21, label: 'Dutch' })]));
    nav.search.current = new URLSearchParams('file=7');
    await act(async () => {
      view.rerender(<WatchPage />);
    });
    for (let i = 0; i < 4; i++) await act(async () => {});
    expect.soft(pickerHint(), 'and it went with the list it was about').not.toMatch(/\.ass/);
  });
});

// ===================================================================================
// 6. The label is the backend's, verbatim
// ===================================================================================

describe('the row text', () => {
  it('is the backend’s rendered label and nothing re-derived', async () => {
    // THE ONE THING IN THIS STAGE THAT TELLS A VIEWER A PAIRING WAS INFERRED. A mis-paired
    // sidecar is the stage's only failure with no error anywhere — valid VTT, correct
    // readiness, a true sentence about everything except whose episode it is — so the
    // provenance the backend folded into `label` has to arrive intact.
    //
    // BOTH DIRECTIONS, because one alone leaves the other mutation green: the suffixed
    // labels must not be stripped, and the bare one must not have a suffix ADDED. An exact
    // `toEqual` over all three is what pins that, and it is also what fails if this surface
    // ever starts rendering `lang` (every row's `lang` differs from its label) or
    // re-deriving a language name.
    svc.getSubtitles.mockResolvedValue(
      listOf([
        track({ index: 9, lang: 'en', label: 'English', pair_source: 'stem' }),
        track({ index: 11, lang: 'fr', label: 'French (matched by folder)', pair_source: 'dir' }),
        track({
          index: 13,
          lang: 'de',
          label: 'German (matched by episode number)',
          pair_source: 'parse',
        }),
      ]),
    );
    await openPicker();
    expect(pickerCells().map((b) => b.firstChild?.textContent)).toEqual([
      'Off',
      'English',
      'French (matched by folder)',
      'German (matched by episode number)',
    ]);
  });

  it('treats pair_source as an opaque string, behaviourally and in the source', async () => {
    // `PAIR_SOURCES` GREW WHILE THIS STAGE WAS BEING IMPLEMENTED (a sixth entry, `near`), so
    // any list of its values on this side would have been wrong within the hour. A row whose
    // source is a value this build has never heard of must therefore behave exactly like any
    // other: its label renders, it is selectable, and choosing it is what the cell reports.
    svc.getSubtitles.mockResolvedValue(
      listOf([
        track({ index: 15, label: 'Polish (nearest of several matches)', pair_source: 'near' }),
        track({
          index: 17,
          label: 'Czech (some rung from a later stage)',
          pair_source: 'a-rung-this-build-has-never-heard-of',
          video_index: null,
        }),
      ]),
    );
    await openPicker();
    const odd = cell(/^Czech/);
    expect.soft(odd.textContent, 'the unknown source renders its label').toBe(
      'Czech (some rung from a later stage)',
    );
    await clickOn(odd);
    expect
      .soft(cell('Subtitles').getAttribute('data-subtitles'), 'and it was choosable')
      .toBe('fetching');

    // AND THE SOURCE SAYS SO, which is the only instrument that can see a `switch` whose
    // default happens to be right for every fixture here. Comments stripped: a comment
    // explaining the rule is a good thing.
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    for (const rel of [
      'src/app/(bigscreen)/_player/SubtitlePicker.tsx',
      'src/app/(bigscreen)/bigscreen/watch/[id]/page.tsx',
    ]) {
      const src = strip(readFileSync(join(process.cwd(), rel), 'utf8'));
      expect.soft(src, `${rel} reads no pair source`).not.toContain('pair_source');
      expect.soft(src, `${rel} enumerates no rung`).not.toContain('PAIR_SOURCES');
    }
  });

  it('uses only bs- classes the stylesheet has a rule for', async () => {
    // `bigscreen.css` is hand-authored plain CSS outside PostCSS and is NOT this task's file,
    // so the picker reuses existing classes — and a typo'd class name renders a geometry-less
    // element that passes every other assertion on this surface. `playerCss.test.tsx`'s
    // catch-all renders ScrubBar and TransportBar only; the picker is reached through the
    // route, so the check comes here.
    const css = readFileSync(join(process.cwd(), 'public/bigscreen.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const hasRule = (name: string) => new RegExp(`(?:^|\\n|,|\\s)\\.${name}[\\s,:{]`).test(css);
    expect.soft(hasRule('bs-player__row'), 'the matcher is not vacuous').toBe(true);
    expect.soft(hasRule('bs-player__typo-that-does-not-exist')).toBe(false);
    // The hint's reserved line is a PROPERTY of the rule, not just of the class existing:
    // the row above asserts the empty `<p>` is rendered, and this is the half that says
    // rendering it reserves space. Read from the stylesheet TEXT, because a linked
    // stylesheet contributes nothing to jsdom's computed styles.
    expect
      .soft(/\.bs-player__hint\s*\{[^}]*min-height\s*:/.test(css), 'the hint holds a line open')
      .toBe(true);

    svc.getSubtitles.mockResolvedValue(listOf([track(), track({ index: 11, format: 'ssa', convertible: false, reason: 'unsupported-format', label: 'Thai' })]));
    await openPicker();
    const used = new Set<string>();
    for (const el of band()!.querySelectorAll('*')) {
      for (const name of el.classList) if (name.startsWith('bs-')) used.add(name);
    }
    expect.soft(used.size, 'the picker renders bs- classes at all').toBeGreaterThan(3);
    const missing = [...used].filter((n) => !hasRule(n)).sort();
    expect(missing, `no rule for ${missing.join(', ')}`).toEqual([]);
  });
});

// ===================================================================================
// 7. Off, the empty picker, and the one thing the choice is for
// ===================================================================================

describe('Off and the empty picker', () => {
  it('is one always-focused cell with the reason as its hint, in all three empty states', async () => {
    // `Off` IS WHAT MAKES THE SCREEN SAFE: `pickerRowCounts` is `entries + 1`, so no
    // reachable state of this picker leaves nothing focused. The three sentences are kept
    // apart for the reason the backend keeps `none` and `unknown` apart — "this release ships
    // nothing" and "the box cannot see this download's files" are different facts, and
    // collapsing them would make the television say one sentence about two situations.
    const arms: Array<[string, () => void, RegExp]> = [
      [
        'the list has not answered',
        () => {
          svc.getSubtitles.mockReturnValue(new Promise<SubtitleList>(() => {}));
        },
        /Still checking/,
      ],
      [
        'a live torrent that ships no sidecar',
        () => {
          svc.getSubtitles.mockResolvedValue(listOf([], 'none'));
        },
        /ships no subtitle files/,
      ],
      [
        'no live handle to enumerate',
        () => {
          svc.getSubtitles.mockResolvedValue(listOf([], 'unknown'));
        },
        /cannot see this download/,
      ],
      [
        'a read that failed outright',
        () => {
          svc.getSubtitles.mockRejectedValue(httpError(503));
        },
        /cannot see this download/,
      ],
    ];
    for (const [name, arrange, sentence] of arms) {
      arrange();
      const view = await openPicker();
      expect.soft(pickerCells(), `${name}: one cell`).toHaveLength(1);
      expect.soft(pickerCells()[0]?.textContent, `${name}: and it is Off`).toBe('Off');
      expect.soft(ring(), `${name}: exactly one ring`).toHaveLength(1);
      expect.soft(ring()[0], `${name}: on the focused cell`).toBe(document.activeElement);
      expect.soft(pickerHint(), `${name}: with the reason`).toMatch(sentence);
      // OFF IS THE CURRENT CHOICE WHEN NOTHING IS CHOSEN, and it wears the dress that says
      // so. Pinned here because the only other dress assertion in this file is taken AFTER
      // a language has been chosen, so `cell !== 0 && cell === currentCell` — Off never
      // primary, i.e. the picker opening with no cell marked as current — was GREEN on all
      // 19 rows and on all 1518 in `test:tv`. The viewer who has subtitles off sees this
      // state on every open.
      expect.soft(pickerCells()[0]?.className, `${name}: Off is the current choice`).toBe('bs-btn');
      // STILL NOT IN THE BAND'S MESSAGE LINE, which is what `mayHide` reads.
      expect.soft(statusLines(), `${name}: and not in the message line`).toEqual([]);
      view.unmount();
    }
  });

  it('mounts the chosen track, and Off takes it away again', async () => {
    // THE GAP TASK 13 NAMED AND COULD NOT CLOSE: nothing on this surface could CHOOSE a
    // sidecar, so `page.track.test.tsx` could only prove the element's absence. The picker is
    // the chooser, so this is the first row anywhere that sees the route's `<track>` actually
    // mounted — and the src is built from the TORRENT's own file index (9), never from the
    // row's position in the list (0) or from the video it paired to (4).
    svc.getSubtitles.mockResolvedValue(listOf([track({ ready: true })]));
    await openPicker();
    await clickOn(cell('English'));
    expect.soft(trackEls(), 'exactly one track').toHaveLength(1);
    expect.soft(trackEls()[0].getAttribute('src')).toBe(`/api/v1/streaming/${PACK}/subtitles/9`);
    expect.soft(trackEls()[0].getAttribute('srclang')).toBe('en');
    expect.soft(cell('Subtitles').getAttribute('data-subtitles')).toBe('on');

    await clickOn(cell('Subtitles'));
    expect.soft(document.activeElement, 'reopening lands on the chosen row').toBe(cell('English'));
    // WHICH TRACK IS SHOWING IS NOT THE SAME SIGNAL AS WHICH CELL IS FOCUSED. The ring is
    // the navigation model; the primary dress says what is on. Asserted because the
    // component claims it in a comment, and a claim nothing can falsify is the shape this
    // branch keeps finding — dressing every cell the same left every other row here green.
    expect.soft(cell('English').className, 'and wears the primary dress').toBe('bs-btn');
    expect.soft(cell('Off').className, 'while Off does not').toBe('bs-btn bs-btn--ghost');
    await clickOn(cell('Off'));
    expect.soft(trackEls(), 'Off renders no track').toHaveLength(0);
    expect.soft(cell('Subtitles').getAttribute('data-subtitles')).toBe('off');
  });

  it('clears a stale element fault when a new entry is chosen', async () => {
    // `trackFault` OUTRANKS READINESS in `chosenCellState`, so a fault left standing across a
    // choice would make the cell say `unreadable` about a track that has not been asked to
    // load yet. Reachable in one sitting: a failing sidecar, then a different one.
    svc.getSubtitles.mockResolvedValue(
      listOf([track({ ready: true }), track({ index: 11, label: 'Dutch', lang: 'nl', ready: true })]),
    );
    await openPicker();
    await clickOn(cell('English'));
    await act(async () => {
      // NON-BUBBLING, which is RTL's own default for `error`: a bubbling one would also reach
      // the `<video>`'s `onError` and run the stream-recovery ladder for a subtitle fault.
      trackEls()[0].dispatchEvent(new Event('error', { bubbles: false }));
    });
    expect(cell('Subtitles').getAttribute('data-subtitles'), 'the element failed').toBe(
      'unreadable',
    );
    await clickOn(cell('Subtitles'));
    await clickOn(cell('Dutch'));
    expect.soft(cell('Subtitles').getAttribute('data-subtitles'), 'a new choice is not a fault').toBe(
      'on',
    );
  });
});
