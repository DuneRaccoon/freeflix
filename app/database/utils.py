from typing import Dict, Any, List, Optional
from datetime import datetime

from app.models import TorrentStatus, TorrentState, ScheduleResponse, ScheduleConfig, SearchParams

# These functions are kept for backward compatibility
# In the refactored approach, most functionality is moved to model methods

def to_dict(obj) -> Dict[str, Any]:
    """Convert SQLAlchemy model instance to dictionary."""
    if hasattr(obj, 'to_dict'):
        return obj.to_dict()
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}

def torrent_db_to_status(db_torrent) -> TorrentStatus:
    """Convert database Torrent model to TorrentStatus Pydantic model."""
    return db_torrent.to_status()

def schedule_db_to_response(db_schedule) -> ScheduleResponse:
    """Convert database Schedule model to ScheduleResponse Pydantic model."""
    return db_schedule.to_response()

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

# Additional utility functions that may be useful

def paginate(query, page: int = 1, per_page: int = 10):
    """Paginate a SQLAlchemy query."""
    return query.limit(per_page).offset((page - 1) * per_page).all()

def get_or_create(model, db, defaults=None, **kwargs):
    """Get an existing instance or create a new one."""
    instance = db.query(model).filter_by(**kwargs).first()
    if instance:
        return instance, False
    else:
        params = {**kwargs}
        if defaults:
            params.update(defaults)
        instance = model(**params)
        db.add(instance)
        db.commit()
        db.refresh(instance)
        return instance, True