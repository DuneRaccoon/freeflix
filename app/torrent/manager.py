import libtorrent as lt
import asyncio
import time
import json
import uuid
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
            'listen_interfaces': settings.LISTEN_INTERFACES,
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
        
        # Try to load the resume data
        settings.RESUME_DATA_PATH.mkdir(parents=True, exist_ok=True)
        
        # Dictionary to store active torrents: {torrent_id: (handle, metadata)}
        self.active_torrents: Dict[str, Tuple[lt.torrent_handle, Dict[str, Any]]] = {}
        
        # Initialize the database
        init_db()
        
        # Load any previously active torrents
        self._load_saved_torrents()
        
        # Background task to update torrent status
        self.update_task = None
        
        logger.info("TorrentManager initialized")
    
    def _load_saved_torrents(self):
        """Load previously active torrents from the database"""
        try:
            with get_db() as db:
                # Use the model's new class method to find active torrents
                active_torrents = DbTorrent.find_active(db)
                
                for torrent in active_torrents:
                    if torrent.state != 'error':
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
                            # Update torrent state to error
                            torrent.update(db, state='error', error_message=str(e))
        except Exception as e:
            logger.error(f"Error loading saved torrents: {e}")
    
    def _save_resume_data(self, torrent_id: str, resume_data: bytes):
        """Save resume data for a torrent to the database"""
        try:
            with get_db() as db:
                torrent = DbTorrent.get_by_id(db, torrent_id)
                if torrent:
                    torrent.update(db, resume_data=resume_data)
        except Exception as e:
            logger.error(f"Error saving resume data for torrent {torrent_id}: {e}")
    
    def _add_torrent(self, torrent_id: str, magnet_uri: str, save_path: Path, 
                    metadata: Dict[str, Any], resume_data: Optional[bytes] = None) -> lt.torrent_handle:
        """Add a torrent to the libtorrent session"""
        try:
            params = {
                'save_path': str(save_path),
                'storage_mode': lt.storage_mode_t.storage_mode_sparse
            }
            
            # Try to use resume data if available
            if resume_data:
                handle = lt.add_torrent(self.session, params)
                handle.set_metadata(resume_data)
            else:
                handle = lt.add_magnet_uri(self.session, magnet_uri, params)
            
            # Enable sequential download
            handle.set_sequential_download(True)
            
            # Store the handle and metadata
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
                        ~DbTorrent.state.in_(['error', 'finished', 'stopped'])
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
                resume_data = alert.resume_data
                
                # Find the torrent_id for this handle
                for torrent_id, (handle, _) in self.active_torrents.items():
                    if handle == torrent_handle:
                        # Save resume data in a new session
                        with get_db() as db:
                            torrent = db.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
                            if torrent:
                                torrent.resume_data = lt.bencode(resume_data)
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
                state_value = alert.state.value
                
                # Map libtorrent state to our state names
                state_map = {
                    1: "checking",  # checking_files
                    2: "downloading_metadata",  # downloading_metadata
                    3: "downloading",  # downloading
                    4: "finished",  # finished
                    5: "seeding",  # seeding
                    6: "allocating",  # allocating
                    7: "checking"  # checking_resume_data
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
            save_path: Custom save path (defaults to settings.DEFAULT_DOWNLOAD_PATH/movie.title)
            
        Returns:
            torrent_id: Unique identifier for the torrent
        """
        # Create a unique ID for this torrent (reuse the one from the torrent model)
        torrent_id = torrent.id
        
        # Determine save path
        if save_path is None:
            save_path = settings.DEFAULT_DOWNLOAD_PATH / movie.title
        
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
                    meta_data=metadata
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

    # Improved get_torrent_status method 
    def get_torrent_status(self, torrent_id: str) -> Optional[TorrentStatus]:
        """Get the current status of a torrent"""
        try:
            # Use a dedicated session
            with get_db() as db:
                torrent = db.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
                if not torrent:
                    return None
                
                # Build status object
                status = TorrentStatus(
                    id=torrent.id,
                    movie_title=torrent.movie_title,
                    quality=torrent.quality,
                    state=TorrentState(torrent.state),
                    magnet=torrent.magnet,
                    progress=torrent.progress,
                    download_rate=torrent.meta_data.get('download_rate', 0.0) if torrent.meta_data else 0.0,
                    upload_rate=torrent.meta_data.get('upload_rate', 0.0) if torrent.meta_data else 0.0,
                    total_downloaded=torrent.meta_data.get('total_downloaded', 0) if torrent.meta_data else 0,
                    total_uploaded=torrent.meta_data.get('total_uploaded', 0) if torrent.meta_data else 0,
                    num_peers=torrent.meta_data.get('num_peers', 0) if torrent.meta_data else 0,
                    save_path=torrent.save_path,
                    created_at=torrent.created_at,
                    updated_at=torrent.updated_at,
                    eta=torrent.meta_data.get('eta') if torrent.meta_data else None,
                    error_message=torrent.error_message
                )
                
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

    # Improved get_all_torrents method
    def get_all_torrents(self) -> List[TorrentStatus]:
        """Get the status of all torrents"""
        try:
            results = []
            
            # Use a dedicated session
            with get_db() as db:
                # Get all torrents from the database
                torrents = db.query(DbTorrent).all()
                
                for torrent in torrents:
                    # Build status object
                    status = TorrentStatus(
                        id=torrent.id,
                        movie_title=torrent.movie_title,
                        quality=torrent.quality,
                        state=TorrentState(torrent.state),
                        magnet=torrent.magnet,
                        progress=torrent.progress,
                        download_rate=torrent.meta_data.get('download_rate', 0.0) if torrent.meta_data else 0.0,
                        upload_rate=torrent.meta_data.get('upload_rate', 0.0) if torrent.meta_data else 0.0,
                        total_downloaded=torrent.meta_data.get('total_downloaded', 0) if torrent.meta_data else 0,
                        total_uploaded=torrent.meta_data.get('total_uploaded', 0) if torrent.meta_data else 0,
                        num_peers=torrent.meta_data.get('num_peers', 0) if torrent.meta_data else 0,
                        save_path=torrent.save_path,
                        created_at=torrent.created_at,
                        updated_at=torrent.updated_at,
                        eta=torrent.meta_data.get('eta') if torrent.meta_data else None,
                        error_message=torrent.error_message
                    )
                    
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
    
    def pause_torrent(self, torrent_id: str) -> bool:
        """Pause a torrent download"""
        if torrent_id in self.active_torrents:
            handle, _ = self.active_torrents[torrent_id]
            handle.pause()
            
            with get_db() as db:
                torrent = DbTorrent.get_by_id(db, torrent_id)
                if torrent:
                    torrent.update(db, state='paused')
                    # Log pause action
                    torrent.add_log(
                        db,
                        message="Download paused",
                        level="INFO",
                        state='paused'
                    )
            
            logger.info(f"Paused torrent {torrent_id}")
            return True
        else:
            logger.warning(f"Torrent {torrent_id} not found in active torrents")
            return False
    
    def resume_torrent(self, torrent_id: str) -> bool:
        """Resume a paused torrent download"""
        if torrent_id in self.active_torrents:
            handle, _ = self.active_torrents[torrent_id]
            handle.resume()
            
            with get_db() as db:
                torrent = DbTorrent.get_by_id(db, torrent_id)
                if torrent:
                    torrent.update(db, state='downloading')
                    # Log resume action
                    torrent.add_log(
                        db,
                        message="Download resumed",
                        level="INFO",
                        state='downloading'
                    )
            
            logger.info(f"Resumed torrent {torrent_id}")
            return True
        else:
            # Check if it's in the database but not active
            try:
                with get_db() as db:
                    torrent: DbTorrent = db.query(DbTorrent).filter(
                        DbTorrent.id == torrent_id,
                        DbTorrent.state == 'paused'
                    ).first()
                    
                    if torrent:
                        # Add the torrent back to the session
                        handle = self._add_torrent(
                            torrent_id, 
                            torrent.magnet, 
                            Path(torrent.save_path), 
                            torrent.meta_data or {},
                            torrent.resume_data
                        )
                        handle.resume()
                        
                        torrent.update(db, state='downloading')
                        # Log resume action
                        torrent.add_log(
                            db,
                            message="Download re-added and resumed",
                            level="INFO",
                            state='downloading'
                        )
                        
                        logger.info(f"Re-added and resumed torrent {torrent_id}")
                        return True
                    else:
                        logger.warning(f"Torrent {torrent_id} not found or not paused")
                        return False
                    
            except Exception as e:
                logger.error(f"Error resuming torrent {torrent_id}: {e}")
                return False
        
        return False
    
    def stop_torrent(self, torrent_id: str) -> bool:
        """Stop a torrent download completely"""
        if torrent_id in self.active_torrents:
            handle, _ = self.active_torrents[torrent_id]
            
            # Request resume data before removing
            handle.save_resume_data()
            
            # Give a moment for the resume data alert to be processed
            time.sleep(0.5)
            
            # Remove the torrent (keep files)
            self.session.remove_torrent(handle)
            
            # Remove from active torrents
            self.active_torrents.pop(torrent_id)
            
            with get_db() as db:
                torrent = DbTorrent.get_by_id(db, torrent_id)
                if torrent:
                    torrent.update(db, state='stopped')
                    # Log stop action
                    torrent.add_log(
                        db,
                        message="Download stopped",
                        level="INFO",
                        state='stopped'
                    )
            
            logger.info(f"Stopped torrent {torrent_id}")
            return True
        else:
            logger.warning(f"Torrent {torrent_id} not found in active torrents")
            return False
    
    def remove_torrent(self, torrent_id: str, delete_files: bool = False) -> bool:
        """Remove a torrent and optionally delete downloaded files"""
        try:
            if torrent_id in self.active_torrents:
                handle, _ = self.active_torrents[torrent_id]
                
                # Remove the torrent
                self.session.remove_torrent(handle, 1 if delete_files else 0)
                
                # Remove from active torrents
                self.active_torrents.pop(torrent_id)
            
            # Remove from database
            with get_db() as db:
                torrent: DbTorrent = DbTorrent.get_by_id(db, torrent_id)
                if torrent:
                    # Log remove action before deleting
                    torrent.add_log(
                        db,
                        message=f"Torrent removed (files {'deleted' if delete_files else 'kept'})",
                        level="INFO"
                    )
                    if delete_files:
                        # Delete the torrent
                        torrent.delete(db)
            
            logger.info(f"Removed torrent {torrent_id} (delete_files={delete_files})")
            return True
        except Exception as e:
            logger.error(f"Error removing torrent {torrent_id}: {e}")
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
        
        # Give a moment for resume data alerts to be processed
        time.sleep(1)
        
        # Process any remaining alerts
        alerts = self.session.pop_alerts()
        for alert in alerts:
            self._handle_alert(alert)
                
    def prioritize_video_files(self, torrent_id: str) -> bool:
        """
        Set high priority for video files and enable sequential downloading
        for optimal streaming experience.
        
        Args:
            torrent_id: ID of the torrent to prioritize
            
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
            handle.set_sequential_download(True)
            
            # Find video files and set their priorities
            torrent_info = handle.get_torrent_info()
            file_priorities = []
            
            for i in range(torrent_info.num_files()):
                file_info = torrent_info.file_at(i)
                file_path = file_info.path
                
                # Check if it's a video file
                if self._is_video_file(file_path):
                    # Set highest priority (7) for video files
                    file_priorities.append(7)
                    logger.info(f"Setting high priority for video file: {file_path}")
                else:
                    # Set normal priority (1) for other files
                    file_priorities.append(1)
            
            # Apply priorities if any files found
            if file_priorities:
                handle.prioritize_files(file_priorities)
                logger.info(f"File priorities set for torrent {torrent_id}")
                
                with get_db() as db:
                    torrent: DbTorrent = db.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
                    if torrent:
                        # Update metadata to indicate streaming optimization
                        metadata = torrent.meta_data or {}
                        metadata['streaming_optimized'] = True
                        torrent.meta_data = metadata
                        torrent.update(db)
            
            return True
        
        except Exception as e:
            logger.error(f"Error setting file priorities for torrent {torrent_id}: {e}")
            return False

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

    def get_video_file_info(self, torrent_id: str) -> Optional[Dict[str, Any]]:
        """
        Get information about the main video file in a torrent
        
        Args:
            torrent_id: ID of the torrent
            
        Returns:
            Dict with video file information or None if not found
        """
        if torrent_id not in self.active_torrents:
            return None
        
        handle, _ = self.active_torrents[torrent_id]
        
        if not handle.has_metadata():
            return None
        
        try:
            torrent_info = handle.get_torrent_info()
            file_progress = handle.file_progress()
            
            # Find the largest video file
            largest_video_index = -1
            largest_video_size = 0
            
            for i in range(torrent_info.num_files()):
                file_info = torrent_info.file_at(i)
                
                if self._is_video_file(file_info.path) and file_info.size > largest_video_size:
                    largest_video_index = i
                    largest_video_size = file_info.size
            
            if largest_video_index >= 0 and largest_video_index < len(file_progress):
                file_info = torrent_info.file_at(largest_video_index)
                downloaded = file_progress[largest_video_index]
                progress = (downloaded / file_info.size) * 100 if file_info.size > 0 else 0
                
                # Get absolute path to the file
                base_path = Path(handle.status().save_path)
                file_path = base_path / file_info.path
                
                return {
                    "index": largest_video_index,
                    "path": str(file_path),
                    "size": file_info.size,
                    "downloaded": downloaded,
                    "progress": progress,
                    "name": Path(file_info.path).name
                }
            
            return None
        
        except Exception as e:
            logger.error(f"Error getting video file info for torrent {torrent_id}: {e}")
            return None


# Create a singleton instance
torrent_manager = TorrentManager()