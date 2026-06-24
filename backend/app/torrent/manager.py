import libtorrent as lt
import asyncio
import time
import json
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

VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.ogv', '.wmv', '.flv']

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
        queue). Called on stream end / completion."""
        entry = self.active_torrents.get(torrent_id)
        if not entry:
            return False
        handle, _ = entry
        self._set_auto_managed(handle, True)
        logger.info(f"Released force-start for {torrent_id} (back to auto-managed)")
        return True

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
            # Auto-managed so libtorrent's own queue enforces active_downloads
            # (the effective cap). The actively-streamed torrent is force-started
            # out of the queue separately (force_start_for_stream).
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
        """Check if a file is a video based on its extension"""
        return any(file_path.lower().endswith(ext) for ext in VIDEO_EXTENSIONS)

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
                    # Set normal priority (1) for other files
                    file_priorities.append(1)
            
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

    def stream_file_range(self, torrent_id: str, file_index: int, file_path: str,
                          start: int, end: int, chunk_size: int = 1024 * 1024,
                          piece_timeout: Optional[float] = None):
        """
        Yield bytes [start, end] (inclusive) of a torrent's file for HTTP streaming,
        WAITING for each underlying piece to actually be downloaded before serving it.

        Serving a torrent file straight off disk while it is still downloading hands
        the player not-yet-downloaded (sparse / zero) bytes — including the MP4 `moov`
        atom when it lives at the END of the file (sequential download fetches that
        last). The browser decoder rejects those bytes as bad data
        (PIPELINE_ERROR_DECODE / VideoToolbox -12909). This generator gates every chunk
        on piece availability — deadlining the needed pieces so libtorrent fetches them
        next — so the player only ever receives real, decodable bytes (it buffers /
        waits instead of decoding garbage).
        """
        entry = self.active_torrents.get(torrent_id)
        handle = entry[0] if entry else None
        ti = handle.get_torrent_info() if (handle and handle.has_metadata()) else None

        # No live torrent (e.g. completed and removed from the session) → every byte
        # is already on disk; serve straight through.
        if ti is None:
            with open(file_path, "rb") as f:
                f.seek(start)
                remaining = end - start + 1
                while remaining > 0:
                    chunk = f.read(min(chunk_size, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk
            return

        file_offset = ti.file_at(file_index).offset
        piece_length = ti.piece_length()
        num_pieces = ti.num_pieces()
        try:
            handle.set_sequential_download(True)
        except Exception:
            pass

        with open(file_path, "rb") as f:
            f.seek(start)
            remaining = end - start + 1
            pos = start
            while remaining > 0:
                n = min(chunk_size, remaining)
                first_piece = (file_offset + pos) // piece_length
                last_piece = (file_offset + pos + n - 1) // piece_length

                # Wait (with deadlining) for this chunk's pieces. On failure we
                # END the generator rather than read sparse/undownloaded bytes —
                # the browser re-requests the Range; WS6/WS2 explain the gap.
                budget = (
                    piece_timeout if piece_timeout is not None
                    else self._adaptive_piece_timeout(handle)
                )
                if not self._await_pieces(
                    handle, first_piece, last_piece, num_pieces, budget
                ):
                    return

                # Pieces confirmed present — only NOW read from disk.
                chunk = f.read(n)
                if not chunk:
                    return
                remaining -= len(chunk)
                pos += len(chunk)
                yield chunk

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

    def _await_pieces(self, handle, first_piece: int, last_piece: int,
                      num_pieces: int, timeout: float, read_ahead: int = 4) -> bool:
        """
        Block until pieces [first_piece, last_piece] are downloaded (or `timeout`
        seconds elapse), deadlining them — plus a little read-ahead — so libtorrent
        fetches them ASAP. Returns True if every required piece arrived, else False
        (caller then serves what's there rather than hanging forever).
        """
        for p in range(first_piece, min(last_piece + 1 + read_ahead, num_pieces)):
            try:
                if not handle.have_piece(p):
                    handle.piece_priority(p, 7)
                    handle.set_piece_deadline(p, 0)
            except Exception:
                pass

        deadline = time.time() + timeout
        while time.time() < deadline:
            if self._pieces_ready(handle, first_piece, last_piece):
                return True
            time.sleep(0.05)

        logger.warning(
            f"Streaming: timed out after {timeout:.1f}s waiting for pieces "
            f"{first_piece}-{last_piece}; ending stream (no garbage served)"
        )
        return False

# Create a singleton instance
torrent_manager = TorrentManager()