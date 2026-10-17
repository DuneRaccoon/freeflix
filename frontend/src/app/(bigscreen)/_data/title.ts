import type { ClientProfileId, StreamingProgress, TorrentStatus } from '@/types';
import { streamingService } from '@/services/streaming';
import { torrentsService } from '@/services/torrents';
import { buildContentId } from '@/lib/contentId';
import { statusOf } from './httpStatus';
import { watchHref } from './watchHref';

/** What the primary control on a detail screen should do, and say. */
export type TitleAction =
  | { kind: 'play' } // nothing exists yet
  | { kind: 'resume'; href: string; atSeconds: number } // progress exists and is resumable
  | { kind: 'open'; href: string } // downloaded, no progress
  // Already downloading. `fileIndex` is set when the torrent is a season pack and the episode
  // asked for was located in it: without it a pack plays its DEFAULT file, i.e. episode 1.
  // `fileUnknown`: a pack whose file list could not be read (a torrent still fetching its
  // metadata has none, by design). It is NOT inferable from a missing `fileIndex`: a movie and
  // a single-episode torrent lack one too, and navigating bare is correct for those. When set,
  // a screen must re-ask instead of navigating, or the pack's default file (episode 1) plays.
  | { kind: 'preparing'; torrentId: string; progress: number; fileIndex?: number; fileUnknown?: true }
  // A download exists but is not running. `fileUnknown`: a pack whose file list could not be
  // read, so resuming must re-ask which file before anything is played.
  | { kind: 'paused'; torrentId: string; fileIndex?: number; fileUnknown?: true }
  | {
      /**
       * The season is here, but WHICH FILE holds this episode could not be determined —
       * the file list was unreadable, not missing the episode. The href therefore carries
       * no `?file=`, so it plays the pack's default file, which may be the wrong episode.
       *
       * Its own kind rather than a flag on `open`/`resume`, deliberately: an optional
       * boolean compiles fine when a screen forgets it, and the first version of this DID
       * forget it on `resume` — so a mid-watch viewer was resumed at their timestamp into
       * possibly the wrong episode and told nothing. A kind cannot be ignored by omission.
       * The screen MUST disclose it; playing something other than what was asked for,
       * without a word, is the same defect class as a control whose label lies.
       */
      kind: 'unresolvedEpisode';
      href: string;
      /** Set when the viewer was mid-watch, so the screen can still offer to resume. */
      atSeconds?: number;
    }
  /** The box refused it, or the profile is passcode-locked (see `TitleState.locked`). */
  | { kind: 'blocked'; reason: string };

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

/**
 * The television asks for 1080p by default and there is still no quality PICKER on this
 * surface — but 1080p is no longer everywhere: a per-title 4K opt-in (stage 8, spec §7.3)
 * raises a single ask to 2160p via `fourK`. Nothing is persisted, so the next title is 1080p
 * again. Every TV request carries `client: TV_PROFILE` regardless, which is what makes the
 * 1080p ask honest too: without it the box ranks by seeds alone and can hand this panel a
 * release it cannot decode.
 */
type RequestResult =
  | {
      ok: true;
      torrentId: string;
      /** A pack the episode was located in. */
      fileIndex?: number;
      /** The box answered with a season pack, and which file is the episode could not be read. */
      unresolved?: true;
    }
  | {
      ok: false;
      reason: string;
      /**
       * The failure does not rule out that a torrent was created. The backend adds the
       * torrent and THEN looks its status up, so a 5xx, or a dropped connection with no status
       * at all, can arrive after the download exists. A 404 or 409 is a refusal before
       * anything was added. A screen must re-ask `titleStateFor` before offering Play again
       * when this is set, or a second press mints a second multi-GB download.
       */
      maybeCreated: boolean;
    };

const inFlight = new Map<string, Promise<RequestResult>>();

