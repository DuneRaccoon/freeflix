/**
 * JOURNEYS — the contract BETWEEN the television's screens.
 *
 * WHY THIS FILE EXISTS. Every other frontend test in this repo mounts a single page, and
 * that blind spot is why the stage-4 whole-branch review found a Critical and three
 * Importants that seven per-screen reviews could not: a card press landing on a bare 404, a
 * retry blanking its own focus, an error boundary whose only reachable control looped. The
 * task 6 review made the same point again — its Critical was a composition defect (Back from
 * a detail screen loses a 30-press search query) that no single-screen test could see, and
 * that neither task had violated its own spec to create. The per-screen tests are not the
 * problem; the absence of any test that MOVES is.
 *
 * WHAT IT CAN AND CANNOT DO. The App Router's real navigation does not exist in jsdom, so
 * nothing here follows a link. What it asserts instead is the contract the next screen
 * depends on: the href a producer emits names a route this surface actually builds, the
 * `?file=` an episode press emits is the shape the watch route will read, every screen that
 * should claim Back does, a 423 anywhere sends the viewer to the picker, and no screen's
 * first state is ringless.
 *
 * THE ROUTE TABLE IS READ OFF THE FILESYSTEM, never written here. A hand-kept list of routes
 * beside a hand-kept list of hrefs is a test that agrees with itself; the point is to catch
 * the href nobody built a screen for.
 *
 * THE CATCH-ALL IS THE VACUITY TRAP, and it is the whole reason this test needs care.
 * `bigscreen/[...rest]` matches EVERY path under /bigscreen, so "resolves to a route that
 * exists" is trivially true for any href that starts with /bigscreen — including
 * `/bigscreen/moviedetail/603`, which is exactly the class of mistake the stage-4 Critical
 * was. So the assertion below is "resolves to a route that is not the catch-all", with ONE
 * documented exemption (`/bigscreen/watch/...`, which stage 7 owes) and a separate test that
 * pins the exemption to today's reality so it cannot outlive its reason.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentType } from 'react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type {
  CatalogItem,
  CatalogPage,
  Episode,
  MovieDetail,
  SeasonDetail,
  SeasonSummary,
  ShowDetail,
  StreamingProgress,
  TorrentStatus,
  VideoFile,
} from '@/types';
import type { WatchlistItem } from '@/services/watchlist';
import { moviesService } from '@/services/movies';
import { tvService } from '@/services/tv';
import { streamingService } from '@/services/streaming';
import { torrentsService } from '@/services/torrents';
import { watchlistService } from '@/services/watchlist';
import { usersService } from '@/services/users';
import { devicesService } from '@/services/devices';
import { NAV_TARGETS } from './_components/NavRow';
import { TV_RAILS, toRail } from './_data/rails';
import { fetchContinueWatching, fetchMyList } from './_data/continueWatching';
import { watchHref } from './_data/watchHref';
import { useTvProfile, type TvProfile } from './_data/useTvProfile';
import HomePage from './bigscreen/page';
import CatchAllPage from './bigscreen/[...rest]/page';
import DiagPage from './bigscreen/diag/page';
import ListPage from './bigscreen/list/page';
import MoviePage from './bigscreen/movie/[id]/page';
import PairPage from './bigscreen/pair/page';
import ProfilesPage from './bigscreen/profiles/page';
import SearchPage from './bigscreen/search/page';
import ShowPage from './bigscreen/show/[id]/page';
import WatchPage from './bigscreen/watch/[id]/page';

// --- the surface's one router and one param bag ------------------------------------
//
// `useParams` is read by three routes ([...rest], movie/[id], show/[id]) and this file
// mounts all of them, so the params are a mutable box rather than a per-file constant.

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  params: { current: {} as Record<string, string | string[]> },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  useParams: () => nav.params.current,
  usePathname: () => '/bigscreen',
  useSearchParams: () => new URLSearchParams(),
}));

// Only the HTTP-facing services are replaced. `_data/rails`, `_data/continueWatching`,
// `_data/title`, `_data/watchlistRow` and `_data/watchHref` are REAL here on purpose: which
// rows become cards, and the URL each one points at, is what most of this file asserts, and
// a mock of those layers would be a second copy of the rules under test.
vi.mock('@/services/movies', () => ({
  moviesService: { browse: vi.fn(), search: vi.fn(), getDetail: vi.fn(), getTorrents: vi.fn() },
}));
vi.mock('@/services/tv', () => ({
  tvService: {
    browse: vi.fn(),
    search: vi.fn(),
    getShow: vi.fn(),
    getSeason: vi.fn(),
    getEpisodeTorrents: vi.fn(),
    getSeasonTorrents: vi.fn(),
  },
}));
vi.mock('@/services/streaming', () => ({
  streamingService: {
    getStreamingInfo: vi.fn(),
    getStreamingUrl: vi.fn(),
    getFiles: vi.fn(),
    checkStreamingReady: vi.fn(),
    saveProgress: vi.fn(),
    updateProgress: vi.fn(),
    getProgressByTorrent: vi.fn(),
    getProgressByMovie: vi.fn(),
    getRecentProgress: vi.fn(),
    deleteProgress: vi.fn(),
  },
}));
vi.mock('@/services/torrents', () => ({
  torrentsService: {
    downloadMovie: vi.fn(),
    downloadCatalogMovie: vi.fn(),
    getSources: vi.fn(),
    getTorrentStatus: vi.fn(),
    listTorrents: vi.fn(),
    performTorrentAction: vi.fn(),
    deleteTorrent: vi.fn(),
    batchAction: vi.fn(),
    prioritizeForStreaming: vi.fn(),
  },
}));
vi.mock('@/services/watchlist', () => ({
  watchlistService: { add: vi.fn(), remove: vi.fn(), list: vi.fn(), update: vi.fn() },
}));
vi.mock('@/services/users', () => ({
  usersService: {
    createUser: vi.fn(),
    getUsers: vi.fn(),
    getUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    getUserSettings: vi.fn(),
    updateUserSettings: vi.fn(),
    unlockProfile: vi.fn(),
  },
}));
vi.mock('@/services/devices', () => ({
  devicesService: { start: vi.fn(), poll: vi.fn(), approve: vi.fn(), list: vi.fn(), revoke: vi.fn() },
}));
vi.mock('./_data/useTvProfile', () => ({ useTvProfile: vi.fn() }));
// The pair screen lazily imports it for the QR code. It is never reached while
// `devicesService.start` is pending, but an unmocked dynamic import of a real package in a
// test that mounts nine screens is a needless variable.
const toDataURL = vi.hoisted(() => vi.fn());
vi.mock('qrcode', () => ({ default: { toDataURL }, toDataURL }));

// ===================================================================================
// The route table, read off the filesystem
// ===================================================================================

const BIGSCREEN_DIR = join(process.cwd(), 'src/app/(bigscreen)');
const ROUTES_DIR = join(BIGSCREEN_DIR, 'bigscreen');

/**
 * Every `page.*` under `(bigscreen)/bigscreen/`, absolute. The walk and the
 * `(bigscreen)`-relative renaming are separate steps on purpose: doing both in one
 * recursive function re-relativises the paths once per level of depth, which quietly turned
 * `bigscreen/movie/[id]/page.tsx` into `../../../../../../bigscreen/movie/[id]/page.tsx` and
 * left the route table agreeing only with the top-level routes.
 */
