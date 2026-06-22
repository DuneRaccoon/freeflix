# Torrent / Download Management Overhaul — Design

**Date:** 2026-06-20
**Status:** Approved design, pre-implementation
**Scope:** End-to-end fix of the downloads/torrent management flow (backend + frontend).

## Problem

The downloads flow is partly broken:

1. **Resume doesn't work.** A paused torrent reverts to "downloading" within ~1s and loses
   its Resume button; a "stopped" torrent has no Resume affordance at all.
2. **Remove doesn't delete.** Clicking Remove neither removes the entry from the list nor
   deletes the downloaded data.

### Verified root causes (ground truth, libtorrent **2.0.11** confirmed installed)

The installed libtorrent build still exposes the deprecated 1.x symbols (`add_magnet_uri`,
`atp.resume_data`, `alert.resume_data`) — so downloads/pause/stop run without crashing. The
breakage is logic, not a hard API removal:

- **Pause doesn't stick.** `pause_torrent` (`backend/app/torrent/manager.py:746`) calls
  `handle.pause()` and sets `state='paused'` but *leaves the torrent in `active_torrents`*.
  The 1s status loop (`manager.py:175-210`) iterates `active_torrents` and unconditionally
  does `torrent.state = TORRENT_STATES[status.state]` — libtorrent still reports the
  underlying state (e.g. `downloading`) for a paused handle, so `paused` is overwritten back
  to `downloading` on the next tick. The Resume button (shown only for `paused`) disappears.
- **Stop is a dead end.** `stop_torrent` (`manager.py:831`) removes the handle from the
  session and sets `state='stopped'` (which *does* persist, since it's no longer in
  `active_torrents`), but the frontend renders no Resume button for `stopped`.
- **resume_data is corrupt.** The column is `Text` (`torrents.py:39`) but the alert handler
  stores raw `bytes` into it (`manager.py:386`) with no base64; the re-add path then
  `lt.bdecode`s a `Text` value (`manager.py:133`). So fast-resume data is unreliable.
- **Remove is a no-op for the path the UI uses.** The UI calls
  `deleteTorrent(id, false)` → `DELETE /torrents/{id}?delete_files=false` →
  `remove_torrent(id, delete_files=False)` (`manager.py:866`), which only writes a log and
  **never deletes the row or changes state**. On the next 2s poll the torrent reappears.
- **Even `delete_files=True` doesn't hide it.** `remove_torrent` calls `torrent.delete(db)`
  which is a **soft** delete (`mixins.py:96` sets `deleted_at`), but `get_all_torrents`
  uses `DbTorrent.get_all(db)` (`mixins.py:54`) which **does not filter `deleted_at`** — so
  the soft-deleted torrent is still listed.
- **Blocking sleep on the event loop.** `stop_torrent` calls `time.sleep(0.5)`
  (`manager.py:840`) inside an async request path.
- **Duplicate methods.** `get_torrent_status`/`get_all_torrents` are each defined twice
  (`manager.py:639` & `:902`, `:691` & `:935`); Python uses the second; the first are dead.

## Decisions (from brainstorming)

1. **Remove offers a choice.** Confirm dialog: "Remove from list (keep files)" vs
   "Delete everything (files + record)".
2. **Unify Pause/Resume.** Drop the separate "Stop". **Pause** saves resume data and frees
   the libtorrent session slot; **Resume** re-adds and continues. Resume works from `paused`
   **and** legacy `stopped`.
3. **Full scope:** core fix + backend cleanup + toast feedback + batch operations
   (Pause all / Resume all / Clear completed / Retry errored).

### Architectural choice: disk is the source of truth; resume_data is an optimization

On Resume we re-add the magnet at the **same `save_path`**; libtorrent rechecks the bytes
already on disk and continues. If valid saved resume_data exists, the recheck is instant and
metadata re-fetch is skipped; if it's missing/corrupt, resume still works (slower recheck).
This is robust against crashes, restarts, and the historical bytes/`Text` corruption.

### How "Remove" preserves watch history (the key constraint)

Removal **hard-deletes** the torrent row. To keep `UserStreamingProgress` (watch history)
from being cascade-wiped, we change the FK so it detaches instead of deletes:

