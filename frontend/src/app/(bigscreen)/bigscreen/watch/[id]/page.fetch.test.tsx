/**
 * THE WIRE: the press that chooses a sidecar is the press that asks the box for its bytes.
 *
 * WHY THIS FILE EXISTS, AND IT IS NOT A STYLE CHOICE. `fetchSubtitle` (the service's POST) and
 * `pollSubtitles` (the bounded read loop) shipped TESTED AND UNCALLED. The service had the
 * admission, `_data/subtitles.ts` had the poll, the transport cell had a word for the wait and
 * `SubtitleTrackElement` had a mount gate — four correct components, each with its own suite,
 * each separately reviewed, and nothing anywhere connected them. So choosing any sidecar whose
 * bytes were not already on disk set the cell to `fetching` and then did nothing, for the rest
 * of the film; `SUBTITLE_CELL_LABELS.fetching`'s own comment ("Chosen, admitted, and the bytes
 * are not here yet") named an admission that never happened. Sixteen adversarial per-task
 * reviews passed that, because every one of them asked "did this task touch anything it did
 * not name" and the defect was a thing no task touched (plan correction C7).
 *
 * SO THE ROWS HERE ARE JOURNEYS, NOT UNITS. Each one presses a real picker cell on a rendered
 * route and then asks what the box was told and what the screen says. The units are already
 * covered — `_data/subtitles.test.ts` for the poll's seven outcomes and the cell's nine words,
 * `services/streaming.subtitles.test.ts` for the 401 opt-out against the real interceptors,
 * `page.subtitles.test.tsx` for the picker's own grid — and none of them could see the seam.
 *
 * FOUR HARNESS FACTS, INHERITED FROM `page.subtitles.test.tsx` WITH ITS REASONS:
 *
 *  - A PRESS IS FIRED AT `document.activeElement`, never at `window`, which sits above the
 *    React root container.
 *  - OK IS A CLICK, not `Enter`: the television turns OK into a native click and jsdom
 *    implements no such default action. `fireEvent.click` fires no focus event.
 *  - ONE `act()` PER SLICE when advancing timers; React commits queued updates when `act()`
 *    exits, so one long advance cannot observe a re-render.
 *  - MOUNTED WITHOUT METADATA, so `scrubRowCount` is 0 and the transport row is the only row —
 *    the television's normal state, and the shape `firstTarget` answers Play/Pause in.
 *
 * THREE NUMBERS THAT MUST NOT BE EQUAL, and the fixture is built so they are not: the VIDEO
 * file index being watched (4), the chosen sidecar's own libtorrent file index (11), and that
 * sidecar's POSITION in the list (1). The POST and the poll take the sidecar's index, the list
 * read takes the video's, and a fixture where any two of the three agreed could not tell a
 * correct build from a swapped one.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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
import { SUBTITLE_POLL_ATTEMPTS, SUBTITLE_POLL_MS, cellLabel } from '../../../_data/subtitles';
import { REVEAL_HIDE_MS } from '../../../_focus/useRevealOnKey';
import { transportCellCount } from '../../../_player/TransportBar';
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
    fetchSubtitle: vi.fn(),
  },
}));
vi.mock('@/services/torrents', () => ({
  torrentsService: { getTorrentStatus: vi.fn(), listTorrents: vi.fn(), downloadCatalogMovie: vi.fn() },
}));
vi.mock('../../../_data/useTvProfile', () => ({ useTvProfile: vi.fn() }));

const svc = vi.mocked(streamingService);
const torrents = vi.mocked(torrentsService);
const profileHook = vi.mocked(useTvProfile);

// --- fixtures ----------------------------------------------------------------------

const PACK = 'pk';
const FILE_SIZE = 2_000_000_000;
/** The video file index on screen. The list read's second argument, and nothing else. */
const VIDEO = 4;
/** The chosen sidecar's own libtorrent file index. The POST's path, and the poll's wait. */
const SIDECAR = 11;
/** Its position in the list. Here so a position-built call is visibly not the index. */
const SIDECAR_POSITION = 1;

