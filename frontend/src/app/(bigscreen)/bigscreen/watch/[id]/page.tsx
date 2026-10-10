'use client';

import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

import type { StreamingInfo, TorrentStatus, VideoFile } from '@/types';
import { streamingService } from '@/services/streaming';
import { torrentsService } from '@/services/torrents';
import { streamAdvice } from '@/lib/player/streamRecovery';
import { deriveStreamHealth } from '@/utils/streamHealth';

import { LoadStatus } from '../../../_components/LoadStatus';
import { LockedRedirect } from '../../../_components/LockedRedirect';
import { TitleScreen } from '../../../_components/TitleScreen';
import { statusOf } from '../../../_data/httpStatus';
import { PREPARING, READY } from '../../../_data/title';
import { useTvProfile } from '../../../_data/useTvProfile';
import { useWatchProgress, watchIdentity } from '../../../_data/useWatchProgress';
import { useBackKey } from '../../../_focus/useBackKey';
import { useFocusGrid } from '../../../_focus/useFocusGrid';
import { useMediaKeys } from '../../../_focus/useMediaKeys';
import { useRevealOnKey, REVEAL_HIDE_MS } from '../../../_focus/useRevealOnKey';
import { classifyStatus, classifyStreamFailure, type StreamFailure } from '../../../_player/classify';
import { createRecovery, type RecoveryStatus } from '../../../_player/recovery';
import { fileIndex, streamSrc } from '../../../_player/fileIndex';
import { formatTime } from '../../../_player/formatTime';
import { ScrubBar, scrubRowCount } from '../../../_player/ScrubBar';
import { clampSeek, type ContiguousRun } from '../../../_player/seekBoundary';
import { MEDIA_TWINS, TransportBar, transportCellCount, type TransportAction } from '../../../_player/TransportBar';
import { useStallWatch } from '../../../_player/useStallWatch';

/**
 * /bigscreen/watch/[id] — the television's player.
 *
 * MUTUALLY EXCLUSIVE CHILDREN, EACH OWNING ITS OWN GRID: the house pattern, and here it is
 * load-bearing rather than tidy. Only one `useFocusGrid` may be live per screen (the
 * listener is on `window` and checks no scope, and effects register CHILD BEFORE PARENT, so
 * of two the INCOMING one is the dead one). `LoadStatus` covers preparing and failed —
 * it already carries the 10s patience timer, a retry that re-arms after a hung retry, an
 * always-present Back and the "a press that is refused says so" label. `LockedRedirect`
 * covers 423. `Gone` is its own render rather than `LoadStatus(failed)`, because there is
 * nothing to retry. `Playing` is the player. `error.tsx` is a tenth consumer of both key
 * hooks and WRAPS this screen, so a throw inside the recovery code — the most likely thing
 * here to throw — lands on a boundary that has its own grid and its own Back.
 *
 * ARRIVING MID-METADATA IS THE DEFAULT CASE, not an edge. `_data/title.ts` puts
 * `downloading_metadata`, `queued`, `checking`, `checking_fastresume` and `allocating` all in
 * PREPARING, and `preparing` NAVIGATES here. So on a normal arrival `/info` 404s and `/files`
 * answers `200 []`.
 *
 * `/files === []` HAS THREE MEANINGS AND ONLY TWO OF THEM ARE "WAIT":
 *   1. a PREPARING state -> genuinely not ready yet: poll `/info` at ~3s (it opens two DB
 *      sessions plus the contiguous walk, so not 1Hz) and stop on unmount;
 *   2. `finished`/`seeding` -> EVICTED BUT PLAYABLE. `find_loadable_on_startup` never re-adds
 *      a finished torrent and `_refresh_active_torrents` evicts one mid-session, so after a
 *      restart the television's main content has no live handle — `/video` and `/info` were
 *      taught to serve it off disk, `/files` was deliberately not. Read as "not ready" this
 *      polls for ever on a title whose every byte is there. It plays.
 *   3. never "this pack has no episodes". It only ever decides which FILE plays.
 *
 * `/info`'s DETAIL STRING CANNOT TELL "NOT READY" FROM "DELETED": the one string is "Video
 * file not found or not ready for streaming" and it is byte-identical to
 * `_resolve_video_file`'s. Only "Torrent not found" is a reliable terminal signal, so the
 * discrimination is done with the torrent's own state from `getTorrentStatus` instead.
 *
 * HIDE IS PAINT ONLY — see `Playing`.
 *
 * BACK IS ONE STATE-SCOPED `useBackKey`, HERE AND NOT IN A CHILD, with its level DERIVED
 * from what the viewer can see. See `backLevel` below.
 */

