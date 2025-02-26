from pydantic import BaseModel, HttpUrl, Field, validator
from typing import Dict, List, Optional, Any, Tuple, Literal, Union
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


class TorrentBase(BaseModel):
    id: str = Field(..., description="Unique identifier for the torrent")
    quality: str
    sizes: Tuple[str, str]
    url: HttpUrl
    magnet: str


class Torrent(TorrentBase):
    class Config:
        orm_mode = True


class MovieBase(BaseModel):
    title: str
    year: int
    rating: str
    link: HttpUrl
    genre: str
    img: HttpUrl
    description: Optional[str] = None


class Movie(MovieBase):
    torrents: List[Torrent]

    class Config:
        orm_mode = True


class TorrentStatusBase(BaseModel):
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


class TorrentStatus(TorrentStatusBase):
    class Config:
        orm_mode = True


class TorrentLogBase(BaseModel):
    torrent_id: str
    timestamp: datetime
    message: str
    level: str
    state: Optional[str] = None
    progress: Optional[float] = None
    download_rate: Optional[float] = None


class TorrentLog(TorrentLogBase):
    id: str

    class Config:
        orm_mode = True


class TorrentRequestBase(BaseModel):
    movie_id: str
    quality: Literal['720p', '1080p', '2160p'] = '1080p'
    save_path: Optional[str] = None


class TorrentRequest(TorrentRequestBase):
    pass


class TorrentActionBase(BaseModel):
    action: Literal['pause', 'resume', 'stop', 'remove']


class TorrentAction(TorrentActionBase):
    pass


class SearchParamsBase(BaseModel):
    keyword: Optional[str] = None
    quality: Optional[str] = 'all'
    genre: Optional[str] = 'all'
    rating: Optional[int] = 0
    year: Optional[int] = None
    order_by: Optional[str] = 'featured'
    page: Optional[int] = 1


class SearchParams(SearchParamsBase):
    pass


class ScheduleConfigBase(BaseModel):
    name: Optional[str] = None
    cron_expression: str
    search_params: SearchParams
    quality: Literal['720p', '1080p', '2160p'] = '1080p'
    max_downloads: int = 1
    enabled: bool = True


class ScheduleConfig(ScheduleConfigBase):
    class Config:
        orm_mode = True


class ScheduleResponseBase(BaseModel):
    id: str
    name: Optional[str] = None
    config: ScheduleConfig
    next_run: datetime
    last_run: Optional[datetime] = None
    status: str = "scheduled"


class ScheduleResponse(ScheduleResponseBase):
    class Config:
        orm_mode = True


class ScheduleLogBase(BaseModel):
    schedule_id: str
    execution_time: datetime
    status: str
    message: Optional[str] = None
    results: Optional[Dict[str, Any]] = None


class ScheduleLog(ScheduleLogBase):
    id: str

    class Config:
        orm_mode = True


class SettingBase(BaseModel):
    key: str
    value: Any
    description: Optional[str] = None


class Setting(SettingBase):
    updated_at: datetime

    class Config:
        orm_mode = True


class MovieCacheBase(BaseModel):
    title: str
    year: int
    link: HttpUrl
    rating: str
    genre: str
    img: HttpUrl
    torrents_json: List[Dict[str, Any]]
    fetched_at: datetime
    expires_at: datetime


class MovieCache(MovieCacheBase):
    id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True