function walkPages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walkPages(p);
    return /^page\.(tsx|ts|jsx|js)$/.test(name) ? [p] : [];
  });
}

/** Those files as `(bigscreen)`-relative ids: `bigscreen/movie/[id]/page.tsx`. */
const pageFileIds = (): string[] =>
  walkPages(ROUTES_DIR)
    .map((p) => relative(BIGSCREEN_DIR, p).split(sep).join('/'))
    .sort();

type Seg = { kind: 'literal'; value: string } | { kind: 'dynamic' } | { kind: 'catchAll' };

interface Route {
  /** The page file, `(bigscreen)`-relative: `bigscreen/movie/[id]/page.tsx`. */
  file: string;
  /** Its URL pattern: `/bigscreen/movie/[id]`. */
  pattern: string;
  segs: Seg[];
}

function segOf(name: string): Seg {
  if (/^\[\.\.\..+\]$/.test(name)) return { kind: 'catchAll' };
  if (/^\[.+\]$/.test(name)) return { kind: 'dynamic' };
  return { kind: 'literal', value: name };
}

const ROUTES: readonly Route[] = pageFileIds().map((file) => {
  const dirs = file.split('/').slice(0, -1); // drop `page.tsx`
  return { file, pattern: `/${dirs.join('/')}`, segs: dirs.map(segOf) };
});

const CATCH_ALL = ROUTES.find((r) => r.segs.some((s) => s.kind === 'catchAll'));

function matches(segs: readonly Seg[], path: readonly string[]): boolean {
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    // A catch-all needs at least one segment of its own (Next's non-optional form).
    if (s.kind === 'catchAll') return path.length > i;
    if (i >= path.length) return false;
    if (s.kind === 'literal' && s.value !== path[i]) return false;
  }
  return path.length === segs.length;
}

/**
 * Which route serves `path`, or null when nothing does (a 404 with no layout, no stylesheet
 * and — the part that matters on a remote — no focus target).
 *
 * Precedence is Next's "most specific wins", reduced to the one rule this route tree needs:
 * a route with no dynamic segment beats one with a dynamic segment, which beats the
 * catch-all. There are no competing dynamic siblings at the same depth here, so a full
 * implementation of the real algorithm would be untested weight.
 */
function routeFor(path: string): Route | null {
  const segments = path.split('/').filter((s) => s !== '');
  const rank = (r: Route) =>
    r.segs.some((s) => s.kind === 'catchAll') ? 2 : r.segs.some((s) => s.kind === 'dynamic') ? 1 : 0;
  return (
    [...ROUTES]
      .filter((r) => matches(r.segs, segments))
      .sort((a, b) => rank(a) - rank(b))[0] ?? null
  );
}

/** The path half of an href: no query, no fragment. */
const pathOf = (href: string) => href.split('#')[0].split('?')[0];

/**
 * THERE IS NO EXEMPTION ANY MORE, and that is the point of this note.
 *
 * `/bigscreen/watch/{id}` used to be exempt: Play, Resume, Open and a resume card all
 * navigated there and landed on the `[...rest]` catch-all, which said so honestly and kept a
 * focus target. Stage 7 built the route, so the exemption and the test that pinned its reason
 * (`watchIsStillTheCatchAll`) are both gone and every producer now goes through the same
 * assertion. Four sites referred to that regex, not the two the deleted test's own comment
 * named; the fourth was the home-card branch at the bottom of this file, which is now an
 * ordinary `expectBuiltRoute` call.
 *
 * WHAT MUST NOT HAPPEN NEXT: relaxing `expectBuiltRoute` — dropping the catch-all
 * distinction, or re-adding a prefix exemption for a route someone has not built yet —
 * because then every href in this file "resolves to a route that exists" trivially and the
 * whole file is vacuous. If a future stage needs a placeholder again, it exempts ONE prefix
 * and pins the reason with a test that fails the day the route lands.
 */
interface Produced {
  /** Where the href came from, so a failure names the producer and not just the URL. */
  source: string;
  href: string;
}

/** The assertion every producer's output goes through. */
function expectBuiltRoute({ source, href }: Produced) {
  expect(href.startsWith('/'), `${source}: ${href} is not a root-relative path`).toBe(true);
  const path = pathOf(href);
  const route = routeFor(path);
  expect(route, `${source}: ${href} matches no route under (bigscreen)/bigscreen/`).not.toBeNull();
  expect(
    route!.file,
    `${source}: ${href} resolves ONLY to the catch-all — nothing builds that screen`,
  ).not.toBe(CATCH_ALL!.file);
}

// ===================================================================================
// Fixtures
// ===================================================================================

const BEN: TvProfile = { id: 'p1', display_name: 'Ben', avatar: null };
const clear = vi.fn();
const select = vi.fn();

