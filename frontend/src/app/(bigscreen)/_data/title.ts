import type { StreamingProgress, TorrentStatus } from '@/types';
import { streamingService } from '@/services/streaming';
import { torrentsService } from '@/services/torrents';
import { buildContentId } from '@/lib/contentId';

/** What the primary control on a detail screen should do, and say. */
export type TitleAction =
  | { kind: 'play' } // nothing exists yet
  | { kind: 'resume'; href: string; atSeconds: number } // progress exists and is resumable
  | { kind: 'open'; href: string } // downloaded, no progress
  | { kind: 'preparing'; torrentId: string; progress: number } // already downloading
  | { kind: 'paused'; torrentId: string } // a download exists but is not running
  | { kind: 'blocked'; reason: string }; // the box refused it

export interface TitleState {
  action: TitleAction;
  /** True when a profile-scoped call answered 423: the caller must send the viewer to the picker. */
  locked: boolean;
}

interface TitleRef {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  season?: number;
  episode?: number;
}

/** The television asks for 1080p everywhere (spec §7.3); there is no picker on this surface. */
const QUALITY = '1080p' as const;

/** Past this a film is finished, not resumable. Matches the web's cut-off. */
const FINISHED_PCT = 95;

const statusOf = (err: unknown): number | undefined =>
  (err as { response?: { status?: number } } | null)?.response?.status;

const READY = new Set(['finished', 'seeding']);
// checking/allocating are the first moments of a download that has just been added; leaving
// them out would offer Play for a title that is already on its way and mint a second torrent.
const PREPARING = new Set([
  'downloading',
  'downloading_metadata',
  'queued',
  'checking',
  'checking_fastresume',
  'allocating',
]);

// A torrent that exists but is not running. `resume_torrent` re-adds a paused, stopped OR
// errored torrent from its resume data and rechecks what is on disk, so all three continue
// where they stopped. Offering Play instead would restart a half-downloaded film from nothing
// (and mint a second torrent) on a Raspberry Pi.
const PAUSED = new Set(['paused', 'stopped', 'error']);

const watchHref = (torrentId: string, fileIndex?: number | null): string =>
  // `!= null`, not truthiness: file 0 is the first file of a season pack.
  fileIndex != null ? `/bigscreen/watch/${torrentId}?file=${fileIndex}` : `/bigscreen/watch/${torrentId}`;

/**
 * Does this torrent row cover the title? Identity fields only: `movie_title` is free text
 * and a season pack's title does not name an episode.
 *
 * - `tmdb_id` AND `media_type` must both agree. A row whose `media_type` disagrees (or is
 *   NULL) is "no match", never a guess: `manager.py` stores a TV torrent as "movie" when a
 *   caller omits it. A movie row that carries a season/episode is that same lie seen from
 *   the other side, so it is rejected too.
 * - A NULL season/episode is only read as "movie" together with `media_type`.
 * - `season: N, episode: null` is a SEASON PACK: "this season is covered", not "episode
 *   unknown". It matches any episode of season N (the caller then resolves a file index).
 *   Asking for the season itself (no episode) is covered only by such a pack.
 */
function covers(row: TorrentStatus, ref: TitleRef): boolean {
  if (row.tmdb_id !== ref.tmdbId || row.media_type !== ref.mediaType) return false;
  if (ref.mediaType === 'movie') return row.season == null && row.episode == null;
  if (ref.season === undefined) return true;
  if (row.season !== ref.season) return false;
  if (ref.episode === undefined) return row.episode == null;
  return row.episode == null || row.episode === ref.episode;
}

function resumable(p: StreamingProgress | null): p is StreamingProgress & { torrent_id: string } {
  // torrent_id is NULL once the torrent is removed (FK ON DELETE SET NULL): history, not a resume.
  if (!p || typeof p.torrent_id !== 'string' || !p.torrent_id) return false;
  if (p.completed) return false;
  const pct = Number(p.percentage);
  return pct > 0 && pct < FINISHED_PCT;
}