/**
 * WHICH TORRENTS THIS CLIENT ASKED FOR IN 4K — the only channel on this surface that
 * carries the ASK rather than what arrived.
 *
 * Why it has to exist at all: because health outranks the quality bucket in the
 * selector, a 4K press answered with a 1080p release is the COMMON outcome, and a
 * control labelled "Ask for 4K" that quietly produces HD is exactly the defect
 * `unresolvedEpisode` exists to prevent. The watch route cannot work the ask out for
 * itself — `watchHref` builds `/bigscreen/watch/{id}` plus an optional `?file=` and
 * nothing else, `router.push` carries no state, `TorrentStatus` has no
 * requested-quality field, and `to_status()` leaves `chosen_quality` null on every
 * poll — so a 1080p row is a 1080p ask and a downgraded 4K ask at once. This module
 * is the one place that knows both the flag and the id it produced.
 *
 * DELIBERATELY NOT THE WIRE AND NOT A SHARED TYPE: no query parameter (`?q=2160p` on a
 * watch URL is a claim anyone can forge and a dead history entry can replay), no field
 * on `TorrentStatus`, no field on `RequestResult`. Module state, which means it lives
 * exactly as long as the client-side navigation it is describing.
 *
 * SILENCE ON A COLD LOAD IS THE POINT, NOT A LIMITATION. A reload, a deep link, or the
 * television waking on `/bigscreen/watch/{id}` has genuinely no idea what was asked for,
 * and "say nothing" is then the honest answer — the alternative is a sentence about a
 * press that may never have happened.
 *
 * TAKEN, NOT READ, and bounded. Both halves guard the same lie: "the second play of a
 * title inherits the first play's disclosure" would look like a feature.
 */
const fourKAsks = new Map<string, true>();

/**
 * How many unread asks to keep. There is one screen and the ARM build allows two
 * concurrent downloads, so more than a couple of UNREAD entries means nobody is reading
 * them — a press the viewer backed out of before the player mounted leaves its entry
 * behind, and nothing else would ever collect it.
 */
const FOUR_K_ASKS_REMEMBERED = 4;

function rememberFourKAsk(torrentId: string): void {
  fourKAsks.set(torrentId, true);
  // Map iterates in insertion order, so the oldest unread ask is the one dropped.
  while (fourKAsks.size > FOUR_K_ASKS_REMEMBERED) {
    const oldest: string | undefined = fourKAsks.keys().next().value;
    if (oldest === undefined) return;
    fourKAsks.delete(oldest);
  }
}

/**
 * Did THIS client ask for this torrent in 4K? Answers once and forgets.
 *
 * `delete` rather than `has`, and that is the whole eviction policy: the disclosure is
 * about an arrival, so the second navigation to the same watch URL — Open, Resume, or a
 * stale history entry — must not be told about a press that has already been answered.
 * A caller that needs the answer across renders holds it in its own state.
 */
export function takeFourKAsk(torrentId: string): boolean {
  return fourKAsks.delete(torrentId);
}

const LOCKED_REASON = 'This profile is locked. Enter its passcode to continue.';

const QUALITY_HD = '1080p' as const;
const QUALITY_4K = '2160p' as const;

/**
 * Sent on EVERY request this surface makes, not only the 4K one. The 1080p ask is the one
 * that needs it most: a 1080p HEVC 10-bit Opus release is exactly what an unprofiled ranker
 * picks on seeds and exactly what this panel cannot play. The backend declares the value as
 * a pydantic Literal and forbids unknown keys, so a typo here is a 422, never a quiet 200
 * ranked with no profile at all.
 */
const TV_PROFILE: ClientProfileId = 'lg-webos22-floor';

/**
 * Past this a film is finished, not resumable. Matches the web's cut-off.
 *
 * EXPORTED because the watch route's heartbeat writes `completed` and must use the SAME
 * cut-off this file reads it back with: a row marked complete at one threshold and judged
 * resumable at another is a title that is neither resumable nor watched, so the show screen
 * never says "all caught up" and Continue Watching keeps offering it.
 */
export const FINISHED_PCT = 95;

/**
 * The torrent states the watch route reads the same way this file does, exported for the
 * same reason: two copies of "is this playable yet" is how one screen navigates to a player
 * the player then refuses. `READY` is also the EVICTED case — `finished`/`seeding` with an
 * empty `/files` means "playable straight off disk", never "this pack has no episodes".
 */
export const READY = new Set(['finished', 'seeding']);
// checking/allocating are the first moments of a download that has just been added; leaving
// them out would offer Play for a title that is already on its way and mint a second torrent.
export const PREPARING = new Set([
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

/** Third answer from a pack lookup: the pack is here, but which file is unknown. */
const UNRESOLVED = 'unresolved' as const;

/**
 * The file to open inside a ready torrent. `null` means "no file param": a movie, a
 * single-episode torrent, or a pack whose file list could not be read. `undefined` means the
 * pack was listed and genuinely does not hold this episode.
 *
 * A failed or empty lookup is UNKNOWN, not absent. The torrent is on disk either way, and
 * offering Play would start a second multi-GB download to fetch something already there,
 * so an unreadable pack opens without `?file=` instead.
 */
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
      const atSeconds = named && canResume ? Number(progress.current_time) || 0 : undefined;
      // Unresolved wins over both verbs: being resumed into the wrong episode is no more
      // acceptable than opening into it.
      if (unresolved) return { kind: 'unresolvedEpisode', href, ...(atSeconds === undefined ? {} : { atSeconds }) };
      return atSeconds === undefined ? { kind: 'open', href } : { kind: 'resume', href, atSeconds };
    } catch {
      // One bad row costs that row.
    }
  }
  return null;
}

