import type { StreamingProgress, TorrentStatus } from '@/types';
import { streamingService } from '@/services/streaming';
import { torrentsService } from '@/services/torrents';
import { buildContentId } from '@/lib/contentId';

/** What the primary control on a detail screen should do, and say. */
export type TitleAction =
  | { kind: 'play' } // nothing exists yet
  | { kind: 'resume'; href: string; atSeconds: number } // progress exists and is resumable
  | {
      kind: 'open';
      href: string;
      /**
       * The title is here, but the episode could not be pinpointed inside a season pack —
       * the file list was unreadable, not missing the episode. The href therefore has no
       * `?file=`, so it plays the pack's default file, which may be the wrong episode. The
       * screen MUST say so rather than navigating silently: offering the wrong episode
       * without a word is the same defect class as a control whose label lies.
       */
      episodeUnresolved?: boolean;
    } // downloaded, no progress
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
type RequestResult = { ok: true; torrentId: string } | { ok: false; reason: string };

const inFlight = new Map<string, Promise<RequestResult>>();

const LOCKED_REASON = 'This profile is locked. Enter its passcode to continue.';

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
 * The file to open inside a ready torrent. `null` means "no file param": a movie, a
 * single-episode torrent, or a pack whose file list could not be read. `undefined` means the
 * pack was listed and genuinely does not hold this episode.
 *
 * A failed or empty lookup is UNKNOWN, not absent. The torrent is on disk either way, and
 * offering Play would start a second multi-GB download to fetch something already there,
 * so an unreadable pack opens without `?file=` instead.
 */
/** Third answer from a pack lookup: the pack is here, but which file is unknown. */
const UNRESOLVED = 'unresolved' as const;

async function fileFor(
  row: TorrentStatus,
  ref: TitleRef,
  saved: number | null | undefined,
): Promise<number | null | undefined | typeof UNRESOLVED> {
  if (saved != null) return saved;
  const isPackLookup =
    ref.mediaType === 'tv' && ref.season !== undefined && ref.episode !== undefined && row.episode == null;
  if (!isPackLookup) return null;
  const found = await lookupEpisodeFile(row.id, ref.season as number, ref.episode as number);
  if (found.kind === 'found') return found.index;
  // 'absent' -> undefined, i.e. this pack genuinely lacks the episode, so try the next row.
  // 'unknown' -> UNRESOLVED, a distinct third answer: the pack is here and we cannot say
  // which file, which the screen has to disclose.
  return found.kind === 'absent' ? undefined : UNRESOLVED;
}

/**
 * `progress` is the row naming a torrent (any row with a torrent_id); `canResume` says whether
 * it is still mid-watch. A finished or barely-started row still finds its torrent, so it opens
 * rather than re-downloads: the finished rule picks the verb, not whether to look.
 */
async function readyAction(
  rows: TorrentStatus[],
  ref: TitleRef,
  progress: (StreamingProgress & { torrent_id: string }) | null,
  canResume: boolean,
): Promise<TitleAction | null> {
  // The torrent the viewer was already watching goes first.
  const ordered = [...rows].sort(
    (a, b) => Number(b.id === progress?.torrent_id) - Number(a.id === progress?.torrent_id),
  );
  for (const row of ordered) {
    try {
      const named = !!progress && row.id === progress.torrent_id;
      const file = await fileFor(row, ref, named ? progress.file_index : null);
      if (file === undefined) continue; // the pack was listed and does not hold this episode
      const unresolved = file === UNRESOLVED;
      const href = watchHref(row.id, unresolved ? null : file);
      return named && canResume
        ? { kind: 'resume', href, atSeconds: Number(progress.current_time) || 0 }
        : unresolved
          ? { kind: 'open', href, episodeUnresolved: true }
          : { kind: 'open', href };
    } catch {
      // One bad row costs that row.
    }
  }
  return null;
}

const isKnownUnready = (row: TorrentStatus): boolean =>
  PREPARING.has(row.state) || PAUSED.has(row.state) || row.state === 'blocked';

/**
 * The action for a torrent that is not ready to watch. Total: an unknown or NULL state on a
 * row that matched is still a torrent that exists, so it reads as `preparing`. Only an
 * unmatched title may reach `play`.
 */
function unreadyAction(row: TorrentStatus): TitleAction {
  if (PAUSED.has(row.state)) return { kind: 'paused', torrentId: row.id };
  if (row.state === 'blocked') {
    return { kind: 'blocked', reason: row.block_reason || 'The box could not start this title.' };
  }
  return { kind: 'preparing', torrentId: row.id, progress: Number(row.progress) || 0 };
}

