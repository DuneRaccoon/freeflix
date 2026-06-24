# Torrent Content Guard — Design Spec

**Date:** 2026-06-24
**Status:** Approved (brainstorming) — pending implementation plan
**Author:** Claude + DuneRaccoon

## Summary

Add a lightweight, heuristic **content guard** that vets a torrent's file list the
moment it becomes known (right after libtorrent fetches metadata, before the bulk
download) and **blocks** torrents that are clearly malicious or fake — executables,
no-playable-video releases, or known fake-torrent patterns. Blocked torrents are
stopped, their partial data is deleted, and the user is shown a clear reason plus
the source picker to choose a different release.

The guard is heuristic only (file-type / structure). It does **not** scan inside
files with an antivirus engine — that was explicitly deferred (see Non-Goals) due
to the Raspberry Pi deploy target, where ClamAV is heavy (RAM, signature DB,
multi-minute scans competing with downloads).

## Background / root cause

A user started a stream for "Toy Story 5"; the streaming page showed "Unable to
Stream" and `/streaming/{id}/info` returned 404 "Video file not found or not ready
for streaming." Investigation showed the selected torrent was actually a single
`.exe` file.

The 404 was *correct* behavior: `get_video_files()` filters by a video-extension
allowlist (`VIDEO_EXTENSIONS`, `manager.py:35`), an `.exe` matches nothing, so the
list is empty and `get_video_file_info()` returns `None` → 404. The real defect is
upstream:

- **There is no content guard at all.** `VIDEO_EXTENSIONS`/`_is_video_file()` only
  filter what is *shown* for streaming; nothing ever *rejects* a download. The
  `.exe` torrent downloaded in full; the UI just reported "no video." This is the
  "false negative" the user sensed — there was never a check.
- **Non-video files download anyway.** Even `prioritize_video_files()`
  (`manager.py:1098`) leaves non-video files at priority 1 (download), not 0 (skip).
- **Files are only knowable after metadata.** The catalog/provider supplies only
  title, seeds, peers, bytes, magnet URI, infohash, and a title-parsed quality —
  **no file list**. The real file list first exists after libtorrent's
  `metadata_received_alert` (`manager.py:530–555`). That alert fires *before* the
  bulk content downloads, giving us a clean early checkpoint.

## Goals

- Reject obviously-malicious or fake torrents at the earliest knowable point, before
  downloading their content.
- Never stream a torrent that contains an executable or no playable video.
- Stop wasting Pi bandwidth/disk on non-video files.
- Give the user a clear reason and an easy path to pick another source.
- Be fully toggleable via a single env-overridable setting (kill switch).

## Non-Goals

- **No antivirus engine** (ClamAV / yara). Deferred: too heavy for the Pi target and
  low-yield against large video files. The guard shrinks the attack surface to
  "video files only"; a deep-scan layer can be added later.
- No provider/selection-time file inspection (the provider has no file list; the
  magnet carries only an infohash + display name).
- No infohash blocklist / reputation service (possible future work).

## Design

### 1. The checkpoint (where it runs)

A new method `TorrentManager.validate_torrent_content(torrent_id, handle) -> Optional[str]`
returns a human-readable block reason if the torrent should be blocked, else `None`.

It is invoked in the `metadata_received_alert` handler (`manager.py:530–555`),
**after** metadata is confirmed (`handle.has_metadata()` True) and **before**
`precompute_episode_map()`. This is the first point `handle.get_torrent_info()`
exposes the full file list (name, size, extension per file) and is before content
pieces are fetched.

When `content_guard_enabled` is `False`, the handler skips validation entirely and
behaves exactly as today.

### 2. Detection rules

Evaluated in order; the first hard-fail returns a block reason. The classifier is a
**pure function over the file list and the configured lists** —
`classify_torrent_files(files, *, blocked_extensions, video_extensions, fake_heuristics) -> Optional[str]`
where `files` is a list of `(path: str, size: int)` — so it is unit-testable without
libtorrent. The `content_guard_enabled` kill switch is checked by the *handler* (it
skips calling `validate_torrent_content` entirely when disabled), not by the
classifier.

