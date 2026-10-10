/**
 * /bigscreen/watch/[id] — the arrival states, the paint-only hide, the Back escalation.
 *
 * WHAT THIS FILE IS FOR. The route is the first and only caller of almost everything stage 7
 * built, so most of what can go wrong here is a composition defect rather than a unit one.
 * The rows below are the ones measured to discriminate; where an obvious assertion turned
 * out not to, the reason is written beside it rather than left as a green test.
 *
 * THREE HARNESS FACTS, EACH OF WHICH COST SOMETHING TO LEARN ELSEWHERE IN THIS SUITE:
 *
 *  - A PRESS IS FIRED AT `document.activeElement`, never at `window`. The house `arrow()`
 *    helper dispatches at `window`, which sits ABOVE the React root container, so no React
 *    `onKeyDown` ever sees it — a scrub-cell test written that way is green about nothing
 *    (`_focus/nestedArrowClaim.test.tsx` pins that asymmetry).
 *  - ONE `act()` PER SLICE when advancing timers. React commits queued updates only when
 *    `act()` exits, so a single long advance cannot observe a re-render and silently makes
 *    an interval's dep-array defect unfalsifiable (task 5 lost a mutation to this).
 *  - jsdom implements no media: `load`/`play`/`pause` are prototype-stubbed, and `duration`
 *    and `currentTime` have to be defined on the element before the scrub row can exist.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { StreamingInfo, StreamingProgress, TorrentStatus, VideoFile } from '@/types';
import { streamingService } from '@/services/streaming';
import { torrentsService } from '@/services/torrents';
import { REVEAL_HIDE_MS } from '../../../_focus/useRevealOnKey';
import { PROGRESS_CADENCE_MS } from '../../../_data/useWatchProgress';
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
  },
}));
vi.mock('@/services/torrents', () => ({
  torrentsService: { getTorrentStatus: vi.fn(), listTorrents: vi.fn() },
}));
vi.mock('../../../_data/useTvProfile', () => ({ useTvProfile: vi.fn() }));

const svc = vi.mocked(streamingService);
const torrents = vi.mocked(torrentsService);
const profileHook = vi.mocked(useTvProfile);
const clear = vi.fn();

// --- fixtures ----------------------------------------------------------------------

const PACK = 'pk';

/** `Record`, not `Partial<TorrentStatus>`: `state` is an enum, so a plain string literal
 *  is not assignable to it and every fixture row would need the enum imported. */
const statusRow = (over: Record<string, unknown> = {}): TorrentStatus =>
  ({
    id: PACK,
    movie_title: 'Show 1399 S02',
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

const FILE_SIZE = 2_000_000_000;

const file = (index: number, episode: number, size = FILE_SIZE): VideoFile => ({
  index,
  name: `show.s02e0${episode}.mkv`,
  size,
  downloaded: size / 2,
  progress: 50,
  mime_type: 'video/x-matroska',
  stream_url: `/api/v1/streaming/${PACK}/video?file_index=${index}`,
  season: 2,
  episode,
});

/** `/files` as the backend sends it: already sorted by season then episode. */
const FILES = [file(4, 1, 1_000_000_000), file(0, 2), file(7, 3)];

const infoRow = (over: Partial<StreamingInfo> = {}): StreamingInfo =>
  ({
    torrent_id: PACK,
    movie_title: 'Show 1399 S02',
    quality: '1080p',
    progress: 42,
    total_progress: 42,
    state: 'downloading',
    content_id: 'tv:1399:s2:e2',
    season: 2,
    episode: 2,
    file_index: 0,
    video_file: {
      name: 'show.s02e02.mkv',
      size: FILE_SIZE,
      downloaded: FILE_SIZE / 2,
      progress: 50,
      mime_type: 'video/x-matroska',
      // Deliberately the BARE url: `/info` appends `?file_index=` only when the CALLER
      // passed one, while the sibling `file_index` reports the RESOLVED index, so trusting
      // this plays one file while the heartbeat records another.
      stream_url: `/api/v1/streaming/${PACK}/video`,
      contiguous: {
        file_index: 0,
        file_size: FILE_SIZE,
        piece_length: 4_194_304,
        run_start: 0,
        run_end: 1_200_000_000,
        complete: false,
        measured_against: 'metadata',
      },
    },
    ...over,
  }) as StreamingInfo;

const progressRow = (over: Partial<StreamingProgress> = {}): StreamingProgress => ({
  id: 'pr1',
  user_id: 'p1',
  torrent_id: PACK,
  movie_id: 'tv:1399:s2:e2',
  current_time: 1200,
  duration: 2400,
  percentage: 50,
  completed: false,
  last_watched_at: '2026-10-01T10:00:00',
  created_at: '2026-10-01T10:00:00',
  updated_at: '2026-10-01T10:00:00',
  file_index: 0,
  title: 'Show 1399 S02E02',
  ...over,
});

const httpError = (status: number, detail?: string) =>
  Object.assign(new Error(`HTTP ${status}`), {
    response: { status, data: detail === undefined ? {} : { detail } },
  });

const NOT_READY = 'Video file not found or not ready for streaming';

/**
 * The route's own re-measure cadence, copied rather than imported: Next validates a page
 * module's exports and rejects anything but its own known fields, so `page.tsx` cannot hand
 * this to its test. The copy is self-pinning in the direction that matters — every row below
 * advances this plus a margin and then asserts the ask HAPPENED, so a page that waited longer
 * than this would go red here.
 */
const INFO_REFRESH_MS = 10_000;

// --- DOM helpers -------------------------------------------------------------------

const ring = () => Array.from(document.querySelectorAll('[tabindex="0"]'));
const video = () => document.querySelector('video') as HTMLVideoElement | null;
const band = () => document.querySelector('.bs-player__bar') as HTMLElement | null;
const hidden = () => !!band()?.classList.contains('bs-player__bar--hidden');
const navCalls = () => [...nav.push.mock.calls, ...nav.replace.mock.calls].map(([to]) => to);
const cell = (name: string | RegExp) => screen.getByRole('button', { name });

/** The device's shape: a keydown at the focused element, bubbling up to `window`. */
function press(init: KeyboardEventInit) {
  const target = document.activeElement ?? document.body;
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

const back = (over: KeyboardEventInit = {}) => press({ key: 'Backspace', ...over });
const right = () => press({ key: 'ArrowRight' });
const down = () => press({ key: 'ArrowDown' });
const up = () => press({ key: 'ArrowUp' });
const ok = () => press({ key: 'Enter' });

/**
 * Make `/info` answer normally until `fail()` is called, then reject with `err`.
 *
 * The periodic re-measure is the one call this route makes REPEATEDLY, so "what a transient
 * failure of it does" is a question only a per-call stub can ask.
 */
function infoThatCanFail(answer = infoRow()) {
  let failing: unknown = null;
  svc.getStreamingInfo.mockImplementation(async () => {
    if (failing) throw failing;
    return answer;
  });
  return {
    fail: (err: unknown) => {
      failing = err;
    },
    heal: () => {
      failing = null;
    },
  };
}

/** One `act()` per slice; see the header. */
async function tick(ms: number, slices = 4) {
  for (let i = 0; i < slices; i++) {
    await act(async () => {
      vi.advanceTimersByTime(Math.ceil(ms / slices));
    });
  }
}

/**
 * Give the element the two properties jsdom leaves unusable, then announce metadata.
 *
 * `at()` reads whatever element is on screen NOW, not the one that was wired: a closure over
 * the original node keeps answering its last value after a remount, which would make every
 * "did the playhead move?" assertion vacuous in exactly the case that matters.
 */
function wire(el: HTMLVideoElement, { duration = 2400 } = {}) {
  let t = 0;
  Object.defineProperty(el, 'currentTime', {
    configurable: true,
    get: () => t,
    set: (v: number) => {
      t = v;
    },
  });
  Object.defineProperty(el, 'duration', { configurable: true, get: () => duration });
  return {
    at: () => (video() === el ? t : (video()?.currentTime ?? Number.NaN)),
    seek: (v: number) => {
      t = v;
    },
  };
}

async function metadata({ duration = 2400 } = {}) {
  const el = video()!;
  const handle = wire(el, { duration });
  await act(async () => {
    fireEvent.loadedMetadata(el);
  });
  return handle;
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
    clear,
  });
  torrents.getTorrentStatus.mockResolvedValue(statusRow());
  svc.getFiles.mockResolvedValue(FILES);
  svc.getStreamingInfo.mockResolvedValue(infoRow());
  svc.getProgressByMovie.mockResolvedValue(null);
  svc.saveProgress.mockResolvedValue(progressRow());
});