const never = () => new Promise<never>(() => {});
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

const movieRow = (tmdbId: number, over: Partial<CatalogItem> = {}): CatalogItem => ({
  tmdb_id: tmdbId,
  media_type: 'movie',
  title: `Title ${tmdbId}`,
  year: 1999,
  overview: 'An overview.',
  poster_url: `https://img.test/p${tmdbId}.jpg`,
  backdrop_url: `https://img.test/b${tmdbId}.jpg`,
  genre_ids: [],
  genres: [],
  vote_average: 8,
  vote_count: 10,
  popularity: 50,
  original_language: 'en',
  ...over,
});
const showRowOf = (tmdbId: number, over: Partial<CatalogItem> = {}): CatalogItem =>
  movieRow(tmdbId, { media_type: 'tv', title: `Show ${tmdbId}`, popularity: 40, ...over });

const catalogPage = (results: CatalogItem[]): CatalogPage => ({
  page: 1,
  results,
  total_pages: 1,
  total_results: results.length,
});

const movieDetailOf = (tmdbId: number): MovieDetail => ({
  ...movieRow(tmdbId),
  runtime: 136,
  imdb_id: null,
  tagline: null,
  cast: [],
  director: null,
  available_qualities: [],
});

const seasonSummary = (n: number): SeasonSummary => ({
  season_number: n,
  name: `Season ${n}`,
  episode_count: 3,
  overview: null,
  poster_url: null,
  air_date: null,
});

const showDetailOf = (tmdbId: number): ShowDetail => ({
  tmdb_id: tmdbId,
  media_type: 'tv',
  name: `Show ${tmdbId}`,
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
  seasons: [seasonSummary(2)],
});

const episode = (n: number): Episode => ({
  episode_number: n,
  name: `Ep ${n}`,
  overview: null,
  runtime: null,
  still_url: null,
  air_date: null,
  vote_average: 0,
});
const seasonDetail: SeasonDetail = {
  season_number: 2,
  name: 'Season 2',
  overview: null,
  episodes: [1, 2, 3].map(episode),
};

const progressRow = (over: Partial<StreamingProgress> = {}): StreamingProgress => ({
  id: 'pr1',
  user_id: 'p1',
  torrent_id: 't9',
  movie_id: 'movie:603',
  current_time: 120,
  duration: 7200,
  percentage: 20,
  completed: false,
  last_watched_at: '2026-10-01T10:00:00',
  created_at: '2026-10-01T10:00:00',
  updated_at: '2026-10-01T10:00:00',
  title: 'The Matrix',
  ...over,
});

const watchlistRow = (over: Partial<WatchlistItem> = {}): WatchlistItem => ({
  id: 'w1',
  user_id: 'p1',
  content_id: 'movie:603',
  tmdb_id: '603',
  media_type: 'movie',
  title: 'The Matrix',
  poster_url: 'https://img.test/p.jpg',
  year: 1999,
  vote_average: 8.2,
  added_at: '2026-10-01T00:00:00',
  created_at: '2026-10-01T00:00:00',
  ...over,
});

const packRow = (over: Partial<TorrentStatus> = {}): TorrentStatus =>
  ({
    id: 'pk',
    movie_title: 'Season 2 pack',
    quality: '1080p',
    state: 'finished',
    progress: 100,
    tmdb_id: 1399,
    media_type: 'tv',
    season: 2,
    episode: null,
    ...over,
  }) as TorrentStatus;

const videoFile = (index: number, season: number | null, ep: number | null, size = 100): VideoFile => ({
  index,
  name: `f${index}.mkv`,
  size,
  downloaded: size,
  progress: 100,
  mime_type: 'video/mp4',
  stream_url: '',
  season,
  episode: ep,
});

/** A controllable IntersectionObserver; home observes its lazy rails through one. */
class FakeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = () => [];
  constructor(public callback: IntersectionObserverCallback) {}
}

const SERVICES = [
  moviesService,
  tvService,
  streamingService,
  torrentsService,
  watchlistService,
  usersService,
  devicesService,
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  nav.params.current = {};
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  // jsdom implements neither, and both are called on this surface during focus handover.
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(useTvProfile).mockReturnValue({ profile: BEN, loading: false, select, clear });
  // EVERY service call hangs by default. That is what puts a screen in its FIRST state
  // without a per-screen stub, and it is the honest default for this surface anyway:
  // `apiClient` sets no timeout, so "still waiting" is a state every screen must survive.
  for (const svc of SERVICES) {
    for (const value of Object.values(svc)) {
      if (vi.isMockFunction(value)) value.mockImplementation(never);
    }
  }
});

// ===================================================================================
// The screens, one entry each. The table is pinned to the filesystem below.
// ===================================================================================

type BackClaim =
  /** Claims Back and goes home. */
  | 'navigates-home'
  /**
   * Claims Back as an ESCALATION whose level is derived from state: collapse what is on
   * screen, then leave — and leave by `replace`, because a pushed watch URL leaves a dead
   * history entry pointing at a torrent that may be gone. In its FIRST state there is
   * nothing to collapse, so the first press already leaves; the collapse rungs need a
   * playing player and are asserted separately below.
   */
  | 'escalating'
  /** Claims Back and deliberately does nothing with it (stage 10 owes both a real exit). */
  | 'claimed-but-inert'
  /** Does not claim Back at all. */
  | 'not-claimed';

interface ScreenCase {
  /** The page file, as `pageFileIds()` names it. */
  file: string;
  /** A path this route serves, used for the params the page reads. */
  path: string;
  params: Record<string, string | string[]>;
  Page: ComponentType;
  back: BackClaim;
  /**
   * Put this screen in the state where its profile-scoped call answers 423, with whatever
   * else it needs to get that far. Null for a screen that makes no profile-scoped call.
   */
  lock: null | (() => void);
}