/**
 * The file inside a ready torrent to open, or `undefined` when the episode is not in it.
 * `null` means "no file param needed" (a movie, or a single-episode torrent).
 */
async function fileFor(
  row: TorrentStatus,
  ref: TitleRef,
  saved: number | null | undefined,
): Promise<number | null | undefined> {
  const isPackLookup = ref.mediaType === 'tv' && ref.season !== undefined && ref.episode !== undefined && row.episode == null;
  if (saved != null) return saved;
  if (!isPackLookup) return null;
  const index = await fileIndexForEpisode(row.id, ref.season as number, ref.episode as number);
  return index === null ? undefined : index;
}

async function readyAction(
  rows: TorrentStatus[],
  ref: TitleRef,
  progress: (StreamingProgress & { torrent_id: string }) | null,
): Promise<TitleAction | null> {
  // The torrent the viewer was already watching goes first.
  const ordered = [...rows].sort(
    (a, b) => Number(b.id === progress?.torrent_id) - Number(a.id === progress?.torrent_id),
  );
  for (const row of ordered) {
    try {
      const resuming = !!progress && row.id === progress.torrent_id;
      const file = await fileFor(row, ref, resuming ? progress.file_index : null);
      if (file === undefined) continue; // the pack does not hold this episode
      const href = watchHref(row.id, file);
      return resuming
        ? { kind: 'resume', href, atSeconds: Number(progress.current_time) || 0 }
        : { kind: 'open', href };
    } catch {
      // One bad row costs that row.
    }
  }
  return null;
}

/** The action for a torrent that is not ready to watch, or null when its state offers none. */
function unreadyAction(row: TorrentStatus): TitleAction | null {
  if (PREPARING.has(row.state)) {
    return { kind: 'preparing', torrentId: row.id, progress: Number(row.progress) || 0 };
  }
  if (PAUSED.has(row.state)) return { kind: 'paused', torrentId: row.id };
  if (row.state === 'blocked') {
    return { kind: 'blocked', reason: row.block_reason || 'The box could not start this title.' };
  }
  return null;
}

/**
 * The torrent the progress row names, fetched directly. The row is what ties this content id
 * to that torrent, so no identity match is needed (or wanted): a torrent downloaded before the
 * identity columns existed has all four NULL and `sync_columns` never backfills them. Null when
 * the torrent is gone or its state offers nothing, and the caller falls back to identity.
 */
async function actionFromProgress(
  progress: StreamingProgress & { torrent_id: string },
  ref: TitleRef,
): Promise<TitleAction | null> {
  try {
    const row = await torrentsService.getTorrentStatus(progress.torrent_id);
    if (!row || typeof row.id !== 'string') return null;
    if (READY.has(row.state)) return await readyAction([row], ref, progress);
    return unreadyAction(row);
  } catch {
    return null;
  }
}

/**
 * Ask what already exists before anyone is offered Play. `POST /torrents/download` mints a
 * fresh uuid4 and `add_torrent` does no magnet or infohash dedupe, so every Play press
 * starts a new torrent, and the ARM build allows only two at once.
 *
 * Resolves, never rejects. A dead `listTorrents` degrades to `play`; a 423 from the
 * profile-scoped progress call is reported as `locked`, never as "nothing to resume".
 * `chosen_quality` is not read: `to_status()` omits it, so it is null on every poll.
 */
