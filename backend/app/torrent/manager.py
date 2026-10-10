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
from typing import Dict, List, Optional, Any, Tuple
from torf import Magnet
from sqlalchemy.orm import Session

from app.database.session import get_db, init_db
from app.database.models import Torrent as DbTorrent, TorrentLog
from app.models import TorrentState, TorrentStatus, Movie, Torrent as TorrentModel
from app.config import settings
from app.torrent.storage import encode_resume_data, decode_resume_data, safe_rmtree
from app.torrent.states import ACTIVE_DOWNLOAD_STATES, RESUMABLE_STATES
from app.providers.episodes import parse_episode

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

# States in which every wanted byte is expected to be on disk already, so a file
# may be served straight through with no piece gating. Deliberately NARROWER than
# states.TERMINAL_STATES, which also holds 'error' (a download that stopped at an
# arbitrary percentage) and 'blocked' (whose files the content guard deleted).
ON_DISK_STATES = frozenset({"finished", "seeding"})

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
        # _CONTIGUOUS_TTL_S.
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
                                    handle.save_resume_data()
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
                handle.save_resume_data()
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
                handle.save_resume_data()
                
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

        Resume data carries the whole `info` dict, so `lt.read_resume_data(...).ti`
        yields the authoritative file list — index, path and size — for a torrent
        that is no longer in the libtorrent session (round-trip verified against
        the pinned libtorrent 2.0.11). Nothing is added to the session here.

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
            return None
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
                             at_bytes: int = 0) -> Optional[Dict[str, Any]]:
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