afterEach(async () => {
  // In an ASYNC act, and before testing-library's cleanup: vitest unwinds afterEach in
  // reverse registration order, so this runs while the screen is still mounted. Draining the
  // pending `/info` timer starts a request whose promise settles a turn later — outside any
  // act() unless the block itself is awaited.
  await act(async () => {
    vi.runOnlyPendingTimers();
  });
  vi.useRealTimers();
});

/**
 * Mount and settle the arrival. Four flushes, not one: the arrival is a chain (the torrent
 * row and `/files`, then the resume read keyed on the identity they produce, then `/info`
 * anchored on what the resume read said), and each link is a separate microtask turn.
 *
 * No `waitFor`: with vitest's fake timers it polls a clock nothing advances and the test
 * dies at the 5s limit instead of failing with the assertion.
 */
async function mount() {
  const view = render(<WatchPage />);
  for (let i = 0; i < 4; i++) await act(async () => {});
  return view;
}

/** Mount, settle, and announce metadata so the scrub row exists. */
async function playing(opts: { duration?: number } = {}) {
  const view = await mount();
  expect(video(), 'the player mounted').not.toBeNull();
  const handle = await metadata(opts);
  return { view, ...handle };
}

// ===================================================================================
// 1. Arrival
// ===================================================================================

describe('arriving', () => {
  it('plays the file the URL named, and builds the src itself', async () => {
    nav.search.current = new URLSearchParams('file=4');
    await mount();
    const el = video()!;
    expect.soft(el.getAttribute('src')).toBe(`/api/v1/streaming/${PACK}/video?file_index=4`);
    // NEVER `/info`'s own stream_url: it carries `?file_index=` only when the caller passed
    // one, so on the one arrival allowed to be bare the two disagree.
    expect.soft(el.getAttribute('src')).not.toBe(infoRow().video_file.stream_url);
    // `metadata`, not `auto`: a 1080p stream pre-buffered aggressively on TV silicon
    // competes with the decode.
    expect.soft(el.getAttribute('preload')).toBe('metadata');
    // No tabindex on the element itself; the ring belongs to the controls.
    expect.soft(el.hasAttribute('tabindex')).toBe(false);
    // THE RENDER SIDE OF THE STYLESHEET PIN. `playerCss.test.tsx` proves the rule exists;
    // only this proves the route asks for it. Renaming the class to `bs-player__vidoe` left
    // `test:tv` at 55/1319 and `tsc` clean, while on the television the picture stopped being
    // full-bleed behind the band. Same for the scrim and the band itself.
    expect.soft(el.className).toBe('bs-player__video');
    expect.soft(document.querySelector('.bs-player')).not.toBeNull();
    expect.soft(document.querySelector('.bs-player__scrim')).not.toBeNull();
    expect.soft(document.querySelector('.bs-player__bar')).not.toBeNull();
  });

  it('?file=0 reaches the src as file_index=0', async () => {
    // File 0 is the FIRST FILE OF A SEASON PACK. `Number(raw) || undefined` maps it to
    // undefined and the backend then serves max(files, key=size) — every episode plays the
    // same arbitrary file.
    nav.search.current = new URLSearchParams('file=0');
    await mount();
    expect.soft(video()!.getAttribute('src')).toBe(`/api/v1/streaming/${PACK}/video?file_index=0`);
    expect.soft(svc.getStreamingInfo.mock.calls[0][1]).toBe(0);
  });

  it('a bare arrival on a pack re-resolves from /files in season order, not by size', async () => {
    // The `unresolvedEpisode` path: the viewer read the disclosure and chose to proceed.
    // Omitting `file_index` would serve the LARGEST file; taking files[0] takes the lowest
    // season/episode, which is what the backend's own sort puts first. The fixture's first
    // entry is deliberately neither index 0 nor the largest file.
    await mount();
    expect.soft(video()!.getAttribute('src')).toBe(`/api/v1/streaming/${PACK}/video?file_index=4`);
    expect.soft(svc.getStreamingInfo.mock.calls[0][1]).toBe(4);
  });

  it('asks /info with `at` the byte under the INTENDED playhead, not 0', async () => {
    // The playhead lift only rescues "yank backwards": on arrival `currentTime` is 0, so a
    // resume seek measured against a run around byte 0 is still reduced. The request has to
    // be anchored where the viewer is going.
    nav.search.current = new URLSearchParams('file=0');
    svc.getProgressByMovie.mockResolvedValue(progressRow({ current_time: 1200, duration: 2400 }));
    await mount();
    // ONE ask, and it is the anchored one. A `ready` written by an effect rather than
    // derived leaves one commit in which the identity is known but the resume read is not,
    // and the ask made in that commit is anchored at byte 0 — the measurement-at-the-wrong-
    // offset defect itself. Measured: that ask was real before the hook derived readiness.
    expect.soft(svc.getStreamingInfo).toHaveBeenCalledTimes(1);
    const [, index, at] = svc.getStreamingInfo.mock.calls[0];
    expect.soft(index).toBe(0);
    // 1200s of 2400s over a 2 GB file.
    expect.soft(at).toBe(FILE_SIZE / 2);
  });

  it('polls while the torrent is still preparing, and never reads an empty /files as "no episodes"', async () => {
    // `title.ts` puts downloading_metadata, queued, checking, checking_fastresume and
    // allocating all in PREPARING, and `preparing` NAVIGATES — so this is the default
    // arrival, not an edge. `/info` 404s and `/files` answers `200 []`.
    torrents.getTorrentStatus.mockResolvedValue(statusRow({ state: 'downloading_metadata' }));
    svc.getFiles.mockResolvedValue([]);
    svc.getStreamingInfo.mockRejectedValue(httpError(404, NOT_READY));
    await mount();

    expect.soft(video()).toBeNull();
    expect.soft(document.body.textContent).not.toMatch(/no episodes|nothing to play/i);
    expect.soft(ring()).toHaveLength(1);
    expect.soft(ring()[0]).toBe(document.activeElement);
    const asked = svc.getStreamingInfo.mock.calls.length;
    await tick(3200);
    expect.soft(svc.getStreamingInfo.mock.calls.length).toBeGreaterThan(asked);
  });

  it('a finished torrent with an empty /files is evicted-but-playable: it plays, it does not poll', async () => {
    // The regression task 2 handed over: a finished download is streamable again, but
    // `/files` still answers `200 []` after a restart. Read as "not ready" the television's
    // main content polls for ever on a title whose every byte is on disk.
    torrents.getTorrentStatus.mockResolvedValue(statusRow({ state: 'finished', progress: 100 }));
    svc.getFiles.mockResolvedValue([]);
    svc.getStreamingInfo.mockRejectedValue(httpError(404, NOT_READY));
    await mount();

    expect.soft(video()).not.toBeNull();
    const asked = svc.getStreamingInfo.mock.calls.length;
    await tick(4000);
    expect.soft(svc.getStreamingInfo.mock.calls.length).toBe(asked);
  });

  it('a torrent that is gone gets a terminal screen with its own ways out, not a retry', async () => {
    // "Torrent not found" is the ONLY reliable terminal signal: `/info`'s other 404 detail is
    // byte-identical to `_resolve_video_file`'s and conflates "not ready" with "deleted".
    // There is nothing to retry here, so this is not `LoadStatus(failed)`.
    torrents.getTorrentStatus.mockRejectedValue(httpError(404, 'Torrent not found'));
    await mount();
    expect.soft(video()).toBeNull();
    expect.soft(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    const hrefs = Array.from(document.querySelectorAll('[href]')).map((el) => el.getAttribute('href'));
    expect.soft(hrefs).toContain('/bigscreen');
    expect.soft(hrefs.length).toBeGreaterThan(1);
    expect.soft(ring()).toHaveLength(1);
    expect.soft(ring()[0]).toBe(document.activeElement);
  });

  it('a torrent that exists but cannot be played offers a retry', async () => {
    torrents.getTorrentStatus.mockResolvedValue(statusRow({ state: 'paused' }));
    svc.getStreamingInfo.mockRejectedValue(httpError(404, NOT_READY));
    await mount();
    expect.soft(video()).toBeNull();
    expect.soft(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('a 423 forgets the profile and sends the viewer to the picker, with no live Play control', async () => {
    svc.getProgressByMovie.mockRejectedValue(httpError(423));
    clear.mockImplementation(() => {
      profileHook.mockReturnValue({ profile: null, loading: false, select: vi.fn(), clear });
    });
    await mount();
    expect.soft(nav.replace).toHaveBeenCalledWith('/bigscreen/profiles');
    expect.soft(clear).toHaveBeenCalled();
    expect.soft(document.body.textContent).toMatch(/locked/i);
    expect.soft(screen.queryByRole('button', { name: /^Play/ })).toBeNull();
    expect.soft(video()).toBeNull();
  });

  it('every reachable state parks the ring on exactly one rendered cell', async () => {
    // A count one too high parks the model on a cell no element claims, and there is no Tab
    // key to escape with.
    await playing();
    expect.soft(ring()).toHaveLength(1);
    expect.soft(ring()[0]).toBe(document.activeElement);
    // ...and the ring lands on the transport row, not the scrub bar: the scrub row is
    // declared first but renders nothing until `loadedmetadata`.
    expect.soft(ring()[0]?.textContent).toMatch(/Pause|Play/);
  });
});

// ===================================================================================
// 1b. A failed re-measure is not an arrival
// ===================================================================================

describe('a transient /info failure while playing', () => {
  /** Playing, 20 minutes in, with a progress row and one heartbeat already written. */
  async function twentyMinutesIn() {
    nav.search.current = new URLSearchParams('file=0');
    svc.getProgressByMovie.mockResolvedValue(progressRow({ current_time: 1200 }));
    const info = infoThatCanFail();
    const handle = await playing();
    expect(handle.at(), 'the resume landed').toBe(1200);
    await act(async () => {
      fireEvent.timeUpdate(video()!);
    });
    await tick(PROGRESS_CADENCE_MS);
    expect(svc.saveProgress.mock.calls.map(([, p]) => p.current_time)).toEqual([1200]);
    return { ...handle, info };
  }

  it('does not take the picture away, does not rewind it, and does not overwrite the saved row', async () => {
    // THE WHOLE OF C1, as the branch review proved it: one 503 on the 10s re-measure made
    // `playable` false, which — because `downloading` IS a PREPARING state — landed the phase
    // ladder on 'preparing' and UNMOUNTED the player. It remounted seconds later, the fresh
    // one-shot seeked to the ARRIVAL-time resume value (0 on a fresh watch), and the next
    // heartbeat wrote the replayed position over the real one: `[1200]` became `[1200, 6]`.
    const { at, info } = await twentyMinutesIn();
    const el = video();

    info.fail(httpError(503));
    await tick(INFO_REFRESH_MS + 500);

    expect.soft(video(), 'the player is still mounted').not.toBeNull();
    expect.soft(video(), 'and it is the SAME element — no remount').toBe(el);
    expect.soft(document.body.textContent).not.toMatch(/Loading this title/);
    expect.soft(at(), 'the playhead did not move').toBe(1200);

    // And the record is intact: the next write is still where the viewer is.
    await tick(PROGRESS_CADENCE_MS);
    const written = svc.saveProgress.mock.calls.map(([, p]) => p.current_time);
    expect.soft(written.every((t) => t >= 1200)).toBe(true);
    expect.soft(written).not.toContain(0);
  });

  it('keeps the measurement it already has: a failed re-measure is not a measurement of nothing', async () => {
    // The other half of the fix, and the one that isolates it from the latch. A failed
    // REFRESH says nothing about the download, so the last good run still stands — and the
    // run only ever grows, so it is a safe subset of the truth. Dropping it to `null` would
    // read as "nobody measured" and go UNBOUNDED, permitting exactly the seek past the
    // frontier that hangs the stream for 300s with the status code already spent (hazard 9).
    const { seek, at, info } = await twentyMinutesIn();
    info.fail(httpError(500));
    await tick(INFO_REFRESH_MS + 500);

    seek(1400);
    await act(async () => {
      fireEvent.timeUpdate(video()!);
    });
    await act(async () => {
      fireEvent.click(cell('Forward 1 min'));
    });
    // Still the measured ceiling: 1.2 GB of 2 GB over 2400s, less the 15s margin.
    expect(at()).toBe(1425);
  });

  it('asks again on the next tick, and carries on when the box answers', async () => {
    const { info } = await twentyMinutesIn();
    info.fail(httpError(503));
    await tick(INFO_REFRESH_MS + 500);
    const asked = svc.getStreamingInfo.mock.calls.length;
    info.heal();
    await tick(INFO_REFRESH_MS + 500);
    expect.soft(svc.getStreamingInfo.mock.calls.length).toBeGreaterThan(asked);
    expect.soft(video()).not.toBeNull();
  });

  it('a new torrent id starts afresh: the previous title’s playhead does not follow it', async () => {
    // The App Router renders the same component for a different dynamic param, so this
    // screen's state survives a watch -> watch navigation. The live playhead now wins over
    // the arrival-time resume value (so a remount cannot rewind the viewer), which means the
    // playhead MUST be cleared with the arrival or the new title would be seeked to the old
    // one's position — and the heartbeat would then write that under the new title's id.
    const { view, at } = await twentyMinutesIn();
    expect(at()).toBe(1200);

    svc.getProgressByMovie.mockResolvedValue(null);
    nav.params.current = { id: 'other' };
    await act(async () => {
      view.rerender(<WatchPage />);
    });
    for (let i = 0; i < 4; i++) await act(async () => {});
    const next = await metadata();
    expect.soft(video()!.getAttribute('src')).toContain('/other/video');
    expect.soft(next.at(), 'the new title starts at its own beginning').toBe(0);
  });

  it('a torrent that really is gone still takes the player down', async () => {
    // The latch is not a licence to keep playing a deleted file: "Torrent not found" is the
    // one answer `/info` gives that means the torrent itself has gone, and it is terminal.
    const { info } = await twentyMinutesIn();
    info.fail(httpError(404, 'Torrent not found'));
    await tick(INFO_REFRESH_MS + 500);
    expect.soft(video()).toBeNull();
    expect.soft(document.body.textContent).toMatch(/isn’t on the box any more/);
  });
});

// ===================================================================================
// 2. The hide is paint only
// ===================================================================================

describe('the auto-hide', () => {
  /** Walk the ring onto a cell that is NOT the grid's fallback target. */
  async function focusSecondCell() {
    await playing();
    down(); // off the scrub row onto the transport row
    right(); // Pause -> Back 10s: column 1, which `firstTarget` is not
    const el = document.activeElement as HTMLElement;
    expect(el.textContent).toBe('Back 10s');
    return el;
  }

  it('keeps the very same control focused across the hide AND the reveal', async () => {
    // THE headline row, and the two mutations it is measured against land on DIFFERENT
    // halves of it — which is why it is one test with `expect.soft`, not two:
    //  - UNMOUNTING the band (with the counts left constant, so the grid's reconcile effect
    //    never re-runs) drops `document.activeElement` to `<body>`, and nothing brings the
    //    ring back on a surface with no Tab key. Measured: the FIRST half fails, with
    //    `<body>` received.
    //  - `rowCounts: [0]` while hidden does not blur anything, so the first half still
    //    passes: the empty pass writes `NO_TARGET` and the next reconcile clamps to
    //    `firstTarget` — first populated row, column 0 — so the reveal lands on the SCRUB
    //    BAR. Measured: the second half fails, with `.bs-player__scrub` received. With hard
    //    assertions the first failure would end the test and this half would never run.
    //
    // WHAT THIS ASSERTION CANNOT SEE, measured rather than assumed: a `display: none` hide.
    // jsdom does not blur a hidden element — under that mutation `document.activeElement`
    // stayed on the control and all four of these assertions passed. What catches it is the
    // STRUCTURAL test below (the band carries no `display`/`visibility`/`inert`/`hidden`)
    // plus `_player/playerCss.test.tsx`'s rule assertion that `--hidden` sets `opacity: 0`
    // and nothing else. Only a real browser blurs, so only a structural test can defend it.
    const el = await focusSecondCell();
    await tick(REVEAL_HIDE_MS + 100);

    expect.soft(hidden(), 'the band faded').toBe(true);
    expect.soft(document.activeElement).toBe(el);

    right(); // the press that only means "wake up"
    expect.soft(hidden()).toBe(false);
    expect.soft(document.activeElement).toBe(el);
    expect.soft(ring()).toHaveLength(1);
    expect.soft(ring()[0]).toBe(el);
  });

  it('hides nothing but the paint: the band stays mounted and keeps its counts', async () => {
    const el = await focusSecondCell();
    await tick(REVEAL_HIDE_MS + 100);
    const bar = band()!;
    expect.soft(bar).not.toBeNull();
    expect.soft(bar.style.display).toBe('');
    expect.soft(bar.style.visibility).toBe('');
    expect.soft(bar.style.pointerEvents).toBe('');
    expect.soft(bar.hasAttribute('hidden')).toBe(false);
    expect.soft(bar.hasAttribute('inert')).toBe(false);
    // `aria-hidden` while a descendant holds focus is its own defect.
    expect.soft(bar.getAttribute('aria-hidden')).toBeNull();
    expect.soft(bar.contains(el)).toBe(true);
    // The counts are what the reconcile effect watches: unchanged, so it never runs.
    expect.soft(ring()).toHaveLength(1);
  });

  it('a pointer wakes the band too, because the Magic Remote can click what it cannot see', async () => {
    // The gyro cursor clicks through an `opacity: 0` control — and `pointer-events: none` is
    // banned here for the focus reason. So pointer activity has to reveal; `useRevealOnKey`
    // composes with this but only watches keys.
    await focusSecondCell();
    await tick(REVEAL_HIDE_MS + 100);
    expect.soft(hidden()).toBe(true);
    await act(async () => {
      fireEvent.pointerMove(window);
    });
    expect.soft(hidden()).toBe(false);
  });

  it('does not hide while the title is paused', async () => {
    // Paused, the band is the only thing on screen telling the viewer anything.
    await playing();
    await act(async () => {
      fireEvent.click(cell(/Pause/));
      fireEvent.pause(video()!);
    });
    await tick(REVEAL_HIDE_MS * 2);
    expect(hidden()).toBe(false);
  });

  it('does not hide while a seek is pending', async () => {
    await playing();
    // The ring starts on the transport row; walk up onto the scrub cell and open an edit.
    up();
    expect(document.activeElement).toBe(document.querySelector('.bs-player__scrub'));
    right();
    await tick(REVEAL_HIDE_MS * 2);
    expect(hidden()).toBe(false);
  });
});

// ===================================================================================
// 3. Back
// ===================================================================================

describe('Back', () => {
  it('collapses first and leaves second, by replace and never by push', async () => {
    await playing();
    back();
    expect.soft(hidden(), 'the first press put the controls away').toBe(true);
    expect.soft(navCalls()).toEqual([]);

    back();
    expect.soft(nav.replace).toHaveBeenCalledWith('/bigscreen');
    // `replace`, not `push`: a pushed watch URL leaves a dead history entry pointing at a
    // torrent that may be gone by the time the viewer walks back to it.
    expect.soft(nav.push).not.toHaveBeenCalled();
  });

  it('a held Back acts once', async () => {
    // A held key arrives as one press with `repeat: false` and then many with `repeat: true`.
    // Back is an escalation, so a repeating press would walk the viewer through every rung
    // of it — out of the player — in a single hold.
    await playing();
    back();
    back({ repeat: true });
    back({ repeat: true });
    expect.soft(hidden()).toBe(true);
    expect.soft(navCalls()).toEqual([]);
  });

  it('a reveal puts the viewer back at the top rung: the level is derived, never counted', async () => {
    // A counter would be at rung 2 after the first Back, so the press after a reveal would
    // leave the player while the controls were on screen. The level comes from the state the
    // viewer can see.
    await playing();
    back(); // hide
    right(); // reveal
    expect.soft(hidden()).toBe(false);
    back();
    expect.soft(hidden(), 'Back collapsed the band again').toBe(true);
    expect.soft(navCalls()).toEqual([]);
    back();
    expect.soft(navCalls()).toEqual(['/bigscreen']);
  });

  it('cancels a pending seek before it collapses anything', async () => {
    await playing();
    up();
    right();
    const scrub = document.querySelector('.bs-player__scrub') as HTMLElement;
    expect.soft(scrub.textContent).toMatch(/OK jumps to/);

    back();
    expect.soft(scrub.textContent, 'the edit was cancelled').toMatch(/Left or Right chooses a time/);
    expect.soft(hidden(), 'and the band is still up').toBe(false);
    expect.soft(navCalls()).toEqual([]);
    // The ring has not moved off the control the viewer was on.
    expect.soft(document.activeElement).toBe(scrub);
  });

  it('flushes the position before anything navigates', async () => {
    const { view, seek } = await playing();
    seek(900);
    await act(async () => {
      fireEvent.timeUpdate(video()!);
    });
    back();
    back();
    expect.soft(nav.replace).toHaveBeenCalledWith('/bigscreen');
    // The route change fires neither `beforeunload` nor `pagehide`; the unmount is all there
    // is, and the flush must have happened by then.
    view.unmount();
    expect.soft(svc.saveProgress).toHaveBeenCalled();
    expect.soft(svc.saveProgress.mock.calls[0][1].current_time).toBe(900);
  });
});

// ===================================================================================
// 4. The controls
// ===================================================================================

describe('the control surface', () => {
  it('Play/Pause is relabelled, never swapped, and the label follows the EVENT', async () => {
    await playing();
    const el = cell(/Pause/);
    await act(async () => {
      fireEvent.click(el);
    });
    expect.soft(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    // jsdom's `pause()` fires no `pause` event, so the test delivers it — and that is the
    // contract, not a workaround: the label is read from EVENTS and never from
    // `video.paused`, because `load()` (the first thing a recovery does) sets `paused` with
    // no event and a property-derived label would flip to "Play" every time the ladder ran.
    await act(async () => {
      fireEvent.pause(video()!);
    });
    // The SAME element, relabelled: two elements swapped by a condition unmount the control
    // the ring is on, and with the row's count unchanged nothing brings the ring back.
    expect.soft(el.textContent).toBe('Play');
    expect.soft(el).toBe(document.activeElement);
    expect.soft(document.querySelectorAll('.bs-player__row > button').length).toBeGreaterThan(4);
  });

  it('a media key acts once and does what its on-screen twin does', async () => {
    await playing();
    // 19 is VK_PAUSE; nothing about this television's key codes has ever been read, which is
    // why every action has a focusable twin in the transport row.
    press({ key: 'Unidentified', keyCode: 19 });
    expect.soft(window.HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    press({ key: 'Unidentified', keyCode: 19, repeat: true });
    expect.soft(window.HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
  });

  it('the remote’s ▶ does not stop a playing title, and ⏸ does not start a paused one', async () => {
    // Measured before the split: with the title playing, a Play press called `pause()` once.
    // `useMediaKeys` distinguishes three actions and the one consumer collapsed all three
    // onto the toggle. 415 is MediaPlay, 19 is VK_PAUSE.
    await playing();
    press({ key: 'Unidentified', keyCode: 415 });
    expect.soft(window.HTMLMediaElement.prototype.pause, '▶ while playing').not.toHaveBeenCalled();
    press({ key: 'Unidentified', keyCode: 19 });
    expect.soft(window.HTMLMediaElement.prototype.pause, '⏸ while playing').toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.pause(video()!);
    });
    const plays = vi.mocked(window.HTMLMediaElement.prototype.play).mock.calls.length;
    press({ key: 'Unidentified', keyCode: 19 });
    expect.soft(window.HTMLMediaElement.prototype.pause, '⏸ while paused').toHaveBeenCalledTimes(1);
    press({ key: 'Unidentified', keyCode: 415 });
    expect.soft(
      vi.mocked(window.HTMLMediaElement.prototype.play).mock.calls.length,
      '▶ while paused',
    ).toBe(plays + 1);
  });

  it('a forward jump is bounded by the download, not by the press', async () => {
    const { seek } = await playing();
    seek(1400);
    await act(async () => {
      fireEvent.timeUpdate(video()!);
    });
    // The measured run ends at 1.2 GB of 2 GB over 2400s = 1440s, less the 15s margin =
    // 1425. An unbounded +60 would land at 1460, just inside the frontier — which passes
    // `wait_for_first_chunk` (it only answers for the first 1 MiB), sends the 206, and then
    // sits in the mid-stream poll where the hold is 300s per chunk with the status code
    // already spent. That is the hang the margin exists to prevent.
    await act(async () => {
      fireEvent.click(cell('Forward 1 min'));
    });
    expect(video()!.currentTime).toBe(1425);
  });

  it('a stream failure probes with HEAD, says why, and grows a Retry cell at the END of the row', async () => {
    // The 503 path, which is the common TV failure: no peers answers in about two seconds.
    // The probe is HEAD-only and that is load-bearing — every `GET /video` runs
    // `prioritize_video_files` + `force_start_for_stream` (a DB write) and re-deadlines 32
    // pieces at the FILE HEAD, so a ranged "cheap probe" would hijack libtorrent's deadline
    // queue away from the live playhead mid-film.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 503, headers: { 'Retry-After': '2' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await playing();
    const before = screen.getAllByRole('button').length;
    await act(async () => {
      fireEvent.error(video()!);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect.soft(url).toBe(`/api/v1/streaming/${PACK}/video?file_index=4`);
    expect.soft((init as RequestInit).method).toBe('HEAD');
    expect.soft(JSON.stringify(init)).not.toMatch(/range|bytes=/i);
    // Appended LAST, never inserted: the grid refocuses only when the clamped target
    // changes, so a cell inserted at or before the focused column would leave DOM focus on
    // the element that just became column 1 while the model still pointed at column 0.
    const cells = screen.getAllByRole('button');
    expect.soft(cells).toHaveLength(before + 1);
    expect.soft(cells[cells.length - 1].textContent).toBe('Try again');
    expect.soft(ring()).toHaveLength(1);
    expect.soft(ring()[0]).toBe(document.activeElement);
    // A message is up, so the band may not fade out from under it.
    expect.soft(document.body.textContent).toMatch(/trying again/i);
    await tick(REVEAL_HIDE_MS + 100);
    expect.soft(hidden()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('a request the box rejects as nonsense is not retried, and offers no Retry to press', async () => {
    // `badRequest` (422/416) is structurally unreachable from here — the probe is a HEAD with
    // no Range, and `fileIndex`/`streamSrc` guarantee the index is decimal digits or absent —
    // so this is defence in depth. But if it ever fires it must be COHERENT: four retries of
    // a request the server has already rejected as nonsense are four pointless deadline
    // recomputes, and a focusable "Try again" beside a sentence that says to press Stop is
    // two controls one of which the message tells the viewer not to use.
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 422 }));
    vi.stubGlobal('fetch', fetchMock);
    await playing();
    const before = screen.getAllByRole('button').length;
    await act(async () => {
      fireEvent.error(video()!);
    });
    await tick(12_000);
    expect.soft(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect.soft(screen.getAllByRole('button')).toHaveLength(before);
    expect.soft(window.HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
    expect.soft(document.body.textContent).toMatch(/Press Stop/);
    vi.unstubAllGlobals();
  });

  it('Stop flushes and then leaves, rather than navigating from inside the cell', async () => {
    const { seek } = await playing();
    seek(1000);
    await act(async () => {
      fireEvent.timeUpdate(video()!);
    });
    await act(async () => {
      fireEvent.click(cell('Stop'));
    });
    expect.soft(svc.saveProgress).toHaveBeenCalled();
    expect.soft(svc.saveProgress.mock.calls[0][1].current_time).toBe(1000);
    expect.soft(nav.replace).toHaveBeenCalledWith('/bigscreen');
  });
});

// ===================================================================================
// 4b. A recovery, and what it may not do to a seek the viewer made
// ===================================================================================

describe('during a recovery', () => {
  /** Playing, 20 minutes in, with the ladder's first rung about to fire. */
  async function recovering() {
    nav.search.current = new URLSearchParams('file=0');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 503, headers: { 'Retry-After': '2' } })),
    );
    const handle = await playing();
    handle.seek(1200);
    await act(async () => {
      fireEvent.timeUpdate(video()!);
    });
    await act(async () => {
      fireEvent.error(video()!);
    });
    // The 503's Retry-After (2s) wins over the ladder's first rung (1s).
    await tick(2500);
    expect(window.HTMLMediaElement.prototype.load, 'the ladder reloaded').toHaveBeenCalled();
    return handle;
  }

  it('takes the scrub row away and the pending edit with it', async () => {
    // Task 8 wrote `ScrubBar`'s render-phase reset for exactly this, but the premise was
    // false in this composition: the route's `duration` STATE was only written by
    // `onLoadedMetadata`, so `load()` never took it to NaN, the row never went away and the
    // reset never fired. Measured: the cell still read "OK jumps to 20:10" throughout a
    // recovery, and an OK pressed then was silently undone by the engine's playhead restore.
    nav.search.current = new URLSearchParams('file=0');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 503, headers: { 'Retry-After': '2' } })),
    );
    const { seek } = await playing();
    seek(1200);
    await act(async () => {
      fireEvent.timeUpdate(video()!);
    });
    // Open an edit on the scrub cell.
    up();
    right();
    expect.soft(document.querySelector('.bs-player__scrub')?.textContent).toMatch(/OK jumps to/);

    await act(async () => {
      fireEvent.error(video()!);
    });
    await tick(2500);

    // The row is gone, so there is nothing for OK to commit against a duration that no
    // longer exists.
    expect.soft(document.querySelector('.bs-player__scrub'), 'the scrub row went away').toBeNull();

    // And when metadata comes back, so does the row — WITHOUT the edit.
    await metadata();
    const scrub = document.querySelector('.bs-player__scrub');
    expect.soft(scrub, 'the row came back').not.toBeNull();
    expect.soft(scrub?.textContent).toMatch(/Left or Right chooses a time/);
    expect.soft(scrub?.textContent).not.toMatch(/OK jumps to/);
    vi.unstubAllGlobals();
  });

  it('keeps a seek the viewer made, rather than letting the restore undo it', async () => {
    // The engine captures the playhead BEFORE `load()` and restores it on the next
    // `loadedmetadata`. A press in that window is newer than the capture.
    const { at } = await recovering();
    await act(async () => {
      fireEvent.click(cell('Back 10s'));
    });
    expect.soft(at(), 'the press landed').toBe(1190);
    await act(async () => {
      fireEvent.loadedMetadata(video()!);
    });
    expect.soft(at(), 'and the restore did not reverse it').toBe(1190);
    vi.unstubAllGlobals();
  });
});

// ===================================================================================
// 5. Progress
// ===================================================================================

describe('what it records', () => {
  it('writes the id it built, never the s0: one /info is willing to answer', async () => {
    // `resolve_content_id`'s last resort mints `tv:{tmdb}:s0:e{file_index}`: it parses
    // cleanly, matches nothing the detail screens build, and draws as "S00 · E04".
    nav.search.current = new URLSearchParams('file=0');
    svc.getStreamingInfo.mockResolvedValue(infoRow({ content_id: 'tv:1399:s0:e0', season: 0, episode: 0 }));
    const { seek } = await playing();
    seek(600);
    await act(async () => {
      fireEvent.timeUpdate(video()!);
    });
    await act(async () => {
      fireEvent.click(cell('Stop'));
    });
    const payload = svc.saveProgress.mock.calls[0][1];
    expect.soft(payload.movie_id).toBe('tv:1399:s2:e2');
    expect.soft(payload.movie_id).not.toContain(':s0:');
    expect.soft(payload.title).toBe('Show 1399 S02E02');
    expect.soft(payload.file_index).toBe(0);
  });

  it('seeks to the resume position once metadata lands, with no question asked', async () => {
    nav.search.current = new URLSearchParams('file=0');
    svc.getProgressByMovie.mockResolvedValue(progressRow({ current_time: 1200 }));
    const { at } = await playing();
    expect.soft(at()).toBe(1200);
    // And the resume read is by content id. `getProgressByTorrent` filters on torrent + user
    // only, so on a pack it answers episode 3's timestamp for episode 5.
    expect.soft(svc.getProgressByMovie).toHaveBeenCalledWith('p1', 'tv:1399:s2:e2');
    expect.soft(svc.getProgressByTorrent).not.toHaveBeenCalled();
  });

  it('a resume the download has not reached is reduced, and the reduction is on screen', async () => {
    nav.search.current = new URLSearchParams('file=0');
    svc.getProgressByMovie.mockResolvedValue(progressRow({ current_time: 2000 }));
    const { at, seek } = await playing();
    // The run ends at 1.2 GB of 2 GB over 2400s = 1440s, less the margin = 1425. Seeking to
    // the asked 2000 would put the playhead past the download frontier and hang the stream
    // where no status code is left to say so.
    expect.soft(at()).toBe(1425);
    // AND IT IS A SENTENCE, NOT A SILENCE. Asserted against the note itself, not against the
    // body text: `/23:45/` alone was satisfied by the scrub cell's own readout ("23:45 of
    // 40:00"), so the whole `setResumeNote` block could be deleted with the suite still green
    // — the eighth test on this branch that could not fail.
    const note = screen.getByText(/^Carrying on from/);
    expect.soft(note.className).toBe('bs-player__hint');
    expect.soft(note.textContent).toMatch(/Carrying on from 23:45/);
    expect.soft(note.textContent).toMatch(/hasn’t reached 33:20/);

    // And it survives the event that used to clear it. `playing` follows `loadedmetadata` by
    // a frame or two on a healthy start, so clearing the note there left it on screen for
    // well under a second at three metres.
    await act(async () => {
      fireEvent.playing(video()!);
    });
    expect.soft(screen.getByText(/^Carrying on from/)).toBeTruthy();

    // It goes on its own, so it does not sit over the film for the rest of the title — and
    // the band, which this message was suppressing, can fade again afterwards.
    //
    // THE PLAYHEAD HAS TO KEEP MOVING through this wait, and that is not decoration: with it
    // frozen, the stall watcher escalates after ~2s and "Buffering…" takes over the one line
    // by PRECEDENCE. The note then looks gone while still being set, and a mutation that
    // never clears it passes. Measured: it did.
    for (let i = 1; i <= 9; i++) {
      at() >= 0 && seek(1425 + i);
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect.soft(screen.queryByText(/^Carrying on from/), 'cleared, not masked').toBeNull();
    expect.soft(document.querySelector('.bs-player__hint')?.textContent ?? '').not.toMatch(/Buffering/);
  });

  it('an unmeasured boundary resumes exactly where the viewer left off', async () => {
    // `contiguous: null` means UNKNOWN, and unknown means UNBOUNDED — the finished, evicted
    // download answers null and plays every byte off disk. A null read as a ceiling of zero
    // refuses the resume on the television's main content.
    nav.search.current = new URLSearchParams('file=0');
    svc.getProgressByMovie.mockResolvedValue(progressRow({ current_time: 2000 }));
    svc.getStreamingInfo.mockResolvedValue(
      infoRow({ video_file: { ...infoRow().video_file, contiguous: null } }),
    );
    const { at } = await playing();
    expect(at()).toBe(2000);
  });
});