const HOME = '/bigscreen';
const PROFILES = '/bigscreen/profiles';
const PAIR = '/bigscreen/pair';
const MY_LIST = '/bigscreen/list';

/** `/info`'s one terminal detail. Everything else it says conflates two different facts. */
const TORRENT_NOT_FOUND = 'Torrent not found';

/** The poll while a download is still finding its metadata. Not 1Hz; see the header. */
const PREPARE_POLL_MS = 3000;

/**
 * How often a PLAYING title re-measures the seek boundary. The download frontier moves, and
 * a ceiling measured at arrival is a readout that lies by the minute — the defect class
 * `_data/title.ts` says this surface refuses. `/info` costs two DB sessions and the walk,
 * which is why this is not the 1s the scrub readout runs at.
 */
const INFO_REFRESH_MS = 10_000;

type Arrival =
  | { k: 'loading' }
  | { k: 'failed' }
  | { k: 'gone' }
  | { k: 'ok'; status: TorrentStatus; files: VideoFile[] };

type Boundary =
  | { k: 'unknown' }
  | { k: 'ready'; info: StreamingInfo }
  /** `/info` 404'd with the detail that means "not ready, OR deleted". The state decides. */
  | { k: 'notReady' }
  | { k: 'gone' };

/**
 * The byte under a second, for `/info`'s `at`. `undefined` means "ask about the head".
 *
 * NOT EXPORTED, and neither are the two cadences above: Next validates a page module's
 * exports and rejects anything but its own known fields, so a page file cannot hand a helper
 * to its test. These are exercised through the screen.
 */
function byteAt(
  seconds: number,
  totalSeconds: number | null | undefined,
  size: number | null | undefined,
): number | undefined {
  if (!size || !totalSeconds || !(seconds > 0)) return undefined;
  // CBR arithmetic over a VBR file, exactly as the boundary's own conversion is: this only
  // has to land in the right REGION of the file, which is the whole point of asking at all.
  return Math.max(0, Math.min(size - 1, Math.floor((seconds / totalSeconds) * size)));
}

