# Database package initialization
# This file makes it easier to import database components

from app.database.session import get_db, init_db, Base, engine, SessionLocal
from app.database.mixins import Model, CRUDMixin, generate_uuid, camel_to_snake_case
from app.database.models import (
    Torrent, 
    TorrentLog, 
    Schedule, 
    ScheduleLog, 
    MovieCache, 
    Setting,
    User,
    UserSettings,
    UserStreamingProgress
)
from app.database.utils import (
    to_dict,
    torrent_db_to_status,
    schedule_db_to_response,
    torrent_status_metadata,
    paginate,
    get_or_create
)

__all__ = [
    # Session components
    'get_db',
    'init_db',
    'Base',
    'engine',
    'SessionLocal',
    
    # Base models and mixins
    'Model',
    'CRUDMixin',
    'generate_uuid',
    'camel_to_snake_case',
    
    # Models
    'Torrent',
    'TorrentLog',
    'Schedule',
    'ScheduleLog',
    'MovieCache',
    'Setting',
    'User',
    'UserSettings',
    'UserStreamingProgress',
    
    # Utils
    'to_dict',
    'torrent_db_to_status',
    'schedule_db_to_response',
    'torrent_status_metadata',
    'paginate',
    'get_or_create'
]