const SCREENS: readonly ScreenCase[] = [
  {
    file: 'bigscreen/[...rest]/page.tsx',
    // A GENUINELY UNBUILT PATH. This used to be `/bigscreen/watch/t1`, which stage 7 turned
    // into a real route — so the case would have been mounting the catch-all at a path the
    // catch-all no longer serves, and the one screen whose whole job is "nothing is built
    // here" would have been exercised against something that is.
    path: '/bigscreen/nothing-built-here',
    params: { rest: ['nothing-built-here'] },
    Page: CatchAllPage,
    back: 'navigates-home',
    lock: null,
  },
  {
    file: 'bigscreen/diag/page.tsx',
    path: '/bigscreen/diag',
    params: {},
    Page: DiagPage,
    // The field instrument, and the ONE screen on this surface that claims no Back — now
    // deliberately, with the reason in its own source. Reading what the remote's Back sends
    // is the key log's whole purpose, and a handler that navigated home would take the
    // viewer off the screen before they could read the line it had just logged. Handing Back
    // to the browser still has the consequence every other screen's comment names (it walks
    // history, and history can leave `(bigscreen)`), so the exit this screen relies on is an
    // on-screen, focusable "Back to home" — the profile keypad's answer to the same problem.
    // Its own `page.test.tsx` asserts that control exists and is the FIRST focus stop, since
    // this page mounts no focus grid and native order is all it has.
    back: 'not-claimed',
    lock: null,
  },
  {
    file: 'bigscreen/list/page.tsx',
    path: '/bigscreen/list',
    params: {},
    Page: ListPage,
    back: 'navigates-home',
    lock: () => {
      vi.mocked(watchlistService.list).mockRejectedValue(httpError(423));
    },
  },
  {
    file: 'bigscreen/movie/[id]/page.tsx',
    path: '/bigscreen/movie/603',
    params: { id: '603' },
    Page: MoviePage,
    back: 'navigates-home',
    lock: () => {
      vi.mocked(moviesService.getDetail).mockResolvedValue(movieDetailOf(603));
      vi.mocked(streamingService.getProgressByMovie).mockRejectedValue(httpError(423));
    },
  },
  {
    file: 'bigscreen/page.tsx',
    path: '/bigscreen',
    params: {},
    Page: HomePage,
    back: 'claimed-but-inert',
    lock: () => {
      // Continue Watching is the lock path; My List stays pending so only one fires.
      vi.mocked(streamingService.getRecentProgress).mockRejectedValue(httpError(423));
    },
  },
  {
    file: 'bigscreen/pair/page.tsx',
    path: '/bigscreen/pair',
    params: {},
    Page: PairPage,
    back: 'claimed-but-inert',
    lock: null,
  },
  {
    file: 'bigscreen/profiles/page.tsx',
    path: '/bigscreen/profiles',
    params: {},
    Page: ProfilesPage,
    back: 'navigates-home',
    // This IS the picker. A 423 here is answered by the passcode keypad, not by a redirect to
    // itself, so it is the one `useTvProfile` reader with nothing to assert below.
    lock: null,
  },
  {
    file: 'bigscreen/search/page.tsx',
    path: '/bigscreen/search',
    params: {},
    Page: SearchPage,
    back: 'navigates-home',
    lock: null,
  },
  {
    file: 'bigscreen/watch/[id]/page.tsx',
    path: '/bigscreen/watch/t1',
    params: { id: 't1' },
    Page: WatchPage,
    back: 'escalating',
    // `useSearchParams` is mocked (above) as a fresh EMPTY URLSearchParams, so every case in
    // this file exercises the BARE arrival — the `unresolvedEpisode` path. `?file=` is
    // covered by the screen's own suite, which can vary the query.
    lock: () => {
      // Far enough for the one profile-scoped call the player makes: the resume read, which
      // is keyed on the content id the torrent row and `/files` produce between them.
      vi.mocked(torrentsService.getTorrentStatus).mockResolvedValue(packRow());
      vi.mocked(streamingService.getFiles).mockResolvedValue([videoFile(0, 2, 1)]);
      vi.mocked(streamingService.getProgressByMovie).mockRejectedValue(httpError(423));
    },
  },
  {
    file: 'bigscreen/show/[id]/page.tsx',
    path: '/bigscreen/show/1399',
    params: { id: '1399' },
    Page: ShowPage,
    back: 'navigates-home',
    lock: () => {
      vi.mocked(tvService.getShow).mockResolvedValue(showDetailOf(1399));
      vi.mocked(tvService.getSeason).mockResolvedValue(seasonDetail);
      vi.mocked(streamingService.getRecentProgress).mockResolvedValue([]);
      vi.mocked(streamingService.getProgressByMovie).mockRejectedValue(httpError(423));
    },
  },
];

const screenFor = (file: string): ScreenCase => {
  const found = SCREENS.find((s) => s.file === file);
  if (!found) throw new Error(`no screen case for ${file}`);
  return found;
};

/** Mount one screen as its route would, with whatever params that route carries. */
function mountScreen(s: ScreenCase) {
  nav.params.current = s.params;
  return render(<s.Page />);
}

// --- source-level helpers ------------------------------------------------------------

const sourceOf = (file: string) => readFileSync(join(BIGSCREEN_DIR, file), 'utf8');

/**
 * Comments removed, for the two "is this hook CALLED" questions below. Block comments go
 * first; then any line whose trimmed form opens with `//` or `*`. A trailing `//` comment on
 * a line of code is left in place deliberately — stripping those is what breaks on `'http://'`
 * — and it cannot hide a call, only leave one visible.
 */
const codeOf = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('//') && !t.startsWith('*');
    })
    .join('\n');

const importSpecifiers = (src: string): string[] => {
  const out: string[] = [];
  const re = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
};

const importsModule = (src: string, tail: string) =>
  importSpecifiers(src).some((spec) => spec.endsWith(tail));

// --- DOM helpers ---------------------------------------------------------------------

/** Everything a remote, a Tab key or a magic-remote pointer could stop on. */
const FOCUS_STOPS = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]';
const stops = () => Array.from(document.querySelectorAll(FOCUS_STOPS));
const ring = () => Array.from(document.querySelectorAll('[tabindex="0"]'));
const hrefs = () =>
  Array.from(document.querySelectorAll('[href]')).map((el) => el.getAttribute('href') ?? '');