/**
 * The torrent the progress row names, fetched directly. The row is what ties this content id
 * to that torrent, so no identity match is needed (or wanted): a torrent downloaded before the
 * identity columns existed has all four NULL and `sync_columns` never backfills them. Null when
 * the torrent is gone, and the caller falls back to identity.
 *
 * Runs for ANY progress row that names a torrent, not only a resumable one: a film finished
 * (or opened at 0%) before the identity columns existed would otherwise be unfindable and
 * offered Play, re-downloading what is on disk.
 */
async function actionFromProgress(
  progress: StreamingProgress & { torrent_id: string },
  ref: TitleRef,
  canResume: boolean,
): Promise<TitleAction | null> {
  try {
    const row = await torrentsService.getTorrentStatus(progress.torrent_id);
    if (!row || typeof row.id !== 'string') return null;
    if (READY.has(row.state)) return await readyAction([row], ref, progress, canResume);
    return unreadyAction(row);
  } catch {
    return null;
  }
}

/** A progress row that names a torrent. */
function named(p: StreamingProgress | null): p is StreamingProgress & { torrent_id: string } {
  return !!p && typeof p.torrent_id === 'string' && p.torrent_id !== '';
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
        if (statusOf(err) === 423) {
          // Never `play`: a consumer that forgets to check `locked` must not be able to mint.
          return { locked: true, action: { kind: 'blocked', reason: LOCKED_REASON } };
        }
        // Any other failure just means there is nothing to resume from.
      }
    }

    const canResume = resumable(progress);
    if (named(progress)) {
      const action = await actionFromProgress(progress, ref, canResume);
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
      const action = await readyAction(ready, ref, named(progress) ? progress : null, canResume);
      if (action) return { locked: false, action };
    }
    // A ready row that reached here was a pack without this episode; it says nothing more.
    // Known states first, then any other matched row: it exists, so it is never Play.
    const live = matches.filter((r) => !READY.has(r.state));
    const row = live.find(isKnownUnready) ?? live[0];
    if (row) return { locked: false, action: unreadyAction(row) };
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

/**
 * Resume a paused download. Same result shape as `requestTitle`.
 *
 * For the screen: a paused row that errored at add time (a bad magnet) fails `resume` again.
 * Surface the `reason` and keep the title recoverable (back to the detail screen, still
 * pressable) rather than looping on a paused state forever. The 404 is ambiguous on the wire:
 * the endpoint answers it both for "not found" and for "action failed".
 */
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
          ? "The box couldn't resume that download. It may have been removed."
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
export function requestTitle(args: {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  season?: number;
  episode?: number;
}): Promise<RequestResult> {
  // POST /download runs a provider search before it answers, and titleStateFor still says
  // `play` for that whole window. A second OK press must join the first request, not mint a
  // second torrent (the ARM build allows two downloads).
  const key = `${args.mediaType}:${args.tmdbId}:${args.season ?? ''}:${args.episode ?? ''}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const started = startDownload(args).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, started);
  return started;
}

async function startDownload(args: {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  season?: number;
  episode?: number;
}): Promise<RequestResult> {
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

type EpisodeLookup = { kind: 'found'; index: number } | { kind: 'absent' } | { kind: 'unknown' };

/**
 * Failure and absence are different facts. `absent` means the file list was read, was not
 * empty, and has no such episode. A rejected call or an empty list is `unknown`: the list may
 * simply not be ready, and "unknown" must never justify a new download.
 */
async function lookupEpisodeFile(torrentId: string, season: number, episode: number): Promise<EpisodeLookup> {
  try {
    const files = await streamingService.getFiles(torrentId);
    if (!Array.isArray(files) || files.length === 0) return { kind: 'unknown' };
    // Packs often ship a sample next to the episode; the biggest match is the episode.
    const hits = files.filter((f) => f?.season === season && f?.episode === episode && Number.isInteger(f.index));
    if (!hits.length) return { kind: 'absent' };
    const best = hits.reduce((a, b) => ((Number(b.size) || 0) > (Number(a.size) || 0) ? b : a));
    return { kind: 'found', index: best.index };
  } catch {
    return { kind: 'unknown' };
  }
}

/**
 * The file index inside `torrentId` that holds this episode, or null if it is not there (or
 * the file list could not be read). `getFiles` already parses season/episode from each
 * filename, so this is a lookup. Null rather than a guessed index: guessing plays the wrong
 * episode. `titleStateFor` uses the finer-grained lookup so an unreadable pack never reads as
 * "absent"; a screen calling this directly gets the same null for both.
 */
export async function fileIndexForEpisode(
  torrentId: string,
  season: number,
  episode: number,
): Promise<number | null> {
  const found = await lookupEpisodeFile(torrentId, season, episode);
  return found.kind === 'found' ? found.index : null;
}