const isKnownUnready = (row: TorrentStatus): boolean =>
  PREPARING.has(row.state) || PAUSED.has(row.state) || row.state === 'blocked';

/**
 * The action for a torrent that is not ready to watch. A matched row is a torrent that exists,
 * so an unknown or NULL state reads as `preparing`; only an unmatched title may reach `play`.
 *
 * A SEASON PACK IS WATCHABLE WHILE IT DOWNLOADS (streaming from in-progress torrents is the
 * point of this service), and for hours that is its normal state, so the episode's file is
 * resolved here exactly as for a ready pack. Without it `preparing` would navigate with no
 * `?file=` and the pack's default file, episode 1, would play for any episode asked.
 * - found: `preparing`/`paused` carry `fileIndex`.
 * - unreadable: `preparing` / `paused` with `fileUnknown`. The honest answer for a torrent that
 *   has no metadata yet is still "Preparing…", not "Play anyway"; the screen re-asks on press.
 *   (`unresolvedEpisode` is for a READY pack whose file we still cannot name.)
 * - absent (listed, and lacks the episode): null, this row does not cover the episode.
 */
async function unreadyAction(
  row: TorrentStatus,
  ref: TitleRef,
  saved?: number | null,
): Promise<TitleAction | null> {
  if (row.state === 'blocked') {
    return { kind: 'blocked', reason: row.block_reason || 'The box could not start this title.' };
  }
  const file = await fileFor(row, ref, saved);
  if (file === undefined) return null;
  const unresolved = file === UNRESOLVED;
  const index = unresolved ? null : file;
  if (PAUSED.has(row.state)) {
    return {
      kind: 'paused',
      torrentId: row.id,
      ...(index != null ? { fileIndex: index } : {}),
      ...(unresolved ? { fileUnknown: true as const } : {}),
    };
  }
  return {
    kind: 'preparing',
    torrentId: row.id,
    progress: Number(row.progress) || 0,
    ...(index != null ? { fileIndex: index } : {}),
    ...(unresolved ? { fileUnknown: true as const } : {}),
  };
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
    return await unreadyAction(row, ref, progress.file_index);
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
    for (const row of [...live.filter(isKnownUnready), ...live.filter((r) => !isKnownUnready(r))]) {
      try {
        const saved = named(progress) && progress.torrent_id === row.id ? progress.file_index : null;
        const action = await unreadyAction(row, ref, saved);
        if (action) return { locked: false, action };
      } catch {
        // One bad row costs that row.
      }
    }
    return { locked: false, action: { kind: 'play' } };
  } catch {
    return { locked: false, action: { kind: 'play' } };
  }
}

/**
 * Only the capability profile says "this television" (`api/torrents.py`'s
 * `_device_refusal`). Two details ride on it, discriminated by `only 4k`:
 *
 *   {'withheld'}  -> "Only 4K sources exist for this title — no torrents this television
 *                     can play in HD"   (a 2160p release the viewer CAN unlock)
 *   anything else -> "No torrents this television can play"   (nothing to press)
 *
 * BELT AND BRACES, AND THE ORDER IS THE BELT. This test runs BEFORE `/no torrents/i`
 * while both details deliberately still MATCH that regex, so the two defences fail in
 * opposite directions and neither is a single point of failure: lose this branch and a
 * device refusal degrades to the mild, true "No sources found for this title yet."
 * rather than to the outright lie "The box doesn't recognise this title." about a title
 * the box just searched. The backend's own docstring carries the other half of the
 * contract ("keep the substring"), and `title.test.ts` reads both strings off
 * `torrents.py` so a copy edit on either side of the wire reddens here.
 */
const DEVICE_REFUSAL = /this television/i;
const DEVICE_REFUSAL_4K = /only 4k/i;

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
    if (DEVICE_REFUSAL.test(detail)) {
      // The 4K copy names the press that can still work; the other promises nothing,
      // because nothing on this screen would change the answer.
      return DEVICE_REFUSAL_4K.test(detail)
        ? 'Only 4K sources exist for this title. Press Ask for 4K to try one.'
        : 'No sources this television can play.';
    }
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
 *
 * `fourK` raises this one ask to 2160p. It is an argument rather than any kind of stored
 * preference on purpose: nothing persists it, so the opt-in is per press.
 */