const cardHrefs = () =>
  Array.from(document.querySelectorAll<HTMLAnchorElement>('.bs-card')).map(
    (el) => el.getAttribute('href') ?? '',
  );
const back = () => fireEvent.keyDown(window, { key: 'Backspace' });
const navCalls = () => [...nav.push.mock.calls, ...nav.replace.mock.calls].map(([to]) => to);

// ===================================================================================
// 1. Every href the TV can produce resolves to a route that exists
// ===================================================================================

describe('every href the TV can produce resolves to a route that exists', () => {
  it('the route table is read off the filesystem, and the matcher tells the three kinds apart', () => {
    // Non-vacuity for everything below: if the walk found nothing, or the matcher stopped
    // matching, every other assertion in this describe would pass without checking anything.
    expect(ROUTES.length).toBeGreaterThanOrEqual(8);
    expect(CATCH_ALL, 'the [...rest] catch-all must exist: it is what keeps a card press from a 404').toBeDefined();

    expect(routeFor('/bigscreen')?.file).toBe('bigscreen/page.tsx');
    expect(routeFor('/bigscreen/diag')?.file).toBe('bigscreen/diag/page.tsx');
    expect(routeFor('/bigscreen/movie/603')?.file).toBe('bigscreen/movie/[id]/page.tsx');
    expect(routeFor('/bigscreen/show/1399')?.file).toBe('bigscreen/show/[id]/page.tsx');
    // A static segment beats the catch-all, and a dynamic one beats it too.
    expect(routeFor('/bigscreen/search')?.file).toBe('bigscreen/search/page.tsx');
    // Stage 7's route, which replaced this file's one exemption: a dynamic segment beats the
    // catch-all, and that is the whole reason the exemption could be deleted rather than
    // relaxed.
    expect(routeFor('/bigscreen/watch/t1')?.file).toBe('bigscreen/watch/[id]/page.tsx');
    // Nothing builds this; only the catch-all answers. THIS is the shape a bad href has.
    expect(routeFor('/bigscreen/moviedetail/603')?.file).toBe(CATCH_ALL!.file);
    expect(routeFor('/bigscreen/watch/t1/deeper')?.file).toBe(CATCH_ALL!.file);
    // Off the surface entirely: the web's own routes are not ours to land on.
    expect(routeFor('/movies/603')).toBeNull();
    expect(routeFor('/')).toBeNull();
  });

  it('expectBuiltRoute itself rejects the catch-all, which is what keeps this file honest', () => {
    // THE VACUITY TRAP, pinned directly. Everything below runs hrefs through
    // `expectBuiltRoute`, so RELAXING it — dropping the catch-all distinction, or re-adding a
    // prefix exemption — would leave every one of those tests green while checking nothing:
    // `[...rest]` matches every path under /bigscreen, so "resolves to a route" is trivially
    // true. Measured: with the distinction removed, the whole file still passed. These three
    // rows are what fails instead.
    expect(() =>
      expectBuiltRoute({ source: 'vacuity', href: '/bigscreen/moviedetail/603' }),
    ).toThrow();
    expect(() => expectBuiltRoute({ source: 'vacuity', href: '/bigscreen/watch/t1/deeper' })).toThrow();
    // ...and it still accepts the real thing, or it would "fail" for the wrong reason.
    expect(() => expectBuiltRoute({ source: 'vacuity', href: '/bigscreen/watch/t1?file=0' })).not.toThrow();
  });

  it('the data-layer producers emit only built routes', async () => {
    const produced: Produced[] = [];

    // NAV_TARGETS — the only way search, My List, the picker and diag are reachable at all.
    for (const t of NAV_TARGETS) produced.push({ source: `NAV_TARGETS ${t.label}`, href: t.href });

    // Every rail in the shipping lineup, through the real `toRail`/`catalogItemToCard`.
    for (const spec of TV_RAILS) {
      const rail = toRail(spec, [movieRow(603)], [showRowOf(1399)]);
      for (const item of rail.items) produced.push({ source: `TV_RAILS ${spec.key}`, href: item.href });
    }

    // Continue Watching: a film to resume, an episode to resume inside a pack, and the
    // "Up next" card a FINISHED episode becomes (which points at the show screen, not a file).
    vi.mocked(streamingService.getRecentProgress).mockResolvedValue([
      progressRow({ id: 'a', movie_id: 'movie:603', torrent_id: 't9' }),
      progressRow({ id: 'b', movie_id: 'tv:1399:s2:e5', torrent_id: 't9', file_index: 7 }),
      progressRow({ id: 'c', movie_id: 'tv:1396:s1:e1', percentage: 100, completed: true }),
    ]);
    vi.mocked(moviesService.getDetail).mockResolvedValue(movieDetailOf(603));
    vi.mocked(tvService.getShow).mockResolvedValue(showDetailOf(1399));
    const cw = await fetchContinueWatching({ userId: 'p1' });
    for (const item of cw.items) produced.push({ source: 'fetchContinueWatching', href: item.href });

    // My List: both media types, through the real row guard.
    vi.mocked(watchlistService.list).mockResolvedValue([
      watchlistRow(),
      watchlistRow({ id: 'w2', content_id: 'tv:1399', tmdb_id: '1399', media_type: 'tv', title: 'Show 1399' }),
    ]);
    const list = await fetchMyList({ userId: 'p1' });
    for (const item of list.items) produced.push({ source: 'fetchMyList', href: item.href });

    // The watch URL builder itself, both branches. `?file=0` is a real index (the first file
    // of a season pack), not an absent one.
    produced.push({ source: 'watchHref (no file)', href: watchHref('t9') });
    produced.push({ source: 'watchHref (file 0)', href: watchHref('t9', 0) });

    // Non-vacuity: the three card-producing routes and the watch URL must all be represented,
    // or this test is asserting over an empty-ish list.
    const all = produced.map((p) => p.href);
    expect(all.filter((h) => h.startsWith('/bigscreen/movie/')).length).toBeGreaterThan(0);
    expect(all.filter((h) => h.startsWith('/bigscreen/show/')).length).toBeGreaterThan(0);
    expect(all.filter((h) => h.startsWith('/bigscreen/watch/')).length).toBeGreaterThan(0);
    expect(all).toContain('/bigscreen/watch/t9?file=7');
    expect(produced.length).toBeGreaterThanOrEqual(NAV_TARGETS.length + TV_RAILS.length * 2 + 5);

    for (const p of produced) expectBuiltRoute(p);
  });

  it('the cards home draws link to built routes', async () => {
    vi.mocked(moviesService.browse).mockResolvedValue(catalogPage([movieRow(603)]));
    vi.mocked(tvService.browse).mockResolvedValue(catalogPage([showRowOf(1399)]));
    mountScreen(screenFor('bigscreen/page.tsx'));
    await waitFor(() => expect(cardHrefs().length).toBeGreaterThan(0));
    for (const href of hrefs()) expectBuiltRoute({ source: 'home', href });
  });

  it('the cards a search draws link to built routes', async () => {
    vi.mocked(moviesService.search).mockResolvedValue(catalogPage([movieRow(603)]));
    vi.mocked(tvService.search).mockResolvedValue(catalogPage([showRowOf(1399)]));
    mountScreen(screenFor('bigscreen/search/page.tsx'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'B' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    });
    await waitFor(() => expect(cardHrefs()).toHaveLength(2));
    for (const href of hrefs()) expectBuiltRoute({ source: 'search results', href });
  });

  it('the cards My List draws link to built routes', async () => {
    vi.mocked(watchlistService.list).mockResolvedValue([
      watchlistRow(),
      watchlistRow({ id: 'w2', content_id: 'tv:1399', tmdb_id: '1399', media_type: 'tv', title: 'Show 1399' }),
    ]);
    mountScreen(screenFor('bigscreen/list/page.tsx'));
    await waitFor(() => expect(cardHrefs()).toHaveLength(2));
    for (const href of hrefs()) expectBuiltRoute({ source: 'My List', href });
  });

  it.each(SCREENS)('$file offers only built routes in its first state', async (s) => {
    mountScreen(s);
    await waitFor(() => expect(stops().length).toBeGreaterThan(0));
    for (const href of hrefs()) expectBuiltRoute({ source: s.file, href });
  });

});

