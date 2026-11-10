'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { torrentsService } from '@/services/torrents';
import { streamingService } from '@/services/streaming';
import { TorrentStatus, StreamingInfo, TorrentState, VideoFile, TorrentCandidate, StreamHealthState } from '@/types';
import PatchedVideoPlayer from '@/components/player/PatchedVideoPlayer';
import UpNextCard from '@/components/player/UpNextCard';
import { Button, Pill } from '@/components/ui/fre';
import {
  ArrowLeftIcon,
  InformationCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  FilmIcon
} from '@heroicons/react/24/outline';
import { formatBytes } from '@/utils/format';
import { isStreamingReady } from '@/utils/streaming';
import { deriveStreamHealth } from '@/utils/streamHealth';
import StreamPhasePanel from '@/components/streaming/StreamPhasePanel';
import { toast } from 'react-hot-toast';
import { cn } from '@/lib/cn';
import { toDownloadQuality } from '@/lib/downloadQuality';
import { useUpNextEpisode } from '@/lib/player/useUpNextEpisode';
import { showNameFromTitle, titleOfStream } from '@/lib/contentId';
import { titlePageHref } from '@/lib/titlePageHref';

export default function StreamingPage() {
  const { id } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const torrentId = Array.isArray(id) ? id[0] : id;

  // File picker state. Guard against junk/empty ?file values (e.g. hand-edited
  // URLs) so they fall back to the default file rather than 404-ing on NaN.
  const fileParam = searchParams.get('file');
  const parsedFileParam = fileParam !== null ? Number(fileParam) : NaN;
  const fileIndex = Number.isInteger(parsedFileParam) ? parsedFileParam : undefined;
  const [videoFiles, setVideoFiles] = useState<VideoFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);

  const [torrentStatus, setTorrentStatus] = useState<TorrentStatus | null>(null);
  const [streamingInfo, setStreamingInfo] = useState<StreamingInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStreamReady, setIsStreamReady] = useState(false);
  const [forceStreaming, setForceStreaming] = useState(false);
  const [showStreamingStats, setShowStreamingStats] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [videoFileProgress, setVideoFileProgress] = useState<number>(0);
  // Ranked alternative sources for the in-player switcher (W1 /torrents/sources).
  const [sources, setSources] = useState<TorrentCandidate[]>([]);
  // Revealed when in-player recovery is exhausted — the page surfaces the
  // source-switch affordance (W6 calls onRecoveryExhausted → setShowSources).
  const [showSources, setShowSources] = useState(false);

  // Up-Next card — shown near the end of an episode that has a next one
  const [showUpNext, setShowUpNext] = useState(false);
  // The episode whose card was closed (Dismiss, or Play next pressed by the viewer or the
  // countdown). The player ticks ~4 Hz, so without this every tick in the last 30 s would reopen
  // the card with a fresh countdown that plays next by itself. Keyed per episode, so the next one
  // offers its own card.
  const upNextClosedFor = useRef<string | null>(null);

  // Single derived stream-health snapshot (§5.2). The page is the ONLY poller;
  // this is passed to the player so it never runs its own status poll.
  const streamHealth: StreamHealthState | null = torrentStatus
    ? deriveStreamHealth(torrentStatus)
    : null;

  // Fetch the file list for this torrent
  useEffect(() => {
    if (!torrentId) return;
    setFilesLoading(true);
    streamingService.getFiles(torrentId)
      .then(files => setVideoFiles(files))
      .catch(err => {
        console.warn('Could not fetch file list for torrent:', err);
        setVideoFiles([]);
      })
      .finally(() => setFilesLoading(false));
  }, [torrentId]);

  // Fetch ranked alternative sources for the in-player switcher. Best-effort:
  // a failure just leaves the switcher empty (no alternatives offered).
  useEffect(() => {
    if (!torrentStatus) return;
    let cancelled = false;
    // Derive tmdb_id from the streaming info when available; the sources call is
    // keyed by the catalog id, which the streaming page does not always hold, so
    // we only fetch when streamingInfo carries content_id we can parse.
    const cid = streamingInfo?.content_id;
    if (!cid) return;
    // content_id: "movie:{tmdb}" | "tv:{tmdb}:s{n}:e{n}"
    const parts = cid.split(':');
    const tmdb = Number(parts[1]);
    if (!Number.isInteger(tmdb)) return;
    const isTv = parts[0] === 'tv';
    const season = isTv ? Number(parts[2]?.replace(/^s/, '')) : undefined;
    const episode = isTv ? Number(parts[3]?.replace(/^e/, '')) : undefined;
    torrentsService
      .getSources({
        tmdb_id: tmdb,
        quality: torrentStatus.quality,
        media_type: isTv ? 'tv' : 'movie',
        season: Number.isInteger(season) ? season : undefined,
        episode: Number.isInteger(episode) ? episode : undefined,
      })
      .then((list) => { if (!cancelled) setSources(list); })
      .catch(() => { if (!cancelled) setSources([]); });
    return () => { cancelled = true; };
  }, [streamingInfo?.content_id, torrentStatus?.quality]);

  // Determine effective file index:
  // - Use fileIndex from URL if provided
  // - Else if there are multiple files, default to the first file's index
  // - Else undefined (single-file torrent → unchanged behaviour)
  const isMultiFile = videoFiles.length > 1;
  const effectiveFileIndex: number | undefined =
    fileIndex !== undefined
      ? fileIndex
      : isMultiFile
      ? videoFiles[0].index
      : undefined;

  // Check if torrent exists and get initial status
  useEffect(() => {
    const getTorrentStatus = async () => {
      if (!torrentId) return;

      try {
        setIsLoading(true);
        setError(null);

        // Get torrent status
        const status = await torrentsService.getTorrentStatus(torrentId);
        setTorrentStatus(status);

        if (!status) {
          setError('Torrent not found. It may have been deleted or never existed.');
          setIsLoading(false);
          return;
        }

        // Prioritize for streaming if not already
        await torrentsService.prioritizeForStreaming(torrentId);

        // Check if streaming is possible
        const readyToStream = await isStreamingReady(torrentId, 2) || forceStreaming; // Reduced minimum progress to 2%
        setIsStreamReady(readyToStream);

        if (readyToStream) {
          try {
            const info = await streamingService.getStreamingInfo(torrentId, effectiveFileIndex);
            setStreamingInfo(info);

            // Set video file specific progress
            if (info?.video_file) {
              setVideoFileProgress(info.video_file.progress);
            } else {
              setVideoFileProgress(status.progress);
            }
          } catch (err) {
            console.error('Error fetching streaming info:', err);
            // Don't set error yet, we'll retry
            if (retryCount < 3) {
              setRetryCount(prev => prev + 1);
            } else {
              setError('Failed to get streaming information. The file may not be ready yet.');
            }
          }
        }
      } catch (err) {
        console.error('Error loading torrent for streaming:', err);
        setError('Failed to load the movie for streaming. Please try again later.');
      } finally {
        setIsLoading(false);
      }
    };

    getTorrentStatus();

    // Set up interval to refresh status and progress
    const interval = setInterval(async () => {
      if (!torrentId) return;

      try {
        // Get updated torrent status
        const status = await torrentsService.getTorrentStatus(torrentId);
        setTorrentStatus(status);

        if (!status) return;

        // Check streaming status if not ready yet
        if (!isStreamReady && !forceStreaming) {
          const readyToStream = await isStreamingReady(torrentId, 2);
          setIsStreamReady(readyToStream);

          if (readyToStream) {
            try {
              const info = await streamingService.getStreamingInfo(torrentId, effectiveFileIndex);
              setStreamingInfo(info);

              // Set video file specific progress
              if (info?.video_file) {
                setVideoFileProgress(info.video_file.progress);
              } else {
                setVideoFileProgress(status.progress);
              }
            } catch (err) {
              console.error('Error fetching streaming info during retry:', err);
            }
          }
        } else if (streamingInfo) {
          // Update streaming info if already streaming
          try {
            const info = await streamingService.getStreamingInfo(torrentId, effectiveFileIndex);
            setStreamingInfo(info);

            // Update video file specific progress
            if (info?.video_file) {
              setVideoFileProgress(info.video_file.progress);
            } else {
              setVideoFileProgress(status.progress);
            }
          } catch (err) {
            console.error('Error updating streaming info:', err);
          }
        }
      } catch (err) {
        console.error('Error updating torrent status:', err);
      }
    }, isStreamReady ? 5000 : 1500);

    return () => clearInterval(interval);
  }, [torrentId, isStreamReady, forceStreaming, retryCount, effectiveFileIndex]);

  // Helpers to label a file entry / an episode (S02E03)
  const pad = (n: number) => String(n).padStart(2, '0');
  const epLabel = (s: number, e: number) => `S${pad(s)}E${pad(e)}`;
  const fileLabel = (f: VideoFile): string => {
    if (f.season !== null && f.episode !== null) {
      return epLabel(f.season, f.episode);
    }
    return f.name;
  };

  // Next-file data for the Up-Next card (only relevant for multi-file season packs)
  const currentFileIdx = videoFiles.findIndex(f => f.index === effectiveFileIndex);
  const currentVideoFile: VideoFile | null = currentFileIdx >= 0 ? videoFiles[currentFileIdx] : null;
  const nextVideoFile: VideoFile | null =
    isMultiFile && currentFileIdx >= 0 && currentFileIdx + 1 < videoFiles.length
      ? videoFiles[currentFileIdx + 1]
      : null;

  // Where the way back goes: the title page of what is playing, and `/downloads` only for a
  // download that cannot say which title it is (a row from before the media columns, or a
  // film with no name). The header arrow, the blocked state's "Choose another source" (the
  // title page is where the source picker lives) and the error state's button all leave
  // through `backHref`.
  //
  // DERIVED ON EVERY RENDER, NEVER LATCHED AT MOUNT. A file switch inside a pack and a same-
  // torrent Up Next both replace the URL without remounting, so a latched target would send
  // the viewer to the episode they started on. Above the early returns, because the blocked
  // and error states need it, and while buffering `streamingInfo` is still null: the hint is
  // then the current `/files` entry. `titleOfStream` reads the torrent row first and the hint
  // second, and never `/info`'s `content_id`, whose `s0` fallback names an episode nobody
  // chose.
  //
  // THE LABEL AND THE TARGET ARE ONE DECISION. Both hang on `backName`, so the arrow can
  // never say "downloads" and go to a show, or name a show and go to downloads. A show's name
  // is `showNameFromTitle`'s: it strips the release's ` S02E02`, and given a blank title it
  // answers `Show {id}` (hence the trim, since it hands whitespace back as it found it). A
  // film's name is its title, and a blank one sends the viewer to downloads, labelled so.
  const backTitle = titleOfStream(torrentStatus, streamingInfo ?? currentVideoFile);
  const playingTitle = torrentStatus?.movie_title?.trim() ?? '';
  const backName: string | null = !backTitle
    ? null
    : backTitle.kind === 'tv'
    ? showNameFromTitle(playingTitle, backTitle.tmdbId)
    : playingTitle || null;
  const backHref = backTitle && backName ? titlePageHref(backTitle) : '/downloads';
  const backLabel = backName ? `Back to ${backName}` : 'Back to downloads';

  // The next episode outside this torrent: the catalog lookup, the owner's threshold
  // prefetch and where Play next goes. Above the early returns (rules of hooks).
  const upNext = useUpNextEpisode({
    contentId: streamingInfo?.content_id,
    quality: torrentStatus?.quality,
    nextFileInTorrent: nextVideoFile !== null,
  });

  // Which episode is playing, for the closed-card latch. The content id, or the file when the
  // stream has none yet.
  const upNextKey = streamingInfo?.content_id ?? `${torrentId}?file=${effectiveFileIndex ?? ''}`;

  // What the Up-Next card offers: the pack's next file, else the catalog's next episode.
  const upNextLabel = nextVideoFile
    ? fileLabel(nextVideoFile)
    : upNext.next
    ? epLabel(upNext.next.season, upNext.next.episode)
    : null;

  // Progress callback for the next-episode prefetch and the Up-Next card trigger.
  // Every tick reaches the prefetch first: it has its own scale (TMDB's runtime) for a
  // player that reports no duration. Then the card shows when there is a next episode and
  // this one is near the end (last 30 seconds or last 5% of duration, whichever comes later).
  // The card counts down 15 s and then plays next by itself (`UpNextCard`'s countdown);
  // Dismiss cancels it, for the rest of this episode (`upNextClosedFor`). Inside a season pack
  // the next file is next; otherwise the next episode's own download is (reused or started via
  // `useUpNextEpisode`).
  const handleVideoProgress = ({ currentTime, duration }: { currentTime: number; duration: number }) => {
    upNext.onProgress(currentTime, duration);
    if (upNextLabel === null || duration <= 0) return;
    if (upNextClosedFor.current === upNextKey) return;
    const remaining = duration - currentTime;
    const pct = (currentTime / duration) * 100;
    // Show when within 30 s OR within last 5 % — whichever is earlier
    if (remaining <= 30 || pct >= 95) {
      setShowUpNext(true);
    }
  };

  const handleBackClick = () => {
    router.push(backHref);
  };

  const toggleStreamingStats = () => {
    setShowStreamingStats(!showStreamingStats);
  };

  const handleForceStreaming = async () => {
    try {
      setIsLoading(true);
      setForceStreaming(true);

      await torrentsService.prioritizeForStreaming(torrentId);

      const info = await streamingService.getStreamingInfo(torrentId, effectiveFileIndex);
      setStreamingInfo(info);

      // Set video file specific progress
      if (info?.video_file) {
        setVideoFileProgress(info.video_file.progress);
      } else if (torrentStatus) {
        setVideoFileProgress(torrentStatus.progress);
      }

      setIsStreamReady(true);
      setError(null);
    } catch (err) {
      console.error('Error forcing stream start:', err);
      setError('Failed to start streaming. The file may not be ready yet.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    try {
      setIsLoading(true);
      setError(null);

      await torrentsService.prioritizeForStreaming(torrentId);

      const status = await torrentsService.getTorrentStatus(torrentId);
      setTorrentStatus(status);

      if (status) {
        const info = await streamingService.getStreamingInfo(torrentId, effectiveFileIndex);
        setStreamingInfo(info);

        // Update video file specific progress
        if (info?.video_file) {
          setVideoFileProgress(info.video_file.progress);
        } else {
          setVideoFileProgress(status.progress);
        }

        setIsStreamReady(true);
      } else {
        setError('Torrent not found. It may have been deleted or never existed.');
      }
    } catch (err) {
      console.error('Error refreshing stream:', err);
      setError('Failed to refresh streaming data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle video player error
  const handleVideoError = (error: string) => {
    // For minor errors during active downloads, don't show the error screen
    if (torrentStatus && torrentStatus.progress < 100 &&
        (error.includes('network error') || error.includes('buffering'))) {
      // Just log the error but don't show the error screen
      console.warn('Video playback issue during download:', error);
    } else {
      // For serious errors, show the error screen
      setError(error);
    }
  };

  // Handle selecting a different episode from the picker
  const handleFileSelect = (selectedIndex: number) => {
    router.replace(`/streaming/${torrentId}?file=${selectedIndex}`);
  };

  // Parse the watch-identity content_id into download params for a source switch.
  const _cidParts = (streamingInfo?.content_id ?? '').split(':');
  const streamingTmdbId: number | undefined = Number.isInteger(Number(_cidParts[1]))
    ? Number(_cidParts[1])
    : undefined;
  const streamingMediaType: 'movie' | 'tv' = _cidParts[0] === 'tv' ? 'tv' : 'movie';
  const streamingSeason: number | undefined =
    streamingMediaType === 'tv' && Number.isInteger(Number(_cidParts[2]?.replace(/^s/, '')))
      ? Number(_cidParts[2].replace(/^s/, ''))
      : undefined;
  const streamingEpisode: number | undefined =
    streamingMediaType === 'tv' && Number.isInteger(Number(_cidParts[3]?.replace(/^e/, '')))
      ? Number(_cidParts[3].replace(/^e/, ''))
      : undefined;

  // Switch the active source from the in-player switcher (W6 renders the UI; the
  // page owns the swap). A season-pack alternative on the SAME torrent is handled
  // as a file_index swap via router.replace(?file=N); any other candidate starts a
  // NEW download (magnet/source_id) and navigates to it. No silent auto-switch —
  // this only runs on an explicit user pick.
  const handleSelectSource = async (c: TorrentCandidate) => {
    // Same-torrent season pack → file_index swap (no new download).
    if (c.is_season_pack && torrentStatus && c.quality === torrentStatus.quality) {
      const target = videoFiles.find((f) => f.name === c.release_title);
      if (target) {
        router.replace(`/streaming/${torrentId}?file=${target.index}`);
        return;
      }
    }
    // Different torrent → start a new download and navigate to it.
    try {
      toast.loading('Switching source…', { id: 'switch-source' });
      const status = await torrentsService.downloadCatalogMovie({
        tmdb_id: streamingTmdbId ?? 0,
        quality: toDownloadQuality(c.quality),
        media_type: streamingMediaType,
        season: streamingSeason,
        episode: streamingEpisode,
        magnet: c.magnet,
        source_id: c.source_id,
      });
      toast.success('Source switched', { id: 'switch-source' });
      if (status?.id && status.id !== torrentId) {
        router.replace(`/streaming/${status.id}`);
      }
    } catch {
      toast.error('Could not switch source. Please try again.', { id: 'switch-source' });
    }
  };

  // Called by the player (W6) when in-player recovery (backoff re-seek) is
  // exhausted: reveal the source-switch affordance so the user can pick another
  // release instead of staring at a stalled stream.
  const handleRecoveryExhausted = () => {
    setShowSources(true);
    if (sources.length > 0) {
      toast('Playback is struggling — try another source.', { id: 'recovery-exhausted' });
    }
  };

  // Get the streaming URL — pass effective file index so switching episodes changes playback
  const streamingUrl = streamingInfo
    ? streamingService.getStreamingUrl(torrentId, torrentStatus?.quality, effectiveFileIndex) ?? ''
    : '';

  // Loading state — FRÈ gold-on-ink spinner
  if (isLoading) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center bg-ink">
        {/* Gold spinning ring */}
        <div
          className="w-14 h-14 rounded-full border-2 border-hairline border-t-gold animate-spin mb-6"
          aria-label="Loading"
        />
        <p className="font-display text-2xl text-text mb-2 tracking-tight">Loading…</p>
        <p className="text-sm text-muted">Preparing your streaming experience</p>
      </div>
    );
  }

  // Blocked-for-safety state — the content guard rejected this torrent. "Choose another
  // source" goes to the title page, where the source picker lives (`backHref`).
  if (torrentStatus?.state === TorrentState.BLOCKED) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center bg-ink p-8">
        <div className="w-16 h-16 rounded-full border border-hairline bg-surface flex items-center justify-center mb-6">
          <ExclamationTriangleIcon className="w-8 h-8 text-gold" />
        </div>
        <h2 className="font-display text-2xl text-text mb-3 tracking-tight">Blocked for Safety</h2>
        <p className="text-muted text-center mb-8 max-w-md text-sm leading-relaxed">
          {torrentStatus.block_reason ||
            'This torrent was blocked because it has no playable video or contains an executable.'}
        </p>
        <div className="flex gap-3 flex-wrap justify-center">
          <Button variant="primary" size="sm" onClick={handleBackClick}>
            <ArrowLeftIcon className="w-4 h-4" />
            Choose another source
          </Button>
        </div>
      </div>
    );
  }

  // Error state — FRÈ styled. Its way back is labelled for where it goes: the title, or
  // Downloads when the download cannot name one (or is gone, and `torrentStatus` with it).
  if (error || !torrentStatus) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center bg-ink p-8">
        {/* Warning icon in gold tint */}
        <div className="w-16 h-16 rounded-full border border-hairline bg-surface flex items-center justify-center mb-6">
          <ExclamationTriangleIcon className="w-8 h-8 text-gold" />
        </div>
        <h2 className="font-display text-2xl text-text mb-3 tracking-tight">Unable to Stream</h2>
        <p className="text-muted text-center mb-8 max-w-md text-sm leading-relaxed">
          {error || 'Movie not found. It may have been deleted or never existed.'}
        </p>
        <div className="flex gap-3 flex-wrap justify-center">
          <Button
            variant="glass"
            size="sm"
            onClick={handleRefresh}
          >
            <ArrowPathIcon className="w-4 h-4" />
            Try Again
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleBackClick}
          >
            <ArrowLeftIcon className="w-4 h-4" />
            {backName ? backLabel : 'Back to Downloads'}
          </Button>
        </div>
      </div>
    );
  }

  // Render straight into the player layout — no pre-stream interstitial.
  // While the stream warms up (before there's enough buffered to play), the
  // player area shows a clean buffering panel; the player's own overlay then
  // carries the buffering / "streaming · N% downloaded" info once it mounts.
  return (
    <div className="h-dvh flex flex-col bg-ink">
      {/* FRÈ Header — glass bar, ink base */}
      <div
        className="flex items-center gap-3 px-5 py-3 border-b border-hairline bg-surface/80 backdrop-blur"
        style={{ minHeight: '56px' }}
      >
        <button
          onClick={handleBackClick}
          className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-hairline bg-surface-2/60 text-text hover:border-gold/50 transition-colors flex-shrink-0"
          aria-label={backLabel}
        >
          <ArrowLeftIcon className="w-4 h-4" />
        </button>

        <h1
          className="font-display text-lg text-text tracking-tight truncate flex-1 min-w-0"
          title={torrentStatus.movie_title}
        >
          {torrentStatus.movie_title}
        </h1>

        <button
          onClick={toggleStreamingStats}
          className={cn(
            'inline-flex items-center justify-center w-9 h-9 rounded-full border transition-colors flex-shrink-0',
            showStreamingStats
              ? 'border-gold/60 bg-gold/10 text-gold'
              : 'border-hairline bg-surface-2/60 text-muted hover:border-gold/40 hover:text-text'
          )}
          aria-label={showStreamingStats ? 'Hide stats' : 'Show stats'}
          aria-pressed={showStreamingStats}
        >
          <InformationCircleIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Episode/File Picker — shown only for season packs (>1 file); FRÈ Pills */}
      {isMultiFile && (
        <div className="bg-surface border-b border-hairline px-5 py-2.5 flex items-center gap-3 overflow-x-auto">
          <FilmIcon className="w-4 h-4 text-muted flex-shrink-0" aria-hidden="true" />
          <span className="text-xs text-muted flex-shrink-0 uppercase tracking-widest font-medium">Episode</span>
          {filesLoading ? (
            <span className="text-xs text-muted italic">preparing episodes…</span>
          ) : (
            <div className="flex gap-2 flex-nowrap">
              {videoFiles.map(f => {
                const isActive = effectiveFileIndex === f.index;
                return (
                  <Pill
                    key={f.index}
                    selected={isActive}
                    onClick={() => handleFileSelect(f.index)}
                    title={f.name}
                    className="text-xs h-8 px-3 whitespace-nowrap flex-shrink-0"
                  >
                    {fileLabel(f)}
                  </Pill>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Player Area */}
      <div className="flex-grow relative overflow-hidden">
        {streamingInfo && streamingUrl && torrentId ? (
          <>
            <PatchedVideoPlayer
              src={streamingUrl}
              torrentId={torrentId}
              torrentInfo={torrentStatus}
              movieId={torrentStatus.movie_title}
              contentId={streamingInfo.content_id ?? undefined}
              fileIndex={effectiveFileIndex}
              title={torrentStatus.movie_title ?? streamingInfo.video_file.name}
              movieTitle={torrentStatus.movie_title}
              subtitle={`${torrentStatus.quality} • ${streamingInfo.video_file.name}`}
              onError={handleVideoError}
              onProgress={handleVideoProgress}
              downloadProgress={videoFileProgress} // Pass the video-specific progress
              streamingInfo={streamingInfo} // Pass the full streaming info
              sources={sources}
              currentSourceId={undefined}
              onSelectSource={handleSelectSource}
              streamHealth={streamHealth ?? undefined}
              onRecoveryExhausted={handleRecoveryExhausted}
            />

            {/* Up-Next card — floats above player, bottom-right, above controls */}
            {showUpNext && upNextLabel && (
              <div className="absolute bottom-28 right-7 z-50 pointer-events-auto">
                <UpNextCard
                  nextLabel={upNextLabel}
                  onPlayNext={async () => {
                    // Latched first: a slow or failed start must not reopen the card and retry.
                    upNextClosedFor.current = upNextKey;
                    setShowUpNext(false);
                    if (nextVideoFile) {
                      router.replace(`/streaming/${torrentId}?file=${nextVideoFile.index}`);
                      return;
                    }
                    // The card is gone and the start can take seconds (a provider search,
                    // or a prefetch still running): say so. The error reuses the id.
                    toast.loading('Starting the next episode…', { id: 'play-next' });
                    const href = await upNext.playNext();
                    if (href !== null) {
                      toast.dismiss('play-next');
                      router.replace(href);
                    } else toast.error('Could not start the next episode.', { id: 'play-next' });
                  }}
                  onDismiss={() => {
                    upNextClosedFor.current = upNextKey;
                    setShowUpNext(false);
                  }}
                  countdownSeconds={15}
                />
              </div>
            )}
          </>
        ) : (
          streamHealth && (
            <StreamPhasePanel
              health={streamHealth}
              progress={torrentStatus.progress}
              onForceStart={handleForceStreaming}
              showForceStart={!forceStreaming}
            />
          )
        )}
      </div>

      {/* Streaming Stats Panel — glass overlay */}
      {showStreamingStats && streamingInfo && (
        <div className="absolute bottom-0 left-0 right-0 border-t border-hairline bg-surface/90 backdrop-blur px-5 py-4 z-10">
          <h3 className="text-xs font-medium text-muted uppercase tracking-widest mb-3">Streaming Statistics</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-2 text-sm">
            <div className="flex items-baseline gap-2">
              <span className="text-muted text-xs">Overall</span>
              <span className="text-text font-medium">{Math.round(torrentStatus.progress)}%</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-muted text-xs">Video File</span>
              <span className="text-text font-medium">{Math.round(streamingInfo.video_file.progress)}%</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-muted text-xs">Speed</span>
              <span className="text-text font-medium">{torrentStatus.download_rate.toFixed(2)} KB/s</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-muted text-xs">File Size</span>
              <span className="text-text font-medium">{formatBytes(streamingInfo.video_file.size)}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-muted text-xs">Downloaded</span>
              <span className="text-text font-medium">{formatBytes(streamingInfo.video_file.downloaded)}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-muted text-xs">Peers</span>
              <span className="text-text font-medium">{torrentStatus.num_peers}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-muted text-xs">State</span>
              <span className="text-text font-medium">{torrentStatus.state}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-muted text-xs">Progress Rate</span>
              <span className="text-text font-medium">
                {torrentStatus.download_rate > 0
                  ? `~${(torrentStatus.download_rate / streamingInfo.video_file.size * 100).toFixed(4)}%/s`
                  : 'N/A'}
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-muted text-xs">Format</span>
              <span className="text-text font-medium">{streamingInfo.video_file.mime_type.split('/')[1].toUpperCase()}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-muted text-xs">ETA</span>
              <span className="text-text font-medium">
                {torrentStatus.eta
                  ? `${Math.floor(torrentStatus.eta / 60)} min ${torrentStatus.eta % 60} sec`
                  : 'Unknown'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