const statusRow = (over: Record<string, unknown> = {}): TorrentStatus =>
  ({
    id: PACK,
    movie_title: 'Show 1399 S02',
    // 1080p, so the arrival disclosure says NOTHING: it speaks only for a bucket this
    // television never asks for. That is what lets the auto-hide row below read `message`.
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

/** Season/episode sorted, as the backend sends it: the file that plays is index 4. */
const FILES = [file(VIDEO, 1), file(0, 2), file(7, 3)];

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
    file_index: VIDEO,
    video_file: {
      name: 'show.s02e01.mkv',
      size: FILE_SIZE,
      downloaded: FILE_SIZE / 2,
      progress: 50,
      mime_type: 'video/x-matroska',
      stream_url: `/api/v1/streaming/${PACK}/video`,
      contiguous: null,
    },
  }) as unknown as StreamingInfo;

const track = (over: Partial<SubtitleTrack> = {}): SubtitleTrack => ({
  index: 9,
  video_index: VIDEO,
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

/** The chosen one. Index 11, position 1, paired to video 4 — three different numbers. */
const spanish = (over: Partial<SubtitleTrack> = {}): SubtitleTrack =>
  track({ index: SIDECAR, lang: 'es', label: 'Spanish', url: `/api/v1/streaming/${PACK}/subtitles/${SIDECAR}`, ...over });

const listOf = (
  subtitles: SubtitleTrack[],
  coverage: SubtitleCoverage = 'listed',
): SubtitleList => ({
  torrent_id: PACK,
  state: 'downloading',
  coverage,
  source: coverage === 'unknown' ? null : 'session',
  paired_to: VIDEO,
  subtitles,
});

/** Both entries unready, Spanish second — the normal first answer for every sidecar (D1). */
const UNREADY = listOf([track(), spanish()]);
/** The same list after the admission's flush landed on the chosen one only. */
const SPANISH_READY = listOf([track(), spanish({ ready: true })]);

const httpError = (status: number, data: Record<string, unknown> = {}) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

const ADMITTED = { admitted: 2, budget_ms: 45_000 };

// --- DOM helpers -------------------------------------------------------------------

const ring = () => Array.from(document.querySelectorAll('[tabindex="0"]'));
const band = () => document.querySelector('.bs-player__bar') as HTMLElement | null;
const hidden = () => !!band()?.classList.contains('bs-player__bar--hidden');
const cell = (name: string | RegExp) => screen.getByRole('button', { name });
const transportRow = () => screen.queryByRole('group', { name: 'Playback controls' });
const transportButtons = () => [...(transportRow()?.querySelectorAll('button') ?? [])];
const trackEls = () => [...document.querySelectorAll('track')];
const subCell = () => cell('Subtitles');
const subState = () => subCell().getAttribute('data-subtitles');
const subNote = () => subCell().querySelector('.bs-player__commit')?.textContent;
/** The BAND's `role="status"` line — the route's `message`, which `mayHide` reads. */
const statusLines = () =>
  Array.from(band()?.querySelectorAll('[role="status"]') ?? []).map((el) => el.textContent ?? '');
/** The picker's own hint: a `.bs-player__hint` with NO role. */
const pickerHint = () =>
  Array.from(document.querySelectorAll('.bs-player__hint'))
    .filter((el) => !el.hasAttribute('role'))
    .map((el) => el.textContent ?? '')
    .join('|');
const pickerCells = () => [...(band()?.querySelectorAll('.bs-player__row button') ?? [])];

/** Every argument list `getSubtitles` has been called with, newest last. */
const reads = () => svc.getSubtitles.mock.calls;
/** Every argument list the admission POST has been called with. */
const posts = () => svc.fetchSubtitle.mock.calls;

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  sessionStorage.clear();
  localStorage.clear();
  nav.params.current = { id: PACK };
  nav.search.current = new URLSearchParams();
  Element.prototype.scrollIntoView = vi.fn();
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
  svc.getSubtitles.mockResolvedValue(UNREADY);
  svc.fetchSubtitle.mockResolvedValue(ADMITTED);
});

