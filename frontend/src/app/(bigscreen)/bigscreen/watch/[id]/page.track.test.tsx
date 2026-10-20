/**
 * The route's half of "exactly one `<track>`": where the element is mounted, and how many.
 *
 * WHAT THIS FILE CAN AND CANNOT CLAIM, SAID FIRST BECAUSE IT SHAPES EVERY ROW.
 *
 * NO ROW HERE CHOOSES A SIDECAR, and that is now a property of this FILE rather than of the
 * surface. When these rows were written nothing could choose at all; the picker (task 14) can,
 * and `page.subtitles.test.tsx` is where a choice mounts the element and its `src` is read.
 * Every row below leaves the picker shut, so `chosen` is `null` throughout — which is what
 * makes the zero-count row and the source pins mean what they say. The element's own rules
 * (the mount gate, the two `kind` arms, the key that makes a switch a remount,
 * `onErrorCapture`) are proved where they live, in `_player/SubtitleTrackElement.test.tsx`
 * and in `_data/subtitles.ts`'s `chosenCellState`.
 *
 * What is left for this file is the composition, and it is not nothing: a `<track>` is a
 * CHILD of the media element, so the same element rendered as a sibling of the `<video>` is
 * inert and no suite anywhere would report it; and "one element, never one per offerable
 * entry" is a property of this call site, because the component is handed a single entry and
 * cannot iterate. Both are pinned against the source, which is the only instrument that can
 * see them while the chooser is missing — the same posture `engineContract.test.ts` takes for
 * the HEAD probe, for the same reason.
 *
 * THE ZERO-COUNT ROW HAS A POSITIVE CONTROL IN THIS FILE, deliberately: an assertion that
 * `querySelectorAll('track')` is empty is also satisfied by a broken query, so one row below
 * renders the element directly and requires the same query to find it.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
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
import { useTvProfile } from '../../../_data/useTvProfile';
import { SubtitleTrackElement } from '../../../_player/SubtitleTrackElement';
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
  },
}));
vi.mock('@/services/torrents', () => ({
  torrentsService: { getTorrentStatus: vi.fn(), listTorrents: vi.fn(), downloadCatalogMovie: vi.fn() },
}));
vi.mock('../../../_data/useTvProfile', () => ({ useTvProfile: vi.fn() }));

const svc = vi.mocked(streamingService);
const torrents = vi.mocked(torrentsService);
const profileHook = vi.mocked(useTvProfile);

const PACK = 'pk';
const FILE_SIZE = 2_000_000_000;

const statusRow = (): TorrentStatus =>
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

const FILES = [file(4, 1), file(0, 2)];

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

/** `index` 9, `video_index` 4 and position 0 are three different numbers, on purpose. */
const row = (over: Partial<SubtitleTrack> = {}): SubtitleTrack => ({
  index: 9,
  video_index: 4,
  pair_source: 'a-rung-this-build-has-never-heard-of',
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

const listOf = (subtitles: SubtitleTrack[], coverage: SubtitleCoverage = 'listed'): SubtitleList => ({
  torrent_id: PACK,
  state: 'downloading',
  coverage,
  source: coverage === 'unknown' ? null : 'session',
  paired_to: 4,
  subtitles,
});

const videoEl = () => document.querySelector('video') as HTMLVideoElement | null;
const trackEls = () => [...document.querySelectorAll('track')];

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
  svc.getSubtitles.mockResolvedValue(listOf([row()]));
});

