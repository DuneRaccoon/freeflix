import libtorrent as lt
import asyncio
import threading
import time
import json
import os
import uuid
import shutil
from datetime import datetime
from pathlib import Path
from loguru import logger
from typing import Dict, List, NamedTuple, Optional, Any, Tuple
from torf import Magnet
from sqlalchemy.orm import Session

from app.database.session import get_db, init_db
from app.database.models import Torrent as DbTorrent, TorrentLog
from app.models import TorrentState, TorrentStatus, Movie, Torrent as TorrentModel
from app.config import settings
from app.torrent.storage import encode_resume_data, decode_resume_data, safe_rmtree
from app.torrent.states import ACTIVE_DOWNLOAD_STATES, RESUMABLE_STATES
from app.providers.episodes import parse_episode
from app.subtitles import sidecars

# Ordered list of torrent states
TORRENT_STATES = [
    "queued", 
    "checking", 
    "downloading_metadata", 
    "downloading", 
    "finished", 
    "seeding",
    "allocating",
    "checking_fastresume"
]

# The flag that makes a resume blob SELF-SUFFICIENT.
#
# libtorrent 2.0 drops the `info` dict from resume data unless it is asked for, so a
# flagless `save_resume_data()` writes a blob whose `.ti` is None — it can restart a
# download (it has the infohash and the piece state) but it cannot say what FILES the
# torrent holds. Every blob this app had ever written was that shape, which made the
# whole completed-on-disk fallback inert: `_video_files_from_resume_data` returned []
# for every torrent, so a finished download that was no longer in the session 404ed on
# every streaming route and the television said the title was "no longer on the box".
#
# `getattr` rather than a direct reference: a libtorrent build without the flag then
# degrades to today's behaviour (a blob that still resumes) instead of failing at import.
_SAVE_INFO_DICT = getattr(getattr(lt, "save_resume_flags_t", None), "save_info_dict", None)

# How much of a file's length its allocated blocks must cover before it is accepted as
# complete without metadata to compare against. A fully written file measures 1.0 (an
# ext4 or APFS file reports st_blocks covering its length); a half-downloaded one in
# libtorrent's sparse storage mode measures near zero, because the holes are not
# allocated. 0.99 rather than 1.0 leaves room for a filesystem that rounds, and the
# margin is nowhere near wide enough to admit a partial download.
_ALLOCATED_AT_LEAST = 0.99

# States in which every wanted byte is expected to be on disk already, so a file
# may be served straight through with no piece gating. Deliberately NARROWER than
# states.TERMINAL_STATES, which also holds 'error' (a download that stopped at an
# arbitrary percentage) and 'blocked' (whose files the content guard deleted).
ON_DISK_STATES = frozenset({"finished", "seeding"})

# ---------------------------------------------------------------- sidecar admission
#
# Stage 9 admits a sidecar subtitle's pieces ON DEMAND, at PIECE level, and the
# shape is measured rather than chosen (plan D1/D3/D4 and Correction C1):
#
#   phase 1  piece_priority(p, 7) + set_piece_deadline(p, 0) over the sidecar's
#            own piece span. This widens total_wanted by exactly the file's
#            bytes, leaves every FILE priority untouched, and SURVIVES
#            prioritize_video_files' next call — because that vector is a pure
#            function of the file set and libtorrent does not recompute from an
#            identical list. A file-level admission makes that next call a
#            CHANGED list, which recomputes and takes _prioritize_window's
#            raised window with it. Measured, C1 [A]/[B]/[C].
#   phase 2  the FLUSH. Phase 1 alone never produces a readable file: libtorrent
#            2.0 routes a priority-0 file's bytes into a `.<infohash>.parts`
#            part file and only moves them into place when the file's priority
#            rises above 0. So once the span is HELD, one file_priority(idx, 1)
#            moves them (measured: redownloaded=0) and one file_priority(idx, 0)
#            puts the priority back.
#
# The two exits differ in exactly the call that is unsafe, which is why there is
# one retraction function with an explicit `expired` flag and not two
# interchangeable ones. See retract_sidecar_pieces.
_sidecar_fetch_tasks: Dict[Tuple[str, int], "asyncio.Task"] = {}

# Refusal reasons. Each is a 409 for the POST; `None` with `admitted == 0` is a
# SUCCESS (see SidecarAdmission).
SIDECAR_REFUSAL_NOT_LOADED = "not-loaded"
SIDECAR_REFUSAL_NO_SUCH_SIDECAR = "no-such-sidecar"
SIDECAR_REFUSAL_NOT_DESELECTED = "not-deselected"
SIDECAR_REFUSAL_SPAN_TOO_LARGE = "span-too-large"
# No running event loop, so the background fetch could not be started. The
# admission is WITHDRAWN before this is returned: pieces raised with nothing to
# retract them would hold the torrent below 100% forever, which is D1's reason 3
# and the most expensive failure in the stage. Unreachable from the POST handler
# (it is async), and it exists so the sync-call case cannot leak an admission.
SIDECAR_REFUSAL_NO_DRIVER = "no-driver"

# The flush's bounded wait for libtorrent to move the held bytes out of the part
# file and into the save path.
#
# NOT A MEASURED MINIMUM, and said so here rather than implied: C1's probe
# (`probe_flush.py`) slept 1.5 s, called flush_cache(), slept another 1.0 s and
# then saw the file — it never polled, so 2.5 s is an upper bound on what was
# observed and the true latency is unknown. 3.0 s is that figure rounded up. The
# probe's flush_cache() call is deliberately NOT copied: libtorrent 2.0 has no
# write cache to flush (the disk cache was removed in 2.0; writes go through the
# OS page cache, which os.path.getsize sees), the plan prescribes exactly three
# steps for the flush, and adding a fourth libtorrent call on the strength of a
# defensive try/except in a probe would be a guess. If a real device ever shows
# the file arriving later than this, raise the constant — the trailing re-zero
# runs either way, so a short wait costs the sidecar and never the torrent.
_SIDECAR_FLUSH_WAIT_S = 3.0
_SIDECAR_FLUSH_POLL_S = 0.05


def _forget_sidecar_fetch(key: Tuple[str, int], task) -> None:
    """Drop a finished fetch from the registry, but only if it is still ours.

    The identity check matters, and its window is NORMAL rather than a bug (an
    earlier draft of this said the second): `add_done_callback` fires through
    `loop.call_soon`, so a second POST can pass `not existing.done()` and
    register a NEW task before the first's callback runs and blind-`pop`s it.
    """
    if _sidecar_fetch_tasks.get(key) is task:
        _sidecar_fetch_tasks.pop(key, None)


class SidecarAdmission(NamedTuple):
    """What one `admit_sidecar_pieces` call did.

    `admitted` is the number of pieces this call raised. **ZERO IS A SUCCESS**
    when `refusal` is None, and the POST answers 202 for it (plan task 8): it
    means there was nothing to raise, which happens TWO ways — every piece is
    already held, or gate 4 found a WANTED file sharing a piece so the bytes are
    already on their way. Both still want the flush, because held-but-unflushed
    bytes live in the part file and no `<track>` can read them. An earlier draft
    of this docstring named a third way, "the span was empty"; it is
    UNREACHABLE, and task 8 must not write a branch for it. `_resolve_sidecar`
    refuses `size <= 0`, so `refusal is None` implies
    `last_piece >= first_piece` and `pieces` therefore always holds at least one
    piece.

    `pieces` is the full span, reported even when nothing was raised. On the
    `refusal is None` paths that is because the driver waits on it and then
    flushes regardless of `admitted`. It is ALSO non-empty for exactly one
    refusal — see `SIDECAR_REFUSAL_NO_DRIVER` below — where nothing is waiting
    on it at all, so a consumer must read `pieces` together with `refusal` and
    never as "what somebody is about to fetch".

    `refusal` is a 409, except `SIDECAR_REFUSAL_NO_SUCH_SIDECAR`, which task 8
    answers 404 (`api/subtitles.py`). It does NOT uniformly mean "the admission
    did not happen and will not". That holds for the gate refusals, which return
    before touching libtorrent and report `pieces == ()`.
    `SIDECAR_REFUSAL_NO_DRIVER` is the exception: the admission DID happen, found
    no running event loop to drive the wait, and was withdrawn on the spot by
    `retract_sidecar_pieces(expired=True)`. It is the one refusal carrying a
    non-empty `pieces`, and that span is one already withdrawn rather than one
    anybody is waiting for.
    """

    admitted: int
    pieces: Tuple[int, ...]
    refusal: Optional[str]


class _SidecarTarget(NamedTuple):
    """One sidecar resolved against LIVE metadata, with its piece span."""

    handle: Any
    ti: Any
    index: int
    rel_path: str
    size: int
    first_piece: int
    last_piece: int
    priorities: List[int]
    save_path: str


# contiguous_available's walk bound and memo window.
#
# The walk costs one have_piece() pybind call per piece inspected, and a 30 GB
# season pack at libtorrent's 8 MiB piece length is ~3,840 pieces. This bounds
# the calls ONE answer may cost; exhausting it makes the answer conservative (a
# run reported shorter than it really is refuses a seek that would have worked)
# and never optimistic, which is the right direction for a seek ceiling.
_CONTIGUOUS_MAX_PIECES = 4096
# Memo window, matched to the status loop's own ~1s cadence.
_CONTIGUOUS_TTL_S = 1.0