1. **Executable present → BLOCK.** If any file's lowercased extension is in
   `blocked_extensions`. Reason: `"Contains an executable file ({name}) — blocked for safety."`
2. **No streamable video → BLOCK.** If no file's extension is in `video_extensions`.
   Reason: `"No playable video file found — likely a fake or archive-only release."`
3. **Structural fake pattern → BLOCK** *(only when `fake_torrent_heuristics` is True; default False)*.
   Fires when the single largest file (by bytes) is a non-video AND a companion file
   whose name matches `password`, `how to`, `read ?me`, or `install` (case-insensitive,
   any text extension) is present. Reason: `"Matches a known fake-torrent pattern — blocked for safety."`

**Tolerated companions** (never trigger a block on their own, as long as rule 1
passes and a video exists): subtitles (`.srt .sub .ass .ssa .vtt`), `.nfo`, images
(`.jpg .jpeg .png .gif`), small `.txt`, and sample clips.

### 3. Extension lists (defaults; config-overridable)

**`blocked_extensions`** (executables / installers / scripts / disc images):
```
.exe .scr .com .bat .cmd .msi .apk .jar .vbs .vbe .js .wsf .ps1 .lnk .dll .sys
.reg .hta .cpl .gadget .sh .run .deb .rpm .pkg .dmg .iso .bin
```
(`.iso`/`.bin` are blocked: occasionally legitimate disc images, but never
streamable here.)

**`video_extensions`** (expanded from today's 8 to reduce false "no video"
positives):
```
.mp4 .mkv .avi .mov .webm .ogv .wmv .flv .m4v .mpg .mpeg .ts .m2ts .vob .3gp .mts
```
This replaces the hardcoded `VIDEO_EXTENSIONS` list at `manager.py:35`; `_is_video_file()`
reads from settings.

### 4. Enforcement (block + pick another)

On a block reason, the handler:
1. Pauses the handle and removes it from the libtorrent session
   (`session.remove_torrent(handle)`).
2. Deletes partial data on disk: `safe_rmtree(save_path)` (the existing helper used
   by `remove_torrent`).
3. Persists `state = TorrentState.BLOCKED` and `block_reason = <reason>` on the
   `torrents` row, and drops the entry from `active_torrents`.

No override and no auto-fallback (per decision): the torrent stays blocked; the user
picks a different source.

### 5. Skip non-video downloads

Tied to the guard. When `content_guard_enabled` is True and a torrent passes
validation, set every non-video file to libtorrent priority **0** (skip) at the
checkpoint, and keep this in `prioritize_video_files()` (replace the current
non-video priority of 1 with 0). Video files retain streaming priority. When the
guard is disabled, file priorities are left as they are today.

### 6. Config (kill switch + lists)

Added to `app/config.py` `Settings` (pydantic — all env-overridable; documented in
`.env`):

| Setting | Env var | Default | Meaning |
| --- | --- | --- | --- |
| `content_guard_enabled` | `CONTENT_GUARD_ENABLED` | `True` | Master on/off. **Off = exactly today's behavior**: no validation, no blocking, no non-video skip. |
| `blocked_extensions` | `BLOCKED_EXTENSIONS` | list above | Extensions that hard-block a torrent. |
| `video_extensions` | `VIDEO_EXTENSIONS` | list above | Extensions counted as playable video. |
| `fake_torrent_heuristics` | `FAKE_TORRENT_HEURISTICS` | `False` | Enables detection rule 3 (structural). |

`content_guard_enabled` is the single switch the user asked for; flipping it to
`false` in `.env` disables the whole feature.

### 7. Data model (no Alembic — additive, per project convention)

- Add nullable `block_reason: Optional[str]` (String) column to the `torrents` ORM
  model (`database/models/torrents.py`). Auto-added on startup by `sync_columns()`.
- Add `BLOCKED = "blocked"` to the `TorrentState` enum (`models.py`).
- Exclude `BLOCKED` from `RESUMABLE_STATES` (`torrent/states.py`) so a blocked torrent
  is **not** re-added on restart, and from `ACTIVE_DOWNLOAD_STATES`.
- `DbTorrent.to_status()` maps `block_reason` onto the `TorrentStatus` Pydantic model
  (new optional `block_reason` field).

