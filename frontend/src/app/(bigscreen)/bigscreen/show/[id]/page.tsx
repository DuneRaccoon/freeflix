'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { Episode, SeasonDetail, SeasonSummary, ShowDetail, StreamingProgress } from '@/types';
import { tvService } from '@/services/tv';
import { streamingService } from '@/services/streaming';
import { atSize } from '../../../_components/Hero';
import { EpisodeList, episodeRowCount } from '../../../_components/EpisodeList';
import { PrimaryAction } from '../../../_components/PrimaryAction';
import { LoadStatus } from '../../../_components/LoadStatus';
import { LockedRedirect } from '../../../_components/LockedRedirect';
import { TitleScreen } from '../../../_components/TitleScreen';
import { titleStateFor, type TitleAction, type TitleState } from '../../../_data/title';
import { watchHref } from '../../../_data/watchHref';
import { episodeTraces, latestSeasonWatched, nextUnwatched, seasonFinished } from '../../../_data/showProgress';
import { AutoNextToggle } from '../../../_components/AutoNextToggle';
import { useAutoNext } from '../../../_data/autoNext';
import { useTvProfile } from '../../../_data/useTvProfile';
import { HEADER_CELLS } from '../../../_components/Header';
import { useFocusGrid } from '../../../_focus/useFocusGrid';
import { useBackKey } from '../../../_focus/useBackKey';

/**
 * /bigscreen/show/[id] — the show detail screen: a season picker and the episode list.
 *
 * ROWS. Row 0 is the control for ONE episode (the "subject"), row 1 is the season picker
 * (one cell per season), rows 2+ are the open season's episodes, one row each. Each row's
 * count is taken from what is rendered (`episodeRowCount`; the picker maps the same array it
 * counts), so opening a season reshapes the grid and `useFocusGrid` clamps focus into it. The
 * rows that change are all BELOW the picker, which is where focus is when a season opens.
 *
 * THE DATA ASYMMETRY. A `ShowDetail` is not a `CatalogItem`: it has `name`, not `title`, and
 * no runtime, tagline, cast or qualities. This screen is built from what exists.
 *
 * SEASONS ARE FETCHED LAZILY, ONCE EACH, into a ref cache. A season in flight is remembered
 * too, so a second press while it loads cannot fetch it twice.
 *
 * AN EPISODE PRESS goes through `titleStateFor`. Where the answer is a place to watch
 * (`open`, `resume`, `preparing`) it navigates; `titleStateFor` has already resolved a season
 * pack's file to `?file=N`. Anything else becomes row 0's subject and focus moves there, so
 * the viewer sees what the box said before anything starts:
 *   - `unresolvedEpisode` is disclosed by `PrimaryAction` and plays only on a SECOND press. The
 *     pack is here, but which file holds this episode could not be read, and its href has no
 *     `?file=`. There is deliberately no "Check again" beside it: it would give row 0 a
 *     variable cell count, and pressing the same episode again re-asks the box anyway.
 *   - `play` means no download covers the episode. That is also what a pack that was listed and
 *     really lacks it answers (an unreadable list is `unresolvedEpisode`, never `play`). Play
 *     is the only thing here that starts a download.
 *
 * NOTHING LEFT TO WATCH. The "Up next" card on home cannot know whether a next episode
 * exists; this screen does. If the open season's episodes are all watched it says so (and
 * moves on to the next season when it opens the screen), and it offers no Play for it.
 *
 * Whatever navigates or mutates after an `await` checks the mounted latch first.
 */

const HOME = '/bigscreen';
const PROFILES = '/bigscreen/profiles';
/**
 * How much watch history to read for the markers. The backend returns newest first. 500 is
 * far larger than the 24 rows Continue Watching reads, which is what makes it correct rather
 * than arbitrary: an "Up next" card can only point here for a show whose latest row is among
 * the newest 24, so this screen can always see that history.
 */
const HISTORY_LIMIT = 500;

interface Opened {
  show: ShowDetail;
  history: StreamingProgress[];
  seasons: Map<number, SeasonDetail>;
  open: number | null;
  /** The season to open could not be fetched. */
  openFailed: boolean;
}

type Load = { phase: 'loading' } | { phase: 'failed' } | ({ phase: 'ready' } & Opened);

