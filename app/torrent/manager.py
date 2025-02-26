import libtorrent as lt
import asyncio
import time
import json
import uuid
import sqlite3
from datetime import datetime
from pathlib import Path
from loguru import logger
from typing import Dict, List, Optional, Any, Tuple
from torf import Magnet

from app.models import TorrentState, TorrentStatus, Movie, Torrent as TorrentModel
from app.config import settings


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
        })
        
        # Try to load the resume data
        settings.RESUME_DATA_PATH.mkdir(parents=True, exist_ok=True)
        
        # Dictionary to store active torrents: {torrent_id: (handle, metadata)}
        self.active_torrents: Dict[str, Tuple[lt.torrent_handle, Dict[str, Any]]] = {}
        
        # Initialize the SQLite database for persistent storage
        self._init_db()
        
        # Load any previously active torrents
        self._load_saved_torrents()
        
        # Background task to update torrent status
        self.update_task = None
        
        logger.info("TorrentManager initialized")
    
    def _init_db(self):
        """Initialize the SQLite database for torrent status storage"""
        try:
            # Create parent directory if it doesn't exist
            settings.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
            
            # Connect to the database
            conn = sqlite3.connect(settings.DB_PATH)
            cursor = conn.cursor()
            
            # Create the torrents table if it doesn't exist
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS torrents (
                id TEXT PRIMARY KEY,
                movie_title TEXT NOT NULL,
                quality TEXT NOT NULL,
                magnet TEXT NOT NULL,
                save_path TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                state TEXT NOT NULL,
                progress REAL DEFAULT 0.0,
                resume_data BLOB,
                metadata JSON
            )
            ''')
            
            conn.commit()
            conn.close()
            logger.info(f"Database initialized at {settings.DB_PATH}")
        except Exception as e:
            logger.error(f"Error initializing database: {e}")
    
    def _load_saved_torrents(self):
        """Load previously active torrents from the database"""
        try:
            conn = sqlite3.connect(settings.DB_PATH)
            cursor = conn.cursor()
            
            cursor.execute('''
            SELECT id, movie_title, quality, magnet, save_path, state, resume_data, metadata
            FROM torrents
            WHERE state NOT IN ('finished', 'error')
            ''')
            
            rows = cursor.fetchall()
            conn.close()
            
            for row in rows:
                torrent_id, movie_title, quality, magnet, save_path, state, resume_data, metadata = row
                if state != 'error':
                    try:
                        metadata_dict = json.loads(metadata) if metadata else {}
                        self._add_torrent(torrent_id, magnet, Path(save_path), metadata_dict, resume_data)
                        logger.info(f"Loaded torrent {torrent_id} - {movie_title} ({quality})")
                    except Exception as e:
                        logger.error(f"Error loading torrent {torrent_id}: {e}")
                        self._update_torrent_in_db(torrent_id, {'state': 'error', 'error_message': str(e)})
        except Exception as e:
            logger.error(f"Error loading saved torrents: {e}")
    
    def _update_torrent_in_db(self, torrent_id: str, update_data: Dict[str, Any]):
        """Update torrent information in the database"""
        try:
            conn = sqlite3.connect(settings.DB_PATH)
            cursor = conn.cursor()
            
            # Prepare the update statement based on the provided data
            set_clause = ", ".join([f"{k} = ?" for k in update_data.keys()])
            values = list(update_data.values())
            
            # Add updated_at timestamp
            set_clause += ", updated_at = ?"
            values.append(datetime.now().isoformat())
            
            # Execute the update
            cursor.execute(f"UPDATE torrents SET {set_clause} WHERE id = ?", values + [torrent_id])
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"Error updating torrent {torrent_id} in database: {e}")
    
    def _save_resume_data(self, torrent_id: str, resume_data: bytes):
        """Save resume data for a torrent to the database"""
        self._update_torrent_in_db(torrent_id, {'resume_data': resume_data})
    
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
            try:
                # Process libtorrent alerts
                alerts = self.session.pop_alerts()
                for alert in alerts:
                    self._handle_alert(alert)
                
                # Update status for all active torrents
                for torrent_id, (handle, metadata) in list(self.active_torrents.items()):
                    try:
                        status = handle.status()
                        state_str = [
                            "queued", 
                            "checking", 
                            "downloading_metadata", 
                            "downloading", 
                            "finished", 
                            "seeding", 
                            "allocating", 
                            "checking_fastresume"
                        ][status.state]
                        
                        # Update progress in database
                        self._update_torrent_in_db(torrent_id, {
                            'state': state_str,
                            'progress': status.progress * 100
                        })
                        
                        # Log status periodically
                        if torrent_id not in getattr(self, '_last_logged', {}):
                            self._last_logged = getattr(self, '_last_logged', {})
                            self._last_logged[torrent_id] = 0
                        
                        current_time = time.time()
                        if current_time - self._last_logged.get(torrent_id, 0) > 30:  # Log every 30 seconds
                            if handle.has_metadata():
                                torrent_info = handle.get_torrent_info()
                                logger.info(f"Torrent {torrent_id}: {torrent_info.name()} - "
                                            f"{status.progress * 100:.2f}% complete ({state_str}) - "
                                            f"{status.download_rate / 1000:.2f} kB/s")
                            else:
                                logger.info(f"Torrent {torrent_id}: Downloading metadata - "
                                            f"{status.download_rate / 1000:.2f} kB/s")
                            self._last_logged[torrent_id] = current_time
                        
                        # If download is finished, update the state
                        if status.state == lt.torrent_status.finished:
                            logger.info(f"Torrent {torrent_id} finished downloading")
                            self._update_torrent_in_db(torrent_id, {'state': 'finished'})
                        
                        # If seeding, calculate seed time and potentially stop seeding
                        if status.state == lt.torrent_status.seeding:
                            # TODO: Implement seeding limits based on ratio or time
                            pass
                    
                    except Exception as e:
                        logger.error(f"Error updating status for torrent {torrent_id}: {e}")
                        self._update_torrent_in_db(torrent_id, {
                            'state': 'error',
                            'error_message': str(e)
                        })
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
    
    def _handle_alert(self, alert):
        """Handle libtorrent alerts"""
        # Handle different types of alerts
        if isinstance(alert, lt.torrent_finished_alert):
            torrent_handle = alert.handle
            # Find the torrent_id for this handle
            for torrent_id, (handle, _) in self.active_torrents.items():
                if handle == torrent_handle:
                    logger.info(f"Torrent {torrent_id} finished downloading")
                    self._update_torrent_in_db(torrent_id, {'state': 'finished'})
                    break
        
        elif isinstance(alert, lt.save_resume_data_alert):
            torrent_handle = alert.handle
            resume_data = alert.resume_data
            
            # Find the torrent_id for this handle
            for torrent_id, (handle, _) in self.active_torrents.items():
                if handle == torrent_handle:
                    self._save_resume_data(torrent_id, lt.bencode(resume_data))
                    break
        
        elif isinstance(alert, lt.torrent_error_alert):
            torrent_handle = alert.handle
            error_message = alert.message()
            
            # Find the torrent_id for this handle
            for torrent_id, (handle, _) in self.active_torrents.items():
                if handle == torrent_handle:
                    logger.error(f"Torrent error for {torrent_id}: {error_message}")
                    self._update_torrent_in_db(torrent_id, {
                        'state': 'error',
                        'error_message': error_message
                    })
                    break
    
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
        # Create a unique ID for this torrent
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
        
        # Store torrent in database
        try:
            conn = sqlite3.connect(settings.DB_PATH)
            cursor = conn.cursor()
            
            cursor.execute('''
            INSERT INTO torrents 
            (id, movie_title, quality, magnet, save_path, created_at, updated_at, state, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                torrent_id, 
                movie.title, 
                torrent.quality, 
                torrent.magnet, 
                str(save_path),
                datetime.now().isoformat(),
                datetime.now().isoformat(),
                'queued',
                json.dumps(metadata)
            ))
            
            conn.commit()
            conn.close()
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
            self._update_torrent_in_db(torrent_id, {
                'state': 'error',
                'error_message': str(e)
            })
            raise
    
    def pause_torrent(self, torrent_id: str) -> bool:
        """Pause a torrent download"""
        if torrent_id in self.active_torrents:
            handle, _ = self.active_torrents[torrent_id]
            handle.pause()
            self._update_torrent_in_db(torrent_id, {'state': 'paused'})
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
            self._update_torrent_in_db(torrent_id, {'state': 'downloading'})
            logger.info(f"Resumed torrent {torrent_id}")
            return True
        else:
            # Check if it's in the database but not active
            try:
                conn = sqlite3.connect(settings.DB_PATH)
                cursor = conn.cursor()
                
                cursor.execute('''
                SELECT magnet, save_path, metadata, resume_data
                FROM torrents
                WHERE id = ? AND state = 'paused'
                ''', (torrent_id,))
                
                row = cursor.fetchone()
                conn.close()
                
                if row:
                    magnet, save_path, metadata_json, resume_data = row
                    metadata = json.loads(metadata_json) if metadata_json else {}
                    
                    # Add the torrent back to the session
                    handle = self._add_torrent(
                        torrent_id, magnet, Path(save_path), metadata, resume_data
                    )
                    handle.resume()
                    
                    self._update_torrent_in_db(torrent_id, {'state': 'downloading'})
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
            
            self._update_torrent_in_db(torrent_id, {'state': 'stopped'})
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
            conn = sqlite3.connect(settings.DB_PATH)
            cursor = conn.cursor()
            
            cursor.execute("DELETE FROM torrents WHERE id = ?", (torrent_id,))
            
            conn.commit()
            conn.close()
            
            logger.info(f"Removed torrent {torrent_id}")
            return True
        except Exception as e:
            logger.error(f"Error removing torrent {torrent_id}: {e}")
            return False
    
    def get_torrent_status(self, torrent_id: str) -> Optional[TorrentStatus]:
        """Get the current status of a torrent"""
        try:
            conn = sqlite3.connect(settings.DB_PATH)
            cursor = conn.cursor()
            
            cursor.execute('''
            SELECT movie_title, quality, save_path, created_at, updated_at, state, progress, metadata
            FROM torrents
            WHERE id = ?
            ''', (torrent_id,))
            
            row = cursor.fetchone()
            conn.close()
            
            if not row:
                return None
            
            movie_title, quality, save_path, created_at, updated_at, state, progress, metadata_json = row
            metadata = json.loads(metadata_json) if metadata_json else {}
            
            # Get real-time status if the torrent is active
            download_rate = 0.0
            upload_rate = 0.0
            num_peers = 0
            eta = None
            error_message = metadata.get('error_message')
            
            if torrent_id in self.active_torrents:
                handle, _ = self.active_torrents[torrent_id]
                status = handle.status()
                
                download_rate = status.download_rate / 1000  # B/s to kB/s
                upload_rate = status.upload_rate / 1000  # B/s to kB/s
                num_peers = status.num_peers
                
                # Calculate ETA if downloading
                if state == 'downloading' and status.download_rate > 0:
                    total_size = status.total_wanted
                    downloaded = status.total_wanted_done
                    remaining = total_size - downloaded
                    eta = int(remaining / status.download_rate)
            
            return TorrentStatus(
                id=torrent_id,
                movie_title=movie_title,
                quality=quality,
                state=TorrentState(state),
                progress=progress,
                download_rate=download_rate,
                upload_rate=upload_rate,
                total_downloaded=0,  # TODO: Get from handle
                total_uploaded=0,    # TODO: Get from handle
                num_peers=num_peers,
                save_path=save_path,
                created_at=datetime.fromisoformat(created_at),
                updated_at=datetime.fromisoformat(updated_at),
                eta=eta,
                error_message=error_message
            )
        except Exception as e:
            logger.error(f"Error getting status for torrent {torrent_id}: {e}")
            return None
    
    def get_all_torrents(self) -> List[TorrentStatus]:
        """Get the status of all torrents"""
        try:
            conn = sqlite3.connect(settings.DB_PATH)
            cursor = conn.cursor()
            
            cursor.execute('''
            SELECT id, movie_title, quality, save_path, created_at, updated_at, state, progress, metadata
            FROM torrents
            ''')
            
            rows = cursor.fetchall()
            conn.close()
            
            results = []
            for row in rows:
                torrent_id, movie_title, quality, save_path, created_at, updated_at, state, progress, metadata_json = row
                metadata = json.loads(metadata_json) if metadata_json else {}
                
                download_rate = 0.0
                upload_rate = 0.0
                num_peers = 0
                eta = None
                error_message = metadata.get('error_message')
                
                if torrent_id in self.active_torrents:
                    handle, _ = self.active_torrents[torrent_id]
                    status = handle.status()
                    
                    download_rate = status.download_rate / 1000  # B/s to kB/s
                    upload_rate = status.upload_rate / 1000  # B/s to kB/s
                    num_peers = status.num_peers
                    
                    # Calculate ETA if downloading
                    if state == 'downloading' and status.download_rate > 0:
                        total_size = status.total_wanted
                        downloaded = status.total_wanted_done
                        remaining = total_size - downloaded
                        eta = int(remaining / status.download_rate)
                
                results.append(TorrentStatus(
                    id=torrent_id,
                    movie_title=movie_title,
                    quality=quality,
                    state=TorrentState(state),
                    progress=progress,
                    download_rate=download_rate,
                    upload_rate=upload_rate,
                    total_downloaded=0,  # TODO: Get from handle
                    total_uploaded=0,    # TODO: Get from handle
                    num_peers=num_peers,
                    save_path=save_path,
                    created_at=datetime.fromisoformat(created_at),
                    updated_at=datetime.fromisoformat(updated_at),
                    eta=eta,
                    error_message=error_message
                ))
            
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
                self._update_torrent_in_db(torrent_id, {'state': 'paused'})
            except Exception as e:
                logger.error(f"Error saving resume data for torrent {torrent_id}: {e}")
        
        # Give a moment for resume data alerts to be processed
        time.sleep(1)
        
        # Process any remaining alerts
        alerts = self.session.pop_alerts()
        for alert in alerts:
            self._handle_alert(alert)


# Create a singleton instance
torrent_manager = TorrentManager()