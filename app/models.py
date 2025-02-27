from pydantic import BaseModel, HttpUrl, Field, validator, ConfigDict
from typing import Optional, List, Tuple, Literal, Dict, Any
from datetime import datetime
from enum import Enum


class TorrentState(str, Enum):
    QUEUED = "queued"
    CHECKING = "checking"
    DOWNLOADING_METADATA = "downloading_metadata"
    DOWNLOADING = "downloading"
    FINISHED = "finished"
    SEEDING = "seeding"
    ALLOCATING = "allocating"
    CHECKING_FASTRESUME = "checking_fastresume"
    PAUSED = "paused"
    ERROR = "error"
    STOPPED = "stopped"


class Torrent(BaseModel):
    model_config = ConfigDict(
        allow_mutation=True,
        from_attributes=True,
    )
    
    id: str = Field(..., description="Unique identifier for the torrent")
    quality: str
    sizes: Tuple[str, str]
    url: HttpUrl
    magnet: str

class Movie(BaseModel):
    model_config = ConfigDict(
        allow_mutation=True,
        from_attributes=True,
    )
    
    title: str
    year: int
    rating: str
    link: HttpUrl
    genre: str
    img: HttpUrl
    description: Optional[str] = None
    torrents: List[Torrent]


class TorrentStatus(BaseModel):
    model_config = ConfigDict(
        allow_mutation=True,
        from_attributes=True,
    )
    
    id: str
    movie_title: str
    quality: str
    state: TorrentState
    progress: float = 0.0
    download_rate: float = 0.0  # kB/s
    upload_rate: float = 0.0    # kB/s
    total_downloaded: int = 0   # Bytes
    total_uploaded: int = 0     # Bytes
    num_peers: int = 0
    save_path: str
    created_at: datetime
    updated_at: datetime
    eta: Optional[int] = None   # Estimated seconds remaining
    error_message: Optional[str] = None


class TorrentRequest(BaseModel):
    movie_id: str
    quality: Literal['720p', '1080p', '2160p'] = '1080p'
    save_path: Optional[str] = None


class SearchParams(BaseModel):
    keyword: Optional[str] = None
    quality: Optional[str] = 'all'
    genre: Optional[str] = 'all'
    rating: Optional[int] = 0
    year: Optional[int] = None
    order_by: Optional[str] = 'featured'
    page: Optional[int] = 1


class TorrentAction(BaseModel):
    action: Literal['pause', 'resume', 'stop', 'remove']


class ScheduleConfig(BaseModel):
    model_config = ConfigDict(
        allow_mutation=True,
        from_attributes=True,
    )
    
    name: Optional[str] = None
    cron_expression: str
    search_params: SearchParams
    quality: Literal['720p', '1080p', '2160p'] = '1080p'
    max_downloads: int = 1
    enabled: bool = True


class ScheduleResponse(BaseModel):
    model_config = ConfigDict(
        allow_mutation=True,
        from_attributes=True,
    )
    
    id: str
    name: Optional[str] = None
    config: ScheduleConfig
    next_run: datetime
    last_run: Optional[datetime] = None
    status: str = "scheduled"


# Log models
class TorrentLogEntry(BaseModel):
    model_config = ConfigDict(
        allow_mutation=True,
        from_attributes=True,
    )
    
    id: str
    torrent_id: str
    timestamp: datetime
    message: str
    level: str
    state: Optional[str] = None
    progress: Optional[float] = None
    download_rate: Optional[float] = None


class ScheduleLogEntry(BaseModel):
    model_config = ConfigDict(
        allow_mutation=True,
        from_attributes=True,
    )
    
    id: str
    schedule_id: str
    execution_time: datetime
    status: str
    message: Optional[str] = None
    results: Optional[Dict[str, Any]] = None


# Settings model
class AppSetting(BaseModel):
    model_config = ConfigDict(
        allow_mutation=True,
        from_attributes=True,
    )
    
    key: str
    value: Any
    description: Optional[str] = None
    updated_at: datetime