const regularSeasons = (show: ShowDetail): SeasonSummary[] =>
  (Array.isArray(show.seasons) ? show.seasons : []).filter((s) => s.season_number > 0);

/** A season whose `episodes` is missing reads as having none, here and in the render path. */
const episodesOf = (d: SeasonDetail | undefined): readonly Episode[] =>
  Array.isArray(d?.episodes) ? (d as SeasonDetail).episodes : [];

function eyebrowOf(show: ShowDetail, seasonCount: number): string | null {
  const parts: string[] = [];
  const year = show.year ?? (show.first_air_date ? Number(show.first_air_date.slice(0, 4)) || null : null);
  if (year) parts.push(String(year));
  if (seasonCount > 0) parts.push(seasonCount === 1 ? '1 season' : `${seasonCount} seasons`);
  return parts.length ? parts.join(' · ') : null;
}

async function loadShow(id: number, profileId: string | null): Promise<Opened> {
  const [show, history] = await Promise.all([
    tvService.getShow(id),
    profileId
      ? streamingService.getRecentProgress(profileId, HISTORY_LIMIT).catch((): StreamingProgress[] => [])
      : Promise.resolve([] as StreamingProgress[]),
  ]);
  const regular = regularSeasons(show);
  const latest = latestSeasonWatched(history, id);
  let open: number | null =
    regular.find((s) => s.season_number === latest)?.season_number ?? regular[0]?.season_number ?? null;
  const seasons = new Map<number, SeasonDetail>();
  let openFailed = false;
  if (open !== null) {
    try {
      seasons.set(open, await tvService.getSeason(id, open));
    } catch {
      openFailed = true;
    }
    const here = seasons.get(open);
    // The viewer finished that season: land on the next one rather than on a finished list.
    if (here && seasonFinished(episodesOf(here), episodeTraces(history, id, open))) {
      const next = regular.find((s) => s.season_number > (open as number));
      if (next) {
        try {
          seasons.set(next.season_number, await tvService.getSeason(id, next.season_number));
          open = next.season_number;
        } catch {
          /* stay on the finished season; it says so */
        }
      }
    }
  }
  return { show, history, seasons, open, openFailed };
}

/** The episode row 0 is about. */
interface Subject {
  season: number;
  episode: number;
  name: string;
  action: TitleAction;
}

function assertNever(x: never): never {
  throw new Error(`Unhandled title action: ${JSON.stringify(x)}`);
}

/**
 * Where an answer sends the viewer straight away, or null when it needs a decision first.
 * Exhaustive on purpose: a new `TitleAction` kind must fail the type check here, not fall
 * through to "needs a decision".
 */
function placeToWatch(action: TitleAction): string | null {
  switch (action.kind) {
    case 'open':
    case 'resume':
      return action.href;
    case 'preparing':
      // `fileIndex` is what keeps a season pack off its default file (episode 1); with the file
      // unknown there is nowhere safe to go yet, so the control (which re-asks) decides.
      return action.fileUnknown ? null : watchHref(action.torrentId, action.fileIndex);
    case 'play':
    case 'paused':
    case 'unresolvedEpisode':
    case 'blocked':
      return null;
    default:
      return assertNever(action);
  }
}

const blockedState = (): TitleState => ({
  action: { kind: 'blocked', reason: 'Couldn’t reach the box. Check that it is on.' },
  locked: false,
});