afterEach(async () => {
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

describe('the route’s <video> and its one track', () => {
  it('the query used below can actually see a track', async () => {
    // THE POSITIVE CONTROL for every zero-count assertion in this file. Without it, a
    // `querySelectorAll('track')` that had been broken by a rename would make them all pass.
    render(
      <video>
        <SubtitleTrackElement
          torrentId={PACK}
          chosen={row({ ready: true })}
          reloading={false}
          onUnreadable={() => {}}
        />
      </video>,
    );
    expect(trackEls()).toHaveLength(1);
  });

  it('renders no track until the viewer has chosen one, at every coverage', async () => {
    // Four coverages, because they are the four shapes the list can answer with and each one
    // reaches the `<video>` through a different cell state. A ready, convertible, paired
    // sidecar is in the first of them and still mounts nothing — which is the point: a
    // `<track>` appears when the VIEWER chooses one, never because a release ships one.
    for (const list of [
      listOf([row({ ready: true })]),
      listOf([row({ format: 'ass', convertible: false, reason: 'unsupported-format' })]),
      listOf([], 'none'),
      listOf([], 'unknown'),
    ]) {
      svc.getSubtitles.mockResolvedValue(list);
      const view = await mount();
      expect.soft(videoEl(), 'the player mounted').not.toBeNull();
      expect.soft(trackEls(), `coverage ${list.coverage}`).toHaveLength(0);
      view.unmount();
    }
  });

  it('keeps the film, the scrim and the band in that source order', async () => {
    // THE REGRESSION THE CONTAINER CHANGE COULD CAUSE. `.bs-player__video` and
    // `.bs-player__scrim` are BOTH `z-index: -1`, so which one paints on top is decided by
    // source order alone, and the scrim's whole job depends on being the later of the two.
    // Turning the self-closing `<video>` into a container is the edit most likely to move a
    // sibling, and nothing else on this surface counts these three.
    await mount();
    const player = document.querySelector('.bs-player')!;
    const kids = [...player.children].map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
    expect(kids).toEqual([
      'video.bs-player__video',
      'div.bs-player__scrim',
      'div.bs-player__bar',
    ]);
  });
});

/**
 * The composition, against the source. Still the only instrument for it: a `<track>` rendered
 * as a SIBLING of the `<video>` is inert and no render would report it, and "one element,
 * never one per offerable entry" is a property of the call site, not of a reachable state.
 */
describe('the route’s source, for the mount no render can reach', () => {
  const PAGE = readFileSync(
    join(process.cwd(), 'src/app/(bigscreen)/bigscreen/watch/[id]/page.tsx'),
    'utf8',
  );

  /** Comments stripped; this route's own prose names every construct pinned below. */
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  /**
   * Is the one mount a CHILD of the `<video>` rather than a sibling of it?
   *
   * Index arithmetic rather than a parser: the route has exactly one `<video` and one
   * `</video>`, which the row below asserts before this answer is believed.
   */
  function mountIsInsideVideo(src: string): boolean {
    const open = src.indexOf('<video');
    const close = src.indexOf('</video>');
    const mount = src.indexOf('<SubtitleTrackElement');
    if (open < 0 || close < 0 || mount < 0) return false;
    return mount > open && mount < close;
  }

  it('the inside-the-video predicate can tell the two apart', () => {
    // POSITIVE AND NEGATIVE CONTROL for the instrument, because "the mount is inside the
    // video" is the one claim in this stage that is true of a working player and of a
    // completely inert one in exactly the same words.
    expect.soft(mountIsInsideVideo('<video>\n<SubtitleTrackElement />\n</video>')).toBe(true);
    expect.soft(mountIsInsideVideo('<video src="x" />\n<SubtitleTrackElement />')).toBe(false);
    expect.soft(mountIsInsideVideo('<video>\n</video>\n<SubtitleTrackElement />')).toBe(false);
    expect.soft(mountIsInsideVideo('<video>\n</video>'), 'no mount at all').toBe(false);
  });

  it('mounts exactly one track element, inside the media element', () => {
    const src = code(PAGE);
    // A `<track>` is a CHILD of the media element. The same element one line lower, as a
    // sibling, renders a perfectly valid DOM node that no media pipeline ever reads — and
    // every behavioural assertion in this repo would still pass.
    expect.soft(src.match(/<video\b/g), 'one media element').toHaveLength(1);
    expect.soft(src.match(/<\/video>/g), 'and it is a container now').toHaveLength(1);
    expect.soft(src.match(/<SubtitleTrackElement\b/g), 'one mount').toHaveLength(1);
    expect.soft(mountIsInsideVideo(src), 'and it is the media element’s child').toBe(true);
  });

  /** The mount's own attribute list: from `<SubtitleTrackElement` to its closing `/>`. */
  function mountRegion(src: string): string {
    const at = src.indexOf('<SubtitleTrackElement');
    if (at < 0) return '';
    const end = src.indexOf('/>', at);
    return end < 0 ? '' : src.slice(at, end + 2);
  }

  it('the mount-region slice is a slice of the real mount', () => {
    // THE POSITIVE CONTROL for the instrument below: an empty slice would make both of its
    // rows pass by matching nothing, which is the shape this branch keeps finding.
    expect.soft(mountRegion('<video>\n</video>'), 'no mount at all').toBe('');
    expect.soft(mountRegion(code(PAGE)), 'the real mount').toContain('torrentId=');
  });

  it('hands the element the choice and takes back its fault', () => {
    // MEASURED, AND THIS IS WHY THESE TWO ROWS EXIST. With `chosen={null}` hard-coded at
    // this mount the `<track>` can never appear on the television in any future state, and
    // with `onUnreadable={() => {}}` the cell can never reach `unreadable` — and BOTH
    // mutations left all 1469 rows of `npm run test:tv` green. The row below pins that the
    // cell READS `chosen` and `trackFault`; nothing pinned that the element is handed the
    // one or reports the other, which is the stage-7 inert-repair shape with a comment over
    // it claiming the composition was pinned.
    const region = mountRegion(code(PAGE));
    expect.soft(region, 'the chosen entry reaches the element').toMatch(/chosen=\{\s*track\s*\}/);
    expect.soft(region, 'and its load failure comes back up').toMatch(
      /onUnreadable=\{\s*onTrackUnreadable\s*\}/,
    );
  });

  it('wires the two things the element cannot see for itself', () => {
    const src = code(PAGE);
    // THE RECOVERY CONJUNCT IS THE ROUTE'S TO PASS. `recovery` is `Playing`'s own state, the
    // element takes it as a boolean, and no test that renders this route can reach the
    // reloading state with a track mounted — so this line is where that conjunct is either
    // wired or silently absent.
    expect.soft(src, 'the reloading guard').toMatch(
      /reloading=\{\s*recovery\.kind === 'reloading'\s*\}/,
    );
    // AND THE CELL READS THE SAME CHOICE THE ELEMENT DOES. Passing `null` here instead would
    // leave the cell saying `off` over showing subtitles, with nothing anywhere to notice.
    expect.soft(src, 'the cell is derived from the choice and the fault').toMatch(
      /subtitleCellState\(\s*subtitleRead,\s*chosen,\s*trackFault\s*\)/,
    );
  });

  it('never iterates the list into tracks', () => {
    const src = code(PAGE);
    // Two `<track default>` elements both reach `mode: 'showing'` and Blink enforces no
    // winner, so "one per offerable entry, `default` on the chosen one" is two cue lines on
    // the picture. The component's signature takes ONE entry, which is what makes the mapped
    // version impossible to write without changing it; this is the other half, at the only
    // call site that holds the list.
    const open = src.indexOf('<video');
    const close = src.indexOf('</video>');
    expect.soft(src.slice(open, close), 'nothing iterated inside the media element').not.toMatch(
      /\.map\(/,
    );
  });
});
