'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
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
import { showAskFrom } from '../../../_data/titleHref';
import { watchHref } from '../../../_data/watchHref';
import { episodeTraces, latestSeasonWatched, nextUnwatched, seasonFinished } from '../../../_data/showProgress';
import { useTvProfile } from '../../../_data/useTvProfile';
import { HEADER_CELLS } from '../../../_components/Header';
import { useFocusGrid } from '../../../_focus/useFocusGrid';
import { useBackKey } from '../../../_focus/useBackKey';

/**
 * /bigscreen/show/[id] — the show detail screen: a season picker and the episode list.
 *
 * ROWS. Row 0 is the top bar (`TitleScreen` renders it), row 1 (`ACTION_ROW`) is the control
 * for ONE episode (the "subject"), row 2 is the season picker (one cell per season), rows 3+
 * are the open season's episodes, one row each. Each row's count is taken from what is
 * rendered (`episodeRowCount`; the picker maps the same array it counts), so opening a season
 * reshapes the grid and `useFocusGrid` clamps focus into it. The rows that change are all
 * BELOW the picker, which is where focus is when a season opens.
 *
 * THE DATA ASYMMETRY. A `ShowDetail` is not a `CatalogItem`: it has `name`, not `title`, and
 * no runtime, tagline, cast or qualities. This screen is built from what exists.
 *
 * SEASONS ARE FETCHED LAZILY, ONCE EACH, into a ref cache. A season in flight is remembered
 * too, so a second press while it loads cannot fetch it twice.
 *
 * AN EPISODE PRESS goes through `titleStateFor`. Where the answer is a place to watch
 * (`open`, `resume`, `preparing`) it navigates; `titleStateFor` has already resolved a season
 * pack's file to `?file=N`. Anything else becomes the action row's subject and focus moves
 * there, so the viewer sees what the box said before anything starts:
 *   - `unresolvedEpisode` is disclosed by `PrimaryAction` and plays only on a SECOND press. The
 *     pack is here, but which file holds this episode could not be read, and its href has no
 *     `?file=`. There is deliberately no "Check again" beside it: it would give the action
 *     row a variable cell count, and pressing the same episode again re-asks the box anyway.
 *   - `play` means no download covers the episode. That is also what a pack that was listed and
 *     really lacks it answers (an unreadable list is `unresolvedEpisode`, never `play`). Play
 *     is the only thing here that starts a download.
 *
 * NOTHING LEFT TO WATCH. The "Up next" card on home cannot know whether a next episode
 * exists; this screen does. If the open season's episodes are all watched it says so (and,
 * when the screen opens on such a season, asked for or not, moves on to the next one), and
 * it offers no Play for it.
 *
 * AN ASKED EPISODE (`?s=&e=`, written by `showHref` and read by `showAskFrom`, both in
 * `_data/titleHref`). Continue Watching's resume card opens this screen on the episode its
 * row is about instead of opening the player, so the viewer sees what they are resuming
 * first; and the player's way out (`titleExitOf`) asks for the episode that was playing.
 * The asked season opens when the show lists it as a regular season. The subject is the
 * asked episode unless that episode is not listed or is already watched, and then it is the
 * first unwatched, as with no ask. The "Next up" badge is handed the same answer.
 * `titleStateFor` then resumes the row's own torrent and file (its saved `file_index`
 * first), which is why the card carries no `?file=`. An absent, junk or unknown value is no
 * ask at all, and the screen makes its own pick as it always has. The ask belongs to its
 * season, so opening another season and coming back finds it again.
 *
 * AN ASK HOLDS ITS SEASON ONLY WHILE IT NAMES SOMETHING TO WATCH. The finished-season advance
 * runs from the asked season exactly as from the screen's own pick. An ask that resolves to
 * a subject (a listed episode not yet watched) is never on a finished season, so the advance
 * never passes it; an ask that resolves to none holds nothing, so a finished season is left
 * as it would be with no ask. The season finale is that case: leaving the player after it
 * asks for `?s=1&e=<finale>`, now watched, and the viewer wants season 2, not "You've
 * finished Season 1". A new ask while the screen is mounted (a query-only navigation) is a
 * new `Loaded`, keyed on the ask its load was made for, so nothing the previous load opened
 * survives it.
 *
 * Whatever navigates or mutates after an `await` checks the mounted latch first.
 */

const HOME = '/bigscreen';
const PROFILES = '/bigscreen/profiles';
/**
 * How much watch history to read for the markers. The backend returns newest first. 500 is
 * far larger than the 24 rows Continue Watching reads, which is what makes it correct rather
 * than arbitrary: an "Up next" card or a resume card can only point here for a show whose
 * latest row is among the newest 24, so this screen can always see the history the card was
 * built from.
 */
const HISTORY_LIMIT = 500;

interface Opened {
  show: ShowDetail;
  history: StreamingProgress[];
  seasons: Map<number, SeasonDetail>;
  open: number | null;
  /** The season to open could not be fetched. */
  openFailed: boolean;
  /**
   * The query's ask this load was made for, as read, honoured or not. `Loaded` is keyed on
   * it, never on the live query: the query changes as soon as the viewer navigates, and the
   * load for it lands later, so a key read off the query would remount the OLD load's screen.
   */
  asked: Asked;
  /**
   * The asked episode, kept only when its season is a listed regular season and is the one
   * opened. An advance past it drops it and loses nothing: every episode a finished season
   * lists is watched, so the ask could not resolve there anyway. The episode is checked
   * later, against the fetched list and the traces.
   */
  ask: { season: number; episode: number | null } | null;
}