- `UserStreamingProgress.torrent_id` → `nullable=True`, `ForeignKey(..., ondelete="SET NULL")`
  (`streaming.py:17`).
- `Torrent.streaming_progress` relationship → drop `delete-orphan`, add `passive_deletes=True`
  (`torrents.py:51`) so SQLAlchemy relies on the DB `SET NULL` rather than nulling/deleting
  children in Python.

On delete, `torrent_logs` still cascade away (they're torrent-scoped — keep their
`delete-orphan` + `ondelete="CASCADE"`), while progress rows have `torrent_id` set to NULL and
survive. Continue-watching continues to resolve via `movie_id` (`streaming.py:18`); a
re-download re-links naturally. "Delete everything" additionally `rmtree`s the files; "Remove
from list" keeps them. Both hard-delete the row, so no `deleted_at` read-path filtering is
needed.

**Schema migration.** The FK nullability + `ondelete` change is not applied by the
additive-only `sync_columns()` pass. The user has confirmed pre-launch — recreate the DB
volume (`docker compose down -v && make up`) so `create_all()` builds the new schema. Document
this in the implementation steps.

---

## Backend changes

### `backend/app/torrent/manager.py`

**State vocabulary (cleanup).** Introduce shared groupings (a small module/const, e.g.
`app/torrent/states.py`) so manager, model, and activity agree:
- `ACTIVE_DOWNLOAD_STATES = {queued, checking, downloading_metadata, downloading, allocating, checking_fastresume}`
- `RESUMABLE_STATES = {paused, stopped}`
- `TERMINAL_STATES = {finished, seeding, error}`

**resume_data — modernize to the 2.0 buffer API + base64 in the `Text` column.**
- Add helpers: `_encode_resume_data(buf: bytes) -> str` (base64) and
  `_decode_resume_data(s: str) -> bytes`.
- Save (alert handler, `manager.py:372`): `buf = lt.write_resume_data_buf(alert.params)`;
  store `base64` string. (Look up `torrent_id` by handle as today.)
- Load (`_add_torrent`, `manager.py:112`): build `add_torrent_params` consistently:
  - With resume_data: `atp = lt.read_resume_data(_decode_resume_data(s))`, then set
    `atp.save_path`, `atp.storage_mode`. On any failure, fall back to the magnet path.
  - Without: `atp = lt.parse_magnet_uri(magnet_uri)`, set `save_path`/`storage_mode`
    (replaces deprecated `lt.add_magnet_uri`).
  - `handle = self.session.add_torrent(atp)`; `handle.set_sequential_download(True)`.
- **Periodic save:** in the status loop, when `handle.need_save_resume_data()` (or every
  ~30s per torrent), call `handle.save_resume_data()` so the DB keeps fresh resume_data for
  fast pause/resume and crash recovery.