function Loaded({
  opened,
  profileId,
  onLocked,
}: {
  opened: Opened;
  profileId: string | null;
  /** Reports a locked answer; true means the screen is being sent to the picker. */
  onLocked: (state: TitleState) => boolean;
}) {
  const router = useRouter();
  const { show, history } = opened;
  const tmdbId = show.tmdb_id;
  const seasons = useMemo(() => regularSeasons(show), [show]);

  // Per-profile, read once here. The player reads it again on its own: the two screens are
  // different page loads as far as this surface is concerned (the TV navigates client-side,
  // but nothing on it holds settings in a context), and one small GET is cheaper than a
  // provider for one boolean.
  const autoNext = useAutoNext(profileId);

  const cache = useRef(new Map<number, SeasonDetail>(opened.seasons));
  const inFlight = useRef(new Set<number>());
  const [failedSeasons, setFailedSeasons] = useState<ReadonlySet<number>>(
    () => new Set(opened.openFailed && opened.open !== null ? [opened.open] : []),
  );
  const [, setTick] = useState(0);
  const [open, setOpen] = useState<number | null>(opened.open);
  const [subject, setSubject] = useState<Subject | null>(null);
  const [pending, setPending] = useState(false);
  const [busyEpisode, setBusyEpisode] = useState<number | null>(null);
  const pressing = useRef(false);
  /** Bumped by any write to the subject that is not the default lookup, so a late default loses. */
  const subjectVersion = useRef(0);

  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const loadSeason = useCallback(
    async (n: number) => {
      if (cache.current.has(n) || inFlight.current.has(n)) return;
      inFlight.current.add(n);
      // Synchronous, before the first await, and it must stay so: dropping a season from the
      // failed set commits an intermediate grid shape ([1, N], no status row) so focus
      // reconciles off the "Try again" row that is about to vanish. Without it the screen can
      // be left with DOM focus on an unmounted button and no ring.
      setFailedSeasons((f) => {
        if (!f.has(n)) return f;
        const next = new Set(f);
        next.delete(n);
        return next;
      });
      try {
        cache.current.set(n, await tvService.getSeason(tmdbId, n));
      } catch {
        if (alive.current) setFailedSeasons((f) => new Set(f).add(n));
      } finally {
        inFlight.current.delete(n);
        if (alive.current) setTick((t) => t + 1);
      }
    },
    [tmdbId],
  );

  const openSeason = (n: number) => {
    setOpen(n);
    void loadSeason(n);
  };

  const entry = open !== null ? cache.current.get(open) : undefined;
  const failed = open !== null && !entry && failedSeasons.has(open);
  const loading = open !== null && !entry && !failed;
  const episodes: readonly Episode[] = episodesOf(entry);
  const traces = useMemo(
    () => (open === null ? new Map() : episodeTraces(history, tmdbId, open)),
    [history, tmdbId, open],
  );
  const finished = !!entry && open !== null && seasonFinished(episodes, traces);
  // The same answer row 0's control is built from, handed to the list so the badge and the
  // control cannot appear to disagree about which episode is next.
  const upNext = entry ? nextUnwatched(episodes, traces) : null;
  const laterSeason = open !== null && seasons.some((s) => s.season_number > open);
  // "Nothing left" is the absolute claim Continue Watching's "Up next" defers to, so it is made
  // only on complete data: EVERY regular season fetched, none with an unwatched episode
  // (someone who jumped in late, or watched out of order, has earlier ones). Otherwise the
  // hedged "Pick another season" wording; hedging costs nothing.
  const unseenSeason = seasons.some((s) => !cache.current.has(s.season_number));
  const unwatchedElsewhere = seasons.some((s) => {
    const d = cache.current.get(s.season_number);
    return !!d && !seasonFinished(episodesOf(d), episodeTraces(history, tmdbId, s.season_number)) && episodesOf(d).length > 0;
  });

  // Row 0's default subject: the first episode of the open season that is not finished.
  useEffect(() => {
    if (open === null || !entry) {
      setSubject(null);
      setPending(false);
      return;
    }
    const target = nextUnwatched(episodesOf(entry), traces);
    if (!target) {
      setSubject(null);
      setPending(false);
      return;
    }
    const version = ++subjectVersion.current;
    let cancelled = false;
    setSubject(null);
    setPending(true);
    titleStateFor({ mediaType: 'tv', tmdbId, season: open, episode: target.episode_number, userId: profileId })
      .catch(blockedState)
      .then((state) => {
        if (cancelled || version !== subjectVersion.current) return;
        if (onLocked(state)) return;
        setSubject({ season: open, episode: target.episode_number, name: target.name, action: state.action });
        setPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, entry, traces, tmdbId, profileId, onLocked]);

  /**
   * Row 0 is the top bar (`TitleScreen` renders it), row 1 the actions, row 2 the season
   * picker when there is one, and the episodes follow.
   */
  const ACTION_ROW = 1;
  const SEASON_ROW = 2;
  const epBase = seasons.length > 0 ? SEASON_ROW + 1 : SEASON_ROW;
  const emptySeason = !!entry && episodes.length === 0;
  /**
   * ROW 0 IS TWO CELLS NOW: the subject's control, and the auto-next toggle beside it.
   *
   * A CONSTANT, not a condition. The toggle is rendered in BOTH arms of `actions` below —
   * beside the episode control and beside "Back to home" — so the count never changes while
   * this screen is up, which is what keeps it out of the insertion hazard the transport row's
   * `RETRY_CELL` is careful about: the thing that swaps on this screen is WHICH control sits
   * at column 0, and the effect below already puts DOM focus back when that happens.
   */
  const ACTION_CELLS = 2;
  const rowCounts = [
    HEADER_CELLS,
    ACTION_CELLS,
    ...(seasons.length > 0 ? [seasons.length] : []),
    ...(entry && episodes.length > 0
      ? Array.from({ length: episodeRowCount(episodes, false) }, () => 1)
      : failed || emptySeason
        ? [1]
        : []),
  ];
  // The actions, not the menu above them: this screen exists to be pressed.
  const grid = useFocusGrid({ rowCounts, initialRow: ACTION_ROW });

  // Row 0's control can be swapped for a different one (a Home button for the shared action,
  // or one episode's action for another's) and an unmounted focused control drops DOM focus to
  // <body>. The grid still knows where the viewer is; put DOM focus back.
  useEffect(() => {
    if (grid.focused.row === ACTION_ROW && document.activeElement === document.body) {
      grid.setFocus({ row: ACTION_ROW, col: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, pending]);

  const pressEpisode = async (ep: Episode) => {
    if (pressing.current || open === null) return;
    pressing.current = true;
    setBusyEpisode(ep.episode_number);
    const season = open;
    let state: TitleState;
    try {
      state = await titleStateFor({ mediaType: 'tv', tmdbId, season, episode: ep.episode_number, userId: profileId });
    } catch {
      state = blockedState();
    }
    pressing.current = false;
    // Back was pressed while this was out: do not pull the viewer off whatever they went to,
    // and do not clear a profile they never meant to lose.
    if (!alive.current) return;
    setBusyEpisode(null);
    if (onLocked(state)) return;
    const href = placeToWatch(state.action);
    if (href) {
      router.push(href);
      return;
    }
    subjectVersion.current++;
    setPending(false);
    setSubject({ season, episode: ep.episode_number, name: ep.name, action: state.action });
    // The shared action control, which this press has just swapped — NAMED, because a
    // literal row here is what broke when the top bar took row 0.
    grid.setFocus({ row: ACTION_ROW, col: 0 });
  };

  const recheck = async () => {
    if (!subject) return;
    const asked = subject;
    let state: TitleState;
    try {
      state = await titleStateFor({
        mediaType: 'tv', tmdbId, season: asked.season, episode: asked.episode, userId: profileId,
      });
    } catch {
      state = blockedState();
    }
    if (!alive.current) return;
    if (onLocked(state)) return;
    subjectVersion.current++;
    setSubject({ ...asked, action: state.action });
  };

  const goHome = () => router.push(HOME);

  let note: string | null = null;
  if (finished) {
    note = laterSeason || unwatchedElsewhere || unseenSeason
      ? `You’ve finished Season ${open}. Pick another season below.`
      : 'You’re all caught up. Nothing left to watch.';
  }

  const actions = subject ? (
    <>
      <div className="bs-title__action">
        <p className="bs-show__subject">
          S{subject.season} · E{subject.episode} · {subject.name || `Episode ${subject.episode}`}
        </p>
        {subject.action.kind === 'play' && (
          <p className="bs-title__note">This episode isn’t on the box yet. Play will download it.</p>
        )}
      </div>
      <PrimaryAction
        key={`${subject.season}:${subject.episode}`}
        action={subject.action}
        request={{ mediaType: 'tv', tmdbId, season: subject.season, episode: subject.episode }}
        focusProps={grid.focusProps(ACTION_ROW, 0)}
        onRecheck={recheck}
      />
      <AutoNextToggle state={autoNext} focusProps={grid.focusProps(ACTION_ROW, 1)} />
    </>
  ) : (
    <>
      {(note ?? (pending ? 'Checking this episode…' : null)) && (
        <p role="status" className="bs-show__status">
          {note ?? 'Checking this episode…'}
        </p>
      )}
      {/* The label never changes: this control only ever goes home, so it must not say anything else. */}
      <button type="button" className="bs-btn bs-btn--ghost" {...grid.focusProps(ACTION_ROW, 0)} onClick={goHome}>
        Back to home
      </button>
      {/* HERE TOO, and that is what makes `ACTION_CELLS` a constant: the two arms of this
          ternary are the same focus row, so a toggle in only one of them would change the
          row's count every time the subject resolved. */}
      <AutoNextToggle state={autoNext} focusProps={grid.focusProps(ACTION_ROW, 1)} />
    </>
  );

  const below =
    seasons.length === 0 ? (
      <p role="status" className="bs-show__status">
        No seasons are listed for this show yet.
      </p>
    ) : (
      <>
        <div className="bs-show__seasons">
          {seasons.map((s, i) => (
            <button
              key={s.season_number}
              type="button"
              className="bs-show__season"
              aria-pressed={s.season_number === open}
              {...grid.focusProps(SEASON_ROW, i)}
              onClick={() => openSeason(s.season_number)}
            >
              {s.name || `Season ${s.season_number}`}
            </button>
          ))}
        </div>
        {failed ? (
          <div className="bs-show__panel">
            <p role="alert" className="bs-title__alert">
              Couldn’t load this season.
            </p>
            <button
              type="button"
              className="bs-btn"
              {...grid.focusProps(epBase, 0)}
              onClick={() => open !== null && void loadSeason(open)}
            >
              Try again
            </button>
          </div>
        ) : emptySeason ? (
          <div className="bs-show__panel">
            <p role="status" className="bs-show__status">
              No episodes listed for this season yet.
            </p>
            <button
              type="button"
              className="bs-btn bs-btn--ghost"
              {...grid.focusProps(epBase, 0)}
              onClick={() =>
                grid.setFocus({ row: SEASON_ROW, col: Math.max(0, seasons.findIndex((s) => s.season_number === open)) })
              }
            >
              Pick another season
            </button>
          </div>
        ) : (
          <EpisodeList
            episodes={episodes}
            traces={traces}
            loading={loading}
            firstRow={epBase}
            focusProps={grid.focusProps}
            onPress={pressEpisode}
            busyEpisode={busyEpisode}
            nextEpisode={upNext?.episode_number ?? null}
          />
        )}
      </>
    );

  return (
    <TitleScreen
      art={atSize(show.backdrop_url, 'w1920')}
      eyebrow={eyebrowOf(show, seasons.length)}
      title={show.name}
      overview={show.overview || null}
      focusPropsFor={grid.focusProps}
      actions={actions}
      below={below}
    />
  );
}

export default function ShowDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const { profile, loading: profileLoading, clear } = useTvProfile();
  const profileId = profile?.id ?? null;
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [redirecting, setRedirecting] = useState(false);

  useBackKey(useCallback(() => router.push(HOME), [router]));

  const sentToPicker = useCallback(
    (state: TitleState): boolean => {
      if (!state.locked) return false;
      setRedirecting(true);
      clear();
      router.replace(PROFILES);
      return true;
    },
    [clear, router],
  );

  useEffect(() => {
    if (profileLoading || redirecting) return;
    if (!Number.isInteger(id) || id <= 0) {
      setLoad({ phase: 'failed' });
      return;
    }
    let cancelled = false;
    loadShow(id, profileId)
      .then((opened) => {
        if (!cancelled) setLoad({ phase: 'ready', ...opened });
      })
      .catch(() => {
        if (!cancelled) setLoad({ phase: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [id, profileId, profileLoading, redirecting, attempt]);

  const retry = () => {
    setLoad({ phase: 'loading' });
    setAttempt((a) => a + 1);
  };

  // `redirecting` first and on its own: it must not borrow the loading state (see LockedRedirect).
  if (redirecting) return <LockedRedirect />;
  if (load.phase === 'ready') {
    return <Loaded opened={load} profileId={profileId} onLocked={sentToPicker} />;
  }
  return <LoadStatus noun="show" failed={load.phase === 'failed'} onRetry={retry} />;
}
