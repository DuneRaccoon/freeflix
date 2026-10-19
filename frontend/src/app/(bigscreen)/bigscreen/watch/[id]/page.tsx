'use client';

import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

import type { StreamingInfo, SubtitleList, TorrentStatus, VideoFile } from '@/types';
import { streamingService } from '@/services/streaming';
import { torrentsService } from '@/services/torrents';
import { streamAdvice } from '@/lib/player/streamRecovery';
import { deriveStreamHealth } from '@/utils/streamHealth';

import { LoadStatus } from '../../../_components/LoadStatus';
import { LockedRedirect } from '../../../_components/LockedRedirect';
import { TitleScreen } from '../../../_components/TitleScreen';
import { statusOf } from '../../../_data/httpStatus';
import { cellLabel, type SubtitleCellState } from '../../../_data/subtitles';
import { PREPARING, READY, takeFourKAsk } from '../../../_data/title';
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
import {
  MEDIA_TWINS,
  TransportBar,
  transportCellCount,
  type SubtitleCellView,
  type TransportAction,
} from '../../../_player/TransportBar';
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

/**
 * How long the "we could not resume you where you were" sentence stays on screen.
 *
 * It used to be cleared by the `playing` event, which follows `loadedmetadata` by a frame or
 * two on a healthy start — so the one sentence that tells the viewer their resume was reduced
 * was readable for well under a second at three metres (measured by the branch review). It is
 * dismissed by TIME, or by the viewer's first press, and never by playback starting: playback
 * starting is the event that makes the sentence true, not the one that answers it.
 */
const RESUME_NOTE_MS = 8000;

/**
 * THE BUCKET THAT ACTUALLY ARRIVED, and the two sentences that say so.
 *
 * `status.quality` IS THE ONE FIELD TO READ, and the near-miss is the whole hazard:
 * `chosen_quality` is the field whose NAME says what you want and whose VALUE is always
 * null — `api/torrents.py` sets it on the download RESPONSE only, while `to_status()`
 * (`database/models/torrents.py:57-84`) never populates it, so every poll this route
 * makes answers null and a disclosure built on it is silently empty for ever.
 * `_data/title.ts` records the same fact for the same reason.
 *
 * WHAT THE ROW CAN AND CANNOT SAY. `quality` is the bucket of the release the selector
 * CHOSE (`chosen.quality or request.quality`), not the bucket that was ASKED FOR, and
 * nothing on this route carries the ask: the watch URL is `/bigscreen/watch/{id}?file=N`
 * and nothing else (`_data/watchHref.ts`), `router.push` carries no state, and
 * `TorrentStatus` has no requested-quality field. So "you asked for 4K and got HD" is NOT
 * sayable here — a 1080p row is a 1080p ask and a downgraded 4K ask at once,
 * indistinguishable. Rather than guess, this says only what arrived, and only when what
 * arrived is a bucket this television NEVER asks for (`title.ts` asks 1080p, or 2160p on
 * the per-title opt-in). That keeps it silent on the ask it cannot read and non-vacuous
 * on the one it can — and silence on an ordinary arrival is load-bearing twice over,
 * because a line in this slot is a line `mayHide` may not fade out from under.
 */
const BELOW_ANY_ASK: ReadonlySet<string> = new Set(['720p', '480p']);

/** Named, because the decode verdict needs the same test. */
const BUCKET_4K = '2160p';

type Arrival =
  | { k: 'loading' }
  | { k: 'failed' }
  | { k: 'gone' }
  | { k: 'ok'; status: TorrentStatus; files: VideoFile[] };

/**
 * The sidecar list read. THREE STATES, because `null` would be two of them at once — the
 * list that has not answered and the list that answered badly are different sentences on
 * the Subtitles cell, and the whole reason D6 put `coverage` in the envelope is that a bare
 * empty answer already carries too many meanings on this backend.
 */
type SubtitleRead =
  | { k: 'loading' }
  | { k: 'failed' }
  | { k: 'ok'; list: SubtitleList };

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