afterEach(async () => {
  // In an ASYNC act, before testing-library's cleanup: draining a pending poll wait starts a
  // read whose promise settles a turn later, outside any act() unless awaited.
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
 * The belt both sibling suites carry, for the recorded reason: `mount()` resolves after a
 * fixed number of MICROTASK flushes while the grid places the ring in a PASSIVE effect React
 * schedules as a MACROTASK, so no number of `await act(async () => {})` guarantees it has run.
 * It WAITS; it does not assert. NOT `waitFor`, which under fake timers polls a clock nothing
 * advances and dies at its own limit instead of failing with the assertion.
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

/** Mount, walk the ring to the Subtitles cell, and press it. */
async function openPicker() {
  const view = await mount();
  await untilRingOn(/Pause/);
  for (let i = 0; i < 4; i++) right();
  const sub = subCell();
  expect(document.activeElement, 'the walk ended on the Subtitles cell').toBe(sub);
  await clickOn(sub);
  return view;
}

/** Open the picker and press one row by its label. */
async function choose(label: string | RegExp) {
  const view = await openPicker();
  await clickOn(cell(label));
  return view;
}

/** A `getSubtitles` whose every answer is settled by hand, in any order the row wants. */
function deferredReads() {
  const pending: Array<{ index: number | undefined; settle: (list: SubtitleList) => void }> = [];
  svc.getSubtitles.mockImplementation(
    (_torrentId: string, index?: number) =>
      new Promise<SubtitleList>((resolve) => {
        pending.push({ index, settle: resolve });
      }),
  );
  return pending;
}

// ===================================================================================
// 1. The journey the stage never had
// ===================================================================================

describe('choosing an unready sidecar', () => {
  it('posts once, polls, and mounts the <track> when a later list says ready', async () => {
    // THE ROW C7 EXISTS FOR, end to end, through the screen. Before the wire, everything
    // after the first assertion was unreachable: the cell said `fetching` and the box was
    // never told anything.
    await choose('Spanish');

    // ONE POST, WITH THE SIDECAR'S OWN FILE INDEX AND THE 401 OPT-OUT, pinned as a whole
    // call list rather than `toHaveBeenCalledWith`: "called with" is satisfied by a build
    // that also posts three more times, and a re-POST per poll tick re-deadlines libtorrent's
    // pieces against a 45 s budget that is shared with the playhead.
    expect.soft(posts(), 'exactly one admission, for file 11').toEqual([
      [PACK, SIDECAR, { allow401: true }],
    ]);
    // NOT THE POSITION (1) AND NOT THE VIDEO (4). Said as two negatives as well, because the
    // equality above would also be satisfied by a fixture where the three numbers agreed —
    // and this is the one assertion that says they must not.
    expect.soft(SIDECAR).not.toBe(SIDECAR_POSITION);
    expect.soft(SIDECAR).not.toBe(VIDEO);

    // THE PICKER CLOSED ON THE PRESS AND THE RING CAME BACK TO THE CELL, with the fetch still
    // in flight: the fetch is reported on the cell, never by holding the menu open.
    expect.soft(transportRow(), 'the picker closed').not.toBeNull();
    expect.soft(document.activeElement, 'and the ring is back on the cell').toBe(subCell());
    expect.soft(ring(), 'exactly one cell holds it').toHaveLength(1);
    // THE DECLARED COUNT STILL EQUALS THE CELLS RENDERED while a fetch is in flight — the
    // house invariant, asserted in the one state this task adds.
    expect.soft(transportButtons()).toHaveLength(transportCellCount({ retry: false }));

    // THE CELL SAYS IT IS WAITING, AND NOTHING IS MOUNTED YET: the element's own gate is
    // `ready`, and a `<track>` spends its one and only load on whatever is at that URL.
    expect.soft(subState(), 'the cell is waiting').toBe('fetching');
    expect.soft(subNote()).toBe(cellLabel('fetching'));
    expect.soft(trackEls(), 'nothing is mounted on an unready sidecar').toHaveLength(0);

    // AND THE POLL IS RUNNING, against the VIDEO file index: the list the television wants is
    // the one filtered to the episode on screen. Call 0 is the route's own arrival read.
    expect.soft(reads().length, 'the poll issued its first read').toBe(2);
    expect.soft(reads()[1], 'with the video index, not the sidecar one').toEqual([
      PACK,
      VIDEO,
      { allow401: true },
    ]);

    // THE BYTES LAND. The next answer reports the CHOSEN entry ready — and only it, so a
    // build that read readiness off a sibling or off the whole envelope cannot pass.
    svc.getSubtitles.mockResolvedValue(SPANISH_READY);
    await tick(SUBTITLE_POLL_MS + 50);

    expect.soft(reads().length, 'the poll read again').toBe(3);
    expect.soft(posts(), 'and did not re-admit').toHaveLength(1);
    expect.soft(subState(), 'the cell flips to on').toBe('on');
    const mounted = trackEls();
    expect.soft(mounted, 'exactly one track').toHaveLength(1);
    // THE SRC IS BUILT FROM THE TORRENT'S OWN FILE INDEX. A position-built URL (0 or 1) and a
    // video-built one (4) are both valid-looking strings that load another file.
    expect
      .soft(mounted[0]?.getAttribute('src'), 'from the sidecar’s own index')
      .toBe(`/api/v1/streaming/${PACK}/subtitles/${SIDECAR}`);
    expect.soft(mounted[0]?.getAttribute('srclang')).toBe('es');
    expect.soft(mounted[0]?.parentElement?.tagName.toLowerCase(), 'inside the media element').toBe(
      'video',
    );
  });

  it('opts every one of its calls out of the 401 redirect', async () => {
    // WHAT THIS ROW DOES NOT CLAIM: the service is mocked here, so `allow401` is asserted as
    // an ARGUMENT. The arm that proves the flag actually suppresses the hard navigation runs
    // the real interceptors with a swapped adapter — `services/streaming.subtitles.test.ts`.
    // A mid-film 401 that hard-navigates to `/bigscreen/pair` from inside the interceptor's
    // own rejection handler, behind a module-scoped flag it never resets, is what the opt-out
    // exists to prevent: a subtitle is never worth a film.
    await choose('Spanish');
    await tick(SUBTITLE_POLL_MS + 50);
    await tick(SUBTITLE_POLL_MS + 50);

    expect.soft(reads().length, 'the route’s read plus three polled ones').toBe(4);
    // EVERY call, the arrival read included, and asserted per call rather than with an
    // `every(...)`: an empty list satisfies `every` and the poll's reads are the ones this
    // task adds.
    for (const [i, call] of reads().entries()) {
      expect.soft(call[2], `read ${i}`).toEqual({ allow401: true });
    }
    expect.soft(posts()[0]?.[2], 'and the POST').toEqual({ allow401: true });
  });
});

// ===================================================================================
// 2. The presses that send nothing
// ===================================================================================

describe('the presses that must not ask the box for anything', () => {
  it('asks for nothing at all until a press asks, and polls nothing either', async () => {
    // THE OTHER HALF OF "A HANDLER, NOT AN EFFECT", and the half an effect-shaped
    // implementation passes every other row with: admitting the first offerable entry on
    // arrival would mount a track nobody chose, spend the box's shared admission budget on a
    // language the viewer does not read, and — on a pack with a twenty-language `Subs/` tree
    // — do it per episode switch. Nothing on this screen may talk to the box about subtitles
    // before OK is pressed on a row.
    await mount();
    await untilRingOn(/Pause/);
    await tick(SUBTITLE_POLL_MS * 3 + 50, 8);

    expect.soft(posts(), 'no admission without a press').toEqual([]);
    // AND NO POLL: the list is read ONCE per (title, file). A poll with nothing chosen has
    // nothing to wait for and would re-enumerate the torrent's files every two seconds for
    // the length of the film.
    expect.soft(reads().length, 'one list read, and no poll behind it').toBe(1);
    expect.soft(subState(), 'and the cell says what the list alone means').toBe('off');
  });

  it('sends nothing for an entry that is already ready, and never polls for one', async () => {
    // ADMISSION RE-DEADLINES PIECES against a budget shared with the playhead (D4), so for a
    // file already complete on disk a POST is a cost with no benefit. The track mounts from
    // the list the route already had.
    svc.getSubtitles.mockResolvedValue(SPANISH_READY);
    await choose('Spanish');

    expect.soft(posts(), 'no admission for bytes already on disk').toEqual([]);
    expect.soft(subState(), 'and the cell is simply on').toBe('on');
    expect.soft(trackEls(), 'with its track mounted').toHaveLength(1);

    // AND NO POLL EITHER: nothing to wait for. Advanced well past a tick, so "no poll" is a
    // measurement rather than a race.
    await tick(SUBTITLE_POLL_MS * 2 + 50, 8);
    expect.soft(reads().length, 'the arrival read and nothing more').toBe(1);
  });

  it('sends nothing for Off, and Off stops the poll the last press started', async () => {
    const view = await choose('Spanish');
    expect.soft(posts(), 'the first press did post').toHaveLength(1);
    expect.soft(reads().length).toBe(2);

    await clickOn(subCell());
    await clickOn(cell('Off'));

    expect.soft(posts(), 'Off asked for nothing').toHaveLength(1);
    expect.soft(subState(), 'and the cell is off').toBe('off');
    expect.soft(trackEls(), 'with no track').toHaveLength(0);

    // THE POLL IS THE PART THAT IS EASY TO LEAVE RUNNING. Five intervals, so an uncancelled
    // poll would be five reads further on; the instrument is the read count going still, not
    // a rendered word — the word is `off` either way.
    await tick(SUBTITLE_POLL_MS * 5 + 50, 12);
    expect.soft(reads().length, 'the poll stopped where Off was pressed').toBe(2);
    view.unmount();
  });

  it('a second choice stops the first poll instead of running two', async () => {
    // TWO POLLS AGAINST ONE BOX is the failure this counts: on a pack they are two different
    // episodes' lists racing to write one state, and the newest press is the one the viewer
    // is watching. The arithmetic is the whole instrument —
    //   1 arrival read
    // + 1 first read for English's poll, + 1 for Spanish's (both at the press, no advance)
    // + 2 more for Spanish alone across two intervals
    // = 5. With the first poll left running it is 7, and both builds say `fetching`.
    await choose('English');
    await clickOn(subCell());
    await clickOn(cell('Spanish'));
    expect.soft(reads().length, 'one first read per press').toBe(3);
    expect.soft(posts().map((c) => c[1]), 'and one admission per press').toEqual([9, SIDECAR]);

    await tick(SUBTITLE_POLL_MS + 50);
    await tick(SUBTITLE_POLL_MS + 50);
    expect.soft(reads().length, 'only the live poll kept reading').toBe(5);
    // AND THE DEAD POLL DOES NOT SPEAK FOR THE LIVE CHOICE. The first poll ends `cancelled`,
    // which is NOT a verdict — the press that cancelled it has already written its own state.
    // Not prescribed: a build that set the verdict for every outcome the poll returns would
    // keep the read count above and say `not arriving` about the sidecar now being fetched.
    expect.soft(subState(), 'the cancelled poll reported nothing').toBe('fetching');
  });
});

// ===================================================================================
// 3. The second async writer into one piece of state
// ===================================================================================

describe('a poll that outlives its episode', () => {
  it('never lets the previous episode’s answer land on the new episode’s screen', async () => {
    // THE CLASS TASK 12'S REVIEW FIXED TWICE IN THE READ EFFECT, now in a second writer: a
    // poll lives up to 48 s, a season pack's episodes share one torrent, and the list is
    // filtered per episode — so the old episode's answer arriving AFTER the new one's would
    // put ANOTHER EPISODE'S sidecars on screen, with `ready` among them.
    //
    // THE ORDER IS THE POINT: A's answer is settled LAST. Settled first, nothing could tell a
    // generation guard from the read effect's own `cancelled` flag.
    const pending = deferredReads();
    const view = await mount();
    expect.soft(pending[0]?.index, 'the arrival read is for episode 1').toBe(VIDEO);
    await act(async () => {
      pending[0]?.settle(UNREADY);
    });
    await untilRingOn(/Pause/);
    for (let i = 0; i < 4; i++) right();
    await clickOn(subCell());
    await clickOn(cell('Spanish'));
    // Episode 1's poll has a read in flight, deliberately unsettled.
    expect.soft(pending.length, 'the poll’s read is in flight').toBe(2);

    // THE EPISODE CHANGES with no new arrival — `?file=` moves when the show screen pushes a
    // new watch URL for the same torrent.
    nav.search.current = new URLSearchParams('file=7');
    await act(async () => {
      view.rerender(<WatchPage />);
    });
    for (let i = 0; i < 4; i++) await act(async () => {});
    expect.soft(pending[2]?.index, 'episode 3 is read on its own index').toBe(7);

    // Episode 3 answers: this release ships nothing.
    await act(async () => {
      pending[2]?.settle(listOf([], 'none'));
    });
    expect.soft(subState(), 'the new episode’s own answer').toBe('none');

    // AND NOW EPISODE 1'S POLL ANSWERS, LATE, with its chosen sidecar ready.
    await act(async () => {
      pending[1]?.settle(SPANISH_READY);
    });

    expect.soft(subState(), 'the stale answer was dropped').toBe('none');
    expect.soft(trackEls(), 'and nothing mounted from it').toHaveLength(0);
    // THE PICKER IS THE SECOND WITNESS, and the more visible one: a stale write puts episode
    // 1's two languages into episode 3's menu.
    await clickOn(subCell());
    expect.soft(pickerCells().map((b) => b.textContent), 'Off alone').toEqual(['Off']);
    expect.soft(pickerHint(), 'with the new episode’s reason').toMatch(/ships no subtitle files/);
    view.unmount();
  });
});

// ===================================================================================
// 4. The four ways a fetch ends with no bytes
// ===================================================================================

describe('when the bytes do not come', () => {
  it('says `not arriving` once the poll has given up', async () => {
    // THE FULL BUDGET: 25 reads, 24 waits of 2 s = 48 s, one tick past the backend's own 45 s
    // admission budget. Before the ninth state existed this screen said `fetching` for the
    // rest of the film about a box that had already retracted.
    await choose('Spanish');
    for (let i = 0; i < SUBTITLE_POLL_ATTEMPTS; i++) await tick(SUBTITLE_POLL_MS);

    expect.soft(reads().length, 'the poll spent its budget').toBe(SUBTITLE_POLL_ATTEMPTS + 1);
    expect.soft(subState(), 'and said so').toBe('notArriving');
    expect.soft(subNote()).toBe(cellLabel('notArriving'));
    expect.soft(trackEls(), 'with nothing mounted').toHaveLength(0);
    // AND IT STOPPED. A poll that kept asking would still be reading after its own budget.
    const spent = reads().length;
    await tick(SUBTITLE_POLL_MS * 3 + 50, 8);
    expect.soft(reads().length, 'and it is not still asking').toBe(spent);
  });

  it('says `not arriving` when a read throws', async () => {
    // A SEPARATE ARM FROM THE ONE ABOVE, because one cannot discriminate the other: a build
    // that mapped only `exhausted` to the verdict leaves this one on `fetching` for ever, and
    // a build that mapped only `error` leaves the other one there. A failed read is not
    // retried — a 404 means the torrent went away and a 5xx will not be fixed by asking 24
    // more times.
    svc.getSubtitles.mockResolvedValueOnce(UNREADY).mockResolvedValueOnce(UNREADY);
    svc.getSubtitles.mockRejectedValue(httpError(503, { detail: 'not ready' }));
    await choose('Spanish');
    expect.soft(subState(), 'waiting, to begin with').toBe('fetching');

    await tick(SUBTITLE_POLL_MS + 50);

    expect.soft(subState(), 'the read threw and the wait is over').toBe('notArriving');
    expect.soft(reads().length, 'and nothing was retried').toBe(3);
  });

  it('says `not arriving` when the box refuses the admission, and does not poll at all', async () => {
    // TWO ARMS, because they arrive differently: a refused gate is a 409 whose body names the
    // gate, and a POST can also simply throw. Neither is worth a sentence of its own on a
    // cell read at three metres — the operator has the backend log, and the viewer's next
    // press is the same for both.
    const arms: Array<[string, unknown]> = [
      ['a refused gate', httpError(409, { reason: 'sidecar-overlaps-wanted-video' })],
      ['a POST that threw', new TypeError('Network request failed')],
    ];
    for (const [name, rejection] of arms) {
      svc.fetchSubtitle.mockRejectedValue(rejection);
      const view = await choose('Spanish');

      expect.soft(posts(), `${name}: it was asked for`).toHaveLength(1);
      expect.soft(subState(), `${name}: and refused`).toBe('notArriving');
      // NO POLL. Twenty-four reads against a box that has just said no is the one thing a
      // refusal must not cost, and the cell's word is the same either way — so the read
      // count is the only instrument.
      await tick(SUBTITLE_POLL_MS * 2 + 50, 8);
      expect.soft(reads().length, `${name}: nothing was polled`).toBe(1);
      view.unmount();
      vi.clearAllMocks();
      svc.getSubtitles.mockResolvedValue(UNREADY);
      svc.getStreamingInfo.mockResolvedValue(infoRow());
      svc.getFiles.mockResolvedValue(FILES);
      svc.getProgressByMovie.mockResolvedValue(null);
      torrents.getTorrentStatus.mockResolvedValue(statusRow());
    }
  });

  it('a second press on the same entry is the retry', async () => {
    // WHY THE POST IS SENT BY A HANDLER AND NOT BY AN EFFECT. An effect keyed on the choice
    // would not re-run for the SAME choice, which is exactly the press someone makes after
    // reading `not arriving` — the entry is still the one they want and the box may have
    // peers now. So the retry has to be the press itself, and the verdict has to be cleared
    // by it or the cell would still be saying the old answer about the new attempt.
    svc.fetchSubtitle.mockRejectedValueOnce(httpError(409, { reason: 'budget-exhausted' }));
    await choose('Spanish');
    expect.soft(subState(), 'the first attempt was refused').toBe('notArriving');

    await clickOn(subCell());
    await clickOn(cell('Spanish'));

    expect.soft(posts(), 'the same entry was asked for again').toEqual([
      [PACK, SIDECAR, { allow401: true }],
      [PACK, SIDECAR, { allow401: true }],
    ]);
    expect.soft(subState(), 'and the cell is waiting again, not still refusing').toBe('fetching');
    // THE PRESCRIBED MUTATION FOR THIS ROW IS A NO-OP AGAINST THIS HANDLER, AND THAT IS
    // MEASURED. "Gate the POST on `choice !== chosenIndex`" is GREEN on all 1543 rows — not
    // because this row is weak, but because the handler never reads `chosenIndex` and so it
    // is not in the callback's dependency list: the gate then compares against the value
    // captured when `subtitleRead` last changed, which on this path is still `null`, and the
    // POST goes out anyway. Adding `chosenIndex` to the deps ALONGSIDE the gate — the
    // faithful version of the same defect — reddens exactly this row and nothing else.
  });

  it('a superseded POST failure never speaks for the new choice', async () => {
    // NOT PRESCRIBED, AND REACHABLE: a POST is in flight for as long as the box takes to
    // answer, so a press on a different entry lands first and the old rejection arrives
    // afterwards. Without the generation check in the POST's own `catch`, the cell then reads
    // `not arriving` about the sidecar the viewer has just chosen — a true sentence about the
    // wrong file, which is the worst kind this stage has.
    let rejectFirst!: (err: unknown) => void;
    svc.fetchSubtitle.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        }),
    );
    await choose('English');
    await clickOn(subCell());
    await clickOn(cell('Spanish'));
    expect.soft(subState(), 'the second choice is waiting').toBe('fetching');

    await act(async () => {
      rejectFirst(httpError(409, { reason: 'sidecar-overlaps-wanted-video' }));
    });

    expect.soft(subState(), 'and the first choice’s refusal stayed with it').toBe('fetching');
  });
});