### 8. API changes

- `TorrentStatus` (Pydantic, `models.py`) gains `block_reason: Optional[str] = None`.
  It is already returned by `/torrents/status/{id}` and `/torrents/list`, so the
  frontend can read `state` + `block_reason` from its existing status poll.
- `/streaming/{id}/info` and `/video` keep returning 404 for a blocked torrent (no
  video exists). The frontend distinguishes "blocked" from a generic failure via the
  `/status` poll, not the `/info` error.

### 9. Frontend

In the streaming page (`frontend/src/app/streaming/[id]/page.tsx`), when the status
poll reports `state === 'blocked'`, render a dedicated **"Blocked for safety"** screen:
- The `block_reason` text.
- A primary action that opens the source picker / returns to the title's sources so
  the user can choose a different release ("Choose another source").
- Distinct from the existing generic "Unable to Stream" screen.

A small typed addition to the streaming service/types for the `block_reason` field.

## Edge cases & failure handling

- **False positive (legit torrent flagged "no video"):** mitigated by the expanded
  `video_extensions`. Recovery path is "pick another source" (no override by
  decision). If false positives prove common, enabling an override is a future
  toggle, not part of this scope.
- **Guard disabled:** `content_guard_enabled=False` → validation skipped, priorities
  untouched → behavior identical to today (including the original 404-on-no-video).
- **Metadata never arrives:** the guard never runs (no file list); the torrent stays
  in `downloading_metadata` as today. Out of scope here.
- **Cleanup atomicity:** removal from session → delete files → DB update are done in
  the alert handler under the manager's existing locking; if `safe_rmtree` fails it is
  logged and the DB still records `blocked` (partial files are harmless leftovers, not
  served — no video).
- **Already-running torrents from before the feature:** the guard only runs on the
  metadata alert for newly added torrents; pre-existing torrents are unaffected.

## Testing strategy

**Backend (pytest):**
- `classify_torrent_files` unit tests (pure, no libtorrent):
  - single `.exe` → blocked (rule 1)
  - video + `.exe` → blocked (rule 1 beats rule 2)
  - archive-only (`.rar`/`.zip`) → blocked (rule 2)
  - document-only → blocked (rule 2)
  - `.mkv` + `.srt` + `.nfo` → allowed
  - `.m4v` / `.ts` (expanded extensions) → allowed
  - structural pattern (big `.bin` + `password.txt`) → blocked only when
    `fake_heuristics=True`; allowed when False
- Handler bypass: with `content_guard_enabled=False`, `validate_torrent_content` is
  not invoked from the metadata handler — an `.exe`-only torrent proceeds exactly as
  today (no block, priorities untouched).
- Enforcement test with a fake libtorrent handle: a blocked torrent results in
  handle removed from session, `safe_rmtree` called on `save_path`,
  `state='blocked'`, `block_reason` set, entry dropped from `active_torrents`.
- `RESUMABLE_STATES` excludes `BLOCKED` (a blocked torrent is not resumed on startup).

**Frontend (tsc + component check):**
- Streaming page renders the "Blocked for safety" screen (with reason + choose-another
  action) when `state==='blocked'`, and the normal player/flow otherwise.

## File change map (for the plan)

- `backend/app/config.py` — new settings (kill switch + lists).
- `backend/app/torrent/manager.py` — `classify_torrent_files`, `validate_torrent_content`,
  call in `metadata_received_alert` handler, `_is_video_file`/`VIDEO_EXTENSIONS` read
  from settings, non-video priority 0 in `prioritize_video_files`.
- `backend/app/torrent/states.py` — exclude `BLOCKED` from resumable/active sets.
- `backend/app/models.py` — `TorrentState.BLOCKED`, `TorrentStatus.block_reason`.
- `backend/app/database/models/torrents.py` — `block_reason` column, `to_status` mapping.
- `frontend/src/app/streaming/[id]/page.tsx` — blocked-state screen.
- `frontend/src/services/*` + types — `block_reason` field.
- `.env` / `.env.example` — document `CONTENT_GUARD_ENABLED` (+ optional list vars).
- Tests: `backend/tests/test_content_guard.py` (+ frontend check).