export async function titleStateFor(args: TitleRef & { userId: string | null }): Promise<TitleState> {
  const ref: TitleRef = {
    mediaType: args.mediaType,
    tmdbId: args.tmdbId,
    season: args.season,
    episode: args.episode,
  };
  try {
    let progress: StreamingProgress | null = null;
    if (args.userId) {
      try {
        progress = await streamingService.getProgressByMovie(
          args.userId,
          buildContentId({
            kind: args.mediaType,
            tmdbId: args.tmdbId,
            season: args.season,
            episode: args.episode,
          }),
        );
      } catch (err) {
        if (statusOf(err) === 423) return { locked: true, action: { kind: 'play' } };
        // Any other failure just means there is nothing to resume from.
      }
    }

    if (resumable(progress)) {
      const action = await actionFromProgress(progress, ref);
      if (action) return { locked: false, action };
    }

    let all: TorrentStatus[] = [];
    try {
      const listed = await torrentsService.listTorrents();
      all = Array.isArray(listed) ? listed : [];
    } catch {
      return { locked: false, action: { kind: 'play' } };
    }

    const matches: TorrentStatus[] = [];
    for (const row of all) {
      try {
        if (row && covers(row, ref)) matches.push(row);
      } catch {
        // malformed row
      }
    }

    const ready = matches.filter((r) => READY.has(r.state));
    if (ready.length) {
      const action = await readyAction(ready, ref, resumable(progress) ? progress : null);
      if (action) return { locked: false, action };
    }
    for (const row of matches) {
      const action = unreadyAction(row);
      if (action) return { locked: false, action };
    }
    return { locked: false, action: { kind: 'play' } };
  } catch {
    return { locked: false, action: { kind: 'play' } };
  }
}

function reasonFor(err: unknown): string {
  const status = statusOf(err);
  const raw = (err as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail;
  const detail = typeof raw === 'string' ? raw : '';
  if (status === undefined) {
    return (err as { request?: unknown } | null)?.request
      ? "Couldn't reach the box. Check that it is on."
      : "Couldn't start this title. Try again.";
  }
  if (status === 404) {
    return /no torrents/i.test(detail)
      ? 'No sources found for this title yet.'
      : "The box doesn't recognise this title.";
  }
  if (status === 409 || status === 429 || status === 503 || /busy|too many|limit/i.test(detail)) {
    return 'The box is busy with other downloads. Try again in a few minutes.';
  }
  return "Couldn't start this title. Try again.";
}

/** Resume a paused download. Same result shape as `requestTitle`. */
export async function resumeTitle(
  torrentId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await torrentsService.performTorrentAction(torrentId, 'resume');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason:
        statusOf(err) === 404
          ? 'That download is no longer on the box.'
          : (err as { request?: unknown } | null)?.request && statusOf(err) === undefined
            ? "Couldn't reach the box. Check that it is on."
            : "Couldn't resume this download. Try again.",
    };
  }
}

/**
 * Start a download. Resolves with the new torrent id, or a reason it did not start.
 * Deliberately not `handleCatalogStreamingStart`: it swallows the error into a toast, and
 * this surface mounts no toaster, so a failed Play would be silent on the television.
 */
export async function requestTitle(args: {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  season?: number;
  episode?: number;
}): Promise<{ ok: true; torrentId: string } | { ok: false; reason: string }> {
  if (args.mediaType === 'tv' && args.season === undefined) {
    return { ok: false, reason: "Couldn't start this title. Try again." };
  }
  try {
    const status = await torrentsService.downloadCatalogMovie({
      tmdb_id: args.tmdbId,
      quality: QUALITY,
      media_type: args.mediaType,
      ...(args.mediaType === 'tv' ? { season: args.season, episode: args.episode } : {}),
    });
    const id = status?.id;
    if (typeof id !== 'string' || !id) return { ok: false, reason: "Couldn't start this title. Try again." };
    return { ok: true, torrentId: id };
  } catch (err) {
    return { ok: false, reason: reasonFor(err) };
  }
}

/**
 * The file index inside `torrentId` that holds this episode, or null if it is not there.
 * `getFiles` already parses season/episode from each filename, so this is a lookup. Null
 * rather than a guessed index: guessing plays the wrong episode.
 */
export async function fileIndexForEpisode(
  torrentId: string,
  season: number,
  episode: number,
): Promise<number | null> {
  try {
    const files = await streamingService.getFiles(torrentId);
    if (!Array.isArray(files)) return null;
    const hit = files.find((f) => f?.season === season && f?.episode === episode);
    return hit && Number.isInteger(hit.index) ? hit.index : null;
  } catch {
    return null;
  }
}
