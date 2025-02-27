from typing import TypeVar, Type, List, Dict, Any, Optional, Generic
from pydantic import BaseModel
from sqlalchemy.orm import Session
from datetime import datetime

from app.database.models import Torrent as DbTorrent
from app.database.models import TorrentLog as DbTorrentLog
from app.database.models import Schedule as DbSchedule
from app.database.models import ScheduleLog as DbScheduleLog
from app.database.models import MovieCache as DbMovieCache
from app.database.models import Setting as DbSetting
from app.models import TorrentStatus, TorrentState, ScheduleResponse, ScheduleConfig, SearchParams

T = TypeVar('T', bound=BaseModel)
M = TypeVar('M', bound=Any)

def to_dict(obj) -> Dict[str, Any]:
    """Convert SQLAlchemy model instance to dictionary."""
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}

def torrent_db_to_status(db_torrent: DbTorrent) -> TorrentStatus:
    """Convert database Torrent model to TorrentStatus Pydantic model."""
    # Extract metadata fields
    meta_data = db_torrent.meta_data or {}
    
    return TorrentStatus(
        id=db_torrent.id,
        movie_title=db_torrent.movie_title,
        quality=db_torrent.quality,
        state=TorrentState(db_torrent.state),
        progress=db_torrent.progress,
        download_rate=meta_data.get('download_rate', 0.0),
        upload_rate=meta_data.get('upload_rate', 0.0),
        total_downloaded=meta_data.get('total_downloaded', 0),
        total_uploaded=meta_data.get('total_uploaded', 0),
        num_peers=meta_data.get('num_peers', 0),
        save_path=db_torrent.save_path,
        created_at=db_torrent.created_at,
        updated_at=db_torrent.updated_at,
        eta=meta_data.get('eta'),
        error_message=db_torrent.error_message
    )

def schedule_db_to_response(db_schedule: DbSchedule) -> ScheduleResponse:
    """Convert database Schedule model to ScheduleResponse Pydantic model."""
    search_params = SearchParams(**db_schedule.search_params)
    
    return ScheduleResponse(
        id=db_schedule.id,
        name=db_schedule.name,
        config=ScheduleConfig(
            name=db_schedule.name,
            cron_expression=db_schedule.cron_expression,
            search_params=search_params,
            quality=db_schedule.quality,
            max_downloads=db_schedule.max_downloads,
            enabled=db_schedule.enabled
        ),
        next_run=db_schedule.next_run,
        last_run=db_schedule.last_run,
        status=db_schedule.last_run_status or "scheduled"
    )

def torrent_status_metadata(status: TorrentStatus) -> Dict[str, Any]:
    """Extract metadata fields from TorrentStatus for database storage."""
    return {
        'download_rate': status.download_rate,
        'upload_rate': status.upload_rate,
        'total_downloaded': status.total_downloaded,
        'total_uploaded': status.total_uploaded,
        'num_peers': status.num_peers,
        'eta': status.eta
    }