**Status loop guard (`manager.py:175`).** Skip DB-`paused` and soft-deleted torrents when
writing state, so a transient race can never overwrite `paused`. (Under the new pause this
won't be in `active_torrents` anyway — defense in depth.)

**`pause_torrent(id)` — becomes "pause + unload".**
1. If in `active_torrents`: `handle.save_resume_data()` (best-effort), `handle.pause()`,
   `self.session.remove_torrent(handle)` (keep files), pop from `active_torrents`.
2. Set DB `state='paused'`, add log. Idempotent if already paused. Returns `True` if the
   torrent exists.

**`resume_torrent(id)` — works from `paused` and `stopped`.**
1. Load the torrent (non-deleted) whose `state in RESUMABLE_STATES`.
2. `handle = self._add_torrent(id, magnet, save_path, meta, resume_data)` (resume_data fast
   path or magnet+recheck fallback), `handle.resume()`.
3. Set `state='downloading'` (the loop will refine it), add log, `await start_update_task()`.
4. If already in `active_torrents` (shouldn't happen post-unification), just `handle.resume()`.

**`remove_torrent(id, delete_files=False)` — actually removes; preserves history.**
1. If in `active_torrents`: `self.session.remove_torrent(handle)`, pop. (Don't rely on the
   libtorrent delete-files flag.)
2. Capture `save_path`; add a removal log; then **hard-delete** the row
   (`torrent.delete(db, hard_delete=True)`). `torrent_logs` cascade away; `streaming_progress`
   rows have their `torrent_id` set to NULL (history preserved) via the FK change above.
3. If `delete_files`: `self._safe_rmtree(save_path)`.
4. Return `True` if a row was found or a handle was removed (idempotent).

**`_safe_rmtree(path)` (new).** Resolve `path` and `settings.default_download_path`; only
`shutil.rmtree` if `path` exists, is a directory, is **strictly inside** the download root,
and is not equal to it. Log and refuse otherwise. (Prevents nuking the root.)

**Drop `stop_torrent`** (folded into pause). Keep the method as a thin alias to
`pause_torrent` only if needed for safety; otherwise remove.

**Remove the duplicate `get_torrent_status`/`get_all_torrents`** (keep the `to_status()`
versions, `manager.py:902`/`:935`). No `deleted_at` filtering needed — Remove hard-deletes.

**`time.sleep` removal.** No blocking sleep in request paths (pause no longer sleeps;
shutdown's `time.sleep(1)` may stay as it's outside request handling, or use the alert pump).

**Startup load (`_load_saved_torrents`, `manager.py:76`).** Only auto-re-add torrents whose
`state in ACTIVE_DOWNLOAD_STATES`. Paused/stopped/finished/error stay unloaded (pause survives
restart). Update `_refresh_active_torrents` (`manager.py:322`) to also drop `paused` from
`active_torrents`.

### `backend/app/database/models/torrents.py`

- Add `find_loadable_on_startup(db)` → `state in ACTIVE_DOWNLOAD_STATES` (replaces
  `find_active` for startup re-load; retire/repoint `find_active` accordingly).
- Change `streaming_progress` relationship: drop `delete-orphan`, add `passive_deletes=True`
  (keep `download_logs` cascade as-is).
- `resume_data` stays `Text` (now base64-encoded).

### `backend/app/database/models/streaming.py`

- `torrent_id` → `nullable=True`, `ForeignKey("torrents.id", ondelete="SET NULL")` so deleting
  a torrent detaches (not deletes) watch history.

### `backend/app/api/torrents.py`

- **`POST /action/{id}`** → actions narrowed to **`pause` | `resume`**. Accept legacy
  `stop` as an alias of `pause`; reject `remove` with a 400 pointing to `DELETE`.
- **`DELETE /{id}?delete_files=bool`** → unchanged signature; now works via the fixed
  `remove_torrent`.
- **`POST /batch`** (new) — body `TorrentBatchAction { action: 'pause'|'resume'|'clear_completed'|'retry', delete_files?: bool }`:
  - `pause`: pause every torrent in `ACTIVE_DOWNLOAD_STATES`.
  - `resume`: resume every torrent in `RESUMABLE_STATES`.
  - `clear_completed`: soft-remove (keep files) every `finished`/`seeding` torrent.
  - `retry`: re-add every `error` torrent (reset error, re-add to session).
  - Returns `{ action, results: [{id, success}], succeeded, failed }` so the UI can report
    partial failures.

### `backend/app/api/activity.py`

- Add `max_active_downloads` (the ARM-capped configured value) to `ActivityCountResponse`
  so the frontend's hardcoded "/ 2" can show the real configured limit. (Removed torrents
  are hard-deleted, so the count naturally excludes them.)

### `backend/app/models.py`

- `TorrentAction.action`: allow `pause`/`resume` (and legacy `stop`).
- Add `TorrentBatchAction` request model and the batch response model.
- Add `max_active_downloads` to `ActivityCountResponse`.

### Non-goals (backend)

- **Enforcing** the concurrent-download cap. `max_active_downloads` is currently computed in
  `main.py:40` but never applied (no slot check in `add_torrent`, no libtorrent
  `active_downloads` setting). We will *surface* the configured number to the UI but not add
  enforcement in this change. Noted for a future task.

---

## Frontend changes

Toasts already exist: `react-hot-toast`'s `<Toaster>` is mounted in `app/layout.tsx:44`.
Import `{ toast }` directly — **do not** add a provider. UI primitives are the FRÈ set
(`@/components/ui/fre`): `Button` (variants primary/glass/ghost/icon/danger; sizes sm/md/lg),
`Modal` (`open`/`onClose`/`label`/children; provide your own footer), `Pill`, `Progress`,
`Badge`. There is **no** Radio component — build a small one matching the `Toggle` pattern
(sr-only `<input>` + styled indicator, gold accent, the shared focus ring). Context dir is
`src/context/` (singular).

### `src/types/index.ts`

- `TorrentAction = 'pause' | 'resume'`.
- Add `TorrentBatchAction = 'pause' | 'resume' | 'clear_completed' | 'retry'` and a batch
  result type. Add `max_active_downloads?` to the activity count type.

### `src/services/torrents.ts`

- Keep `performTorrentAction(id, 'pause'|'resume')`, `deleteTorrent(id, deleteFiles)`,
  `prioritizeForStreaming(id)`.
- Add `batchAction(action, deleteFiles?)` → `POST /torrents/batch`.

### `src/components/downloads/DownloadsView.tsx`

**`TorrentRow`:**
- Remove the **Stop** button.
- **Resume** shows for `paused` **and** `stopped`; **Pause** shows for active-download states
  and `seeding`.
- Replace the remove modal with a **two-choice** picker (custom radio):
  - "Remove from list — keep downloaded files" → `deleteTorrent(id, false)`
  - "Delete everything — files + record" → `deleteTorrent(id, true)`
- Every action (`pause`/`resume`/remove) shows `toast.success` / `toast.error`; no more
  silently-swallowed catches. Disable buttons while a request is in flight (existing `busy`).

**Toolbar (`DownloadsView`):**
- Batch buttons: **Pause all · Resume all · Clear completed · Retry errored**, each calling
  `batchAction(...)`, with toasts and a confirm modal for **Clear completed** (it removes
  entries). Buttons disabled when no torrent qualifies.
- Show "Active N / M" using `max_active_downloads` from the activity/count response instead
  of the hardcoded `2`.

---

## Testing (TDD)

### Backend (`backend/tests/`)
- `_encode_resume_data`/`_decode_resume_data` round-trip (bytes → str → bytes).
- `_safe_rmtree`: deletes a valid subdir of the download root; refuses the root itself and
  any path outside it (use `tmp_path` + monkeypatched `settings.default_download_path`).
- `remove_torrent`: hard-deletes the row, leaves `UserStreamingProgress` intact with
  `torrent_id` set to NULL, and `rmtree`s only when `delete_files=True` (mock
  `session.remove_torrent`).
- `torrent_logs` cascade-delete when a torrent is removed (FK behavior intact).
- `pause_torrent`/`resume_torrent`: state transitions and `active_torrents` membership
  (mock libtorrent `handle`/`session`).
- `get_all_torrents`/`list_visible`: excludes soft-deleted rows.
- Endpoint tests with a mocked `torrent_manager`: `/action` (pause/resume; legacy stop;
  remove→400), `DELETE` (`delete_files` true/false), `/batch` (each action + partial-failure
  shape).

> Per CLAUDE.md: new/edited test files aren't bind-mounted — run with `make build` first, or
> mount `backend/tests` explicitly:
> `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/<file>`.
> Confirm the existing `tests/conftest.py` DB fixture (sqlite vs pg) during implementation.

### Frontend (`src/components/downloads/DownloadsView.test.tsx`)
- Resume button shows for `stopped`.
- Remove modal: "keep files" calls `deleteTorrent(id, false)`; "delete everything" calls
  `deleteTorrent(id, true)`.
- Batch buttons call `batchAction` with the right action.
- A failing action calls `toast.error` (mock `react-hot-toast`).

---

## Out of scope / future

- Enforcing `max_active_downloads` (queueing beyond the cap).
- Per-file selective download UI, disk-space pre-checks, download reordering.

## Affected files (summary)

**Backend:** `torrent/manager.py` (major), `torrent/states.py` (new),
`database/models/torrents.py`, `database/models/streaming.py` (FK change), `api/torrents.py`,
`api/activity.py`, `models.py`, `tests/` (new/updated). **Requires DB volume recreate.**
**Frontend:** `types/index.ts`, `services/torrents.ts`,
`components/downloads/DownloadsView.tsx`, a small radio component, `DownloadsView.test.tsx`.