const detailOf = (err: unknown): string | undefined => {
  const detail = (err as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail;
  return typeof detail === 'string' ? detail : undefined;
};

export default function WatchPage() {
  // THE SUSPENSE BOUNDARY IS DELIBERATE, and it is the first `useSearchParams` on this
  // surface. The plan's reason for it — "`next build` fails without one, and that build runs
  // inside the Docker image build, so getting it wrong breaks an IMAGE rather than a test
  // run" — turns out NOT to apply to this route as it stands, and that was measured rather
  // than assumed: with the boundary deleted, `npm run build` still succeeded. `[id]` is a
  // dynamic segment with no `generateStaticParams`, so this page is rendered on demand (the
  // build lists it as `ƒ`) and the `useSearchParams` bail-out only errors while STATICALLY
  // PRERENDERING.
  //
  // It stays, for two reasons that do not depend on that: adding `generateStaticParams` here
  // — or moving this screen to a static path — would make the build fail the moment someone
  // does it, with an error message that names the hook and not the change; and the fallback
  // is a real screen with a real focus stop, which is what the shell paints while the client
  // bundle arrives. A remote cannot act on a screen with no ring.
  return (
    <Suspense fallback={<Waiting />}>
      <WatchScreen />
    </Suspense>
  );
}

/** What the prerendered shell shows until the query string is readable. */
function Waiting() {
  const grid = useFocusGrid({ rowCounts: [1] });
  return (
    <main className="bs-page">
      <h1>Getting ready…</h1>
      <p>Opening the player.</p>
      <div className="bs-controls">
        <Link href={HOME} className="bs-btn" draggable={false} {...grid.focusProps(0, 0)}>
          Back to home
        </Link>
      </div>
    </main>
  );
}

/**
 * Both ways on from a title that is not there any more, in render order. An ARRAY, so the
 * focus count is `GONE_WAYS_OUT.length` rather than a number kept beside a layout.
 */
const GONE_WAYS_OUT: readonly { href: string; label: string; ghost?: true }[] = [
  { href: HOME, label: 'Back to home' },
  { href: MY_LIST, label: 'My List', ghost: true },
];

/**
 * A terminal 404. NOT `LoadStatus(failed)`: that grows a `Try again` after ten seconds, and
 * there is nothing here a press could change — the torrent is gone from the box.
 */
function Gone({ reason }: { reason: string }) {
  const grid = useFocusGrid({ rowCounts: [GONE_WAYS_OUT.length] });
  return (
    <TitleScreen
      art={null}
      title="This title isn’t on the box any more"
      overview={null}
      actions={
        <>
          {GONE_WAYS_OUT.map((way, col) => (
            <Link
              key={way.href}
              href={way.href}
              className={way.ghost ? 'bs-btn bs-btn--ghost' : 'bs-btn'}
              draggable={false}
              {...grid.focusProps(0, col)}
            >
              {way.label}
            </Link>
          ))}
          <p role="alert" className="bs-title__alert">
            {reason}
          </p>
        </>
      }
    />
  );
}

function WatchScreen() {
  const router = useRouter();
  const torrentId = useParams<{ id: string }>()?.id ?? '';
  const askedIndex = fileIndex(useSearchParams().get('file'));
  const { profile, loading: profileLoading, clear } = useTvProfile();
  const userId = profile?.id ?? null;

  const [arrival, setArrival] = useState<Arrival>({ k: 'loading' });
  const [boundary, setBoundary] = useState<Boundary>({ k: 'unknown' });
  const [attempt, setAttempt] = useState(0);
  const [round, setRound] = useState(0);
  const [redirecting, setRedirecting] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // The player's own state lives HERE, not in `Playing`: Back's level is derived from
  // `visible` and `editOpen`, and the heartbeat needs the playhead. `Playing` owns the
  // element and the engines, and reports.
  const [visible, setVisible] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(Number.NaN);
  const [ended, setEnded] = useState(false);

  // --- the arrival: identity, and which file ---------------------------------------
  useEffect(() => {
    if (!torrentId) {
      setArrival({ k: 'gone' });
      return;
    }
    let cancelled = false;
    setArrival({ k: 'loading' });
    setBoundary({ k: 'unknown' });
    Promise.all([
      torrentsService.getTorrentStatus(torrentId),
      // An unreadable or empty `/files` is UNKNOWN, never "no episodes": it decides which
      // file plays and nothing else, so it may not fail the arrival.
      streamingService.getFiles(torrentId).catch(() => [] as VideoFile[]),
    ])
      .then(([status, files]) => {
        if (cancelled) return;
        setArrival(status ? { k: 'ok', status, files: files ?? [] } : { k: 'gone' });
      })
      .catch((err) => {
        if (cancelled) return;
        // 404 here IS terminal: this is the route whose only 404 detail is "Torrent not found".
        setArrival(statusOf(err) === 404 ? { k: 'gone' } : { k: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [torrentId, attempt]);

  const files = arrival.k === 'ok' ? arrival.files : null;
  /**
   * The file to play. An explicit `?file=` always wins; a BARE arrival on a pack is
   * legitimate (the `unresolvedEpisode` path — the viewer read the disclosure and chose to
   * proceed) and is re-resolved from `/files`, which the backend returns SEASON/EPISODE
   * SORTED. Taking the first entry takes the lowest episode; omitting `file_index` would
   * instead serve `max(files, key=size)` — the largest file, which is not episode 1.
   */
  const index = askedIndex !== undefined ? askedIndex : files?.[0]?.index;
  const chosenFile = files?.find((f) => f.index === index) ?? null;
  const identity = watchIdentity({ status: arrival.k === 'ok' ? arrival.status : null, file: chosenFile });

  const progress = useWatchProgress({
    userId,
    torrentId,
    contentId: identity.contentId,
    title: identity.title,
    fileIndex: index,
    position,
    duration,
    ended,
    // Nothing is recorded before there is playback to record.
    writing: boundary.k === 'ready' || (arrival.k === 'ok' && READY.has(arrival.status.state)),
  });

  // --- 423: the profile is passcode-locked -----------------------------------------
  // Latched: `clear()` changes the profile id, which would re-run the read as "nobody" and
  // could paint a live control before the replace lands.
  useEffect(() => {
    if (!progress.locked || redirecting) return;
    setRedirecting(true);
    clear();
    router.replace(PROFILES);
  }, [progress.locked, redirecting, clear, router]);

  // --- the seek boundary ------------------------------------------------------------
  // Read through refs so the ask can be anchored at the LIVE playhead without putting a
  // 1Hz value in the effect's deps.
  const positionRef = useRef(position);
  const durationRef = useRef(duration);
  useLayoutEffect(() => {
    positionRef.current = position;
    durationRef.current = duration;
  });

  const resume = progress.resume;
  useEffect(() => {
    if (arrival.k !== 'ok' || !resume.ready || !torrentId) return;
    let cancelled = false;
    // ANCHORED AT THE INTENDED PLAYHEAD, NEVER 0. The clamp's playhead lift only rescues
    // "yank backwards": on arrival `currentTime` IS 0, so a resume to 50:20 measured around
    // byte 0 is still reduced to a ceiling that has nothing to do with where the viewer is
    // going. A measurement taken at the wrong offset cannot be fixed later.
    const live = positionRef.current;
    const seconds = live > 0 ? live : resume.atSeconds;
    const liveDuration = durationRef.current;
    const total =
      Number.isFinite(liveDuration) && liveDuration > 0 ? liveDuration : resume.totalSeconds;
    const size = chosenFile?.size ?? null;
    streamingService
      .getStreamingInfo(torrentId, index, byteAt(seconds, total, size))
      .then((info) => {
        if (cancelled) return;
        if (info) setBoundary({ k: 'ready', info });
      })
      .catch((err) => {
        if (cancelled) return;
        const verdict = classifyStatus({
          status: statusOf(err) ?? 0,
          detail: detailOf(err),
        });
        // The ONE string that means the torrent itself is gone. Everything else `/info` says
        // conflates "not ready yet" with "deleted", so the state decides below.
        setBoundary(
          verdict.kind === 'gone' && verdict.detail === TORRENT_NOT_FOUND
            ? { k: 'gone' }
            : { k: 'notReady' },
        );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [torrentId, index, arrival, resume, round, chosenFile?.size]);

  // --- what the screen is ----------------------------------------------------------
  const state = arrival.k === 'ok' ? arrival.status.state : '';
  const evicted = arrival.k === 'ok' && READY.has(state);
  const playable = boundary.k === 'ready' || evicted;
  // `progress.locked` as well as `redirecting`: the lock is known one commit before the
  // redirect latches, and in that commit a `finished` torrent is already "playable" — so the
  // screen would paint a live Play control for one frame to a profile that is passcode-
  // locked. A locked profile never gets one.
  const phase: 'locked' | 'gone' | 'failed' | 'preparing' | 'playing' = redirecting || progress.locked
    ? 'locked'
    : arrival.k === 'gone' || boundary.k === 'gone'
      ? 'gone'
      : arrival.k === 'failed'
        ? 'failed'
        : arrival.k === 'loading' || profileLoading
          ? 'preparing'
          : playable
            ? 'playing'
            : boundary.k === 'notReady' && !PREPARING.has(state)
              ? 'failed'
              : 'preparing';

  // --- the `/info` cadence ---------------------------------------------------------
  useEffect(() => {
    if (phase !== 'preparing' && phase !== 'playing') return;
    if (arrival.k !== 'ok') return;
    const delay = phase === 'playing' ? INFO_REFRESH_MS : PREPARE_POLL_MS;
    const timer = setTimeout(() => setRound((r) => r + 1), delay);
    return () => clearTimeout(timer);
  }, [phase, round, arrival.k]);

  // --- leaving ---------------------------------------------------------------------
  /**
   * Nothing navigates out of the player without writing the position first. `flush()` is
   * synchronous in its effect and the write opts out of apiClient's 401 redirect, so the
   * interceptor cannot destroy the player from inside the rejection handler of this very
   * call. `replace`, never `push`: a pushed watch URL leaves a dead history entry pointing
   * at a torrent that may be gone by the time the viewer walks back to it.
   */
  const leave = useCallback(
    (to: string) => {
      if (leaving) return;
      setLeaving(true);
      progress.flush();
      router.replace(to);
    },
    [leaving, progress, router],
  );

  // --- Back ------------------------------------------------------------------------
  /**
   * ONE `useBackKey`, HERE. Not in a child: effects register child before parent, so a
   * handler in `Playing` would claim the press and this one would never hear it — and the
   * levels below belong to the screen, not to the band.
   *
   * THE LEVEL IS DERIVED, NEVER COUNTED. A counter would sit at rung 2 after the first
   * press, so the press after a REVEAL would leave the player while the controls were on
   * screen. `visible` and `editOpen` are self-correcting.
   *
   * LEVEL 3 IS NOT BUILT. Home's own Back is a documented no-op (`stayOnHome`) and stage 10
   * owes both of them a real exit; inventing one here would be inventing the shell.
   */
  const onBack = useCallback(() => {
    if (phase === 'playing' && editOpen) {
      // Cancelling is the cell's own `onBlur`, so the cancel is a blur and an immediate
      // refocus of the SAME element: the edit goes and the ring does not move.
      const el = document.activeElement as HTMLElement | null;
      if (el && typeof el.blur === 'function') {
        el.blur();
        el.focus();
        return;
      }
    }
    if (phase === 'playing' && visible) {
      setVisible(false);
      return;
    }
    leave(HOME);
  }, [phase, editOpen, visible, leave]);
  useBackKey(onBack);

  // --- the verdicts only the screen can act on -------------------------------------
  const onTerminal = useCallback(
    (failure: StreamFailure) => {
      // A 401 mid-film means the session is gone, and this surface's front door is pairing,
      // not a sign-in form a remote cannot fill in. The position is flushed on the way.
      if (failure.kind === 'session') leave(PAIR);
      else if (failure.kind === 'gone') setBoundary({ k: 'gone' });
    },
    [leave],
  );

  if (phase === 'locked') return <LockedRedirect />;
  if (phase === 'gone') {
    return (
      <Gone reason="The download this was playing from is no longer on the box. Nothing here can bring it back." />
    );
  }
  if (phase === 'playing' && arrival.k === 'ok') {
    const src = streamSrc(torrentId, index);
    if (src) {
      return (
        <Playing
          src={src}
          status={arrival.status}
          contiguous={boundary.k === 'ready' ? boundary.info.video_file.contiguous ?? null : null}
          resumeAtSeconds={resume.ready ? resume.atSeconds : 0}
          position={position}
          duration={duration}
          visible={visible}
          editOpen={editOpen}
          onVisible={setVisible}
          onEditOpen={setEditOpen}
          onPosition={setPosition}
          onDuration={setDuration}
          onEnded={setEnded}
          onTerminal={onTerminal}
          onStop={() => leave(HOME)}
        />
      );
    }
  }
  return (
    <LoadStatus
      noun="title"
      failed={phase === 'failed'}
      onRetry={() => {
        setAttempt((a) => a + 1);
      }}
    />
  );
}

// ===================================================================================
// The player
// ===================================================================================

/**
 * The film, the scrim and the control band.
 *
 * HIDE IS PAINT ONLY, and the two reasons are separately verified rather than argued:
 *
 *  - A HIDE THAT BLURS IS PERMANENT. `display: none`, `visibility: hidden`, `inert`,
 *    `hidden` and unmounting all drop DOM focus to `<body>`, and with the grid's counts
 *    UNCHANGED its reconcile effect never re-runs (its deps are `[shape, …]`), the ref
 *    callback has deleted the element, and `go` bails on `!el.isConnected`. The ring is
 *    nowhere, for ever, on a surface with no Tab key.
 *  - A ZERO-COUNT HIDE DOES NOT RESTORE THE CELL. The empty pass writes `NO_TARGET` and the
 *    next reconcile clamps to `firstTarget` — first populated row, column 0 — so every
 *    auto-hide would dump the viewer onto the scrub bar.
 *
 * So the band stays mounted with its counts intact, `--hidden` sets `opacity: 0` and nothing
 * else (the stylesheet test pins that), and `pointer-events: none` is banned outright while a
 * descendant holds focus. The scrim and the hint hold no focus, so those may come and go.
 *
 * THE POINTER REVEALS TOO. The Magic Remote's gyro cursor can click a control at
 * `opacity: 0`, and `pointer-events: none` is not available to stop it, so pointer activity
 * has to wake the band exactly as a key press does. `useRevealOnKey` composes with this but
 * watches only keys.
 *
 * IT OWNS THE ONE LIVE `useFocusGrid`, with `rowCounts = [scrub, transport]`: the scrub row
 * is declared first and renders nothing until `loadedmetadata`, so the ring lands on
 * Play/Pause on arrival and moves up to the bar when the row appears.
 *
 * THE PLAY/PAUSE STATE IS READ FROM EVENTS, NEVER FROM `video.paused`. `load()` — the first
 * thing a recovery does — sets `paused` with no `pause` event, so a label derived from the
 * property flips to "Play" every time the ladder runs. `useStallWatch`'s header has the same
 * rule for the same mechanism.
 */
function Playing({
  src,
  status,
  contiguous,
  resumeAtSeconds,
  position,
  duration,
  visible,
  editOpen,
  onVisible,
  onEditOpen,
  onPosition,
  onDuration,
  onEnded,
  onTerminal,
  onStop,
}: {
  src: string;
  status: TorrentStatus;
  contiguous: ContiguousRun | null;
  resumeAtSeconds: number;
  position: number;
  duration: number;
  visible: boolean;
  editOpen: boolean;
  onVisible: (visible: boolean) => void;
  onEditOpen: (open: boolean) => void;
  onPosition: (seconds: number) => void;
  onDuration: (seconds: number) => void;
  onEnded: (ended: boolean) => void;
  onTerminal: (failure: StreamFailure) => void;
  onStop: () => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const getVideo = useCallback(() => ref.current, []);
  const [playing, setPlaying] = useState(true);
  const [failure, setFailure] = useState<StreamFailure | null>(null);
  const [recovery, setRecovery] = useState<RecoveryStatus>({ kind: 'idle' });
  const [resumeNote, setResumeNote] = useState('');

  // One engine for the life of this element. `onStatus` is the readout; the ladder, the
  // attempt bound and the exhaustion latch are the engine's.
  const [engine] = useState(() => createRecovery({ getVideo, onStatus: setRecovery }));
  useEffect(() => () => engine.dispose(), [engine]);

  const stall = useStallWatch({
    getVideo,
    // A freeze the browser never surfaced. The engine's latch, not this one, decides whether
    // anything is actually done about it.
    onEscalate: () => engine.attempt(),
  });

  const contiguousRef = useRef(contiguous);
  const durationRef = useRef(duration);
  useLayoutEffect(() => {
    contiguousRef.current = contiguous;
    durationRef.current = duration;
  });

  // --- the seek, in one place so the boundary cannot be bypassed --------------------
  /**
   * Every seek on this surface goes through the clamp. It answers a finite second at or
   * ahead of the playhead for a forward press, so assigning it can never move the viewer
   * backwards, and it always answers a REASON — a press is never silently refused here.
   */
  const seekTo = useCallback(
    (target: number) => {
      const video = ref.current;
      if (!video) return;
      const verdict = clampSeek({
        target,
        currentTime: video.currentTime,
        duration: durationRef.current,
        contiguous: contiguousRef.current,
      });
      if (verdict.seconds !== video.currentTime) video.currentTime = verdict.seconds;
      onPosition(Math.floor(verdict.seconds));
    },
    [onPosition],
  );

  const act = useCallback(
    (action: TransportAction) => {
      const video = ref.current;
      if (!video) return;
      switch (action) {
        case 'playPause':
          if (playing) video.pause();
          else void video.play()?.catch?.(() => {});
          return;
        case 'back10':
          seekTo(video.currentTime - 10);
          return;
        case 'back60':
          seekTo(video.currentTime - 60);
          return;
        case 'forward60':
          seekTo(video.currentTime + 60);
          return;
        case 'retry':
          setFailure(null);
          engine.attempt();
          return;
        case 'stop':
          // Reported, never navigated from inside the cell: the position has to be flushed
          // before anything leaves the player.
          onStop();
          return;
        default:
          return;
      }
    },
    [playing, seekTo, engine, onStop],
  );

  // --- the auto-hide ---------------------------------------------------------------
  /**
   * Suppressed while the title is paused, while an edit is open, and while a message is on
   * screen: all three are states in which the band is the only thing telling the viewer
   * what is going on.
   */
  const message = messageFor({ failure, recovery, stall, status, resumeNote });
  const mayHide = playing && !editOpen && message === '';
  const mayHideRef = useRef(mayHide);
  useLayoutEffect(() => {
    mayHideRef.current = mayHide;
  });

  const reveal = useCallback(() => onVisible(true), [onVisible]);
  const hide = useCallback(() => {
    if (mayHideRef.current) onVisible(false);
  }, [onVisible]);
  useRevealOnKey({ visible, onReveal: reveal, onHide: hide });

  // The gyro cursor, which can click what it cannot see. A ref-held timer and a reveal only
  // while hidden, so a moving pointer cannot re-render the band once per sample.
  const visibleRef = useRef(visible);
  useLayoutEffect(() => {
    visibleRef.current = visible;
  });
  const latestHide = useRef(hide);
  const latestReveal = useRef(reveal);
  useLayoutEffect(() => {
    latestHide.current = hide;
    latestReveal.current = reveal;
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onPointer = () => {
      if (!visibleRef.current) latestReveal.current();
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        latestHide.current();
      }, REVEAL_HIDE_MS);
    };
    window.addEventListener('pointermove', onPointer);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  // Every media key has a focusable twin in the transport row, so an unrecognised one is a
  // missing SHORTCUT and never a missing feature. Nothing about this set's key codes has
  // ever been read.
  useMediaKeys((action) => act(MEDIA_TWINS[action]));

  // --- the element ------------------------------------------------------------------
  // The resume seek is a ONE-SHOT: `loadedmetadata` is the first moment `duration` exists,
  // and the clamp needs it. No prompt — the control the viewer pressed already said "Resume
  // from 1:02:05", and a player that then started at 0:00 would be a label that lied.
  const resumed = useRef(false);
  useEffect(() => {
    resumed.current = false;
    // The cleanup's two jobs: clear a pending reload AND detach the one-shot restore. Drop
    // either and a title change leaks a reload plus a listener that will seek the NEXT title
    // to the previous one's playhead.
    engine.noteSourceChange();
  }, [src, engine]);

  const onLoadedMetadata = () => {
    const video = ref.current;
    if (!video) return;
    onDuration(video.duration);
    if (resumed.current) return;
    resumed.current = true;
    const want = resumeAtSeconds;
    if (!(want > 0)) return;
    const verdict = clampSeek({
      target: want,
      currentTime: video.currentTime,
      duration: video.duration,
      contiguous: contiguousRef.current,
    });
    if (verdict.seconds > 0) video.currentTime = verdict.seconds;
    onPosition(Math.floor(verdict.seconds));
    // Reduced, and so said out loud: the download has not reached where the viewer was.
    if (verdict.seconds < want) {
      setResumeNote(
        `Carrying on from ${formatTime(verdict.seconds, video.duration)} — the download hasn’t reached ${formatTime(want, video.duration)} yet.`,
      );
    }
  };

  // Whole seconds only. `timeupdate` fires about four times a second, and a re-render of the
  // band per event is four re-renders a second composited over a decoding 1080p surface for
  // the length of the film — for a readout that shows whole seconds anyway.
  const onTimeUpdate = () => {
    const video = ref.current;
    if (!video) return;
    const whole = Math.floor(video.currentTime);
    if (whole !== position) onPosition(whole);
  };

  const onError = () => {
    // A HEAD probe, never a ranged GET: every `GET /video` runs `prioritize_video_files` +
    // `force_start_for_stream` (a DB write) and re-deadlines 32 pieces at the FILE HEAD, so
    // a "cheap probe" hijacks libtorrent's deadline queue away from the live playhead.
    void classifyStreamFailure({ src }).then((verdict) => {
      if (!ref.current) return;
      setFailure(verdict);
      if (verdict.kind === 'session' || verdict.kind === 'gone') {
        onTerminal(verdict);
        return;
      }
      // Bounded, because one of the three 503 paths is the catch-all and covers permanent
      // faults with the same status, the same Retry-After and the same empty body.
      engine.attempt(verdict.kind === 'retry' ? verdict.afterMs : undefined);
    });
  };

  const rowCounts = [scrubRowCount(duration), transportCellCount({ retry: !!failure })];
  const grid = useFocusGrid({ rowCounts });

  return (
    <div className="bs-player">
      <video
        ref={ref}
        className="bs-player__video"
        src={src}
        // `metadata`, not the web's `auto`: a 1080p stream pre-buffered aggressively on TV
        // silicon competes with its own decode.
        preload="metadata"
        autoPlay
        playsInline
        // NO `tabIndex`, and no `controls`: the element is not a focus stop (the ring belongs
        // to the band, and `journeys.test.tsx` counts exactly one), and the platform's own
        // control UI would eat the arrows and the media keys.
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onPlay={() => {
          setPlaying(true);
          onEnded(false);
        }}
        onPlaying={() => {
          setPlaying(true);
          setFailure(null);
          setResumeNote('');
          engine.noteHealthy();
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          onEnded(true);
        }}
        onError={onError}
      />
      <div className="bs-player__scrim" aria-hidden="true" />
      {/* The band FADES; it is never unmounted and its counts never change. Its child order
          is written into the stylesheet's own block: the stream's hint, then the scrub cell
          (which brings its own hint and its row), then the transport row. The hint is
          `.bs-player__hint` and not `.bs-msg`, which carries `padding: 0 var(--safe-x)`
          itself and would sit 192px from each edge inside a band that already has the safe
          inset. */}
      <div className={visible ? 'bs-player__bar' : 'bs-player__bar bs-player__bar--hidden'}>
        {message !== '' && (
          <p className="bs-player__hint" role="status">
            {message}
          </p>
        )}
        <ScrubBar
          row={0}
          focusProps={grid.focusProps}
          position={position}
          duration={duration}
          contiguous={contiguous}
          onSeek={seekTo}
          onEditOpen={onEditOpen}
        />
        <TransportBar
          row={1}
          focusProps={grid.focusProps}
          playing={playing}
          retry={!!failure}
          onAction={act}
        />
      </div>
    </div>
  );
}

/**
 * The one line the band says about the stream, in precedence order so a readout can never
 * disagree with itself.
 *
 * `busy` IS WHY `streamAdvice` TAKES IT. A finished, 0-peer torrent playing perfectly off
 * disk reads as a dead swarm otherwise — which is what the web says today, because it passes
 * `true` unconditionally. Here the advice is asked for only while the stream is actually
 * being waited on.
 */
function messageFor({
  failure,
  recovery,
  stall,
  status,
  resumeNote,
}: {
  failure: StreamFailure | null;
  recovery: RecoveryStatus;
  stall: 'ok' | 'frozen' | 'buffering';
  status: TorrentStatus;
  resumeNote: string;
}): string {
  if (failure?.kind === 'session') return 'This television needs to be paired again. Taking you back to pairing.';
  if (failure?.kind === 'badRequest') {
    return 'The box could not make sense of this request. Press Stop and start the title again.';
  }
  if (recovery.kind === 'exhausted') {
    return failure?.kind === 'decode'
      ? 'The file is on the box, but this television cannot play it. Press Stop to leave.'
      : 'The stream could not be kept going. Press Try again, or Stop to leave.';
  }
  if (recovery.kind === 'scheduled' || recovery.kind === 'reloading') {
    return `Lost the stream — trying again (attempt ${recovery.attempt}).`;
  }
  if (stall !== 'ok') {
    switch (streamAdvice(deriveStreamHealth(status), true)) {
      case 'noPeers':
        return 'Waiting for the download — nothing is sharing this right now.';
      case 'slow':
        return 'Buffering — the download is slower than playback.';
      default:
        return 'Buffering…';
    }
  }
  return resumeNote;
}