// ===================================================================================
// 2. Every screen that should claim Back does
// ===================================================================================

describe('every screen that should claim Back does', () => {
  it('every page file under bigscreen/ has a case in this file', () => {
    // The guard that keeps the three tests below general. A new screen with no entry here is
    // a screen none of this file's invariants are asserted against; it fails loudly instead.
    expect(SCREENS.map((s) => s.file).sort()).toEqual(pageFileIds());
  });

  it.each(SCREENS)('$file: the source says the same as its classification', (s) => {
    const src = sourceOf(s.file);
    const shouldClaim = s.back !== 'not-claimed';
    expect(importsModule(src, '_focus/useBackKey'), `${s.file} imports useBackKey`).toBe(shouldClaim);
    expect(/\buseBackKey\s*\(/.test(codeOf(src)), `${s.file} calls useBackKey`).toBe(shouldClaim);
  });

  it.each(SCREENS.filter((s) => s.back === 'navigates-home'))(
    '$file: Back goes home',
    async (s) => {
      mountScreen(s);
      await waitFor(() => expect(stops().length).toBeGreaterThan(0));
      back();
      expect(navCalls()).toContain('/bigscreen');
    },
  );

  it.each(SCREENS.filter((s) => s.back === 'escalating'))(
    '$file: Back leaves by replace, never by push',
    async (s) => {
      mountScreen(s);
      await waitFor(() => expect(stops().length).toBeGreaterThan(0));
      back();
      // Nothing is on screen to collapse in this state — no control band, no pending edit —
      // so the first press is already the rung that leaves. What this file can see that the
      // screen's own suite cannot is WHICH navigation it is: `navCalls()` merges push and
      // replace, so the two buckets above cannot tell them apart.
      expect(nav.replace).toHaveBeenCalledWith('/bigscreen');
      expect(nav.push, 'a pushed watch URL leaves a dead entry behind').not.toHaveBeenCalled();
    },
  );

  it('the player collapses its controls before it leaves, and a reveal resets the level', async () => {
    // The escalation itself, which needs a PLAYING player: the generic case above mounts
    // every screen with its services still out. A level COUNTED rather than derived would be
    // at rung 2 after the first press, so the press after a reveal would leave the player
    // while the controls were still on screen.
    vi.mocked(torrentsService.getTorrentStatus).mockResolvedValue(packRow());
    vi.mocked(streamingService.getFiles).mockResolvedValue([videoFile(0, 2, 1)]);
    vi.mocked(streamingService.getProgressByMovie).mockResolvedValue(null);
    mountScreen(screenFor('bigscreen/watch/[id]/page.tsx'));
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());

    back();
    expect(document.querySelector('.bs-player__bar--hidden'), 'the band faded').not.toBeNull();
    expect(navCalls()).toEqual([]);
    // The band is still MOUNTED and still holds the ring: the hide is paint only.
    expect(document.querySelector('.bs-player__bar')).not.toBeNull();
    expect(ring()).toHaveLength(1);

    back();
    expect(nav.replace).toHaveBeenCalledWith('/bigscreen');
    expect(nav.push).not.toHaveBeenCalled();
  });

  it.each(SCREENS.filter((s) => s.back !== 'navigates-home' && s.back !== 'escalating'))(
    '$file: Back does not navigate ($back)',
    async (s) => {
      mountScreen(s);
      await waitFor(() => expect(stops().length).toBeGreaterThan(0));
      back();
      // Home and pair claim Back and swallow it on purpose; diag never claims it. Either way
      // nothing may move: handing Back to the browser from either walks history out of
      // (bigscreen), which a remote cannot type its way back from. STAGE 10 owes both a real
      // exit, and when it lands these two classifications change with it.
      expect(navCalls()).toEqual([]);
    },
  );
});