// ===================================================================================
// 5. What the fetch is NOT allowed to do to the band
// ===================================================================================

describe('the band during a fetch', () => {
  it('still auto-hides, and says nothing about the fetch in its message line', async () => {
    // C7 BULLET 6, AND IT IS THE REASON THE STATE LIVES ON THE CELL. `mayHide` is
    // `message === ''`, so one sentence about a fetch in the band's own line would pin the
    // 480px band over the picture for as long as the fetch runs — up to 48 s, which is the
    // worst instance of exactly what D12 refused. `message === ''` is also what keeps this
    // row discriminating: a build that said something would be refused the hide by the
    // PRE-EXISTING clause and this row would be measuring that instead.
    await choose('Spanish');
    expect.soft(subState(), 'a fetch is in flight').toBe('fetching');
    expect.soft(statusLines(), 'and the band says nothing').toEqual([]);

    await tick(REVEAL_HIDE_MS + 100);

    expect.soft(hidden(), 'the quiet period took the band away as usual').toBe(true);
    expect.soft(statusLines(), 'with nothing said to stop it').toEqual([]);
    // THE CELL IS STILL THE CHANNEL, and it is still in the row the viewer can wake: the hide
    // is paint only, so the counts and the ring are untouched.
    expect.soft(subState(), 'the cell still carries the state').toBe('fetching');
    expect.soft(transportButtons()).toHaveLength(transportCellCount({ retry: false }));
    expect.soft(ring(), 'and the ring is still on a real cell').toHaveLength(1);
  });

  it('a polled answer arriving under an OPEN picker leaves the ring on a real cell', async () => {
    // A REACHABLE STATE THIS TASK CREATES, and nobody asked for it. Before the wire the list
    // changed only when the title or the episode did; now a poll rewrites it every two
    // seconds, and the picker can be open over it — so the grid's shape can change while the
    // ring is inside it. The house invariant is that no reachable state leaves nothing
    // focused, and `useFocusGrid` only re-places the ring when the CLAMPED TARGET changes
    // (`useFocusGrid.ts:300`), so a list that grew or shrank under an open menu is exactly
    // where a ring lands on a cell no element claims — indistinguishable on a television from
    // nothing being focused.
    //
    // NO RESCUE IS ADDED AND NONE IS PRESCRIBED: `clampTarget` already pulls a column into a
    // shorter row. This row is the measurement that says so for the poll's own writes, in
    // both directions — the same answer again, and a shorter one.
    await choose('Spanish');
    await clickOn(subCell());
    const before = document.activeElement;
    expect.soft(pickerCells(), 'Off and two languages').toHaveLength(3);
    expect.soft(pickerCells(), 'the ring is in the picker').toContain(before);

    // ARM 1: another answer of the same shape, still unready — the ordinary poll tick. The
    // route wraps every answer in a fresh `{k:'ok', list}`, so the picker is re-rendered with
    // a new `rows` array whether or not anything in it changed.
    await tick(SUBTITLE_POLL_MS + 50);
    expect.soft(reads().length, 'the poll is still running').toBe(3);
    expect.soft(pickerCells(), 'the menu is still three cells').toHaveLength(3);
    expect.soft(ring(), 'exactly one ring').toHaveLength(1);
    expect.soft(ring()[0], 'and it is the focused element').toBe(document.activeElement);
    expect.soft(pickerCells(), 'which is a cell that exists').toContain(document.activeElement);

    // ARM 2: the answer comes back SHORTER while the menu is open — the lister re-enumerates
    // per read, so a row can go. The chosen entry is still in it, so the poll runs on; what
    // matters is that the grid's declared shape and the ring survive the change under it.
    svc.getSubtitles.mockResolvedValue(listOf([spanish()]));
    await tick(SUBTITLE_POLL_MS + 50);
    expect.soft(pickerCells(), 'the menu shrank with the list').toHaveLength(2);
    expect.soft(ring(), 'still exactly one ring').toHaveLength(1);
    expect.soft(ring()[0]).toBe(document.activeElement);
    expect.soft(pickerCells(), 'on a cell that exists').toContain(document.activeElement);

    // ARM 3: and the bytes land while the menu is STILL open. The element lives in the
    // `<video>`, not in the band, so the track mounts under an open picker — and the ring is
    // still where the viewer left it.
    svc.getSubtitles.mockResolvedValue(listOf([spanish({ ready: true })]));
    await tick(SUBTITLE_POLL_MS + 50);
    expect.soft(trackEls(), 'the track mounted with the picker up').toHaveLength(1);
    expect.soft(ring(), 'and the ring never left the menu').toHaveLength(1);
    expect.soft(pickerCells()).toContain(document.activeElement);
  });

  it('the message line this row reads can be non-empty', async () => {
    // THE POSITIVE CONTROL for `statusLines()`. A `toEqual([])` against a selector broken by
    // a rename would pass for ever; this is the row that fails instead.
    torrents.getTorrentStatus.mockResolvedValue(statusRow({ quality: '720p' }));
    await mount();
    expect(statusLines()).toEqual([
      'Playing the 720p release — lower than this television asked for.',
    ]);
  });
});