/**
 * Which of the eight cell states the sidecar list puts the Subtitles cell in.
 *
 * FOUR OF THE EIGHT ARE REACHABLE FROM A LIST ALONE, and the other four describe a sidecar
 * the viewer has chosen, which nothing on this surface can do yet. So this covers `loading`,
 * `unavailable`, `none` and `off`, and the picker's press is what will reach `fetching`, `on`,
 * `unreadable` and `noCues`.
 *
 * `coverage: "listed"` IS `off` EVEN WITH NOTHING OFFERABLE. A release that ships only an
 * `.ass` is listed, and `none in this release` would be a false sentence about it — the file
 * is there, in the release, and the box simply cannot convert it. The picker is where that is
 * said out loud, with the format and the reason on the row; the cell says only that nothing
 * is showing, which is true.
 *
 * ANYTHING THAT IS NOT `listed` OR `none` IS `unavailable`, including a coverage value this
 * build has never heard of. Three is the whole set today (`SubtitleCoverage`) and a fourth
 * was declined deliberately, but the one answer this may not produce is a cell that says
 * nothing at all.
 */
function subtitleCellState(read: SubtitleRead): SubtitleCellState {
  if (read.k === 'loading') return 'loading';
  if (read.k === 'failed') return 'unavailable';
  if (read.list.coverage === 'none') return 'none';
  if (read.list.coverage !== 'listed') return 'unavailable';
  return 'off';
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
  /**
   * THE LATCH: has this screen ever been playable? Once it has, a re-measure may not take
   * the player away — only a terminal answer or a new arrival may.
   *
   * This is the second of two defences against the same failure and it is deliberately the
   * blunter one. The first (below, in the boundary's `catch`) is what the behaviour rests
   * on: a failed REFRESH writes nothing, so nothing can turn into "not ready". This one is
   * the guard against the next writer of `notReady` that someone adds without noticing that
   * the same state gates whether the player exists at all. With both in place neither can be
   * mutated out on its own — see the report; the pair is demonstrated instead.
   */
  const [started, setStarted] = useState(false);

  // The player's own state lives HERE, not in `Playing`: Back's level is derived from
  // `visible` and `editOpen`, and the heartbeat needs the playhead. `Playing` owns the
  // element and the engines, and reports.
  /**
   * Did the press that started this torrent ask for 4K? `_data/title.ts` is the only
   * thing that knows, and it answers ONCE — so the answer is taken here and held, never
   * re-read per render.
   *
   * ONE TAKE PER TORRENT ID, keyed on the id rather than on "ever": the `id` in the ref
   * is what makes a title change ask again, and a test pins that half.
   *
   * THE REF'S OTHER HALF IS DELIBERATELY UNFALSIFIABLE HERE, MEASURED RATHER THAN
   * ASSUMED. Deleting it entirely leaves the suite green (49/49), because `render()` is
   * not wrapped in StrictMode and `[torrentId]` already prevents a re-run — so no fixture
   * in this harness can produce the double-invoke. It stays for two reasons that do not
   * depend on this suite: StrictMode double-invokes an effect on the SAME instance in
   * dev, and the second pass would read an emptied slot and write `false` over the `true`
   * the first pass took; and the sibling arrival effect three dozen lines down is keyed
   * `[torrentId, attempt]`, so "add `attempt` here too" is one plausible edit away from
   * spending the ask on a retry press. Recorded instead of covered by a green test.
   *
   * A genuine remount (a reload) starts with an empty ref AND an empty slot, which is the
   * cold-load case — the ask is unknown, and nothing is claimed about it.
   */
  const [askedFourK, setAskedFourK] = useState(false);
  const askTakenFor = useRef<string | null>(null);
  useEffect(() => {
    if (askTakenFor.current === torrentId) return;
    askTakenFor.current = torrentId;
    setAskedFourK(takeFourKAsk(torrentId));
  }, [torrentId]);

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
    // A NEW ARRIVAL IS ALLOWED to take the player down (it is the retry press, or a new
    // torrent id); the latch is about re-measures, not about arrivals. And the playhead goes
    // with it: a `position` carried across a title change would make the resume below seek
    // the NEW title to the previous one's playhead.
    setStarted(false);
    setPosition(0);
    setDuration(Number.NaN);
    setEnded(false);
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

  // --- the sidecar list -------------------------------------------------------------
  /**
   * ONE READ PER (TITLE, FILE), AND NO POLL. The Subtitles cell has to say something from
   * the moment the band exists, so "has not answered yet" is a state of its own here rather
   * than an empty list: `{k:'loading'}` is `checking`, and an empty `subtitles` array with
   * `coverage: "none"` is the quite different `none in this release`. Waiting for a chosen
   * sidecar's bytes is a poll (`_data/subtitles.pollSubtitles`) and belongs to the press that
   * chooses one, not here.
   *
   * KEYED ON THE RESOLVED FILE INDEX, and gated on the arrival, because `index` is undefined
   * until `/files` answers and the list the television wants is the one filtered to the
   * episode on screen. Reading before the arrival settles would ask for the whole pack's
   * sidecars and then ask again — two libtorrent file walks for one answer.
   *
   * `allow401` IS NOT OPTIONAL HERE. Without it apiClient's rejection interceptor
   * hard-navigates to `/bigscreen/pair` from inside its own handler, behind a module-scoped
   * flag it never resets — so one 401 on a subtitle list would take the viewer out of the
   * film, and a subtitle list is never worth that. `saveProgress` opts out for the same
   * reason and `services/streaming.subtitles.test.ts` is where the opt-out is proved.
   *
   * EVERY FAILED READ IS `unavailable`, and that is deliberate rather than lazy: the eight
   * cell states are the eight things the television can say, `unreadable` means a sidecar
   * this box cannot decode, and a cell left saying `checking` for the rest of the film would
   * be the only one of the eight that is a lie. An operator who needs the difference has the
   * backend log; a viewer's next press is the same either way.
   */
  const [subtitleRead, setSubtitleRead] = useState<SubtitleRead>({ k: 'loading' });
  const arrived = arrival.k === 'ok';
  useEffect(() => {
    // Before the guard: a new arrival or a new file invalidates the old answer, and a stale
    // `off` on a title whose list has not been read yet is a claim nothing measured.
    setSubtitleRead({ k: 'loading' });
    if (!torrentId || !arrived) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await streamingService.getSubtitles(torrentId, index, { allow401: true });
        if (!cancelled) setSubtitleRead({ k: 'ok', list });
      } catch {
        // Deliberately not narrowed. A 404 (unknown torrent), a 401 (dead session, which the
        // flag above kept from navigating), a 503 and a service that is not there at all all
        // mean the same thing to the one cell that reads this: nothing to offer.
        if (!cancelled) setSubtitleRead({ k: 'failed' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [torrentId, index, arrived]);

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
        // The ONE string that means the torrent itself is gone. Terminal whenever it arrives,
        // arrival or refresh: a deleted file cannot be played on.
        if (verdict.kind === 'gone' && verdict.detail === TORRENT_NOT_FOUND) {
          setBoundary({ k: 'gone' });
          return;
        }
        // A FAILED RE-MEASURE IS NOT AN ARRIVAL, and this is the whole of it. `notReady` is a
        // statement about whether the title can be played, and `playable` gates whether the
        // player EXISTS — so writing it here from a 503, a 500 or a timeout on the periodic
        // re-measure tore the player down mid-film, remounted it, replayed from the
        // arrival-time resume value and then wrote that over the viewer's real position.
        // (Measured by the branch review: `[1200]` became `[1200, 6]`.)
        //
        // So once the player has started, a failed refresh writes NOTHING: the last good
        // answer stands. That is also the honest reading of the measurement — the run only
        // ever GROWS, so yesterday's run is a safe subset of today's, while dropping it to
        // `null` would mean "nobody measured" and go UNBOUNDED, permitting exactly the seek
        // past the frontier that hangs the stream for 300s with the status code already
        // spent. The next tick asks again.
        if (startedRef.current) return;
        // The ARRIVAL ask, where "not ready, or deleted" is true and the state decides.
        setBoundary({ k: 'notReady' });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [torrentId, index, arrival, resume, round, chosenFile?.size]);

  // --- what the screen is ----------------------------------------------------------
  const state = arrival.k === 'ok' ? arrival.status.state : '';
  const evicted = arrival.k === 'ok' && READY.has(state);
  // `|| started`: see the latch. A screen that has been playable stays playable until a
  // terminal answer or a new arrival says otherwise.
  const playable = boundary.k === 'ready' || evicted || started;
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

  const startedRef = useRef(started);
  useLayoutEffect(() => {
    startedRef.current = started;
  });
  useEffect(() => {
    if (phase === 'playing' && !started) setStarted(true);
  }, [phase, started]);

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
      // Both halves from the one state, so the attribute and the words can never disagree
      // about which state the screen believes it is in.
      const subtitleState = subtitleCellState(subtitleRead);
      const subtitles: SubtitleCellView = { stateId: subtitleState, note: cellLabel(subtitleState) };
      return (
        <Playing
          src={src}
          status={arrival.status}
          subtitles={subtitles}
          askedFourK={askedFourK}
          contiguous={boundary.k === 'ready' ? boundary.info.video_file.contiguous ?? null : null}
          // THE LIVE PLAYHEAD WINS. The resume read happens once on arrival and is never
          // refreshed, so a `Playing` that remounts for any reason would otherwise seek back
          // to where the viewer was when they arrived — 0 on a fresh watch — and the
          // heartbeat would then write that over their real position. `position` is reset
          // with every new arrival (above), so this can only ever be the same title's.
          resumeAtSeconds={Math.max(resume.ready ? resume.atSeconds : 0, position)}
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
  subtitles,
  askedFourK,
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
  /**
   * What the Subtitles cell says. IT GOES TO THE CELL AND NOWHERE ELSE — never into
   * `messageFor`. `mayHide` is `playing && !editOpen && message === ''`, so a steady sentence
   * in that slot pins the 480px band over the picture for the rest of the film; stage 8
   * measured exactly that, and a subtitle state is steady by nature.
   */
  subtitles: SubtitleCellView;
  /** The press that started this torrent asked for 2160p. False also means "unknown". */
  askedFourK: boolean;
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
  /**
   * The arrival disclosure's window: open on arrival, closed by time or by the viewer's
   * first press, exactly like the resume note and for the same reason (it must be
   * readable at three metres, and it must not be readable for the rest of the film).
   *
   * A BOOLEAN WINDOW, NOT A STORED SENTENCE: the sentence is derived from the row inside
   * `messageFor`, so the field it is derived FROM is what a mutation lands on. A string
   * set once at arrival would keep reporting the first poll's bucket, and would survive
   * reading the wrong field at all.
   */
  const [discloseArrival, setDiscloseArrival] = useState(true);

  // Held in a ref so the engine's one-shot `onStatus` closure always calls the current
  // props, rather than the ones the first render happened to have.
  const latestDuration = useRef(onDuration);
  useLayoutEffect(() => {
    latestDuration.current = onDuration;
  });

  // One engine for the life of this element. `onStatus` is the readout; the ladder, the
  // attempt bound and the exhaustion latch are the engine's.
  const [engine] = useState(() =>
    createRecovery({
      getVideo,
      onStatus: (status) => {
        setRecovery(status);
        // `load()` HAS JUST BEEN CALLED, so the element's `duration` is NaN until
        // `loadedmetadata` lands again. Writing that through is what makes the scrub row
        // actually disappear and come back — which is what `ScrubBar`'s render-phase
        // pending-edit reset is written for, and without this the premise was false: the
        // route's `duration` STATE was only ever written by `onLoadedMetadata`, so the row
        // never went away and an edit opened mid-stall stayed committable by OK against a
        // duration that no longer existed. Measured by the branch review: the cell still read
        // "OK jumps to 20:10" throughout a recovery.
        if (status.kind === 'reloading') latestDuration.current(Number.NaN);
      },
    }),
  );
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
      // THE VIEWER'S CHOICE IS NEWER THAN THE ENGINE'S CAPTURE. A recovery captures the
      // playhead before `load()` and restores it on the next `loadedmetadata`; a press in
      // that window would otherwise be silently undone.
      engine.noteSeek();
    },
    [onPosition, engine],
  );

  const act = useCallback(
    (action: TransportAction) => {
      const video = ref.current;
      if (!video) return;
      // A press is the viewer answering the note, whatever the press was — and whichever
      // of the two notes is up.
      setResumeNote('');
      setDiscloseArrival(false);
      switch (action) {
        case 'playPause':
          if (playing) video.pause();
          else void video.play()?.catch?.(() => {});
          return;
        // DISCRETE AND IDEMPOTENT. The remote's ▶ and ⏸ are two keys, not a toggle: a viewer
        // pressing ▶ on a playing title must not stop it. Both still live on the one
        // focusable cell (`TWIN_CELL`), so the on-screen-twin contract is untouched.
        case 'play':
          if (!playing) void video.play()?.catch?.(() => {});
          return;
        case 'pause':
          if (playing) video.pause();
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
        case 'subtitles':
          // NOTHING YET, AND THIS CASE EXISTS TO SAY SO. The cell ships unconditionally
          // ahead of the picker that answers it (the list resolves asynchronously, so a cell
          // that arrived with the list would be a mid-row insertion), and the press is
          // therefore a deliberate no-op until the picker lands. It is not "handled": a
          // reviewer reading this switch should see an unfinished control, not a finished
          // one, and no test here claims a press does anything.
          return;
        default:
          return;
      }
    },
    [playing, seekTo, engine, onStop],
  );

  // Long enough to read at three metres, and it suppresses the auto-hide while it is up (a
  // message on screen is one of the three suppressions), so the band cannot fade out from
  // under the sentence.
  useEffect(() => {
    if (resumeNote === '') return;
    const timer = setTimeout(() => setResumeNote(''), RESUME_NOTE_MS);
    return () => clearTimeout(timer);
  }, [resumeNote]);

  // The same clock for the arrival disclosure, re-armed per `src` so a title change gets
  // its own one — unconditionally, because the window has to close whether or not this
  // row's bucket was worth naming (a row that changes bucket mid-poll must not reopen it).
  useEffect(() => {
    setDiscloseArrival(true);
    const timer = setTimeout(() => setDiscloseArrival(false), RESUME_NOTE_MS);
    return () => clearTimeout(timer);
  }, [src]);

  // --- the auto-hide ---------------------------------------------------------------
  /**
   * Suppressed while the title is paused, while an edit is open, and while a message is on
   * screen: all three are states in which the band is the only thing telling the viewer
   * what is going on.
   */
  const message = messageFor({ failure, recovery, stall, status, resumeNote, discloseArrival, askedFourK });
  const mayHide = playing && !editOpen && message === '';
  const mayHideRef = useRef(mayHide);
  useLayoutEffect(() => {
    mayHideRef.current = mayHide;
  });

  const reveal = useCallback(() => onVisible(true), [onVisible]);
  // REPORTS THE REFUSAL, so the quiet period is served again instead of being spent on a
  // hide this screen was never going to allow. Without the return value a note that
  // outlives the period (8s against 5s) left the band over the picture for the rest of
  // the film — see `useRevealOnKey`'s own header for the contract.
  const hide = useCallback(() => {
    if (!mayHideRef.current) return false;
    onVisible(false);
    return true;
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
      // NOTHING TO RETRY: the box has rejected the request itself (422/416), so the same
      // request four more times is four more deadline recomputes for nothing — and the
      // message tells the viewer to press Stop, so a focusable Retry beside it would be a
      // control the sentence says not to use. Structurally unreachable today (see the test);
      // kept coherent for the day it is not.
      if (verdict.kind === 'badRequest') return;
      // Bounded, because one of the three 503 paths is the catch-all and covers permanent
      // faults with the same status, the same Retry-After and the same empty body.
      engine.attempt(verdict.kind === 'retry' ? verdict.afterMs : undefined);
    });
  };

  // The Retry cell is offered only for a failure a press can change. `badRequest` is not
  // one, and `session`/`gone` leave the player altogether.
  const retryable = failure !== null && failure.kind !== 'badRequest';
  const rowCounts = [scrubRowCount(duration), transportCellCount({ retry: retryable })];
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
          // NOT `setResumeNote('')`: see RESUME_NOTE_MS. `playing` arrives a frame or two
          // after the seek that the sentence is about.
          engine.noteHealthy();
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          onEnded(true);
        }}
        onError={onError}
      />
      {/* The scrim FADES WITH THE BAND, on the same `visible` flag and never on `playing`.
          It exists to make the band legible, and native text-track cues paint inside the
          video element's box — the other `z-index: -1` layer, earlier in source order — so
          a scrim that stays up paints over every cue for the whole film and the auto-hide
          does not rescue them. Faded rather than unmounted: the stylesheet does license
          unmounting it (it holds no focus), but a 480px layer appearing and disappearing is
          a repaint where the point was a composited fade. */}
      <div
        className={visible ? 'bs-player__scrim' : 'bs-player__scrim bs-player__scrim--hidden'}
        aria-hidden="true"
      />
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
          retry={retryable}
          subtitles={subtitles}
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
  discloseArrival,
  askedFourK,
}: {
  failure: StreamFailure | null;
  recovery: RecoveryStatus;
  stall: 'ok' | 'frozen' | 'buffering';
  status: TorrentStatus;
  resumeNote: string;
  /** The arrival disclosure's one-shot window; see `BELOW_ANY_ASK` and `Playing`. */
  discloseArrival: boolean;
  /** This client's own 4K press, taken from `title.ts`. False also means "unknown". */
  askedFourK: boolean;
}): string {
  if (failure?.kind === 'session') return 'This television needs to be paired again. Taking you back to pairing.';
  if (failure?.kind === 'badRequest') {
    return 'The box could not make sense of this request. Press Stop and start the title again.';
  }
  if (recovery.kind === 'exhausted') {
    if (failure?.kind !== 'decode') {
      return 'The stream could not be kept going. Press Try again, or Stop to leave.';
    }
    // THE VERDICT NAMES THE BUCKET. `_player/classify.ts:27-31` records that `decode` is
    // honest rather than a guess dressed up — the bytes are there and the element still
    // failed — and the bucket is the single most useful thing to add to it: on a 2160p
    // file the viewer has a press that changes the answer (ask for this title in HD
    // instead), which is not true of a 1080p file this panel refuses.
    return status.quality === BUCKET_4K
      ? 'This 4K file is on the box, but this television cannot play it. Press Stop to leave.'
      : 'The file is on the box, but this television cannot play it. Press Stop to leave.';
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
  if (resumeNote !== '') return resumeNote;
  // LAST, AND ONCE. The reduced-resume sentence is the more urgent of the two and both
  // are about the same arrival, so it takes the line while it is up; this one is what is
  // left to say afterwards. `discloseArrival` is the window, so a title whose bucket is
  // worth naming does not sit on this line for the length of the film.
  if (discloseArrival) {
    // THE MAIN CASE, and the reason this task exists: health outranks the bucket, so a
    // 4K press answered with a 1080p release is the COMMON outcome. The ask is known
    // here only because `title.ts` carried it; it names what was asked and what arrived
    // and claims NOTHING about why — no 2160p release existed, none was healthy, and
    // every one of them being device-refused all land here identically.
    if (askedFourK && status.quality !== BUCKET_4K) {
      return `You asked for 4K — this is the ${status.quality} release.`;
    }
    // And the case where no ask is known at all (a cold load, a reload, a deep link):
    // a bucket this television never asks for is a downgrade whichever press made it.
    if (BELOW_ANY_ASK.has(status.quality)) {
      return `Playing the ${status.quality} release — lower than this television asked for.`;
    }
  }
  return '';
}