// ===================================================================================
// 3. No screen renders with zero focus stops in its initial state
// ===================================================================================

/**
 * This is an ARRIVAL invariant, not a grid walk. It asserts that every screen, mounted the
 * way its route mounts it with every service still out, offers something to press and parks
 * the ring on exactly one rendered cell. It does NOT walk the arrows — each screen's own
 * suite owns that (`walkTheGrid`), because a walk needs the screen's full row shape and that
 * is per-screen knowledge. What this adds is coverage of EVERY screen at once, including any
 * screen added later, which is the thing no per-screen file can promise.
 */
describe('no screen renders with zero focus stops in its initial state', () => {
  it.each(SCREENS)('$file', async (s) => {
    mountScreen(s);
    // There is no Tab key and no pointer on this surface, so a screen with nothing focusable
    // is unrecoverable: the viewer's only way out is the TV's power button.
    await waitFor(() => expect(stops().length).toBeGreaterThan(0));

    // And where the screen drives a focus grid, exactly one rendered cell must hold the ring.
    // Derived from the source, not listed: a count one too high parks the ring on a cell no
    // element claims, which looks identical to nothing being focused.
    if (importsModule(sourceOf(s.file), '_focus/useFocusGrid')) {
      await waitFor(() => expect(ring()).toHaveLength(1));
      expect(ring()[0]).toBe(document.activeElement);
    }
  });
});

// ===================================================================================
// 4. The `?file=` an episode press produces, and who else produces one
// ===================================================================================

describe('?file= rides from the screen that resolved it to the watch route', () => {
  const episodeButtons = () => screen.queryAllByRole('button', { name: /^\d+\s/ });

  /** The show screen, settled, with a season-2 pack already on the box. */
  async function mountShow(files: VideoFile[] | Error) {
    vi.mocked(tvService.getShow).mockResolvedValue(showDetailOf(1399));
    vi.mocked(tvService.getSeason).mockResolvedValue(seasonDetail);
    vi.mocked(streamingService.getRecentProgress).mockResolvedValue([]);
    vi.mocked(streamingService.getProgressByMovie).mockResolvedValue(null);
    vi.mocked(torrentsService.listTorrents).mockResolvedValue([packRow()]);
    if (files instanceof Error) vi.mocked(streamingService.getFiles).mockRejectedValue(files);
    else vi.mocked(streamingService.getFiles).mockResolvedValue(files);
    mountScreen(screenFor('bigscreen/show/[id]/page.tsx'));
    await waitFor(() => expect(episodeButtons()).toHaveLength(3));
    // Row 0's own lookup must land first or it races the press under test.
    await screen.findByText(/S2 · E1/);
  }

  it('an episode press carries that episode’s file index, in the form the watch route reads', async () => {
    await mountShow([videoFile(0, 2, 1), videoFile(4, 2, 2, 900), videoFile(5, 2, 3)]);
    fireEvent.click(episodeButtons()[1]); // E2
    await waitFor(() => expect(nav.push).toHaveBeenCalledTimes(1));
    const href = nav.push.mock.calls[0][0] as string;

    expectBuiltRoute({ source: 'show screen episode press', href });
    // The contract stage 7 consumes: a torrent id in the path, the file index in the query.
    const url = new URL(href, 'http://tv.test');
    expect(url.pathname).toBe('/bigscreen/watch/pk');
    expect(url.searchParams.get('file')).toBe('4');
    expect(Number.isInteger(Number(url.searchParams.get('file')))).toBe(true);
  });

  it('an unresolved index discloses instead of navigating to the pack’s default file', async () => {
    // An unreadable file list is UNKNOWN, not "the episode is absent". Navigating bare would
    // play the pack's DEFAULT file — episode 1 — for every episode the viewer asks for.
    await mountShow(new Error('no file list'));
    fireEvent.click(episodeButtons()[1]); // E2
    expect(await screen.findByRole('note')).toHaveTextContent(/may be a different episode/i);
    expect(nav.push).not.toHaveBeenCalled();

    // And when the viewer accepts the disclosure, the URL carries NO `?file=` — the one case
    // where a bare watch URL is correct, because no index was ever resolved.
    fireEvent.click(screen.getByRole('button', { name: 'Play anyway' }));
    expect(nav.push).toHaveBeenCalledTimes(1);
    const href = nav.push.mock.calls[0][0] as string;
    expect(new URL(href, 'http://tv.test').searchParams.has('file')).toBe(false);
    expect(href).toBe(watchHref('pk'));
  });

  it('every producer of a watch URL writes the same shape', async () => {
    // Three screens' worth of code reach the watch route: the show screen's episode press,
    // Continue Watching's resume card on home, and `watchHref` itself. One watch route will
    // read all three, so a producer that spelled it `&file=` or `?f=` would be a dead player
    // on one entry path and a working one on another — and no single-screen test can see it.
    await mountShow([videoFile(0, 2, 1), videoFile(4, 2, 2, 900)]);
    fireEvent.click(episodeButtons()[1]);
    await waitFor(() => expect(nav.push).toHaveBeenCalledTimes(1));
    const fromShowScreen = nav.push.mock.calls[0][0] as string;

    vi.mocked(streamingService.getRecentProgress).mockResolvedValue([
      progressRow({ movie_id: 'tv:1399:s2:e2', torrent_id: 'pk', file_index: 4 }),
    ]);
    const rail = await fetchContinueWatching({ userId: 'p1' });
    const fromResumeCard = rail.items[0]?.href;

    expect(fromShowScreen).toBe(watchHref('pk', 4));
    expect(fromResumeCard).toBe(watchHref('pk', 4));
  });
});

// ===================================================================================
// 5. A 423 anywhere sends the viewer to the picker
// ===================================================================================