/** The query's ask, as primitives; either may be null (see `showAskFrom`). */
interface Asked {
  season: number | null;
  episode: number | null;
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

async function loadShow(id: number, profileId: string | null, asked: Asked): Promise<Opened> {
  const [show, history] = await Promise.all([
    tvService.getShow(id),
    profileId
      ? streamingService.getRecentProgress(profileId, HISTORY_LIMIT).catch((): StreamingProgress[] => [])
      : Promise.resolve([] as StreamingProgress[]),
  ]);
  const regular = regularSeasons(show);
  // Only a season the show lists counts as asked; anything else falls through to today's pick.
  const askedSeason = regular.find((s) => s.season_number === asked.season)?.season_number ?? null;
  const latest = latestSeasonWatched(history, id);
  let open: number | null =
    askedSeason ??
    regular.find((s) => s.season_number === latest)?.season_number ??
    regular[0]?.season_number ??
    null;
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
    // An asked season too. An ask that resolves to a subject names a listed episode not yet
    // watched, so its season is never finished and this never passes it; an ask that names
    // nothing left (the finale the player has just finished, an episode the season does not
    // list) has no claim on a season with nothing in it.
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
  return {
    show,
    history,
    seasons,
    open,
    openFailed,
    asked,
    ask: askedSeason !== null && open === askedSeason ? { season: askedSeason, episode: asked.episode } : null,
  };
}

/** `Loaded`'s key: one per ask a load can be made for, so a new ask is a new screen. */
const askKey = (a: Asked): string => `${a.season ?? '-'}:${a.episode ?? '-'}`;

/** The episode the action row (`ACTION_ROW`) is about. */
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
  /**
   * THE ONE PLACE that decides whether the ask is honoured: only on its own season, only for
   * an episode that season lists, and never for one already watched. Memoised on the opened
   * load's own `ask` object, never on a literal, so the default lookup below does not re-run
   * on every render.
   */
  const askedEp = useMemo(() => {
    const ask = opened.ask;
    if (!ask || !entry || open !== ask.season) return null;
    const ep = episodesOf(entry).find((e) => e.episode_number === ask.episode);
    return ep && traces.get(ep.episode_number)?.mark !== 'watched' ? ep : null;
  }, [opened.ask, open, entry, traces]);
  // The same answer the action row's control is built from, handed to the list so the badge
  // and the control cannot appear to disagree about which episode is next.
  const upNext = entry ? (askedEp ?? nextUnwatched(episodes, traces)) : null;
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

  // The action row's default subject: the asked episode when it is honoured, otherwise the
  // first episode of the open season that is not finished.
  useEffect(() => {
    if (open === null || !entry) {
      setSubject(null);
      setPending(false);
      return;
    }
    const target = askedEp ?? nextUnwatched(episodesOf(entry), traces);
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
  }, [open, entry, traces, askedEp, tmdbId, profileId, onLocked]);

  /**
   * Row 0 is the top bar (`TitleScreen` renders it), row 1 the actions, row 2 the season
   * picker when there is one, and the episodes follow.
   */
  const ACTION_ROW = 1;
  const SEASON_ROW = 2;
  const epBase = seasons.length > 0 ? SEASON_ROW + 1 : SEASON_ROW;
  const emptySeason = !!entry && episodes.length === 0;
  /** ROW 1 IS ONE CELL, the subject's control (or 'Back to home'), and stays one in both arms of `actions`. */
  const ACTION_CELLS = 1;
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

  // The action row's control can be swapped for a different one (a Home button for the shared
  // action, or one episode's action for another's) and an unmounted focused control drops DOM
  // focus to <body>. The grid still knows where the viewer is; put DOM focus back.
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

function ShowScreen() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  // Primitives, so the load below re-runs when the ask changes and not on every render.
  const { season: askSeason, episode: askEpisode } = showAskFrom(useSearchParams());
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
    loadShow(id, profileId, { season: askSeason, episode: askEpisode })
      .then((opened) => {
        if (!cancelled) setLoad({ phase: 'ready', ...opened });
      })
      .catch(() => {
        if (!cancelled) setLoad({ phase: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [id, profileId, profileLoading, redirecting, attempt, askSeason, askEpisode]);

  const retry = () => {
    setLoad({ phase: 'loading' });
    setAttempt((a) => a + 1);
  };

  // `redirecting` first and on its own: it must not borrow the loading state (see LockedRedirect).
  if (redirecting) return <LockedRedirect />;
  if (load.phase === 'ready') {
    // Keyed on the ask the load was made for: `Loaded` seeds its open season and its season
    // cache from `opened` once, so a new ask handed to the same instance would be ignored
    // whenever it named a different season.
    return <Loaded key={askKey(load.asked)} opened={load} profileId={profileId} onLocked={sentToPicker} />;
  }
  return <LoadStatus noun="show" failed={load.phase === 'failed'} onRetry={retry} />;
}

export default function ShowDetailPage() {
  // The same boundary as the watch route's, for the same reasons (see `watch/[id]/page.tsx`):
  // `useSearchParams` needs one the day this page is ever prerendered, and the fallback is a
  // real screen with a focus stop, which is what the shell paints until the query is readable.
  return (
    <Suspense fallback={<LoadStatus noun="show" failed={false} onRetry={() => window.location.reload()} />}>
      <ShowScreen />
    </Suspense>
  );
}
