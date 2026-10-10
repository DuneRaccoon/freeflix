'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TorrentStatus, VideoFile } from '@/types';
import { buildContentId, showNameFromTitle } from '@/lib/contentId';
import { streamingService } from '@/services/streaming';
import { statusOf } from './httpStatus';
import { FINISHED_PCT } from './title';

/**
 * Where the viewer got to, read once on arrival and written on a heartbeat.
 *
 * WHY IT IS IN `_data/` AND NOT `_player/`, since the plan says otherwise: nothing under
 * `_player/` may import `@/services/streaming` or `@/services/api-client`
 * (`_player/engineContract.test.ts`, "never routes a probe through apiClient"), because
 * apiClient's rejection interceptor hard-navigates to `/bigscreen/pair` from inside its own
 * handler and the player ENGINE must not carry that in its graph. This module is by
 * definition an HTTP writer, so it belongs where this surface keeps its HTTP-facing hooks —
 * beside `useTvProfile`, which imports a service for the same reason. The guard is not
 * weakened and not routed around.
 *
 * FOUR THINGS HERE ARE LOAD-BEARING, EACH FOR A DEFECT THAT IS LIVE SOMEWHERE ELSE:
 *
 * 1. POST EVERY TIME, NEVER THE PUT. `StreamingProgressUpdate` has exactly four fields
 *    (`current_time`, `duration`, `percentage`, `completed`), so a PUT can never correct
 *    `file_index`, `title` or `torrent_id`. The POST upserts on `(user_id, movie_id)` — one
 *    row per movie, one per episode — so there is nothing a progress id would buy, and
 *    caching one is precisely how the second write stops carrying the episode.
 * 2. ALWAYS A TITLE. `progress_upsert` puts `title`, `file_index` and `content_id` in
 *    `update_cols` UNCONDITIONALLY, so a write with `title: null` ERASES what the web wrote
 *    and takes Continue Watching's label with it. The shape is the one
 *    `showNameFromTitle`'s regex can strip (`Name S02E05`), so the rail draws the show.
 * 3. THE ID IS BUILT HERE, AND NEVER UNDER `s0:`. The backend's `resolve_content_id` has a
 *    last resort that mints `tv:{tmdb}:s0:e{file_index}` — it parses cleanly, matches
 *    nothing the detail screens build, and draws as "S00 · E04". So `/info`'s `content_id`
 *    is not trusted: `watchIdentity` composes the same key the show screen composes, or
 *    answers null and this hook does nothing at all.
 * 4. NEVER `getProgressByTorrent`. It filters on torrent + user only, so on a season pack it
 *    answers whichever episode was watched last: used as a fallback it resumes episode 5 at
 *    episode 3's timestamp. That is what the web does. The only read is by content id.
 *
 * THE FLUSH HAS TWO EXITS AND THEY ARE NOT THE SAME EVENT. A Back press on this surface is a
 * client-side route change: it fires neither `beforeunload` nor `pagehide`, and the only
 * thing that happens is this component unmounting — so the unmount cleanup writes. A reload
 * or a full-page navigation unmounts nothing, so `pagehide` writes. The web player listens
 * for `beforeunload` only and therefore loses the position on exactly the press a remote
 * makes most.
 *
 * THE WRITE OPTS OUT OF THE 401 REDIRECT (`allow401`). apiClient's interceptor navigates
 * from inside its rejection handler before any caller sees the error, so a 401 on the flush
 * would destroy the player — and the position — on the way out. `allow401.test.tsx` drives
 * the real interceptor to prove it.
 */

/**
 * How often a playing title's position is written. 30s: the row is only ever read back by
 * Continue Watching and the detail screens, so a finer cadence buys a viewer nothing and
 * costs a DB upsert per tick on a Raspberry Pi.
 */
export const PROGRESS_CADENCE_MS = 30_000;

/**
 * Below this, nothing is recorded. A title the viewer opened and left in the first seconds
 * is not "where you left off", and a row for it would push a real one off Continue Watching.
 * The web uses the same floor.
 */
export const MIN_POSITION_S = 5;

export interface WatchIdentity {
  /** The watch-identity join key, or null when the torrent carries no identity to build one from. */
  contentId: string | null;
  /** What Continue Watching will draw, in strippable shape. Null only when `contentId` is. */
  title: string | null;
}