class TorrentManager:
    """
    Manages torrent downloads using libtorrent.
    Provides methods to start, stop, resume, and check status of torrent downloads.
    """
    
    def __init__(self):
        # Initialize libtorrent session
        self.session = lt.session({
            'listen_interfaces': settings.listen_interfaces,
            'alert_mask': lt.alert.category_t.all_categories,
            'enable_dht': True,
            'dht_bootstrap_nodes': (
                'router.bittorrent.com:6881, '
                'router.utorrent.com:6881, '
                'dht.transmissionbt.com:6881'
            ),
            'enable_lsd': True,  # local peer discovery
            'enable_upnp': True,
            'enable_natpmp': True,
        })
        
        self.session.add_dht_router("router.bittorrent.com", 6881)
        self.session.add_dht_router("router.utorrent.com", 6881)
        self.session.add_dht_router("dht.transmissionbt.com", 6881)

        # Apply arch-profiled libtorrent tuning (WS5). Unknown keys are already
        # filtered by config.lt_settings(); this also swallows apply errors.
        self._apply_session_tuning()

        # Try to load the resume data
        settings.resume_data_path.mkdir(parents=True, exist_ok=True)
        
        # Dictionary to store active torrents: {torrent_id: (handle, metadata)}
        self.active_torrents: Dict[str, Tuple[lt.torrent_handle, Dict[str, Any]]] = {}

        # W4: per-torrent event-driven piece waiters.
        # {torrent_id: {piece_index: [asyncio.Future, ...]}}. The alert thread
        # resolves these via _on_piece_finished; stream coroutines await them
        # instead of busy-polling have_piece(). _waiter_lock guards mutation
        # (the alert loop and request coroutines both touch the map).
        self._piece_waiters: Dict[str, Dict[int, List[asyncio.Future]]] = {}
        self._waiter_lock = threading.Lock()
        # The running event loop, captured when the status task starts; used by
        # _on_piece_finished for loop.call_soon_threadsafe cross-thread wakeups.
        self._loop: Optional[asyncio.AbstractEventLoop] = None

        # Per-torrent tracker-recovery backoff: {torrent_id: {"attempts": int, "next_at": float}}
        self._tracker_recovery: Dict[str, Dict[str, Any]] = {}

        # Video-file lists recovered from stored resume data for torrents that are
        # no longer in the session: {torrent_id: (blob_fingerprint, [file dicts])}.
        # Keyed on the blob itself, so a re-saved resume blob can never be served
        # from a stale entry. See _video_files_from_resume_data.
        self._resume_video_files: Dict[str, Tuple[Any, List[Dict[str, Any]]]] = {}

        # contiguous_available's memo: {(torrent_id, file_index, at_piece):
        # (monotonic_stamp, result)}. Keyed on the PIECE containing the offset,
        # so a player polling a moving playhead still hits it. See
        # _CONTIGUOUS_TTL_S. SHARED, and evicted by a whole-dict `.clear()`
        # above 64 entries, which is why a bulk caller passes
        # `contiguous_available(..., memoize=False)` — distinct keys protect the
        # ANSWERS here, not the capacity.
        self._contiguous_runs: Dict[Tuple[str, int, int], Tuple[float, Dict[str, Any]]] = {}

        # Initialize the database
        init_db()
        
        # Load any previously active torrents
        self._load_saved_torrents()
        
        # Background task to update torrent status
        self.update_task = None
        
        logger.info("TorrentManager initialized")
    
    def _set_auto_managed(self, handle, value: bool) -> None:
        """Toggle libtorrent's auto_managed flag (version-safe). When True the
        torrent is subject to the active_downloads queue; when False it is
        force-started/pinned by the caller."""
        try:
            flag = lt.torrent_flags.auto_managed
        except Exception:
            return  # build lacks the flag enum; nothing to toggle
        try:
            if value:
                handle.set_flags(flag)
            else:
                handle.unset_flags(flag)
        except Exception as e:
            logger.debug(f"auto_managed toggle failed: {e}")

    def force_start_for_stream(self, torrent_id: str) -> bool:
        """Pin the actively-streamed torrent out of the auto-managed queue so it
        is never paused while the user is watching (auto_managed=False + resume)."""
        entry = self.active_torrents.get(torrent_id)
        if not entry:
            return False
        handle, _ = entry
        self._set_auto_managed(handle, False)
        try:
            handle.resume()
        except Exception as e:
            logger.debug(f"resume on force-start failed for {torrent_id}: {e}")
        logger.info(f"Force-started {torrent_id} for streaming (out of queue)")
        return True

    def release_stream_force_start(self, torrent_id: str) -> bool:
        """Revert a force-started torrent back to auto-managed (re-enters the
        queue). Called on stream end / completion. Only re-enables auto_managed
        when the queue is active (lt_auto_managed_queue=True); otherwise a
        no-op so the torrent stays live."""
        entry = self.active_torrents.get(torrent_id)
        if not entry:
            return False
        handle, _ = entry
        if settings.lt_auto_managed_queue:
            self._set_auto_managed(handle, True)
            logger.info(f"Released force-start for {torrent_id} (back to auto-managed)")
        else:
            logger.info(f"Released force-start for {torrent_id} (queue disabled — torrent stays active)")
        return True

    def _schedule_tracker_recovery(self, torrent_id: str, handle) -> None:
        """On a tracker error, force a re-announce (tracker + DHT) with exponential
        backoff (15s base, x2, cap 300s, max 5 attempts). No-op until the next
        scheduled time so a burst of tracker errors does not hammer announces."""
        base, cap, max_attempts = 15.0, 300.0, 5
        now = time.time()
        rec = self._tracker_recovery.get(torrent_id, {"attempts": 0, "next_at": 0.0})

        if rec["attempts"] >= max_attempts:
            return
        if now < rec["next_at"]:
            return

        try:
            handle.force_reannounce()
        except Exception as e:
            logger.debug(f"force_reannounce failed for {torrent_id}: {e}")
        try:
            handle.force_dht_announce()
        except Exception as e:
            logger.debug(f"force_dht_announce failed for {torrent_id}: {e}")

        rec["attempts"] += 1
        backoff = min(base * (2 ** (rec["attempts"] - 1)), cap)
        rec["next_at"] = now + backoff
        self._tracker_recovery[torrent_id] = rec
        logger.info(
            f"Tracker recovery for {torrent_id}: re-announce attempt "
            f"{rec['attempts']} (next in {backoff:.0f}s)"
        )

    def _apply_session_tuning(self):
        """Apply the arch-profiled settings_pack to the live session. Errors are
        logged and swallowed so a single unsupported key never blocks startup."""
        try:
            pack = settings.lt_settings()
            self.session.apply_settings(pack)
            logger.info(f"Applied libtorrent session tuning ({len(pack)} keys)")
        except Exception as e:
            logger.warning(f"Failed to apply session tuning (continuing): {e}")

    def _load_saved_torrents(self):
        """Load previously active torrents from the database"""
        try:
            with get_db() as db:
                # Use the model's new class method to find active torrents
                active_torrents = DbTorrent.find_loadable_on_startup(db)
                
                for torrent in active_torrents:
                    try:
                        metadata_dict = torrent.meta_data or {}
                        self._add_torrent(
                            torrent.id, 
                            torrent.magnet, 
                            Path(torrent.save_path), 
                            metadata_dict, 
                            torrent.resume_data
                        )
                        logger.info(f"Loaded torrent {torrent.id} - {torrent.movie_title} ({torrent.quality})")
                    except Exception as e:
                        logger.error(f"Error loading torrent {torrent.id}: {e}")
                        # Mark errored in the SAME session — CRUDMixin.update() opens
                        # `with db as session:` which closes/detaches on exit and would
                        # break the remaining loop iterations.
                        torrent.state = 'error'
                        torrent.error_message = str(e)
                        db.commit()
        except Exception as e:
            logger.error(f"Error loading saved torrents: {e}")
    
    def _save_resume_data(self, handle) -> None:
        """Ask libtorrent for resume data that can describe its own files.

        THE ONE CALLER OF `save_resume_data` IN THIS FILE, so the flag cannot be
        forgotten at one of the three sites that need it. Without `save_info_dict` the
        blob has no `info` dict, `read_resume_data(...).ti` is None, and the completed
        download fallback (`get_completed_video_file_info`) can resolve nothing at all —
        which is how a finished episode became "no longer on the box" after a restart.

        The blob gets bigger: the info dict carries every file name and the piece hashes,
        so a season pack's resume data goes from a few KB to a few hundred. It is a Text
        column in Postgres and it is written at most once per refresh tick per torrent.
        """
        if _SAVE_INFO_DICT is not None:
            handle.save_resume_data(_SAVE_INFO_DICT)
        else:
            handle.save_resume_data()

    def _add_torrent(self, torrent_id: str, magnet_uri: str, save_path: Path,
                    metadata: Dict[str, Any], resume_data: Optional[str] = None) -> lt.torrent_handle:
        """Add a torrent to the libtorrent session (libtorrent 2.0 API)."""
        try:
            atp = None
            if resume_data:
                try:
                    atp = lt.read_resume_data(decode_resume_data(resume_data))
                except Exception as e:
                    logger.warning(f"resume_data unusable for {torrent_id} ({e}); re-adding from magnet")
                    atp = None
            if atp is None:
                atp = lt.parse_magnet_uri(magnet_uri)

            atp.save_path = str(save_path)
            atp.storage_mode = lt.storage_mode_t.storage_mode_sparse

            handle = self.session.add_torrent(atp)
            handle.set_sequential_download(True)
            # Only opt-in to the auto-managed queue when explicitly enabled.
            # By default (lt_auto_managed_queue=False) torrents are always active
            # so a background queue-pause can never block streaming readiness.
            if settings.lt_auto_managed_queue:
                self._set_auto_managed(handle, True)
            # Per-torrent connection cap (lt 2.x has no settings_pack key for this).
            try:
                handle.set_max_connections(settings.lt_per_torrent_connections())
            except Exception as e:
                logger.debug(f"set_max_connections skipped for {torrent_id}: {e}")
            self.active_torrents[torrent_id] = (handle, metadata)
            return handle
        except Exception as e:
            logger.error(f"Error adding torrent {torrent_id}: {e}")
            raise
    
    async def start_update_task(self):
        """Start the background task to update torrent status"""
        # Capture the loop running this coroutine so the alert thread can wake
        # stream coroutines across threads (loop.call_soon_threadsafe).
        self._loop = asyncio.get_running_loop()
        if self.update_task is None or self.update_task.done():
            self.update_task = asyncio.create_task(self._update_torrents_status())
            logger.info("Started torrent status update task")
    
    async def _update_torrents_status(self):
        """Background task to update the status of all active torrents"""
        while True:
            
            self._refresh_active_torrents()
            
            try:
                # Process libtorrent alerts
                alerts = self.session.pop_alerts()
                for alert in alerts:
                    self._handle_alert(alert)
                
                # Update status for all active torrents
                for torrent_id, (handle, metadata) in list(self.active_torrents.items()):
                    try:
                        # Get the status from libtorrent
                        status = handle.status()
                        state_str = TORRENT_STATES[status.state]
                        
                        # Process each torrent in its own database session
                        with get_db() as db:
                            # Get a fresh torrent instance from the database
                            torrent: DbTorrent = db.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
                            if not torrent:
                                logger.warning(f"Torrent {torrent_id} not found in database, but exists in active_torrents")
                                continue
                            
                            # Never resurrect a paused torrent (defensive -- paused
                            # torrents are normally unloaded from the session).
                            if torrent.state == 'paused':
                                continue

                            # Keep resume data fresh for fast pause/resume + crash recovery.
                            try:
                                if handle.need_save_resume_data():
                                    self._save_resume_data(handle)
                            except Exception:
                                pass

                            # Update basic state and progress
                            torrent.state = state_str
                            torrent.progress = status.progress * 100
                            
                            # Update metadata
                            updated_metadata = torrent.meta_data or {}
                            updated_metadata.update({
                                'download_rate': status.download_rate / 1000,  # B/s to kB/s
                                'upload_rate': status.upload_rate / 1000,  # B/s to kB/s
                                'num_peers': status.num_peers
                            })
                            
                            # Calculate ETA if downloading
                            if state_str == 'downloading' and status.download_rate > 0:
                                total_size = status.total_wanted
                                downloaded = status.total_wanted_done
                                remaining = total_size - downloaded
                                updated_metadata['eta'] = int(remaining / status.download_rate)
                            
                            # Update the torrent object and commit within this session
                            torrent.meta_data = updated_metadata
                            db.commit()
                            
                            # Periodic logging
                            current_time = time.time()
                            if torrent_id not in getattr(self, '_last_logged', {}):
                                self._last_logged = getattr(self, '_last_logged', {})
                                self._last_logged[torrent_id] = 0
                            
                            if current_time - self._last_logged.get(torrent_id, 0) > 30:  # Log every 30 seconds
                                # Use torrent from the current session for logging
                                if handle.has_metadata():
                                    torrent_info = handle.get_torrent_info()
                                    logger.info(f"Torrent {torrent.movie_title} [{torrent_id}]: {torrent_info.name()} - "
                                                f"{status.progress * 100:.2f}% complete ({state_str}) - "
                                                f"{status.download_rate / 1000:.2f} kB/s")
                                    
                                    # Add log entry within the current session
                                    torrent_log = TorrentLog(
                                        torrent_id=torrent_id,
                                        message=f"Download progress: {status.progress * 100:.2f}%",
                                        level="INFO",
                                        state=state_str,
                                        progress=status.progress * 100,
                                        download_rate=status.download_rate / 1000
                                    )
                                    db.add(torrent_log)
                                    db.commit()
                                else:
                                    logger.info(f"Torrent {torrent_id}: Downloading metadata - "
                                                f"{status.download_rate / 1000:.2f} kB/s")
                                    
                                    # Add log entry within the current session
                                    torrent_log = TorrentLog(
                                        torrent_id=torrent_id,
                                        message="Downloading metadata",
                                        level="INFO",
                                        state=state_str,
                                        download_rate=status.download_rate / 1000
                                    )
                                    db.add(torrent_log)
                                    db.commit()
                                    
                                self._last_logged[torrent_id] = current_time
                            
                            # Check for completed downloads in its own session
                            if status.state == lt.torrent_status.finished:
                                logger.info(f"Torrent {torrent_id} finished downloading")
                                torrent.state = 'finished'
                                # Log completion
                                torrent_log = TorrentLog(
                                    torrent_id=torrent_id,
                                    message="Download completed",
                                    level="INFO",
                                    state='finished',
                                    progress=100.0
                                )
                                db.add(torrent_log)
                                db.commit()
                    
                    except Exception as e:
                        logger.error(f"Error updating status for torrent {torrent_id}: {e}")
                        # Handle error in a separate session
                        with get_db() as error_db:
                            try:
                                error_torrent = error_db.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
                                if error_torrent:
                                    error_torrent.state = 'error'
                                    error_torrent.error_message = str(e)
                                    # Log error
                                    error_log = TorrentLog(
                                        torrent_id=torrent_id,
                                        message=f"Error: {str(e)}",
                                        level="ERROR",
                                        state='error'
                                    )
                                    error_db.add(error_log)
                                    error_db.commit()
                            except Exception as inner_e:
                                logger.error(f"Failed to update error state for torrent {torrent_id}: {inner_e}")
                        
                        # Remove from active torrents
                        self.active_torrents.pop(torrent_id, None)
                
                # Sleep for a short time
                await asyncio.sleep(1)
            
            except asyncio.CancelledError:
                logger.info("Torrent status update task cancelled")
                break
            except Exception as e:
                logger.error(f"Error in torrent status update task: {e}")
                await asyncio.sleep(5)  # Longer sleep on error
                
    def _get_fresh_torrent(self, db: Session, torrent_id: str) -> Optional[DbTorrent]:
        """
        Get a fresh instance of the torrent from the database.
        This ensures we're not using a stale reference.
        
        Args:
            db: The database session to use
            torrent_id: ID of the torrent to retrieve
            
        Returns:
            A fresh Torrent instance or None if not found
        """
        try:
            return db.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
        except Exception as e:
            logger.error(f"Error fetching torrent {torrent_id} from database: {e}")
            return None

    # Add this method to ensure we're not keeping stale references
    def _refresh_active_torrents(self):
        """
        Refreshes the list of active torrents to ensure it matches the database.
        Removes any torrents that are no longer in the database.
        """
        try:
            with get_db() as db:
                # Get all active torrent IDs from the database
                active_ids = set(
                    row[0] for row in db.query(DbTorrent.id).filter(
                        ~DbTorrent.state.in_(['error', 'finished', 'stopped', 'paused'])
                    ).all()
                )
                
                # Remove any torrents that no longer exist or are not active
                for torrent_id in list(self.active_torrents.keys()):
                    if torrent_id not in active_ids:
                        logger.info(f"Removing torrent {torrent_id} from active_torrents as it's no longer active in the database")
                        self.active_torrents.pop(torrent_id, None)
        except Exception as e:
            logger.error(f"Error refreshing active torrents: {e}")


    def _handle_alert(self, alert):
        """Handle libtorrent alerts"""
        try:
            # Handle different types of alerts
            if isinstance(alert, lt.torrent_finished_alert):
                torrent_handle = alert.handle
                # Find the torrent_id for this handle
                for torrent_id, (handle, _) in self.active_torrents.items():
                    if handle == torrent_handle:
                        logger.info(f"Torrent {torrent_id} finished downloading")
                        # Completed torrent no longer needs the streaming pin —
                        # return it to the auto-managed queue (WS5).
                        self.release_stream_force_start(torrent_id)
                        # Use a new session for database operations
                        with get_db() as db:
                            torrent: DbTorrent = db.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
                            if torrent:
                                torrent.state = 'finished'
                                # Log completion
                                log = TorrentLog(
                                    torrent_id=torrent_id,
                                    message="Download completed",
                                    level="INFO",
                                    state='finished',
                                    progress=100.0
                                )
                                db.add(log)
                                db.commit()
                        break
            
            elif isinstance(alert, lt.save_resume_data_alert):
                torrent_handle = alert.handle
                try:
                    buf = lt.write_resume_data_buf(alert.params)
                except Exception as e:
                    logger.error(f"write_resume_data_buf failed: {e}")
                    buf = None
                if buf is not None:
                    for torrent_id, (handle, _) in self.active_torrents.items():
                        if handle == torrent_handle:
                            with get_db() as db:
                                torrent = db.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
                                if torrent:
                                    torrent.resume_data = encode_resume_data(buf)
                                    db.commit()
                            break
            
            elif isinstance(alert, lt.torrent_error_alert):
                torrent_handle = alert.handle
                error_message = alert.message()
                
                # Find the torrent_id for this handle
                for torrent_id, (handle, _) in self.active_torrents.items():
                    if handle == torrent_handle:
                        logger.error(f"Torrent error for {torrent_id}: {error_message}")
                        # Use a new session for database operations
                        with get_db() as db:
                            torrent = db.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
                            if torrent:
                                torrent.state = 'error'
                                torrent.error_message = error_message
                                # Log error
                                log = TorrentLog(
                                    torrent_id=torrent_id,
                                    message=f"Error: {error_message}",
                                    level="ERROR",
                                    state='error'
                                )
                                db.add(log)
                                db.commit()
                        break
            
            elif isinstance(alert, lt.stats_alert):
                # Statistics alert - useful for updating UI but doesn't need persistent storage
                pass  # We handle these updates in the _update_torrents_status method
            
            elif isinstance(alert, lt.metadata_received_alert):
                torrent_handle = alert.handle

                for torrent_id, (handle, _) in self.active_torrents.items():
                    if handle == torrent_handle:
                        logger.info(f"Received metadata for torrent {torrent_id}")
                        # Update database to indicate we have metadata
                        with get_db() as db:
                            torrent = db.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
                            if torrent and torrent.state == 'downloading_metadata':
                                torrent.state = 'downloading'
                                log = TorrentLog(
                                    torrent_id=torrent_id,
                                    message="Metadata received, starting download",
                                    level="INFO",
                                    state='downloading'
                                )
                                db.add(log)
                                db.commit()
                        # Content guard: vet the now-known file list BEFORE the bulk
                        # download. Blocks executables / no-video / fake torrents,
                        # otherwise skips non-video files. Gated by the kill switch.
                        if settings.content_guard_enabled:
                            reason = self.validate_torrent_content(handle)
                            if reason:
                                self._block_torrent(torrent_id, handle, reason)
                                break
                            self.skip_non_video_files(torrent_id, handle)
                        # Files are now known: cache per-file season/episode so content_id
                        # resolution never depends on a per-request filename parse.
                        try:
                            self.precompute_episode_map(torrent_id)
                        except Exception as e:
                            logger.warning(f"Episode precompute failed for {torrent_id}: {e}")
                        break
            
            elif isinstance(alert, lt.state_changed_alert):
                torrent_handle = alert.handle
                # Fix: Use the state directly, not trying to access a value attribute
                state_value = alert.state
                
                # Map libtorrent state to our state names
                state_map = {
                    lt.torrent_status.checking_files: "checking",
                    lt.torrent_status.downloading_metadata: "downloading_metadata",
                    lt.torrent_status.downloading: "downloading",
                    lt.torrent_status.finished: "finished",
                    lt.torrent_status.seeding: "seeding",
                    lt.torrent_status.allocating: "allocating",
                    lt.torrent_status.checking_resume_data: "checking"
                }
                
                if state_value in state_map:
                    new_state = state_map[state_value]
                    for torrent_id, (handle, _) in self.active_torrents.items():
                        if handle == torrent_handle:
                            # Only log significant state changes
                            logger.debug(f"Torrent {torrent_id} changed state to {new_state}")
                            with get_db() as db:
                                torrent = db.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
                                if torrent and torrent.state != new_state:
                                    torrent.state = new_state
                                    # Only log significant state changes to avoid database bloat
                                    if new_state in ['checking', 'downloading', 'finished', 'seeding']:
                                        log = TorrentLog(
                                            torrent_id=torrent_id,
                                            message=f"State changed to {new_state}",
                                            level="INFO",
                                            state=new_state
                                        )
                                        db.add(log)
                                    db.commit()
                            break

            elif isinstance(alert, lt.tracker_error_alert):
                torrent_handle = alert.handle
                error_message = f"Tracker error: {alert.error_message()}"

                for torrent_id, (handle, _) in self.active_torrents.items():
                    if handle == torrent_handle:
                        logger.warning(f"Tracker error for torrent {torrent_id}: {error_message}")
                        # Schedule a backed-off re-announce (tracker + DHT) so a
                        # transient tracker outage doesn't strand a low-seed swarm.
                        self._schedule_tracker_recovery(torrent_id, handle)
                        # We don't update the torrent state just for tracker errors
                        # but we do log them for debugging purposes
                        with get_db() as db:
                            log = TorrentLog(
                                torrent_id=torrent_id,
                                message=error_message,
                                level="WARNING",
                                state=None  # Don't change state for tracker errors
                            )
                            db.add(log)
                            db.commit()
                        break

            elif isinstance(alert, lt.fastresume_rejected_alert):
                torrent_handle = alert.handle
                error_message = f"Fast resume data rejected: {alert.message()}"
                
                for torrent_id, (handle, _) in self.active_torrents.items():
                    if handle == torrent_handle:
                        logger.warning(f"Fast resume rejected for {torrent_id}: {error_message}")
                        # This isn't fatal, we just log it and continue
                        with get_db() as db:
                            log = TorrentLog(
                                torrent_id=torrent_id,
                                message=error_message,
                                level="WARNING",
                                state=None
                            )
                            db.add(log)
                            db.commit()
                        break

            elif isinstance(alert, lt.performance_alert):
                torrent_handle = alert.handle
                warning = f"Performance warning: {alert.message()}"
                
                for torrent_id, (handle, _) in self.active_torrents.items():
                    if handle == torrent_handle:
                        logger.warning(f"Performance alert for {torrent_id}: {warning}")
                        # Log performance warnings but don't change state
                        with get_db() as db:
                            log = TorrentLog(
                                torrent_id=torrent_id,
                                message=warning,
                                level="WARNING",
                                state=None
                            )
                            db.add(log)
                            db.commit()
                        break

            elif isinstance(alert, lt.piece_finished_alert):
                # W4: wake any stream coroutine awaiting this piece. Dispatched
                # to the loop thread inside _on_piece_finished via
                # call_soon_threadsafe, so this is safe even if alerts are popped
                # off-loop.
                torrent_handle = alert.handle
                piece_index = int(alert.piece_index)
                for torrent_id, (handle, _) in self.active_torrents.items():
                    if handle == torrent_handle:
                        self._on_piece_finished(torrent_id, piece_index)
                        break

        except Exception as e:
            logger.error(f"Error handling alert: {e}")
            logger.exception("Alert handling exception details:")
    
    # Improved add_torrent method
    async def add_torrent(self, movie: Movie, torrent: TorrentModel, save_path: Optional[Path] = None) -> str:
        """
        Add a new torrent download
        
        Args:
            movie: Movie information
            torrent: Torrent information
            save_path: Custom save path (defaults to settings.default_download_path/movie.title)
            
        Returns:
            torrent_id: Unique identifier for the torrent
        """
        # Create a unique ID for this torrent (reuse the one from the torrent model)
        torrent_id = torrent.id
        
        # Determine save path
        if save_path is None:
            save_path = settings.default_download_path / movie.title
        
        # Ensure save path exists
        save_path.mkdir(parents=True, exist_ok=True)
        
        # Store metadata for the torrent
        metadata = {
            'movie_title': movie.title,
            'quality': torrent.quality,
            'year': movie.year,
            'genre': movie.genre,
            'sizes': torrent.sizes,
        }
        
        # Store torrent in database with a dedicated session
        try:
            with get_db() as db:
                # Create the new torrent record
                new_torrent = DbTorrent(
                    id=torrent_id,
                    movie_title=movie.title,
                    quality=torrent.quality,
                    magnet=torrent.magnet,
                    url=str(torrent.url),
                    save_path=str(save_path),
                    sizes=torrent.sizes,
                    state='queued',
                    meta_data=metadata,
                    tmdb_id=getattr(movie, "tmdb_id", None),
                    media_type=getattr(movie, "media_type", "movie"),
                    season=getattr(movie, "season", None),
                    episode=getattr(movie, "episode", None),
                )
                
                db.add(new_torrent)
                db.flush()  # Ensure the object is persisted
                
                # Add initial log entry
                log_entry = TorrentLog(
                    torrent_id=torrent_id,
                    message=f"Started download for {movie.title} ({torrent.quality})",
                    level="INFO",
                    state='queued'
                )
                db.add(log_entry)
                db.commit()
        except Exception as e:
            logger.error(f"Error storing torrent in database: {e}")
            raise
        
        # Add torrent to libtorrent session
        try:
            handle = self._add_torrent(torrent_id, torrent.magnet, save_path, metadata)
            logger.info(f"Started downloading {movie.title} ({torrent.quality}) - ID: {torrent_id}")
            
            # Start the status update task if not already running
            await self.start_update_task()
            
            return torrent_id
        except Exception as e:
            logger.error(f"Error starting torrent download: {e}")
            # Handle errors in a new session
            with get_db() as error_db:
                error_torrent = error_db.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
                if error_torrent:
                    error_torrent.state = 'error'
                    error_torrent.error_message = str(e)
                    # Log error
                    error_log = TorrentLog(
                        torrent_id=torrent_id,
                        message=f"Failed to start download: {str(e)}",
                        level="ERROR",
                        state='error'
                    )
                    error_db.add(error_log)
                    error_db.commit()
            raise

    def pause_torrent(self, torrent_id: str) -> bool:
        """Pause a download: save resume data, unload from the session (freeing
        the slot), and mark it paused. Survives restart; resumable later."""
        found = False
        if torrent_id in self.active_torrents:
            handle, _ = self.active_torrents[torrent_id]
            try:
                self._save_resume_data(handle)
            except Exception:
                pass
            try:
                handle.pause()
            except Exception:
                pass
            try:
                self.session.remove_torrent(handle)
            except Exception as e:
                logger.warning(f"pause: remove_torrent failed for {torrent_id}: {e}")
            self.active_torrents.pop(torrent_id, None)
            found = True

        with get_db() as db:
            torrent = db.query(DbTorrent).filter_by(id=torrent_id).first()
            if torrent:
                torrent.state = "paused"
                db.add(torrent)
                db.commit()
                torrent.add_log(db, message="Download paused", level="INFO", state="paused")
                found = True

        if found:
            logger.info(f"Paused torrent {torrent_id}")
        else:
            logger.warning(f"Pause: torrent {torrent_id} not found")
        return found
    
    def resume_torrent(self, torrent_id: str) -> bool:
        """Resume a paused/stopped/errored torrent: re-add to the session (fast
        via resume data, correct via on-disk recheck) and continue downloading."""
        with get_db() as db:
            torrent = db.query(DbTorrent).filter_by(id=torrent_id).first()
            if not torrent:
                logger.warning(f"Resume: torrent {torrent_id} not found")
                return False
            magnet = torrent.magnet
            save_path = Path(torrent.save_path)
            meta = torrent.meta_data or {}
            resume_blob = torrent.resume_data

        try:
            if torrent_id in self.active_torrents:
                handle, _ = self.active_torrents[torrent_id]
                handle.resume()
            else:
                handle = self._add_torrent(torrent_id, magnet, save_path, meta, resume_blob)
                handle.resume()
        except Exception as e:
            logger.error(f"Resume: failed to re-add torrent {torrent_id}: {e}")
            return False

        with get_db() as db:
            torrent = db.query(DbTorrent).filter_by(id=torrent_id).first()
            if torrent:
                torrent.state = "downloading"
                torrent.error_message = None
                db.add(torrent)
                db.commit()
                torrent.add_log(db, message="Download resumed", level="INFO", state="downloading")

        logger.info(f"Resumed torrent {torrent_id}")
        return True
    
    def remove_torrent(self, torrent_id: str, delete_files: bool = False) -> bool:
        """Remove a torrent: unload from the session, hard-delete the DB row
        (watch history is detached via ON DELETE SET NULL), and optionally
        delete the downloaded files."""
        try:
            removed = False
            if torrent_id in self.active_torrents:
                handle, _ = self.active_torrents[torrent_id]
                try:
                    self.session.remove_torrent(handle)
                except Exception as e:
                    logger.warning(f"remove: session.remove_torrent failed for {torrent_id}: {e}")
                self.active_torrents.pop(torrent_id, None)
                removed = True

            save_path = None
            with get_db() as db:
                torrent = db.query(DbTorrent).filter_by(id=torrent_id).first()
                if torrent:
                    save_path = torrent.save_path     # capture BEFORE delete
                    db.delete(torrent)                # hard delete; fires download_logs cascade + FK SET NULL on progress
                    db.commit()
                    removed = True

            if delete_files and save_path:
                safe_rmtree(save_path, settings.default_download_path)

            logger.info(f"Removed torrent {torrent_id} (delete_files={delete_files})")
            return removed
        except Exception as e:
            logger.error(f"Error removing torrent {torrent_id}: {e}", exc_info=True)
            return False
    
    def get_torrent_status(self, torrent_id: str) -> Optional[TorrentStatus]:
        """Get the current status of a torrent"""
        try:
            with get_db() as db:
                torrent = DbTorrent.get_by_id(db, torrent_id)
                if not torrent:
                    return None
                
                # Use model's to_status method to get base status
                status = torrent.to_status()
                
                # Update with real-time information if the torrent is active
                if torrent_id in self.active_torrents:
                    handle, _ = self.active_torrents[torrent_id]
                    lt_status = handle.status()
                    
                    # Update real-time fields
                    status.download_rate = lt_status.download_rate / 1000  # B/s to kB/s
                    status.upload_rate = lt_status.upload_rate / 1000  # B/s to kB/s
                    status.num_peers = lt_status.num_peers
                    
                    # Calculate ETA if downloading
                    if status.state == TorrentState.DOWNLOADING and lt_status.download_rate > 0:
                        total_size = lt_status.total_wanted
                        downloaded = lt_status.total_wanted_done
                        remaining = total_size - downloaded
                        status.eta = int(remaining / lt_status.download_rate)
                
                return status
        except Exception as e:
            logger.error(f"Error getting status for torrent {torrent_id}: {e}")
            return None
    
    def get_all_torrents(self) -> List[TorrentStatus]:
        """Get the status of all torrents"""
        try:
            with get_db() as db:
                torrents = DbTorrent.get_all(db)
                
                results = []
                for torrent in torrents:
                    # Use model's to_status method 
                    status = torrent.to_status()
                    
                    # Update with real-time information if the torrent is active
                    if torrent.id in self.active_torrents:
                        handle, _ = self.active_torrents[torrent.id]
                        lt_status = handle.status()
                        
                        # Update real-time fields
                        status.download_rate = lt_status.download_rate / 1000  # B/s to kB/s
                        status.upload_rate = lt_status.upload_rate / 1000  # B/s to kB/s
                        status.num_peers = lt_status.num_peers
                        
                        # Calculate ETA if downloading
                        if status.state == TorrentState.DOWNLOADING and lt_status.download_rate > 0:
                            total_size = lt_status.total_wanted
                            downloaded = lt_status.total_wanted_done
                            remaining = total_size - downloaded
                            status.eta = int(remaining / lt_status.download_rate)
                    
                    results.append(status)
                
                return results
        except Exception as e:
            logger.error(f"Error getting all torrents: {e}")
            return []
    
    async def shutdown(self):
        """Gracefully shut down the torrent manager"""
        logger.info("Shutting down TorrentManager...")
        
        if self.update_task and not self.update_task.done():
            self.update_task.cancel()
            try:
                await self.update_task
            except asyncio.CancelledError:
                pass
        
        # Save all torrent states
        for torrent_id, (handle, _) in list(self.active_torrents.items()):
            try:
                # Request resume data
                self._save_resume_data(handle)
                
                # Update state to paused
                with get_db() as db:
                    torrent = DbTorrent.get_by_id(db, torrent_id)
                    if torrent:
                        torrent.update(db, state='paused')
                        # Log shutdown action
                        torrent.add_log(
                            db,
                            message="Paused during application shutdown",
                            level="INFO",
                            state='paused'
                        )
            except Exception as e:
                logger.error(f"Error saving resume data for torrent {torrent_id}: {e}")
        
        # Give a moment for resume data alerts to be processed (await — this is
        # an async method on the event loop; a blocking sleep would stall it).
        await asyncio.sleep(1)

        # Process any remaining alerts
        alerts = self.session.pop_alerts()
        for alert in alerts:
            self._handle_alert(alert)

    def _is_video_file(self, file_path: str) -> bool:
        """Check if a file is a video based on its extension (settings-driven)."""
        from app.torrent.content_guard import is_video_file
        return is_video_file(file_path, settings.video_extensions)

    def get_file_progress(self, torrent_id: str) -> Dict[int, float]:
        """
        Get the download progress of individual files in a torrent
        
        Args:
            torrent_id: ID of the torrent
            
        Returns:
            Dict mapping file index to progress percentage
        """
        if torrent_id not in self.active_torrents:
            return {}
        
        handle, _ = self.active_torrents[torrent_id]
        
        if not handle.has_metadata():
            return {}
        
        try:
            torrent_info = handle.get_torrent_info()
            file_progress = handle.file_progress()
            
            result = {}
            for i in range(torrent_info.num_files()):
                file_info = torrent_info.file_at(i)
                total_size = file_info.size
                
                if total_size > 0 and i < len(file_progress):
                    progress_percentage = (file_progress[i] / total_size) * 100
                    result[i] = progress_percentage
            
            return result
        
        except Exception as e:
            logger.error(f"Error getting file progress for torrent {torrent_id}: {e}")
            return {}

    def get_video_files(self, torrent_id: str) -> List[Dict[str, Any]]:
        """List every video file in a torrent (index/path/size/downloaded/progress/name)."""
        if torrent_id not in self.active_torrents:
            return []
        handle, _ = self.active_torrents[torrent_id]
        if not handle.has_metadata():
            return []
        try:
            torrent_info = handle.get_torrent_info()
            file_progress = handle.file_progress()
            base_path = Path(handle.status().save_path)
            files = []
            for i in range(torrent_info.num_files()):
                fi = torrent_info.file_at(i)
                if not self._is_video_file(fi.path):
                    continue
                downloaded = file_progress[i] if i < len(file_progress) else 0
                progress = (downloaded / fi.size) * 100 if fi.size > 0 else 0
                files.append({
                    "index": i,
                    "path": str(base_path / fi.path),
                    "size": fi.size,
                    "downloaded": downloaded,
                    "progress": progress,
                    "name": Path(fi.path).name,
                })
            return files
        except Exception as e:
            logger.error(f"Error listing video files for torrent {torrent_id}: {e}")
            return []

    def precompute_episode_map(self, torrent_id: str) -> dict:
        """Build {str(file_index): {season, episode}} from parseable video file names
        and persist it on the Torrent row. Returns the mapping ({} if nothing parses)."""
        mapping: dict = {}
        for f in self.get_video_files(torrent_id):
            ep = parse_episode(f["name"])
            if ep:
                mapping[str(f["index"])] = {"season": ep[0], "episode": ep[1]}
        if mapping:
            self._persist_episode_map(torrent_id, mapping)
        return mapping

    def _persist_episode_map(self, torrent_id: str, mapping: dict) -> None:
        """Persist the precomputed episode map onto the Torrent row (own session)."""
        try:
            with get_db() as db:
                torrent = db.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
                if torrent is not None:
                    torrent.precomputed_episodes = mapping
                    db.commit()
        except Exception as e:
            logger.warning(f"Could not persist episode map for {torrent_id}: {e}")

    def get_video_file_info(self, torrent_id: str, file_index: Optional[int] = None) -> Optional[Dict[str, Any]]:
        """
        Get info about one video file in a torrent.

        file_index None -> the largest video file (movie / single-episode default).
        file_index set  -> that EXACT file (season-pack episode), or None if it
                           isn't a video file in this torrent. The caller MUST NOT
                           re-query with None on a None result for an explicit
                           index — an explicit index that does not resolve is a
                           404, not a reason to stream the largest file.
        """
        files = self.get_video_files(torrent_id)
        if not files:
            return None
        if file_index is not None:
            for f in files:
                if f["index"] == file_index:
                    return f
            return None
        return max(files, key=lambda f: f["size"])

    def _video_files_from_resume_data(self, torrent_id: str, blob: Optional[str],
                                      save_path: str) -> List[Dict[str, Any]]:
        """A torrent's video-file list read from its STORED RESUME DATA.

        INERT TODAY, and this text said otherwise until stage 9: the three
        `save_resume_data()` calls here are flagless, libtorrent 2.0.11 drops the
        `info` dict without `save_info_dict`, so `.ti` is None for EVERY blob
        this app writes. Adds nothing to the session. Repair: stage-7 follow-up 5.

        It reads the metadata rather than walking save_path because the INDEX is
        the thing being resolved: `?file_index=N` is a libtorrent file index, and
        a directory listing's ordering is NOT it — pad files and non-video extras
        shift it. On a season pack a walk would silently serve the wrong episode,
        which is a worse answer than the 404 this fallback replaces.

        Same dict shape as get_video_files, and the same _is_video_file filter, so
        the content guard's "only video extensions are streamable" still holds.
        `downloaded`/`progress` here are the completion the DB row CLAIMS, not a
        measurement: the one caller (get_completed_video_file_info) verifies the
        file it selects against the bytes on disk. Private for that reason.

        Returns [] when there is no blob or it cannot be parsed — the caller then
        keeps today's 404 rather than guessing. Memoised on the blob, because
        _resolve_video_file runs on every Range request and /info is polled while
        a title is on screen.
        """
        if not blob:
            return []
        fingerprint = (len(blob), hash(blob), save_path)
        cached = self._resume_video_files.get(torrent_id)
        if cached is not None and cached[0] == fingerprint:
            return [dict(f) for f in cached[1]]
        try:
            ti = lt.read_resume_data(decode_resume_data(blob)).ti
            if ti is None:
                logger.info(
                    f"Resume data for {torrent_id} carries no metadata; cannot "
                    f"resolve its files without the session"
                )
                return []
            base_path = Path(save_path)
            files: List[Dict[str, Any]] = []
            for i in range(ti.num_files()):
                fi = ti.file_at(i)
                if not self._is_video_file(fi.path):
                    continue
                files.append({
                    "index": i,
                    "path": str(base_path / fi.path),
                    "size": fi.size,
                    "downloaded": fi.size,
                    "progress": 100.0,
                    "name": Path(fi.path).name,
                })
        except Exception as e:
            logger.warning(
                f"Could not read the file list from resume data for {torrent_id}: {e}")
            return []
        if len(self._resume_video_files) > 16:
            self._resume_video_files.clear()
        self._resume_video_files[torrent_id] = (fingerprint, files)
        return [dict(f) for f in files]

    def _completed_single_file(self, torrent_id: str, blob: Optional[str],
                               save_path: str, file_index: Optional[int]
                               ) -> Optional[Dict[str, Any]]:
        """Resolve a SINGLE-FILE completed torrent from a resume blob with no info dict.

        WHY THIS EXISTS AT ALL. `save_info_dict` fixes every blob written from now on,
        and fixes nothing already on disk: a finished torrent is never re-added to the
        session, so its resume data is never rewritten, so the blob a household already
        has stays info-dict-less for ever. Without this, the repair would only help
        downloads that have not happened yet — and the one the viewer is asking for
        tonight would still be "no longer on the box".

        WHAT IT CAN AND CANNOT DO. An info-dict-less blob still carries `name` and
        `save_path`. For a SINGLE-file torrent `name` IS the file, so `save_path/name` is
        the whole answer and the file's libtorrent index is 0. For a MULTI-file torrent
        `name` is the containing DIRECTORY and says nothing about what is inside it or in
        what order — and `?file_index=N` is a libtorrent index, which a directory walk
        cannot reconstruct (pad files and non-video extras shift it). So a pack resolves
        to None here, deliberately: serving the wrong episode is a worse answer than the
        404, which is the same judgement `_video_files_from_resume_data` already records.
        A pack recovers the first time it is downloaded with the flag above in place.

        THE GATE IS ALLOCATION, NOT SIZE, and `_completed_on_disk` carries it for both
        info-dict-less paths — see there for why it is stronger than the one it replaces.

        Returns the same dict shape as `get_video_files`, or None.
        """
        if not blob:
            return None
        # Index 0 or nothing: this answers for a one-file torrent, and the only file in
        # one is index 0. An explicit index of anything else is a question about a file
        # this cannot see, which is a refusal rather than a near-enough match.
        if file_index is not None and file_index != 0:
            return None
        try:
            atp = lt.read_resume_data(decode_resume_data(blob))
            if atp.ti is not None:
                # The blob can describe itself; the caller's own path already used it and
                # whatever it decided stands. This fallback is for the blind case only.
                return None
            name = atp.name or ""
            blob_save_path = atp.save_path or ""
        except Exception as e:
            logger.info(f"Could not read the resume blob for {torrent_id}: {e}")
            return None
        if not name or not self._is_video_file(name):
            return None
        # A SINGLE-file torrent's name is a bare FILE NAME. A name carrying a separator
        # is either a multi-file torrent (where it is the containing directory, and the
        # `is_file()` test below already refuses it) or a shape this does not model — and
        # a resume blob is attacker-adjacent input: it came off the wire from whoever
        # built the torrent. Refusing anything with a separator in it is what keeps this
        # from being a path join that could climb out of `save_path`.
        if "/" in name or "\\" in name or Path(name).name != name:
            return None

        # The row's save_path first (every other path in this file resolves against it,
        # and it may be relative to the process working directory), then the blob's own,
        # which is absolute and survives a working directory the row's does not.
        for base in (save_path, blob_save_path):
            if not base:
                continue
            candidate = Path(base) / name
            # A FILE. `is_file()` is also the multi-file test: there `name` is the
            # directory, so this is False and the pack is left to `_completed_pack_file`.
            if not candidate.is_file():
                continue
            entry = self._completed_on_disk(torrent_id, candidate, 0)
            if entry is not None:
                return entry
        return None

    def _completed_pack_file(self, torrent_id: str, save_path: str,
                             file_index: Optional[int], precomputed: Optional[dict]
                             ) -> Optional[Dict[str, Any]]:
        """Resolve ONE episode of a completed PACK whose blob has no info dict.

        `_completed_single_file` refuses a pack because a directory listing's ORDER is not
        a libtorrent file index. This does not reconstruct the order — it does not need
        to. `precomputed_episodes` is `{file_index: {season, episode}}`, cached on the row
        the moment metadata was known, and it was built by running `parse_episode` over
        the very file NAMES that are still on disk. So the index the caller asks about
        names an episode, that episode names a file, and the association is recovered
        rather than guessed: both halves come from the same parse of the same names.

        REFUSES ON AMBIGUITY, which is the whole reason this is narrow enough to be safe.
        A pack holding two files that parse to the same episode (a sample, a repack, a
        proper) cannot be resolved this way, and two candidates answer None rather than
        the larger one — picking would be the "serve the wrong episode" defect the single
        file path refuses outright.

        A BARE REQUEST IS ALSO A REFUSAL. Without an index there is no episode to look up,
        and "the largest video file" is a statement about a movie, not about which episode
        of a season somebody wants.
        """
        if file_index is None or not precomputed:
            return None
        want = precomputed.get(str(file_index))
        if not isinstance(want, dict):
            return None
        season, episode = want.get("season"), want.get("episode")
        if season is None or episode is None:
            return None

        base = Path(save_path)
        if not base.is_dir():
            return None
        matches: List[Path] = []
        try:
            for path in base.rglob("*"):
                if not path.is_file() or not self._is_video_file(path.name):
                    continue
                parsed = parse_episode(path.name)
                if parsed == (season, episode):
                    matches.append(path)
        except OSError as e:
            logger.info(f"Completed pack {torrent_id}: could not walk {save_path} ({e})")
            return None
        if len(matches) != 1:
            if matches:
                logger.warning(
                    f"Completed pack {torrent_id}: {len(matches)} files parse to "
                    f"S{season}E{episode}; refusing to choose between them"
                )
            return None
        return self._completed_on_disk(torrent_id, matches[0], file_index)

    def _completed_on_disk(self, torrent_id: str, path: Path,
                           index: int) -> Optional[Dict[str, Any]]:
        """The shared tail of both info-dict-less paths: the allocation gate, then the entry.

        THE GATE IS ALLOCATION, NOT SIZE, and it is stronger than the one it stands in for.
        `get_completed_video_file_info`'s gate 3 compares the file on disk with the size the
        METADATA records — which is exactly what is missing here. What is available is
        better evidence anyway: libtorrent writes at offsets in sparse storage mode, so a
        half-downloaded file already has its FULL length with holes in it, and those holes
        are unallocated. `st_blocks` sees them; a length comparison does not.
        """
        try:
            st = os.stat(path)
        except OSError as e:
            logger.info(f"Completed torrent {torrent_id}: {path} unreadable ({e})")
            return None
        if st.st_size <= 0:
            return None
        allocated = getattr(st, "st_blocks", 0) * 512
        if allocated < st.st_size * _ALLOCATED_AT_LEAST:
            logger.warning(
                f"Completed torrent {torrent_id}: {path.name} is {st.st_size} bytes long "
                f"but only {allocated} are allocated; refusing to stream a sparse file as "
                f"though every byte had arrived"
            )
            return None
        return {
            "index": index,
            "path": str(path),
            "size": st.st_size,
            "downloaded": st.st_size,
            "progress": 100.0,
            "name": path.name,
        }

    def get_completed_video_file_info(self, torrent_id: str,
                                      file_index: Optional[int] = None
                                      ) -> Optional[Dict[str, Any]]:
        """Resolve a video file for a torrent that is DONE and no longer loaded.

        The gap this closes: find_loadable_on_startup never re-adds a finished or
        seeding torrent after a restart, and _refresh_active_torrents evicts
        'finished' mid-session, so get_video_file_info answers None for the
        television's main content — a completed download. stream_file_range has
        carried the handler for that case all along ("No live torrent (e.g.
        completed and removed from the session) -> every byte is already on disk;
        serve straight through"); it was unreachable because resolution 404ed
        first. This is the narrow seam that makes it reachable, and nothing else:
        no state-machine filter changes, and the torrent is NOT reloaded.

        Same return shape as get_video_file_info, or None. FOUR gates, every one
        load-bearing, because that straight-through branch does NO piece gating —
        an ungated fallback reads sparse/zero bytes off a partial file and hands
        them to a decoder, which presents as CORRUPT MEDIA rather than as an error:

        1. a terminal, complete DB state (finished / seeding);
        2. progress >= 100 — the row's own claim that every wanted byte arrived.
           libtorrent writes at offsets in sparse storage mode, so a partially
           downloaded file can already report its FULL length with holes inside
           that read back as zeros; only this gate sees that;
        3. os.path.getsize(path) == the size the torrent metadata records — the
           file has not been truncated, replaced or half-written since;
        4. the content guard: a row carrying a block_reason is never served, and
           only video extensions are resolvable at all.

        Any gate failing answers None and the caller's existing "not found or not
        ready for streaming" 404 stands — including for a finished torrent whose
        file was deleted or truncated, where that detail is admittedly generous.
        This fallback's whole contract is "every byte is on disk" and it will not
        claim that on evidence it does not have.

        WHEN THE BLOB CANNOT DESCRIBE ITSELF, gates 3 and 4b are served by
        `_completed_single_file` instead: a resume blob written before
        `save_info_dict` has no file list at all, so a single-file torrent is resolved
        from `name` and gated on ALLOCATION rather than on a size nobody recorded, and a
        pack is refused. That is not a loosening — it is the only path that exists for
        the downloads a household already has, and it is stricter about holes than the
        size comparison above.
        """
        try:
            with get_db() as db:
                row = db.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
                if row is None:
                    return None
                state = row.state
                progress = row.progress or 0.0
                block_reason = row.block_reason
                save_path = row.save_path
                blob = row.resume_data
                precomputed = row.precomputed_episodes
        except Exception as e:
            logger.warning(f"Completed-file lookup failed for {torrent_id}: {e}")
            return None

        # Gate 1 + 2: the row must say the download is over and complete.
        if state not in ON_DISK_STATES or progress < 100:
            return None
        # Gate 4a (content guard): never serve a torrent the guard rejected.
        if block_reason:
            return None
        if not save_path:
            return None

        # Gate 4b (content guard): video extensions only, same filter as the
        # live path. A non-video index is unresolvable, not merely deprioritised.
        files = self._video_files_from_resume_data(torrent_id, blob, save_path)
        if not files:
            # The blob carries no info dict — every blob written before `save_info_dict`
            # was added, which is every download a household already has. Two shapes are
            # still answerable without it: a single file, from `name` alone, and ONE
            # episode of a pack, through the index->episode map the row cached while
            # metadata was known. Both carry the allocation gate; anything else keeps the
            # 404. See `_completed_single_file` and `_completed_pack_file`.
            entry = self._completed_single_file(torrent_id, blob, save_path, file_index)
            if entry is not None:
                return entry
            return self._completed_pack_file(torrent_id, save_path, file_index, precomputed)
        if file_index is not None:
            match = next((f for f in files if f["index"] == file_index), None)
        else:
            match = max(files, key=lambda f: f["size"])
        if match is None:
            return None

        # Gate 3: the bytes really are there. This is the last line between a
        # partial file and a decoder, and it is why the fallback may not be
        # reduced to a state check.
        try:
            on_disk = os.path.getsize(match["path"])
        except OSError as e:
            logger.info(
                f"Completed torrent {torrent_id}: {match['path']} is not readable ({e})")
            return None
        if on_disk != match["size"]:
            logger.warning(
                f"Completed torrent {torrent_id}: {match['name']} is {on_disk} bytes on "
                f"disk but its metadata records {match['size']}; refusing to stream a "
                f"partial file as though it were complete"
            )
            return None
        return match

    def list_sidecars(self, torrent_id: str) -> Tuple[str, List[Dict[str, Any]]]:
        """Every sidecar subtitle file this torrent's LIVE metadata declares.

        Returns `(coverage, entries)` — never a bare list. `coverage` is
        `"listed"` (metadata read, at least one LISTABLE sidecar), `"none"`
        (metadata read, nothing listable in it) or `"unknown"` (no live handle,
        no metadata yet, or a libtorrent call raised). `"none"` carries TWO
        meanings and the narrower sentence "this release ships none" is not one
        of them: the policy below also answers `"none"` for a release whose
        every sidecar it excluded — over `subtitle_max_bytes`, outside
        `settings.subtitle_extensions`, or escaping the save path.
        `test_an_oversized_sidecar_is_not_listed` and
        `test_narrowing_the_configured_set_drops_a_listed_extension` pin that
        second meaning deliberately, so the television's cell can read `none`
        where the truth is `excluded`. It is still not `"unknown"`, because the
        metadata WAS read and the answer is measured rather than absent; drawing
        the distinction would need a fourth value, which is a UI decision this
        task does not get to take. D6: `/files` already answers
        `200 []` with three meanings and this repo's own suite records that it
        "means 'not ready, or evicted' and never 'this pack has no episodes'"
        (`test_finished_torrent_streamable.py:226-230`), so a fourth bare empty
        list would inherit a meaning the suite has already declared unusable.
        The television's cell renders the three differently — `unavailable`,
        `none`, and a picker — and a 404 would make it say "The box doesn't
        recognise this title." about a release that simply ships no `.srt`.

        THE LIVE SESSION ONLY (D5), and the reason is measured rather than
        chosen: all three `save_resume_data()` calls in this file are flagless
        (`:323`, `:813`, `:994` — re-measured; the plan's `:322` is the
        `need_save_resume_data()` test above the first one), libtorrent 2.0.11
        omits the `info` dict without
        `lt.torrent_handle.save_info_dict`, so `lt.read_resume_data(...).ti` is
        None for every blob this application has ever written and the file list
        of an evicted torrent is simply not enumerable. `coverage: "unknown"` is
        therefore the PERMANENT answer for everything already in the library —
        `_refresh_active_torrents` evicts `finished` mid-session (`:470` excludes
        it from `active_ids`, `:478` pops the handle) and
        `find_loadable_on_startup` never re-adds it — and the television says so
        out loud instead of showing an empty picker. Reversing that is additive,
        after the stage-7 `save_info_dict` repair, and nothing here guesses in
        the meantime.

        Readiness is MEASURED, and it is two conjuncts (D7 as C1 corrected it):
        `contiguous_available(torrent_id, idx, 0)["complete"]` AND the file
        present in `save_path` at its declared size. Neither half can see the
        other's lie. `file_progress()` is called with no granularity flag
        anywhere in this repo, so it counts unverified blocks and a bare
        `file_progress()[i] == size` would report `complete` while a tail seek
        still blocks — which is why the first conjunct goes through
        `contiguous_available`, whose `have_piece(last_piece)` IS the hash check
        for a sidecar small enough to sit inside one piece. And a held piece is
        not a readable file: until task 7's flush runs, the bytes sit in a
        `.<infohash>.parts` file and `open()` on the path raises
        FileNotFoundError while both `contiguous_available` and `file_progress`
        report completion (C1, measured) — which is why the second conjunct is
        not belt-and-braces. A `ready: true` the TV believes is a `<track>`
        spending its one and only load on a path that does not exist.

        The INDEX is the torrent's own libtorrent index, never the position in
        this list: `?file_index=` is a libtorrent index (`api/streaming.py:256`)
        and a filtered position renumbers. Measured: `lt.create_torrent`
        interleaved `.pad/N` entries so a 3-file tree became `num_files() == 6`
        with the sidecar at index 4, and the same tree built `v1_only` came out
        with 0 pads — so a torrent's file order is derivable from the filenames
        in neither direction, which `:1146-1150` already forbids relying on.

        Nothing here mutates: no priority is re-shaped, no deadline is set and
        no flush happens (D1/D2 — a GET that re-deadlined pieces would hijack
        libtorrent's deadline queue, and a lister that flushed would make the
        read mutating). Admission is task 7's POST. Per-entry errors are
        reported in the row and never raised, because one unreadable sidecar may
        not cost the whole list — the dev database holds a `seeding`/100 row
        whose `save_path` does not exist at all.
        """
        entry = self.active_torrents.get(torrent_id)
        if entry is None:
            # No live handle: not "this release has none", which is why the
            # envelope carries three values and not a boolean.
            return sidecars.COVERAGE_UNKNOWN, []
        handle = entry[0]
        try:
            if not handle.has_metadata():
                return sidecars.COVERAGE_UNKNOWN, []
            ti = handle.get_torrent_info()
            file_storage = ti.files()
            num_files = int(ti.num_files())
            save_path = handle.status().save_path
        except Exception as e:
            logger.warning(f"Could not read the file list for {torrent_id}: {e}")
            return sidecars.COVERAGE_UNKNOWN, []
        if not save_path:
            return sidecars.COVERAGE_UNKNOWN, []

        rows: List[Dict[str, Any]] = []
        for i in range(num_files):
            try:
                if file_storage.file_flags(i) & lt.file_flags_t.flag_pad_file:
                    # A pad file carries no extension so the filter below would
                    # drop it anyway; the flag is checked because that is a
                    # property of the pad and not of its name.
                    continue
                fi = ti.file_at(i)
                rel_path = str(fi.path).replace("\\", "/")
                size = int(fi.size)
            except Exception as e:
                logger.warning(
                    f"Skipping file {i} of {torrent_id}: its metadata is unreadable ({e})")
                continue

            ext = sidecars.listed_extension(rel_path)
            if ext is None:
                continue
            if not sidecars.listable_size(size):
                logger.info(
                    f"Sidecar {rel_path} in {torrent_id} is {size} bytes, over "
                    f"subtitle_max_bytes; not listing it"
                )
                continue
            abs_path = sidecars.contained_path(save_path, rel_path)
            if abs_path is None:
                continue

            # The two conjuncts, in one expression, so neither can be dropped
            # without the other reading as an obvious orphan.
            #
            # `memoize=False` keeps this loop out of the SHARED memo, whose
            # overflow policy is a whole-dict `.clear()` above 64 entries: one
            # entry per sidecar is 20 per call for the 20-language tree D4's
            # span cap exists for, and 80 on a four-episode pack — which clears
            # the video's cached run and costs the seek boundary a 4096-call
            # walk. The lister's own walk is one or two `have_piece` calls, so it
            # loses nothing by measuring every time. Measured in
            # `test_sidecar_lister.py`'s section (g), both halves separately.
            run = self.contiguous_available(torrent_id, i, 0, memoize=False)
            run_complete = bool(run and run.get("complete"))
            present, reason = sidecars.present_at_declared_size(abs_path, size)
            ready = run_complete and present

            if reason is None and not sidecars.is_convertible(ext):
                reason = sidecars.REASON_UNSUPPORTED_FORMAT
            rows.append({
                "index": i,
                "rel_path": rel_path,
                "path": str(abs_path),
                "name": Path(rel_path).name,
                "size": size,
                "format": sidecars.format_name(ext),
                "convertible": sidecars.is_convertible(ext),
                "ready": ready,
                "reason": reason,
            })

        # DEAD AS WRITTEN, and said here rather than left to be discovered: the
        # loop above walks `range(num_files)` so `rows` is already in strictly
        # increasing index order, and deleting this line is a GREEN mutation
        # (measured in review). It is kept the way the pad-file check above is
        # kept — because the ordering is a promise the route makes and the next
        # hand to touch this loop should not have to re-derive that the walk is
        # what keeps it — and no test claims this line, only the order.
        rows.sort(key=lambda r: r["index"])
        coverage = sidecars.COVERAGE_LISTED if rows else sidecars.COVERAGE_NONE
        return coverage, rows

    def validate_torrent_content(self, handle) -> Optional[str]:
        """Inspect a torrent's file list (metadata required) and return a content-
        guard block reason if it should be rejected, else None. Best-effort — any
        read error returns None (fail-open: never block on our own error)."""
        from app.torrent.content_guard import classify_torrent_files
        try:
            if not handle.has_metadata():
                return None
            ti = handle.get_torrent_info()
            files = [(ti.file_at(i).path, ti.file_at(i).size) for i in range(ti.num_files())]
            return classify_torrent_files(
                files,
                blocked_extensions=settings.blocked_extensions,
                video_extensions=settings.video_extensions,
                fake_heuristics=settings.fake_torrent_heuristics,
            )
        except Exception as e:
            logger.warning(f"content guard could not classify file list: {e}")
            return None

    def _block_torrent(self, torrent_id: str, handle, reason: str) -> None:
        """Enforce a content-guard block: remove from the session, delete partial
        files, and persist state='blocked' + block_reason."""
        logger.warning(f"Content guard BLOCKED torrent {torrent_id}: {reason}")
        try:
            self.session.remove_torrent(handle)
        except Exception as e:
            logger.warning(f"block: session.remove_torrent failed for {torrent_id}: {e}")
        self.active_torrents.pop(torrent_id, None)

        save_path = None
        try:
            with get_db() as db:
                torrent = db.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
                if torrent:
                    save_path = torrent.save_path
                    torrent.state = 'blocked'
                    torrent.block_reason = reason
                    db.add(TorrentLog(
                        torrent_id=torrent_id,
                        message=f"Blocked by content guard: {reason}",
                        level="WARNING",
                        state='blocked',
                    ))
                    db.commit()
        except Exception as e:
            logger.error(f"block: DB update failed for {torrent_id}: {e}")

        if save_path:
            try:
                safe_rmtree(save_path, settings.default_download_path)
            except Exception as e:
                logger.warning(f"block: safe_rmtree failed for {torrent_id}: {e}")

    def skip_non_video_files(self, torrent_id: str, handle) -> None:
        """Set non-video files to priority 0 (skip) and video files to 1, so a
        guarded torrent never spends Pi bandwidth/disk on non-video extras.
        No-op without metadata. Best-effort — never raises into the caller."""
        try:
            if not handle.has_metadata():
                return
            ti = handle.get_torrent_info()
            priorities = [
                1 if self._is_video_file(ti.file_at(i).path) else 0
                for i in range(ti.num_files())
            ]
            if priorities:
                handle.prioritize_files(priorities)
        except Exception as e:
            logger.warning(f"skip_non_video_files failed for {torrent_id}: {e}")

    def prioritize_video_files(self, torrent_id: str, piece_prioritization: bool = True,
                               file_index: Optional[int] = None) -> bool:
        """
        Set high priority for video files and enable sequential downloading
        for optimal streaming experience.
        
        Args:
            torrent_id: ID of the torrent to prioritize
            piece_prioritization: Whether to prioritize individual pieces for streaming
            
        Returns:
            bool: Success status
        """
        if torrent_id not in self.active_torrents:
            logger.warning(f"Torrent {torrent_id} not found in active torrents")
            return False
        
        handle, _ = self.active_torrents[torrent_id]
        if not handle.has_metadata():
            logger.info(f"Waiting for metadata for torrent {torrent_id}")
            return False
        
        try:
            # Enable sequential download
            handle.set_sequential_download(True)

            # Re-apply the per-torrent connection cap. Torrents resumed from disk
            # bypass _add_torrent's cap, so set it here when streaming begins.
            try:
                handle.set_max_connections(settings.lt_per_torrent_connections())
            except Exception as e:
                logger.debug(f"set_max_connections skipped for {torrent_id}: {e}")

            # Find video files and set their priorities
            torrent_info = handle.get_torrent_info()
            file_priorities = []
            video_file_indices = []
            
            for i in range(torrent_info.num_files()):
                file_info = torrent_info.file_at(i)
                file_path = file_info.path
                
                # Check if it's a video file
                if self._is_video_file(file_path):
                    # Set highest priority (7) for video files
                    file_priorities.append(7)
                    video_file_indices.append(i)
                    logger.info(f"Setting high priority for video file: {file_path}")
                else:
                    # Skip non-video files entirely (priority 0) — don't waste
                    # Pi bandwidth/disk on extras.
                    file_priorities.append(0)
            
            # Apply file priorities if any files found
            if file_priorities:
                handle.prioritize_files(file_priorities)
                logger.info(f"File priorities set for torrent {torrent_id}")

                # Optimise streaming for the requested file (a specific season-pack
                # episode) when valid, otherwise the first video file.
                target_index = (
                    file_index if (file_index is not None and file_index in video_file_indices)
                    else (video_file_indices[0] if video_file_indices else None)
                )

                # Piece prioritization for streaming
                if piece_prioritization and target_index is not None:
                    self._prioritize_streaming_pieces(handle, target_index, torrent_info)

                with get_db() as db:
                    torrent: DbTorrent = db.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
                    if torrent:
                        # Update metadata to indicate streaming optimization
                        metadata = torrent.meta_data or {}
                        metadata['streaming_optimized'] = True
                        metadata['streaming_video_index'] = target_index
                        torrent.meta_data = metadata
                        torrent.update(db)
            
            return True
        
        except Exception as e:
            logger.error(f"Error setting file priorities for torrent {torrent_id}: {e}")
            return False

    def _prioritize_streaming_pieces(self, handle, video_file_index, torrent_info):
        """
        Prioritize pieces at the beginning of the video file and around the current playback position
        to improve streaming experience.
        
        Args:
            handle: Torrent handle
            video_file_index: Index of the video file
            torrent_info: Torrent info object
        """
        try:
            # Get the piece information for the video file
            file_info = torrent_info.file_at(video_file_index)
            file_size = file_info.size
            
            # Get the piece range information for the file
            # In libtorrent 2.0+, you need to get this information differently
            try:
                # Get file bytes range
                file_offset = file_info.offset
                file_size = file_info.size
                piece_length = torrent_info.piece_length()
                
                # Calculate which pieces belong to our file
                first_piece = int(file_offset / piece_length)
                last_piece = int((file_offset + file_size - 1) / piece_length)
                num_pieces = last_piece - first_piece + 1
            except Exception as e:
                logger.error(f"Error calculating piece range: {e}")
                first_piece = 0
                num_pieces = 10  # Fallback to prioritize a few pieces at the beginning
            
            # Set higher priority for pieces at the beginning (first 5%)
            initial_buffer_pieces = max(5, int(num_pieces * 0.05))
            
            pieces_priorities = handle.piece_priorities()
            
            # Set highest priority for initial pieces to allow quick start
            for i in range(first_piece, first_piece + initial_buffer_pieces):
                if i < len(pieces_priorities):
                    handle.piece_priority(i, 7)  # Top priority
            
            logger.info(f"Prioritized initial {initial_buffer_pieces} pieces for streaming")
            
        except Exception as e:
            logger.error(f"Error prioritizing pieces for streaming: {e}")

    async def stream_file_range(self, torrent_id: str, file_index: int, file_path: str,
                                start: int, end: int, chunk_size: int = 1024 * 1024,
                                piece_timeout: Optional[float] = None):
        """
        Async generator yielding bytes [start, end] (inclusive) of a torrent's
        file for HTTP streaming, event-driven-WAITING for each underlying piece to
        actually be downloaded before serving it.

        Serving a torrent file straight off disk while it is still downloading
        hands the player not-yet-downloaded (sparse / zero) bytes — including the
        MP4 `moov` atom when it lives at the END of the file. The browser decoder
        rejects those (PIPELINE_ERROR_DECODE / VideoToolbox -12909). This gates
        every chunk on piece availability — polling _pieces_ready while
        re-asserting _deadline_pieces so libtorrent fetches them next — and NEVER
        yields a chunk whose pieces are not confirmed present (it ends the
        generator on timeout instead of serving garbage). Disk reads run off the
        event loop via asyncio.to_thread. StreamingResponse consumes async
        generators directly.

        `piece_timeout` overrides the flat 300s per-chunk cap. The cap is
        deliberately generous HERE, unlike the pre-response wait in
        wait_for_first_chunk: once the status line is sent, giving up can only
        truncate below the promised Content-Length, so waiting beats failing.
        """
        entry = self.active_torrents.get(torrent_id)
        handle = entry[0] if entry else None
        ti = handle.get_torrent_info() if (handle and handle.has_metadata()) else None

        # No live torrent (e.g. completed and removed from the session) → every
        # byte is already on disk; serve straight through (reads off-loop).
        if ti is None:
            f = await asyncio.to_thread(open, file_path, "rb")
            try:
                await asyncio.to_thread(f.seek, start)
                remaining = end - start + 1
                while remaining > 0:
                    chunk = await asyncio.to_thread(f.read, min(chunk_size, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk
            finally:
                await asyncio.to_thread(f.close)
            return

        file_offset = ti.file_at(file_index).offset
        piece_length = ti.piece_length()
        num_pieces = ti.num_pieces()
        try:
            handle.set_sequential_download(True)
        except Exception:
            pass

        # Seek-aware playhead: where this stream currently reads from, in pieces.
        playhead_piece = (file_offset + start) // piece_length

        f = await asyncio.to_thread(open, file_path, "rb")
        try:
            await asyncio.to_thread(f.seek, start)
            remaining = end - start + 1
            pos = start
            while remaining > 0:
                n = min(chunk_size, remaining)
                first_piece = (file_offset + pos) // piece_length
                last_piece = (file_offset + pos + n - 1) // piece_length

                # Seek-aware graduated read-ahead: focus libtorrent on the window
                # at/after the playhead, relax anything far behind it.
                self._prioritize_window(
                    handle, first_piece, num_pieces, playhead_piece
                )
                playhead_piece = first_piece

                # WAIT (poll have_piece) until this chunk's pieces are on disk,
                # keeping the HTTP response OPEN so the player streams as the
                # sequential download advances. Two hard rules for streaming a
                # still-downloading torrent:
                #   - NEVER truncate below Content-Length. Ending the generator
                #     early closes the 206 short -> the browser sees an incomplete
                #     response and stalls ("buffering" forever) instead of playing.
                #   - NEVER read undownloaded (sparse/zero) bytes -> decode errors.
                # So we hold the response open, re-deadlining the needed pieces,
                # until they arrive. Only give up if the torrent left the session
                # (removed/deleted) or a generous dead-stall cap elapses (then the
                # client simply re-requests the range).
                self._deadline_pieces(handle, first_piece, last_piece, num_pieces)
                cap = piece_timeout if piece_timeout is not None else 300.0
                waited = 0.0
                while not self._pieces_ready(handle, first_piece, last_piece):
                    if torrent_id not in self.active_torrents:
                        return  # torrent removed/deleted mid-stream
                    await asyncio.sleep(0.25)
                    waited += 0.25
                    if waited >= cap:
                        logger.warning(
                            f"Streaming {torrent_id}: pieces {first_piece}-{last_piece} "
                            f"unavailable after {cap:.0f}s (dead swarm?); ending stream"
                        )
                        return
                    # priorities/deadlines can be reset by the session; re-assert.
                    self._deadline_pieces(handle, first_piece, last_piece, num_pieces)

                # Pieces confirmed present — only NOW read from disk (off-loop).
                chunk = await asyncio.to_thread(f.read, n)
                if not chunk:
                    return
                remaining -= len(chunk)
                pos += len(chunk)
                yield chunk
        finally:
            await asyncio.to_thread(f.close)

    def _pieces_ready(self, handle, first_piece: int, last_piece: int) -> bool:
        """Non-blocking: True iff every piece in [first_piece, last_piece] is
        already downloaded. Never sleeps, never deadlines. False on any error
        (e.g. the handle was invalidated mid-stream)."""
        try:
            return all(
                handle.have_piece(p) for p in range(first_piece, last_piece + 1)
            )
        except Exception:
            return False

    def contiguous_available(self, torrent_id: str,
                             file_index: Optional[int] = None,
                             at_bytes: int = 0,
                             *, memoize: bool = True) -> Optional[Dict[str, Any]]:
        """The contiguous downloaded run CONTAINING `at_bytes`, in file bytes.

        The seek boundary's only data source. /info's `downloaded`/`progress` are
        `file_progress()` TOTALS counting scattered pieces, and every Range
        request re-anchors the deadline window at a fresh mid-file offset, so
        holes behind the frontier are the normal state — a bar drawn from
        `progress` permits exactly the seek the boundary exists to refuse.

        THE RUN CONTAINING `at_bytes`, NOT A FROM-FILE-START SCALAR.
        prioritize_video_files marks EVERY video file priority 7 while
        set_sequential_download is per-TORRENT, so on a season pack libtorrent
        fills the lowest-index episode first: for episode 5 a from-file-start
        figure legitimately sits near zero while playback runs off the deadline
        window, and a scalar would refuse every seek inside the episode actually
        being watched. `at_bytes=0` degenerates to the prefix case.

        Returns {file_index, file_size, piece_length, run_start, run_end,
        complete, measured_against}, where `run_start`/`run_end` are FILE-relative
        byte offsets and `run_end` is EXCLUSIVE (the first byte not in the run),
        or None.

        None MEANS UNKNOWN, and only a measured answer may report a zero-length
        run. Three paths answer None: the torrent is absent from active_torrents
        (evicted, or finished and never reloaded — see get_completed_video_file_info),
        it has no metadata yet, or a libtorrent call raised. The caller must map
        None to UNBOUNDED seeking, not to a ceiling of zero: a completed download
        is the television's main content and it is exactly the case with no live
        handle, so a zero there would refuse every seek on a file whose every byte
        is on disk.

        That is also why this does NOT use _safe_have: its per-piece False-on-error
        would silently turn an invalidated handle into a measured zero-length run.
        The whole body is guarded by one try that answers None instead.

        `measured_against` names the size the arithmetic was measured against —
        'metadata', i.e. torrent_info.file_at(idx).size. It is the only value
        today, deliberately: the alternative (os.path.getsize) is a stat call this
        walk does not make, and the live path always has metadata. It exists so a
        client can tell what it is reading rather than having to assume.

        `memoize=False` NEITHER READS NOR WRITES `self._contiguous_runs`, and the
        reason is CAPACITY isolation rather than key isolation. The memo's keys
        already cannot collide — `(torrent_id, file_index, at_piece)` — but its
        overflow policy is a whole-dict `.clear()` above 64 entries
        (`_finish`, `:2030-2031`), so a caller that inserts MANY keys at once
        evicts every other caller's. `list_sidecars` is that caller: it asks this
        question once per sidecar, which for the 20-language `Subs/` tree D4's span
        cap exists for is 20 entries per call on a single-episode release and 80
        on a four-episode pack. Twenty does not reach the cap; eighty crosses it
        and the `.clear()` takes the WHOLE dict, including the run the SEEK
        BOUNDARY (`api/streaming.py:450`) and `/info` are polling while a title
        is on screen — each miss there costing a walk of up to
        `_CONTIGUOUS_MAX_PIECES` (4096) `have_piece` pybind calls on the ARM box.
        The lister pays nothing for opting out: a sidecar spans one or two
        pieces, so the walk it repeats is one or two `have_piece` calls.

        Neither-read-nor-write rather than write-only-skip, because one flag with
        one meaning is testable; "reads the cache but never fills it" is a third
        behaviour nobody asked for, and a read-only lister would still serve an
        answer measured up to `_CONTIGUOUS_TTL_S` ago to the honesty gate that
        decides whether the television loads a `<track>`.
        """
        entry = self.active_torrents.get(torrent_id)
        if entry is None:
            return None  # unknown, NOT zero: no live handle to measure with.
        handle = entry[0]
        try:
            if not handle.has_metadata():
                return None
            ti = handle.get_torrent_info()

            idx = file_index
            if idx is None:
                # Mirror the byte routes' own default (the largest video file)
                # rather than inventing a second resolution rule.
                info = self.get_video_file_info(torrent_id, None)
                if not info:
                    return None
                idx = int(info["index"])
            if idx < 0 or idx >= ti.num_files():
                return None

            fi = ti.file_at(idx)
            file_size = int(fi.size)
            # EVERY FILE BUT THE FIRST IN A PACK HAS A NON-ZERO OFFSET, and the
            # piece map is torrent-global: dropping this term measures some other
            # episode's pieces and calls the answer this one's.
            file_offset = int(fi.offset)
            piece_length = int(ti.piece_length())
            if file_size <= 0 or piece_length <= 0:
                return None

            at = min(max(int(at_bytes or 0), 0), file_size - 1)
            # Integer //, never int(a / b): manager.py's older piece arithmetic
            # uses the float idiom and this index must not depend on it.
            first_piece = file_offset // piece_length
            last_piece = (file_offset + file_size - 1) // piece_length
            at_piece = (file_offset + at) // piece_length

            # Memoised on the PIECE containing at_bytes, not on at_bytes: every
            # offset inside one piece has the same answer, so a player polling a
            # moving playhead still hits the cache. /info is polled while a title
            # is on screen and each miss costs a walk.
            cache_key = (torrent_id, idx, at_piece)
            now = time.monotonic()
            if memoize:
                cached = self._contiguous_runs.get(cache_key)
                if cached is not None and (now - cached[0]) < _CONTIGUOUS_TTL_S:
                    return dict(cached[1])

            def _finish(run_start: int, run_end: int, complete: bool) -> Dict[str, Any]:
                result = {
                    "file_index": idx,
                    "file_size": file_size,
                    "piece_length": piece_length,
                    "run_start": run_start,
                    "run_end": run_end,
                    "complete": complete,
                    "measured_against": "metadata",
                }
                # The whole-dict eviction the `memoize` flag exists for: a caller
                # inserting one key per sidecar would clear the seek boundary's
                # own entry, so a bulk caller opts out of BOTH halves above and
                # here rather than relying on its keys not colliding.
                if memoize:
                    if len(self._contiguous_runs) > 64:
                        self._contiguous_runs.clear()
                    self._contiguous_runs[cache_key] = (now, result)
                return dict(result)

            # Fast path for the common finished-but-still-loaded case, which is
            # otherwise the most expensive walk there is. file_progress() is
            # called with NO granularity flag by either caller, so it counts
            # unverified blocks: byte-completeness alone would report `complete`
            # at exactly the moment a tail seek still blocks. Hence the
            # have_piece(last_piece) conjunct.
            progress = handle.file_progress()
            if idx < len(progress) and progress[idx] >= file_size \
                    and handle.have_piece(last_piece):
                return _finish(0, file_size, True)

            if not handle.have_piece(at_piece):
                # Measured, and zero-length: the piece under the playhead is not
                # here. Distinct from None, which means "not measured".
                return _finish(at, at, False)

            # Forward first — it is the direction the boundary is drawn from —
            # and both walks share one budget. A 30 GB pack at an 8 MiB piece
            # length is ~3,800 have_piece() pybind calls; running out of budget
            # makes the answer CONSERVATIVE (a run reported shorter than it is
            # refuses a seek that would have worked) and never optimistic.
            budget = _CONTIGUOUS_MAX_PIECES
            end_piece = at_piece
            while end_piece < last_piece and budget > 0:
                budget -= 1
                if not handle.have_piece(end_piece + 1):
                    break
                end_piece += 1

            start_piece = at_piece
            while start_piece > first_piece and budget > 0:
                budget -= 1
                if not handle.have_piece(start_piece - 1):
                    break
                start_piece -= 1

            # max(0, …): the file's first piece starts BEFORE the file does
            # (pieces are torrent-global), so the raw product is negative there.
            run_start = max(0, start_piece * piece_length - file_offset)
            # min(file_size, …): the file's last piece is partial and its end
            # overshoots the file — into the next file of a pack, or past EOF.
            run_end = min(file_size, (end_piece + 1) * piece_length - file_offset)
            return _finish(run_start, run_end,
                           run_start == 0 and run_end == file_size)
        except Exception as e:
            # One try for the whole body, answering the unknown value. Logged at
            # debug: /info is polled while a title is on screen and the error
            # middleware writes to a retained file.
            logger.debug(
                f"contiguous_available({torrent_id}, {file_index}, {at_bytes}) "
                f"could not measure: {e}"
            )
            return None

    async def wait_for_first_chunk(self, torrent_id: str, file_index: int,
                                   start: int, length: int,
                                   budget: Optional[float] = None) -> bool:
        """True once the pieces backing [start, start+length-1] are on disk.

        Called by the streaming endpoint BEFORE it starts the response body. Once
        StreamingResponse begins emitting, the status code is already sent, so a
        later failure can only truncate below the promised Content-Length — which a
        browser retries and a TV media pipeline reports as a generic playback
        failure. Answering the first chunk up front is the only point at which a
        seek into a not-yet-downloaded region can still become a retryable 503.

        `budget` defaults to _adaptive_piece_timeout(handle) — NOT a flat number.
        A flat budget is the wrong shape for this deployment: on a Pi with a
        low-seeder torrent the 10s-300s delivery band is the common case, so a
        flat 10s converts a slow SUCCESS into a fatal error for a client that
        cannot retry. The adaptive budget instead spends ~2s on a dead swarm
        (zero peers — the case the 503 exists for), `base` while peers are idle,
        and stretches toward 60s in proportion to measured throughput. Pass an
        explicit `budget` to override (tests do).

        Return-value contract, deliberately asymmetric:
        - Torrent absent from the session AT ENTRY -> True. It completed and was
          removed, so every byte is on disk.
        - Torrent leaves the session MID-WAIT -> False. That means deleted or
          content-guard-blocked, and its files may already be gone; returning
          True would hand the generator a missing file.
        - Metadata missing or unreadable -> True: let the generator deal with it
          rather than refusing a request that might well succeed.
        - `budget` seconds elapse with pieces still missing -> False.

        The mid-stream wait inside stream_file_range is unchanged.
        """
        entry = self.active_torrents.get(torrent_id)
        handle = entry[0] if entry else None
        if handle is None:
            return True

        try:
            # has_metadata() MUST be inside the try. This runs BEFORE the response
            # starts, so a RuntimeError("invalid torrent handle") — raised when the
            # handle is invalidated between active_torrents.get() and here, which
            # _block_torrent makes a live race by calling remove_torrent() before
            # popping active_torrents — would propagate into stream_video's
            # catch-all and serve a body into the decoder.
            if not handle.has_metadata():
                return True
            ti = handle.get_torrent_info()
            file_offset = ti.file_at(file_index).offset
            piece_length = ti.piece_length()
            num_pieces = ti.num_pieces()
        except Exception:
            # No usable metadata (or a handle that just went invalid): let the
            # generator deal with it rather than refusing a request that might
            # well succeed.
            return True

        if budget is None:
            budget = self._adaptive_piece_timeout(handle)

        first_piece = (file_offset + start) // piece_length
        last_piece = (file_offset + start + max(length, 1) - 1) // piece_length

        self._prioritize_window(handle, first_piece, num_pieces, first_piece)
        self._deadline_pieces(handle, first_piece, last_piece, num_pieces)

        waited = 0.0
        while not self._pieces_ready(handle, first_piece, last_piece):
            if torrent_id not in self.active_torrents:
                return False
            if waited >= budget:
                logger.info(
                    f"First chunk for {torrent_id} pieces {first_piece}-{last_piece} "
                    f"not available within {budget:.0f}s; answering 503"
                )
                return False
            await asyncio.sleep(0.25)
            waited += 0.25
            self._deadline_pieces(handle, first_piece, last_piece, num_pieces)

        return True

    def _adaptive_piece_timeout(self, handle, *, base: float = 8.0,
                                max_timeout: float = 60.0) -> float:
        """Per-chunk wait budget derived from live swarm status.

        - No peers connected  -> short 2s abort (a dead/connecting torrent should
          not block the response for 45s).
        - Peers but idle       -> `base` seconds.
        - Peers and downloading -> extend with throughput (more bandwidth => we
          can afford to wait for sequential pieces), capped at `max_timeout`.
        """
        try:
            st = handle.status()
            num_peers = int(getattr(st, "num_peers", 0) or 0)
            rate = int(getattr(st, "download_rate", 0) or 0)
        except Exception:
            return base

        if num_peers <= 0:
            return 2.0
        if rate <= 0:
            return base
        # Scale: +1s of patience per ~64 kB/s of measured throughput.
        extended = base + (rate / 65536.0)
        return min(max_timeout, extended)

    def _register_piece_waiter(self, torrent_id: str, piece_index: int):
        """Create + register a Future resolved when piece `piece_index` of
        `torrent_id` finishes. Must be called from the event-loop thread."""
        fut = self._loop.create_future()
        with self._waiter_lock:
            self._piece_waiters.setdefault(torrent_id, {}).setdefault(
                piece_index, []
            ).append(fut)
        return fut

    def _unregister_piece_waiter(self, torrent_id: str, piece_index: int, fut) -> None:
        """Drop `fut` from the registry (after it resolved, timed out, or the
        stream ended). Idempotent."""
        with self._waiter_lock:
            per_torrent = self._piece_waiters.get(torrent_id)
            if not per_torrent:
                return
            waiters = per_torrent.get(piece_index)
            if not waiters:
                return
            if fut in waiters:
                waiters.remove(fut)
            if not waiters:
                per_torrent.pop(piece_index, None)
            if not per_torrent:
                self._piece_waiters.pop(torrent_id, None)

    def _on_piece_finished(self, torrent_id: str, piece_index: int) -> None:
        """Resolve every Future waiting on (torrent_id, piece_index). Safe to
        call from the alert thread: each Future is completed on its own loop via
        call_soon_threadsafe. Drops the resolved waiters from the registry."""
        with self._waiter_lock:
            per_torrent = self._piece_waiters.get(torrent_id)
            if not per_torrent:
                return
            waiters = per_torrent.pop(piece_index, None)
            if not per_torrent:
                self._piece_waiters.pop(torrent_id, None)
        if not waiters:
            return

        def _resolve(f):
            if not f.done():
                f.set_result(True)

        for fut in waiters:
            loop = fut.get_loop()
            loop.call_soon_threadsafe(_resolve, fut)

    def _deadline_pieces(self, handle, first_piece: int, last_piece: int,
                         num_pieces: int, read_ahead: int = 4) -> None:
        """Top-priority + zero-deadline pieces [first_piece, last_piece] plus a
        little read-ahead so libtorrent fetches them next. No waiting."""
        for p in range(first_piece, min(last_piece + 1 + read_ahead, num_pieces)):
            try:
                if not handle.have_piece(p):
                    handle.piece_priority(p, 7)
                    handle.set_piece_deadline(p, 0)
            except Exception:
                pass

    # ------------------------------------------------------- sidecar admission
    #
    # Four methods and one private resolver. They sit beside _deadline_pieces
    # because they make the same two libtorrent calls it does, with the same
    # per-call guard; everything else about them is new.

    def _resolve_sidecar(self, torrent_id: str,
                         index: int) -> Tuple[Optional[_SidecarTarget], Optional[str]]:
        """Resolve one sidecar against LIVE metadata, or say why it cannot be.

        Gates 1 and 2 of the five: a live handle with metadata, and an index that
        really names a listable sidecar in that metadata. Returns
        `(target, None)` or `(None, reason)` — never raises, and never indexes
        `active_torrents` directly, because a POST naming an evicted torrent must
        answer rather than 500.

        THE EXTENSION CHECK IS A GATE HERE AND NOT ONLY IN THE LISTER. The route
        resolves through the lister (plan D9), so in principle a non-subtitle
        index cannot arrive — but the flush WRITES BYTES TO DISK at a path taken
        from torrent metadata, and `{index}` is a raw integer in the URL. Any
        file at priority 0 would otherwise be admissible: `Setup.exe` sitting
        beside the film in a release is exactly priority 0, exactly what the
        content guard refuses to download, and a POST naming its index would
        fetch it. So the same hard-coded listed set the lister uses
        (`sidecars.listed_extension`, which intersects with
        `settings.subtitle_extensions` and cannot be WIDENED by a `.env`) gates
        admission too. This gate is not in the plan's list of five; it is in the
        report as an addition, with its own test row.
        """
        entry = self.active_torrents.get(torrent_id)
        if entry is None:
            # .get, never [...]: an evicted torrent is the normal case, not an
            # error, and a KeyError here would reach the client as an opaque 500.
            return None, SIDECAR_REFUSAL_NOT_LOADED
        handle = entry[0]
        try:
            if not handle.has_metadata():
                return None, SIDECAR_REFUSAL_NOT_LOADED
            ti = handle.get_torrent_info()
            num_files = int(ti.num_files())
            piece_length = int(ti.piece_length())
            save_path = handle.status().save_path
            priorities = [int(p) for p in handle.get_file_priorities()]
        except Exception as e:
            logger.warning(
                f"Sidecar {index} of {torrent_id}: the live session could not be "
                f"read ({e})"
            )
            return None, SIDECAR_REFUSAL_NOT_LOADED
        if piece_length <= 0 or not save_path:
            return None, SIDECAR_REFUSAL_NOT_LOADED

        idx = int(index)
        # No test in `test_sidecar_admission.py` discriminates this branch
        # (measured: deleting it stays green, because the fake's `file_at` raises
        # out of range and the `except` below answers the same refusal). It stays
        # because a real `file_storage.file_at` out of range is not required to
        # raise anything in particular, and because the `len(priorities)` arm is
        # what keeps `priorities[idx]` from an IndexError further down.
        if idx < 0 or idx >= num_files or idx >= len(priorities):
            return None, SIDECAR_REFUSAL_NO_SUCH_SIDECAR
        try:
            # DEAD AS WRITTEN, measured, and said here rather than left to be
            # discovered: a pad is named `.pad/<size>` and so carries no subtitle
            # extension, which means the `listed_extension` gate below excludes
            # it anyway and deleting this branch is a GREEN mutation. Kept for
            # the same reason the lister keeps its copy — the flag is a property
            # of the pad rather than of its name — and because gate 4's pad
            # exclusion, which is NOT dead, reads the same flag.
            if ti.files().file_flags(idx) & lt.file_flags_t.flag_pad_file:
                return None, SIDECAR_REFUSAL_NO_SUCH_SIDECAR
            fi = ti.file_at(idx)
            rel_path = str(fi.path).replace("\\", "/")
            size = int(fi.size)
            offset = int(fi.offset)
        except Exception as e:
            logger.warning(f"Sidecar {idx} of {torrent_id}: metadata unreadable ({e})")
            return None, SIDECAR_REFUSAL_NO_SUCH_SIDECAR
        if size <= 0 or offset < 0:
            return None, SIDECAR_REFUSAL_NO_SUCH_SIDECAR
        if sidecars.listed_extension(rel_path) is None:
            return None, SIDECAR_REFUSAL_NO_SUCH_SIDECAR

        # Integer //, never int(a / b), matching contiguous_available's own note
        # at its first_piece/last_piece: the float idiom elsewhere in this file
        # loses precision above 2^53 and this index must not depend on it. No
        # test discriminates the two (they agree at every realistic offset and a
        # fixture would need a torrent above 9 PB — the shape stage 7 recorded),
        # so the reason is written here instead.
        #
        # EVERY FILE BUT THE FIRST HAS A NON-ZERO OFFSET and the piece map is
        # torrent-global: dropping the offset term measures some other file's
        # pieces and raises those instead.
        first_piece = offset // piece_length
        last_piece = (offset + size - 1) // piece_length
        return _SidecarTarget(
            handle=handle, ti=ti, index=idx, rel_path=rel_path, size=size,
            first_piece=first_piece, last_piece=last_piece,
            priorities=priorities, save_path=str(save_path),
        ), None

    def _span_is_exclusively_deselected(self, ti, priorities: List[int],
                                        first_piece: int,
                                        last_piece: int) -> Tuple[bool, Optional[int]]:
        """GATE 4: does every byte of every piece in the span belong to files at
        priority 0?

        Returns `(ok, offending_index)`. This is the sharpest edge in stage 9 and
        the reason it exists is measured (plan D3, reproduced in task 0's run 4):
        `piece_priority(p, 0)` on a piece a WANTED file also occupies DE-WANTS
        that file's bytes. On an unpadded layout, where a sidecar shares the
        video's last piece, retracting that piece drove `total_wanted` BELOW
        baseline (residual -3048), left the shared piece at priority 0, and took
        the torrent from `seeding`/100% back to `downloading`/46.78%. A negative
        residual is the torrent wanting less than its own video: an unplayable
        episode reported complete. The acceptance test for anything here is the
        video file's SHA-256 against a known-good copy, never a status line.
        Pads are excluded because a pad carries no bytes anyone reads, and
        libtorrent's own default of 4 (which a SHORT prioritize_files list
        re-admits a tail to, measured in D1's reason 2) would otherwise make
        every padded torrent fail this gate.

        ALL-OR-NOTHING over the span, not per piece. A partial raise would make
        the retraction's piece set differ from the admission's, and the flush
        needs the WHOLE span held before it can move anything anyway.

        Conservative on error: an unreadable file entry answers False, because
        the failure this gate prevents costs the television its main content.
        """
        try:
            piece_length = int(ti.piece_length())
            total_size = int(ti.total_size())
            num_files = int(ti.num_files())
            file_storage = ti.files()
        except Exception as e:
            logger.warning(f"Gate 4 could not read the torrent's layout ({e})")
            return False, None
        if piece_length <= 0:
            return False, None
        span_start = first_piece * piece_length
        span_end = (last_piece + 1) * piece_length
        if total_size > 0:
            # DEAD AS WRITTEN, and said here rather than left to be discovered.
            # The sentence it used to carry — "the last piece of a torrent
            # overshoots its end; those bytes belong to no file at all" — is true
            # about libtorrent and irrelevant here, because this clamp can never
            # change an answer below. `span_end` is only ever read in
            # `f_offset >= span_end`, and no file can lie beyond `total_size`
            # (`total_size` is the sum of the file sizes, so the last file's
            # `offset + size` IS it): a file with `f_offset >= total_size` would
            # have to be empty, and `f_size <= 0` is skipped before the
            # comparison. So every `f_offset` the loop tests is `< total_size`,
            # and clamping `span_end` down to `total_size` cannot flip
            # `f_offset >= span_end` either way. Deleting these two lines is a
            # GREEN mutation. Kept because the overshoot it describes is real —
            # the span of the torrent's last piece genuinely does run past the
            # last file — and the next hand to widen what `span_end` is read for
            # (a byte-range intersection rather than this one-sided test) would
            # need it back immediately.
            span_end = min(span_end, total_size)
        for i in range(num_files):
            try:
                if file_storage.file_flags(i) & lt.file_flags_t.flag_pad_file:
                    continue
                fi = ti.file_at(i)
                f_offset = int(fi.offset)
                f_size = int(fi.size)
            except Exception as e:
                logger.warning(f"Gate 4 could not read file {i} ({e})")
                return False, None
            if f_size <= 0:
                continue
            if f_offset >= span_end or f_offset + f_size <= span_start:
                continue
            if i >= len(priorities) or priorities[i] != 0:
                return False, i
        return True, None

    def admit_sidecar_pieces(self, torrent_id: str, index: int) -> SidecarAdmission:
        """Raise the pieces of ONE sidecar, on demand. Phase 1 of two.

        Five gates (plan D3/D4): a live handle with metadata; an index that
        resolves to a listable sidecar in that metadata; its current FILE
        priority is 0; the span is no longer than `subtitle_admit_max_pieces`;
        and gate 4 — every byte of every piece to be raised belongs to files at
        priority 0. The only calls are `piece_priority(p, 7)` and
        `set_piece_deadline(p, 0)`, the same two `_deadline_pieces` makes, each
        individually guarded, and only for pieces not already held.

        NO FILE PRIORITY IS TOUCHED HERE, and that is the whole point of the
        shape. Measured (C1): `file_priority(sub, 1)` at admission time is undone
        by `prioritize_video_files`' very next call — which every ranged
        `GET /video` makes — and that recompute takes `_prioritize_window`'s
        raised window with it, i.e. it costs the playhead to fetch a subtitle.
        A piece-level admission survives the same call untouched.

        The span cap is on PIECES, not bytes: `total_wanted` rises by only the
        file's size but the download cost is whole pieces — `N_sidecars *
        piece_length` on a pad-aligned torrent. At an 8 MiB piece that is
        20 * 8 MiB = 160 MiB for a 20-language `Subs/` tree, and ~1.6 GiB only
        at the ~200 sidecars of a 20-language x ~10-episode season pack. (This
        docstring said 1.6 GiB for the 20-language tree, 10x off; corrected by
        plan C5, which changed neither the conclusion nor the cap.) §7.5's
        "(kilobytes)" is still wrong by orders of magnitude either way.

        Idempotent, and a no-op off session. `admitted == 0` with no refusal is a
        success — see SidecarAdmission.
        """
        target, refusal = self._resolve_sidecar(torrent_id, index)
        if target is None:
            return SidecarAdmission(0, (), refusal)

        # Gate 3. A file already at a non-zero priority has nothing to admit:
        # its bytes are wanted, and raising its pieces would mean a retraction
        # that de-wants them. Formally implied by gate 4 (which sees the sidecar
        # itself), kept separate so the POST can name THIS reason.
        if target.priorities[target.index] != 0:
            logger.info(
                f"Sidecar {target.rel_path} of {torrent_id} is already at "
                f"priority {target.priorities[target.index]}; nothing to admit"
            )
            return SidecarAdmission(0, (), SIDECAR_REFUSAL_NOT_DESELECTED)

        pieces = tuple(range(target.first_piece, target.last_piece + 1))
        # Gate 5, before gate 4's walk: the cap forecloses the padded worst case
        # STRUCTURALLY rather than by budget. Read defensively — an unreadable
        # setting admits nothing, and a configured 0 disables admission outright
        # rather than being quietly rounded up to 1.
        try:
            cap = int(settings.subtitle_admit_max_pieces)
        except (TypeError, ValueError):  # pragma: no cover - defensive
            cap = 0
        if len(pieces) > cap:
            logger.info(
                f"Sidecar {target.rel_path} of {torrent_id} spans {len(pieces)} "
                f"pieces, over subtitle_admit_max_pieces={cap}; refusing"
            )
            return SidecarAdmission(0, (), SIDECAR_REFUSAL_SPAN_TOO_LARGE)

        # Gate 4 — and when it refuses, that is a measured NO-OP and not a
        # refusal: a wanted file shares the piece, so the sidecar's bytes are
        # already coming. They still need the flush to leave the part file,
        # which is why the span is reported.
        ok, offender = self._span_is_exclusively_deselected(
            target.ti, target.priorities, target.first_piece, target.last_piece)
        if not ok:
            logger.info(
                f"Sidecar {target.rel_path} of {torrent_id} shares pieces "
                f"{pieces[0]}-{pieces[-1]} with file {offender} at a non-zero "
                f"priority; its bytes are already wanted, so admission is a no-op"
            )
            return SidecarAdmission(0, pieces, None)

        raised = 0
        for p in pieces:
            try:
                if not target.handle.have_piece(p):
                    target.handle.piece_priority(p, 7)
                    target.handle.set_piece_deadline(p, 0)
                    raised += 1
            except Exception:
                pass
        if raised:
            logger.info(
                f"Admitted {raised} piece(s) {pieces[0]}-{pieces[-1]} for sidecar "
                f"{target.rel_path} of {torrent_id}"
            )
        return SidecarAdmission(raised, pieces, None)

    def flush_sidecar_file(self, torrent_id: str, index: int,
                           wait_s: Optional[float] = None) -> bool:
        """Move a HELD sidecar's bytes out of the part file and onto disk.

        Phase 2, and the phase C1 added. Phase 1 alone never produces a readable
        file: libtorrent 2.0 routes a priority-0 file's bytes into
        `.<infohash>.parts`, where `open()` on the sidecar's own path raises
        FileNotFoundError while `contiguous_available` reports `complete` and
        `file_progress()` reports the full size. Exactly
        `file_priority(idx, 1)`, a bounded wait for the path to appear at its
        declared size, then `file_priority(idx, 0)`. NEVER 7 — that is
        `prioritize_video_files`' own video value and would put a 40 KB text file
        in competition with the playhead — and never left at 1, because the
        selector's next call would then be a CHANGED list, which recomputes and
        takes `_prioritize_window`'s raised window with it.

        Preconditions, both load-bearing: every piece of the span is HELD, and
        the file's current priority is 0. Flushing before the span is held is a
        file-level admission wearing a flush's name, and it is the one shape C1
        measured as broken.

        The trailing re-zero runs in a `finally`: a wait that times out must
        still put the priority back, or the next selector call sees a changed
        vector. Measured (C1 [3]/[4]/[E]): the file lands at its declared size
        with `redownloaded=0`, the written bytes survive the re-zero, and they
        survive every later `prioritize_video_files` call too (`on_disk=40960`
        after the selector re-zeroed an already-written sidecar).

        Both calls wipe `_prioritize_window`'s raised window. That is the price;
        it is transient because the window is re-asserted per chunk from
        `stream_file_range`, and it is why the flush happens ONCE, after the
        bytes are already held, rather than at admission time. It is also why
        there is no "already on disk, skip it" shortcut: the lister reports such
        a sidecar `ready`, so the television has no reason to ask again, and one
        shape is easier to reason about than two. Re-flushing is harmless either
        way.

        SYNCHRONOUS AND BLOCKING for up to `wait_s`. `_drive_sidecar_fetch` runs
        it in a thread for that reason; a caller on the event loop must do the
        same. Returns True only if the file really arrived at its declared size.
        """
        target, _refusal = self._resolve_sidecar(torrent_id, index)
        if target is None:
            return False
        if target.priorities[target.index] != 0:
            logger.info(
                f"Not flushing {target.rel_path} of {torrent_id}: its priority is "
                f"{target.priorities[target.index]}, not 0 (already wanted, or a "
                f"flush is already in flight)"
            )
            return False
        pieces = tuple(range(target.first_piece, target.last_piece + 1))
        unheld = [p for p in pieces if not self._safe_have(target.handle, p)]
        if unheld:
            logger.debug(
                f"Not flushing {target.rel_path} of {torrent_id}: pieces {unheld} "
                f"are not held yet"
            )
            return False
        abs_path = sidecars.contained_path(target.save_path, target.rel_path)
        if abs_path is None:
            return False

        budget = _SIDECAR_FLUSH_WAIT_S if wait_s is None else float(wait_s)
        landed = False
        try:
            try:
                target.handle.file_priority(target.index, 1)
            except Exception as e:
                logger.warning(
                    f"Could not raise {target.rel_path} of {torrent_id} for the "
                    f"flush ({e})"
                )
                return False
            deadline = time.monotonic() + budget
            while True:
                present, _reason = sidecars.present_at_declared_size(
                    abs_path, target.size)
                if present:
                    landed = True
                    break
                if time.monotonic() >= deadline:
                    break
                time.sleep(_SIDECAR_FLUSH_POLL_S)
        finally:
            try:
                target.handle.file_priority(target.index, 0)
            except Exception:
                pass
        if landed:
            logger.info(
                f"Flushed sidecar {target.rel_path} of {torrent_id} "
                f"({target.size} bytes) into the save path"
            )
        else:
            logger.warning(
                f"Sidecar {target.rel_path} of {torrent_id} did not appear at its "
                f"declared size within {budget:.1f}s; its priority is back to 0"
            )
        return landed

    def retract_sidecar_pieces(self, torrent_id: str, index: int, *,
                               expired: bool) -> int:
        """Withdraw an admission. GATE 4 FIRST, then two exits.

        `expired` is keyword-only and has NO DEFAULT, because choosing the wrong
        exit is the most expensive mistake in the stage and a default would let a
        caller take it by omission.

        **GATE 4 GUARDS BOTH EXITS, and it runs BEFORE the deadline reset.** A
        refusal makes the whole call a true no-op — deadlines included — and that
        ordering is a fix, not a style: the earlier shape reset
        `reset_piece_deadline(p)` over the whole span unconditionally and ahead
        of the re-check, so the gate-4-refused path cleared the deadlines on a
        span the gate had *just* identified as belonging to a WANTED VIDEO FILE.
        Those are exactly the pieces `_deadline_pieces` (`:2204`, its
        `set_piece_deadline(p, 0)` at `:2212`) gives the playhead from
        `wait_for_first_chunk` (`:2112`, `:2126`) and `stream_file_range`
        (`:1851`, `:1866`) — and `_deadline_pieces`' `read_ahead=4` reaches PAST
        the video's last piece into the sidecar's own pieces on an unpadded
        torrent, which is the same adjacency gate 4 exists for. The effect was
        bounded (the streaming path re-asserts its deadlines per chunk) but it
        was a de-prioritisation of the television's main content in the one path
        that is documented as doing nothing, and the gate-4 refusal is reached
        with no admission of ours to withdraw at all: `admit_sidecar_pieces`
        raises nothing when gate 4 refuses, yet `start_sidecar_fetch` still
        starts a driver, and its `finally` arrives here with `expired=True`.

        Then, with the gate passed:

        * **success** (`expired=False`) — the span is held and the flush has
          already put the file priority back to 0. Retraction is
          `reset_piece_deadline(p)` over the span and NOTHING ELSE. The raised
          piece priorities are left alone: libtorrent has already dropped them
          on held pieces (measured — runs 2 and 3 of the probe sampled held
          pieces and both cells were void), and lowering them is the catastrophe
          below. Measured on this path: residual 0, the shared piece left at
          libtorrent's default 4, state back to `seeding`, and the video's
          SHA-256 matching the seed's.
        * **budget expiry** (`expired=True`) — the span is NOT held, so there is
          nothing to flush and the admission must be withdrawn or it holds the
          torrent below 100% forever, which costs the television
          `get_completed_video_file_info`'s gate 2 and one of the Pi's two
          download slots. `reset_piece_deadline(p)` plus `piece_priority(p, 0)`.
          This is the only `piece_priority(p, 0)` in stage 9 and the measured
          catastrophe: on a shared piece it drove `total_wanted` to residual
          -3048 and the torrent from `seeding`/100% to `downloading`/46.78%.

        The re-check is not ceremony: the span's composition can change
        underneath an admission. `_prioritize_window` raises a 32-piece window
        from the playhead, which near the end of a file spills into the next
        file's pieces, and its backward-seek branch sets `piece_priority(p, 1)`
        — "low, not zero (still wanted)" — and is re-asserted per chunk. If the
        sidecar's own file priority has risen meanwhile, gate 4 sees it and this
        call lowers nothing and resets nothing.

        Skipping the reset on the SUCCESS exit when gate 4 now refuses is safe
        for a different reason than the budget exit's: that exit runs with the
        span already HELD, and a deadline on a held piece has nothing left to
        order. Resetting a deadline is NOT unconditionally safe, which is what
        this function used to claim.

        Returns the number of pieces lowered (always 0 on the success exit, and
        always 0 when gate 4 refuses). Idempotent on both paths.
        """
        target, _refusal = self._resolve_sidecar(torrent_id, index)
        if target is None:
            return 0
        pieces = tuple(range(target.first_piece, target.last_piece + 1))

        # Gate 4, ahead of EVERYTHING, on BOTH exits. A refusal means the span's
        # bytes belong to a file somebody else wants, so neither of the two
        # calls below is ours to make: `piece_priority(p, 0)` would de-want that
        # file's bytes, and `reset_piece_deadline(p)` would drop a deadline the
        # streaming path may have set on the very same piece.
        ok, offender = self._span_is_exclusively_deselected(
            target.ti, target.priorities, target.first_piece, target.last_piece)
        if not ok:
            logger.warning(
                f"Gate 4 refuses the retraction of pieces "
                f"{pieces[0]}-{pieces[-1]} of {torrent_id} (expired={expired}): "
                f"file {offender} occupies them at a non-zero priority (None = "
                f"the layout was unreadable), so this call does nothing at all — "
                f"no piece_priority(p, 0), which would de-want that file's "
                f"bytes, and no reset_piece_deadline(p) either, which could drop "
                f"the playhead's own deadline on a shared piece"
            )
            return 0

        for p in pieces:
            try:
                target.handle.reset_piece_deadline(p)
            except Exception:
                pass
        if not expired:
            return 0

        lowered = 0
        for p in pieces:
            try:
                target.handle.piece_priority(p, 0)
                lowered += 1
            except Exception:
                pass
        logger.info(
            f"Withdrew the admission of {target.rel_path} of {torrent_id}: "
            f"{lowered} piece(s) back to priority 0"
        )
        return lowered

    def start_sidecar_fetch(self, torrent_id: str, index: int,
                            budget_ms: Optional[int] = None) -> SidecarAdmission:
        """Admit now, and drive the wait, the flush and the retraction in a task.

        The admission itself is synchronous — it is a handful of libtorrent calls
        and the POST answers 202/409 from its real outcome rather than guessing.
        Everything that waits happens in a background task, because a POST that
        waited for the span would hold a request open for up to
        `subtitle_admit_budget_ms`; the television learns the outcome by polling
        the list (plan D2/task 8).

        ONE TASK PER `(torrent_id, index)`. Two POSTs for the same sidecar — a
        double OK press on the picker, which is the TV remote's normal failure
        mode — must not start two drivers racing to flush and retract the same
        file. The registry is module-level because it belongs to the process, not
        to a request.
        """
        result = self.admit_sidecar_pieces(torrent_id, index)
        if result.refusal is not None:
            return result

        key = (str(torrent_id), int(index))
        existing = _sidecar_fetch_tasks.get(key)
        if existing is not None and not existing.done():
            logger.debug(f"A sidecar fetch for {key} is already in flight")
            return result

        if budget_ms is None:
            try:
                budget_ms = int(settings.subtitle_admit_budget_ms)
            except (TypeError, ValueError):  # pragma: no cover - defensive
                budget_ms = 0
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # No loop to drive the retraction, so withdraw the admission here and
            # now rather than leave raised pieces with nothing to lower them.
            logger.warning(
                f"No running event loop to drive the sidecar fetch for {key}; "
                f"withdrawing the admission"
            )
            self.retract_sidecar_pieces(torrent_id, index, expired=True)
            return SidecarAdmission(0, result.pieces, SIDECAR_REFUSAL_NO_DRIVER)

        task = loop.create_task(
            self._drive_sidecar_fetch(
                torrent_id, int(index), result.pieces, float(budget_ms))
        )
        _sidecar_fetch_tasks[key] = task
        # Drop the key when the task finishes, or the first fetch for a sidecar
        # would be the only one this process ever runs.
        task.add_done_callback(lambda t, k=key: _forget_sidecar_fetch(k, t))
        return result

    async def _drive_sidecar_fetch(self, torrent_id: str, index: int,
                                   pieces: Tuple[int, ...],
                                   budget_ms: float) -> None:
        """admit (done) -> wait for the span -> flush -> retract on the right exit.

        The wait reuses `await_pieces_async`, which is event-driven off the alert
        loop's `piece_finished_alert` rather than a busy poll. One cosmetic cost,
        named so it is not mistaken for a bug: its timeout log line says "ending
        stream", which is wrong for a subtitle — it is shared code and the
        message belongs to its first caller.

        The flush runs in a thread because it blocks on a bounded wait. The
        retraction runs in a `finally` so a cancelled task cannot leave raised
        pieces behind.
        """
        held = False
        try:
            entry = self.active_torrents.get(torrent_id)
            if entry is None:
                return
            if pieces:
                held = await self.await_pieces_async(
                    entry[0], list(pieces), max(budget_ms / 1000.0, 0.0))
            if held:
                await asyncio.to_thread(self.flush_sidecar_file, torrent_id, index)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning(f"Sidecar fetch for {torrent_id}#{index} failed: {e}")
        finally:
            # not held -> the budget expired (or the task was cancelled), and an
            # admission nobody can finish must be withdrawn or it strands the
            # torrent below 100%.
            self.retract_sidecar_pieces(torrent_id, index, expired=not held)

    def _prioritize_window(self, handle, first_piece: int, num_pieces: int,
                           prev_playhead: int, window: int = 32,
                           step_ms: int = 800) -> None:
        """Seek-aware prioritization. Around the current read position set
        GRADUATED set_piece_deadline(p, k*step) across a forward read-ahead
        window (nearest piece tightest), and RELAX pieces far behind the playhead
        on a backward seek so libtorrent stops fetching where the user no longer
        is. Best-effort: every libtorrent call is guarded."""
        last = min(first_piece + window, num_pieces)
        for k, p in enumerate(range(first_piece, last)):
            try:
                if not handle.have_piece(p):
                    handle.piece_priority(p, 7)
                    handle.set_piece_deadline(p, k * step_ms)
            except Exception:
                pass

        # Backward seek: relax the abandoned window behind the new playhead.
        if first_piece < prev_playhead:
            for p in range(first_piece + window, min(prev_playhead + window, num_pieces)):
                try:
                    if not handle.have_piece(p):
                        handle.piece_priority(p, 1)  # low, not zero (still wanted)
                        handle.reset_piece_deadline(p)
                except Exception:
                    pass

    async def await_pieces_async(self, handle, pieces: list, timeout: float) -> bool:
        """Event-driven wait for every piece in `pieces` to be downloaded.

        Returns True once all are have_piece(); False if `timeout` seconds pass
        first. Replaces the old time.sleep(0.05) busy-poll: registers a Future per
        not-yet-have piece (resolved from the alert loop by _on_piece_finished) and
        awaits them under one asyncio.wait_for. Always cleans up its Futures.
        """
        # Find the torrent_id for this handle (registry is keyed by it).
        torrent_id = None
        for tid, (h, _) in self.active_torrents.items():
            if h == handle:
                torrent_id = tid
                break
        if torrent_id is None:
            # Not in the session anymore — fall back to a direct check.
            return all(self._safe_have(handle, p) for p in pieces)

        missing = [p for p in pieces if not self._safe_have(handle, p)]
        if not missing:
            return True

        futures = [self._register_piece_waiter(torrent_id, p) for p in missing]

        # Lost-wakeup guard: piece may have arrived between the _safe_have check
        # above and _register_piece_waiter. Re-check now that we're registered;
        # if it's already here, resolve the future ourselves so we don't hang.
        for p, fut in zip(missing, futures):
            if not fut.done() and self._safe_have(handle, p):
                fut.set_result(True)

        try:
            await asyncio.wait_for(
                asyncio.gather(*futures), timeout=timeout
            )
            return True
        except asyncio.TimeoutError:
            logger.warning(
                f"Streaming: timed out after {timeout:.1f}s waiting for pieces "
                f"{missing[0]}-{missing[-1]}; ending stream (no garbage served)"
            )
            return False
        finally:
            for p, fut in zip(missing, futures):
                self._unregister_piece_waiter(torrent_id, p, fut)
                if not fut.done():
                    fut.cancel()

    def _safe_have(self, handle, piece: int) -> bool:
        """have_piece() that never raises (handle may be invalidated)."""
        try:
            return bool(handle.have_piece(piece))
        except Exception:
            return False

# Create a singleton instance
torrent_manager = TorrentManager()