describe('a 423 anywhere sends the viewer to the picker', () => {
  it('every screen that reads the profile has a lock case, or says why it is exempt', () => {
    // Derived, so a new profile-reading screen is caught: the only exemption is the picker
    // itself, which answers a lock with its passcode keypad rather than a redirect to itself.
    const readsProfile = pageFileIds().filter((file) => importsModule(sourceOf(file), '_data/useTvProfile'));
    expect(readsProfile.length).toBeGreaterThanOrEqual(4);
    const exempt = ['bigscreen/profiles/page.tsx'];
    expect(readsProfile.filter((f) => !exempt.includes(f)).sort()).toEqual(
      SCREENS.filter((s) => s.lock).map((s) => s.file).sort(),
    );
  });

  it.each(SCREENS.filter((s) => s.lock))(
    '$file forgets the profile, replaces to the picker, and never offers a live Play control',
    async (s) => {
      s.lock!();
      // Wire `clear()` the way the real hook behaves: afterwards the screen sees NOBODY. That is
      // what re-runs a screen's load as "nobody" (profileId changed), and with the services
      // answering it would reach `play` unless the screen latched its redirect. The default
      // fixture hangs every call, which hides this entirely.
      clear.mockImplementation(() => {
        vi.mocked(useTvProfile).mockReturnValue({ profile: null, loading: false, select, clear });
      });
      vi.mocked(torrentsService.listTorrents).mockResolvedValue([]);
      mountScreen(s);
      await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/bigscreen/profiles'));
      expect(clear).toHaveBeenCalled();
      // Let the re-run (if any) settle before asserting its absence.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      // Never "your list is empty" and never a live Play control: a 423 means passcode-locked,
      // which is a different fact from "nothing here".
      expect(screen.queryByRole('button', { name: /^Play/ })).toBeNull();
      // And no wasted re-run as nobody: the first (locked) answer never reaches the torrent list.
      expect(torrentsService.listTorrents).not.toHaveBeenCalled();
      if (/movie|show|list/.test(s.file)) expect(document.body.textContent).toMatch(/locked/i);
    },
  );
});

// ===================================================================================
// 6. A card press lands on a screen that accepts the id the card carried
// ===================================================================================

describe('a card press lands on a screen that accepts the id the card carried', () => {
  it('home drops a row that cannot become a usable card, and every card it keeps opens', async () => {
    // The stage-4 Critical in its exact shape: a card the viewer presses that dead-ends. A
    // catalog row off the wire can carry a non-numeric tmdb_id, which would become
    // `/bigscreen/movie/NaN` — a path the route table HAPPILY matches (`movie/[id]`), so only
    // mounting the detail screen with that id shows the dead end.
    vi.mocked(moviesService.browse).mockResolvedValue(
      catalogPage([movieRow(603), movieRow(Number('not-a-number'))]),
    );
    vi.mocked(tvService.browse).mockResolvedValue(catalogPage([showRowOf(1399)]));
    const home = mountScreen(screenFor('bigscreen/page.tsx'));
    await waitFor(() => expect(cardHrefs().length).toBeGreaterThan(0));
    const pressable = [...new Set(cardHrefs())];
    home.unmount();

    expect(pressable).toContain('/bigscreen/movie/603');
    expect(pressable).toContain('/bigscreen/show/1399');
    expect(pressable.some((h) => /NaN|undefined/.test(h))).toBe(false);

    for (const href of pressable) {
      const route = routeFor(pathOf(href));
      expect(route, href).not.toBeNull();
      const id = pathOf(href).split('/').pop() as string;

      if (route!.file === 'bigscreen/movie/[id]/page.tsx') {
        vi.mocked(moviesService.getDetail).mockResolvedValue(movieDetailOf(Number(id)));
        vi.mocked(streamingService.getProgressByMovie).mockResolvedValue(null);
        vi.mocked(torrentsService.listTorrents).mockResolvedValue([]);
        nav.params.current = { id };
        const view = render(<MoviePage />);
        // The detail screen validates the id itself and shows "Couldn't load this movie" for
        // one it rejects. Reaching the title means the href the card carried was openable.
        expect(await screen.findByRole('heading', { level: 1, name: `Title ${id}` })).toBeTruthy();
        view.unmount();
      } else if (route!.file === 'bigscreen/show/[id]/page.tsx') {
        vi.mocked(tvService.getShow).mockResolvedValue(showDetailOf(Number(id)));
        vi.mocked(tvService.getSeason).mockResolvedValue(seasonDetail);
        vi.mocked(streamingService.getRecentProgress).mockResolvedValue([]);
        vi.mocked(streamingService.getProgressByMovie).mockResolvedValue(null);
        vi.mocked(torrentsService.listTorrents).mockResolvedValue([]);
        nav.params.current = { id };
        const view = render(<ShowPage />);
        expect(await screen.findByRole('heading', { level: 1, name: `Show ${id}` })).toBeTruthy();
        view.unmount();
      } else {
        // A home card pointing anywhere else used to be checked against the watch-prefix
        // exemption; with that gone it goes through the general assertion, which is strictly
        // stronger (it rejects the catch-all). DELETING this branch instead would have left
        // `STAGE_7_WATCH` referenced nowhere and the resume card asserted by nothing.
        expectBuiltRoute({ source: `home card`, href });
      }
    }
  });

  it('the route a card takes is decided by the row’s media_type, not by which half it came from', () => {
    // The mechanism, pinned. `catalogItemToCard` reads `item.media_type` off the row, so a row
    // in the SHOWS half that carries another kind is routed by the FIELD, not by which call
    // returned it. `usableCardIdentity` checks the kind is a known one, so it cannot catch a
    // valid-but-wrong kind; the safety against that lives on the BACKEND
    // (`providers/catalog.py`'s `normalize_item` sets `media_type` from the endpoint's own
    // hardcoded mode, so a `tvService.browse` row is always 'tv'). Asserting the mechanism here
    // means a change on either side has to notice.
    const rail = toRail(TV_RAILS[0], [], [showRowOf(1399, { media_type: 'movie' as 'tv' })]);
    expect(rail.items.map((i) => i.href)).toEqual(['/bigscreen/movie/1399']);
    // And the field, set correctly, is what sends a show to the show route.
    expect(toRail(TV_RAILS[0], [], [showRowOf(1399)]).items[0].href).toBe('/bigscreen/show/1399');
  });
});
