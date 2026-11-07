'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { torrentsService } from '@/services/torrents';
import { streamingService } from '@/services/streaming';
import type { CatalogTorrentRequest, TorrentStatus } from '@/types';
import {
  episodeRefOf,
  episodeScaleSeconds,
  findNextEpisode,
  pastAutoNextPoint,
  type EpisodeRef,
  type NextEpisodeAnswer,
  type NextUp,
} from '@/lib/nextEpisode';
import { usePlaybackSettings, type PlaybackSettingsState } from '@/lib/usePlaybackSettings';
import { streamingHref } from '@/lib/streamingHref';
import { toDownloadQuality } from '@/lib/downloadQuality';

/**
 * THE WEB PLAYER'S NEXT EPISODE: what it is, starting it early, and where "Play next" goes.
 *
 * The page only wires this. The catalog lookup and the threshold rule are `@/lib/nextEpisode`'s,
 * shared with the TV; the owner's switch and threshold are `usePlaybackSettings`'.
 *
 * ONE BODY FOR BOTH REQUESTS. The prefetch and Play next POST the same `/torrents/download`
 * body, and the server's reuse (no `magnet`) turns the second into "the row the first one
 * started", so Play next after a prefetch is not a second download. No `client`: browsers stay
 * unprofiled. No `magnet` (it switches the reuse off) and no `source_id` (an explicit pick from
 * the source switcher, never a background choice).
 *
 * THE PREFETCH IS ONCE PER CONTENT ID, latched on the id rather than on a boolean, so moving to
 * the next episode in the same page arms it again. It is gated on a playback read that
 * ANSWERED: in flight or failed is off, because a multi-gigabyte download on a Pi is not a guess.
 * It never fires when the next episode is already a file in this torrent (a season pack), since
 * there is nothing to start. It is silent: a refusal only means Play next asks again.
 */

export interface UpNextEpisode {
  /** The catalog's next episode (a `ready` verdict), or null: none, unknown, still looking, or not an episode. */
  next: NextUp | null;
  /** Feed every player progress tick. Starts the prefetch at most once per content id. Stable identity. */
  onProgress: (currentTime: number, duration: number) => void;
  /** Where "Play next" goes: an href, or null when the box refused or there is no next episode. Never rejects. */
  playNext: () => Promise<string | null>;
}

interface Latest {
  contentId: string | null;
  ref: EpisodeRef | null;
  answer: NextEpisodeAnswer | null;
  playback: PlaybackSettingsState;
  nextFileInTorrent: boolean;
  quality: string | undefined;
}

const bodyFor = (ref: EpisodeRef, next: NextUp, quality: string | undefined): CatalogTorrentRequest => ({
  tmdb_id: ref.tmdbId,
  quality: toDownloadQuality(quality),
  media_type: 'tv',
  season: next.season,
  episode: next.episode,
});

/** The row the box answered with, or null. Never rejects. */
const start = (body: CatalogTorrentRequest): Promise<TorrentStatus | null> =>
  torrentsService.downloadCatalogMovie(body).then(
    (s) => s ?? null,
    () => null,
  );

/**
 * The player link for the row Play next got back.
 *
 * A number in `file_index` is the server's own pick inside a reused pack (0 included), so the
 * file list is not asked again. A row that names its episode is that episode. Anything else is
 * a pack with no pick yet (freshly added, or its metadata not in): its file list names the
 * episode, and failing that the pack opens on its visible episode picker. The identity then
 * comes from the file, so no progress is keyed to the wrong episode.
 */
async function hrefFor(status: TorrentStatus, next: NextUp): Promise<string> {
  if (typeof status.file_index === 'number') return streamingHref(status);
  const base = `/streaming/${status.id}`;
  if (status.episode != null) return base;
  try {
    const files = await streamingService.getFiles(status.id);
    const f = (Array.isArray(files) ? files : []).find(
      (x) => x.season === next.season && x.episode === next.episode,
    );
    return f ? `${base}?file=${f.index}` : base;
  } catch {
    return base;
  }
}

export function useUpNextEpisode(args: {
  contentId: string | null | undefined; // streamingInfo.content_id
  quality: string | undefined; // torrentStatus.quality
  nextFileInTorrent: boolean; // the page has a next VideoFile in THIS torrent
}): UpNextEpisode {
  const contentId = args.contentId ?? null;
  const playback = usePlaybackSettings();
  /**
   * The answer, KEYED to the content id it answers. A different id reads as null in the very
   * render that carries it, before any effect runs, so a tick in between cannot prefetch the
   * previous episode's "next" under the new id.
   */
  const [held, setHeld] = useState<{ contentId: string; answer: NextEpisodeAnswer } | null>(null);
  const answer = held !== null && held.contentId === contentId ? held.answer : null;

  /**
   * THE GENERATION, as on the TV watch page: a late answer for the previous content id must
   * not become this one's "next". Bumped in the cleanup, which covers a change and an unmount.
   */
  const gen = useRef(0);
  useEffect(() => {
    const ref = episodeRefOf(contentId);
    const invalidate = () => {
      gen.current += 1;
    };
    // A film, or a show-level id: nothing after it to look for.
    if (!ref || !contentId) return invalidate;
    const generation = gen.current;
    void findNextEpisode(ref).then((a) => {
      if (gen.current === generation) setHeld({ contentId, answer: a });
    });
    return invalidate;
  }, [contentId]);

  /**
   * The latest values, for callbacks whose identity never changes. Written during render so a
   * tick reads the props it was rendered with; a setting or an answer that arrives after a tick
   * acts on the next one.
   */
  const latest = useRef<Latest | null>(null);
  latest.current = {
    contentId,
    ref: episodeRefOf(contentId),
    answer,
    playback,
    nextFileInTorrent: args.nextFileInTorrent,
    quality: args.quality,
  };

  const prefetched = useRef<{ contentId: string; promise: Promise<TorrentStatus | null> } | null>(null);

  const onProgress = useCallback((currentTime: number, duration: number) => {
    const l = latest.current;
    if (!l || !l.contentId || !l.ref || l.answer?.verdict.k !== 'ready') return;
    if (l.nextFileInTorrent) return;
    if (!l.playback.enabled || l.playback.threshold === null) return;
    const scale = episodeScaleSeconds({ duration, storedSeconds: null, runtimeS: l.answer.runtimeS });
    if (!pastAutoNextPoint(currentTime, scale, l.playback.threshold)) return;
    if (prefetched.current?.contentId === l.contentId) return;
    prefetched.current = {
      contentId: l.contentId,
      promise: start(bodyFor(l.ref, l.answer.verdict.next, l.quality)),
    };
  }, []);

  const playNext = useCallback(async (): Promise<string | null> => {
    const l = latest.current;
    if (!l || !l.ref || l.answer?.verdict.k !== 'ready') return null;
    const next = l.answer.verdict.next;
    const mine = prefetched.current?.contentId === l.contentId ? prefetched.current.promise : null;
    let status = mine ? await mine : null;
    if (!status) status = await start(bodyFor(l.ref, next, l.quality));
    if (!status) return null;
    return hrefFor(status, next);
  }, []);

  return { next: answer?.verdict.k === 'ready' ? answer.verdict.next : null, onProgress, playNext };
}