/**
 * The content id and the label for the file being played, composed from the torrent row and
 * the `/files` entry for that file.
 *
 * `media_type` DECIDES THE KIND, not the season fields. `manager.py` stores a TV torrent as
 * "movie" when the caller omits the type, and the row is the only identity there is; routing
 * by the season instead would key the row under something the detail screens never build.
 */
export function watchIdentity({
  status,
  file,
}: {
  status: TorrentStatus | null | undefined;
  file: Pick<VideoFile, 'season' | 'episode'> | null | undefined;
}): WatchIdentity {
  const tmdbId = status?.tmdb_id;
  if (!status || tmdbId == null) return { contentId: null, title: null };

  const kind = status.media_type === 'tv' ? 'tv' : 'movie';
  // The torrent row first (a single-episode download names its own episode), then the file
  // (a season pack carries `episode: null` — "this season is covered" — so only the file
  // can say which one). Neither: the show-level id, which is a key the detail screens do
  // build. NEVER a stand-in season 0.
  const season = status.season ?? file?.season ?? undefined;
  const episode = status.episode ?? file?.episode ?? undefined;
  const contentId = buildContentId({
    kind,
    tmdbId,
    season: season ?? undefined,
    episode: episode ?? undefined,
  });

  // `movie_title` is free text and often already carries a release's own S02 suffix, so it
  // is stripped first and then re-suffixed from the numbers we actually resolved. That keeps
  // `showNameFromTitle` able to strip it again on the way back out.
  const base = showNameFromTitle(status.movie_title, tmdbId);
  const title =
    kind === 'tv' && season != null && episode != null
      ? `${base} S${pad2(season)}E${pad2(episode)}`
      : base;

  return { contentId, title };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export interface WatchProgressOptions {
  /** The profile watching, or null: progress is per-profile and there is nothing to key on. */
  userId: string | null;
  torrentId: string;
  /** From `watchIdentity`. Null disables both the read and the write. */
  contentId: string | null;
  /** From `watchIdentity`. Sent on EVERY write; see the header. */
  title: string | null;
  /** The file inside the torrent, when one was resolved. */
  fileIndex?: number;
  /**
   * The playhead, in seconds, as the caller last saw it. A VALUE rather than an element
   * getter, and that is forced rather than chosen: React detaches host refs during the
   * mutation phase, before a passive cleanup runs, so a flush that read `getVideo()` on
   * unmount would always find null — which is the one exit that matters most here (a Back
   * press fires no unload event and the unmount cleanup is all there is). Measured: the
   * unmount flush wrote nothing until this became a value.
   */
  position: number;
  /** `video.duration`; `NaN` before metadata. */
  duration: number;
  /** The element reported `ended`. The one certain "completed". */
  ended?: boolean;
  /** Write only once there is playback to record. */
  writing: boolean;
}

export interface WatchProgressState {
  /**
   * The second to resume from. `ready: false` until the read has answered — the caller must
   * NOT start playing before then, because the seek boundary has to be measured around the
   * byte under the INTENDED playhead and that byte is not known until this is.
   *
   * `totalSeconds` is the row's own duration, and it is here for that conversion: before
   * `loadedmetadata` the element reports `NaN`, so the stored duration is the ONLY scale
   * available for turning the resume second into the byte `/info` must measure around.
   */
  resume: { ready: false } | { ready: true; atSeconds: number; totalSeconds: number | null };
  /** The read answered 423: the profile is passcode-locked and the viewer must pick again. */
  locked: boolean;
  /** Write now. For a press that is about to leave the player. */
  flush: () => void;
}

export function useWatchProgress(opts: WatchProgressOptions): WatchProgressState {
  const { userId, contentId } = opts;
  /**
   * The answer, TAGGED WITH THE KEY IT IS AN ANSWER TO, so `ready` can be derived in the
   * render body rather than written by an effect.
   *
   * That is not a style preference. The caller arrives with no identity (the torrent row has
   * not landed yet), so a `ready` written by an effect stays true for ONE COMMIT after the
   * content id appears — and in that commit the caller asks `/info` for its seek boundary
   * anchored at second 0 instead of at the resume position, which is precisely the
   * measurement-at-the-wrong-offset defect the anchoring exists to avoid. Derived, the
   * transition is synchronous and no such commit exists. Measured: the stale ask was real.
   */
  const [answer, setAnswer] = useState<{
    key: string;
    atSeconds: number;
    totalSeconds: number | null;
  } | null>(null);
  const [locked, setLocked] = useState(false);
  const key = userId && contentId ? `${userId}\u0000${contentId}` : null;

  const resume = useMemo<WatchProgressState['resume']>(() => {
    // No profile or no identity: there is nothing to read and nothing to wait for.
    if (key === null) return { ready: true, atSeconds: 0, totalSeconds: null };
    if (!answer || answer.key !== key) return { ready: false };
    return { ready: true, atSeconds: answer.atSeconds, totalSeconds: answer.totalSeconds };
  }, [key, answer]);

  // Everything the writer reads lives in a ref, so the interval and its two listeners are
  // registered ONCE. A re-registration per render would mean a page that re-renders on its
  // own scrub readout never completes a cadence — the shape `useStallWatch`'s header
  // records as hazard 12.
  const latest = useRef(opts);
  useLayoutEffect(() => {
    latest.current = opts;
  });

  const inFlight = useRef(false);
  /**
   * The last duration the element reported. A title's length is a CONSTANT; `NaN` means "not
   * known right now", not "this has no length" — and there is now a window where that
   * happens mid-film, because the route writes `NaN` while a recovery `load()` is in flight
   * so the scrub row really does go away. A write landing in that window would otherwise
   * record `duration: null, percentage: 0` over a good row and Continue Watching would show
   * the title as untouched.
   */
  const lastDuration = useRef<number | null>(null);

  const write = useCallback(() => {
    const o = latest.current;
    if (!o.writing || !o.userId || !o.contentId || inFlight.current) return;

    const position = Number(o.position);
    if (!Number.isFinite(position)) return;
    const live = Number(o.duration);
    if (Number.isFinite(live) && live > 0) lastDuration.current = live;
    const duration = lastDuration.current;
    const usable = duration !== null && duration > 0;
    const percentage = usable ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;
    const ended = o.ended === true;
    if (position < MIN_POSITION_S && !ended) return;

    inFlight.current = true;
    streamingService
      .saveProgress(
        o.userId,
        {
          torrent_id: o.torrentId,
          movie_id: o.contentId,
          current_time: position,
          duration: usable ? duration : null,
          percentage: ended ? 100 : percentage,
          // The same cut-off `title.ts` reads back, so a title is never both unresumable and
          // unwatched. `ended` is the certain case.
          completed: ended || percentage >= FINISHED_PCT,
          // Explicitly what we know, `null` included. A pack whose file could not be resolved
          // is keyed at show level (a DIFFERENT row from the episode's), so a null here can
          // never erase an episode index the web wrote.
          file_index: o.fileIndex ?? null,
          title: o.title,
        },
        { allow401: true },
      )
      // A heartbeat may never take the player down, and there is nothing to tell the viewer:
      // the position is re-sent on the next tick and on the way out.
      .catch(() => {})
      .finally(() => {
        inFlight.current = false;
      });
  }, []);

  // THE READ. One call, by content id, and 423 is the only failure that surfaces: the
  // resume read answers 200 with a null body for "no progress" and `streamingService` turns
  // a real 404 into null, so neither can report a stale profile.
  useEffect(() => {
    setLocked(false);
    if (!userId || !contentId || key === null) return;
    let cancelled = false;
    streamingService
      .getProgressByMovie(userId, contentId)
      .then((row) => {
        if (cancelled) return;
        const finished = !!row && (row.completed || row.percentage >= FINISHED_PCT);
        const at = row && !finished ? Math.max(0, Number(row.current_time) || 0) : 0;
        const total = Number(row?.duration);
        setAnswer({
          key,
          atSeconds: at,
          totalSeconds: Number.isFinite(total) && total > 0 ? total : null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        if (statusOf(err) === 423) setLocked(true);
        // Anything else is "unknown", which is not "nothing": it starts from the beginning
        // rather than refusing to play a title whose history could not be read. Still an
        // ANSWER, so the caller stops waiting for it.
        setAnswer({ key, atSeconds: 0, totalSeconds: null });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, contentId, key]);

  // THE WRITE. `[write]` only — `write` is stable, so the cadence and both exits are
  // registered once for the life of the player.
  useEffect(() => {
    const timer = setInterval(write, PROGRESS_CADENCE_MS);
    const onHide = () => write();
    window.addEventListener('pagehide', onHide);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pagehide', onHide);
      // The Back press's only observable event.
      write();
    };
  }, [write]);

  return { resume, locked, flush: write };
}