export function requestTitle(args: {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  season?: number;
  episode?: number;
  fourK?: boolean;
}): Promise<RequestResult> {
  // POST /download runs a provider search before it answers, and titleStateFor still says
  // `play` for that whole window. A second OK press must join the first request, not mint a
  // second torrent (the ARM build allows two downloads).
  //
  // THE QUALITY IS PART OF THE IDENTITY. Without it in the key, a 1080p press followed by a
  // 4K press inside that window (a full provider search wide, up to ~35s cold) hands the
  // second press the FIRST press's promise: the 4K ask is never sent, and the control
  // reports someone else's result as its own. Two different asks are two requests.
  const key = `${args.mediaType}:${args.tmdbId}:${args.season ?? ''}:${args.episode ?? ''}:${
    args.fourK ? QUALITY_4K : QUALITY_HD
  }`;
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
  fourK?: boolean;
}): Promise<RequestResult> {
  if (args.mediaType === 'tv' && args.season === undefined) {
    return { ok: false, reason: "Couldn't start this title. Try again.", maybeCreated: false };
  }
  try {
    const status = await torrentsService.downloadCatalogMovie({
      tmdb_id: args.tmdbId,
      quality: args.fourK ? QUALITY_4K : QUALITY_HD,
      media_type: args.mediaType,
      client: TV_PROFILE,
      ...(args.mediaType === 'tv' ? { season: args.season, episode: args.episode } : {}),
    });
    const id = status?.id;
    // A 2xx with no usable id: the server answered, so something may well exist.
    if (typeof id !== 'string' || !id) return { ok: false, reason: "Couldn't start this title. Try again.", maybeCreated: true };
    // HERE, AND ONLY HERE: this is the one point that holds the flag and the id it
    // produced at the same time. Recorded before the pack lookup below, which can take
    // another round trip and must not be able to lose the ask by failing.
    if (args.fourK) rememberFourKAsk(id);
    // The backend may satisfy an episode with a season pack (a row with no episode of its
    // own); that plays its default file unless the episode's file is located.
    if (args.mediaType === 'tv' && args.season !== undefined && args.episode !== undefined && status.episode == null) {
      const found = await lookupEpisodeFile(id, args.season, args.episode);
      if (found.kind === 'found') return { ok: true, torrentId: id, fileIndex: found.index };
      return { ok: true, torrentId: id, unresolved: true };
    }
    return { ok: true, torrentId: id };
  } catch (err) {
    const status = statusOf(err);
    return { ok: false, reason: reasonFor(err), maybeCreated: status === undefined || status >= 500 };
  }
}

type EpisodeLookup = { kind: 'found'; index: number } | { kind: 'absent' } | { kind: 'unknown' };

/**
 * Failure and absence are different facts. `absent` means the file list was read, was not
 * empty, HAS AT LEAST ONE LABELLED FILE, and still has no such episode. A rejected call, an
 * empty list, or a list in which nothing parsed is `unknown`: the list may simply not be
 * ready, or the pack may be named unconventionally. "unknown" must never justify a new
 * download.
 */
async function lookupEpisodeFile(torrentId: string, season: number, episode: number): Promise<EpisodeLookup> {
  try {
    const files = await streamingService.getFiles(torrentId);
    if (!Array.isArray(files) || files.length === 0) return { kind: 'unknown' };
    // Packs often ship a sample next to the episode; the biggest match is the episode.
    const hits = files.filter((f) => f?.season === season && f?.episode === episode && Number.isInteger(f.index));
    if (!hits.length) {
      // No match — but is this season really missing the episode, or did none of the names
      // parse? `/files` derives season/episode from the FILENAME, so an unconventionally
      // named pack yields null for every file. Calling that "absent" would offer Play and
      // re-download a season already on disk, which is the whole defect this module exists
      // to prevent. If nothing in the list is labelled at all, we simply cannot tell.
      const anyLabelled = files.some((f) => f?.season != null || f?.episode != null);
      return anyLabelled ? { kind: 'absent' } : { kind: 'unknown' };
    }
    const best = hits.reduce((a, b) => ((Number(b.size) || 0) > (Number(a.size) || 0) ? b : a));
    return { kind: 'found', index: best.index };
  } catch {
    return { kind: 'unknown' };
  }
}
