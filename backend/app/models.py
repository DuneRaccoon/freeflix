from pydantic import BaseModel, HttpUrl, Field, validator, ConfigDict
from typing import Optional, List, Tuple, Literal, Dict, Union, Any
from datetime import datetime
from enum import Enum
from uuid import UUID

class ReviewSource(str, Enum):
    IMDB = "IMDB"
    ROTTEN_TOMATOES = "Rotten Tomatoes"
    ROTTEN_TOMATOES_CRITIC = "Rotten Tomatoes - Critic"
    ROTTEN_TOMATOES_AUDIENCE = "Rotten Tomatoes - Audience"
    METACRITIC = "Metacritic"

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

OrderByLiteral = Literal[
    'latest',
    'oldest',
    'featured',
    'year',
    'rating',
    'likes',
    'alphabetical'
]

GenreLiteral = Literal[
    "all",
    "action",
    "adventure",
    "animation",
    "biography",
    "comedy",
    "crime",
    "documentary",
    "drama",
    "family",
    "fantasy",
    "film-noir",
    "game-show",
    "history",
    "horror",
    "music",
    "musical",
    "mystery",
    "news",
    "reality-tv",
    "romance",
    "sci-fi",
    "sport",
    "talk-show",
    "thriller",
    "war",
    "western"
]

QualityLiteral = Literal['all', '720p', '1080p', '2160p', '3d']
RatingLiteral = Literal['all', '9', '8', '7', '6', '5', '4', '3', '2', '1']
YearLiteral = Literal[
    "all",
    "2025",
    "2024",
    "2023",
    "2022",
    "2021",
    "2020",
    "2019",
    "2018",
    "2017",
    "2016",
    "2015",
    "2014",
    "2013",
    "2012",
    "2011",
    "2010",
    "2000-2009",
    "1990-1999",
    "1980-1989",
    "1970-1979",
    "1950-1969",
    "1900-1949"
]

class SearchParams(BaseModel):
    keyword: Optional[str] = None
    quality: Optional[QualityLiteral] = 'all'
    genre: Optional[GenreLiteral] = 'all'
    rating: Optional[RatingLiteral] = 'all'
    year: Optional[YearLiteral] = None
    order_by: Optional[OrderByLiteral] = 'featured'
    page: Optional[int] = 1
    limit: Optional[int] = 20

class Torrent(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
    )
    
    id: str = Field(..., description="Unique identifier for the torrent")
    quality: str
    sizes: Tuple[str, str]
    url: HttpUrl
    magnet: str

class Movie(BaseModel):
    model_config = ConfigDict(
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

class MovieRating(BaseModel):
    imdb: Optional[str] = None
    imdbVotes: Optional[Union[str, int]] = None
    rottenTomatoes: Optional[str] = None
    rottenTomatoesCount: Optional[Union[str, int]] = None
    rottenTomatoesAudience: Optional[str] = None
    rottenTomatoesAudienceCount: Optional[Union[str, int]] = None
    metacritic: Optional[str] = None
    metacriticCount: Optional[Union[str, int]] = None

class CastMember(BaseModel):
    name: str
    character: Optional[str] = None
    image: Optional[str] = None


class CatalogItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tmdb_id: int
    media_type: Literal['movie', 'tv'] = 'movie'
    title: str
    year: Optional[int] = None
    overview: Optional[str] = None
    poster_url: Optional[str] = None
    backdrop_url: Optional[str] = None
    genre_ids: List[int] = []
    genres: List[str] = []
    vote_average: float = 0.0
    vote_count: int = 0
    popularity: float = 0.0
    original_language: Optional[str] = None


class MovieDetail(CatalogItem):
    runtime: Optional[int] = None
    imdb_id: Optional[str] = None
    tagline: Optional[str] = None
    cast: List[CastMember] = []
    director: Optional[str] = None
    available_qualities: List[str] = []


class TorrentHit(BaseModel):
    title: str
    seeds: int = 0
    peers: int = 0
    bytes: int = 0
    magnet: str
    hash: str = ''
    source: Optional[str] = None
    quality: Optional[str] = None


class CatalogPage(BaseModel):
    page: int = 1
    results: List[CatalogItem] = []
    total_pages: int = 0
    total_results: int = 0


class RailSpec(BaseModel):
    key: str
    title: str
    eyebrow: Optional[str] = None
    variant: Literal['poster', 'ranked'] = 'poster'
    params: Dict[str, Any] = {}
    see_all_href: Optional[str] = None


class RailsResponse(BaseModel):
    rails: List[RailSpec] = []


class SeasonSummary(BaseModel):
    season_number: int
    name: str = ""
    episode_count: int = 0
    overview: Optional[str] = None
    poster_url: Optional[str] = None
    air_date: Optional[str] = None


class Episode(BaseModel):
    episode_number: int
    name: str = ""
    overview: Optional[str] = None
    runtime: Optional[int] = None
    still_url: Optional[str] = None
    air_date: Optional[str] = None
    vote_average: float = 0.0


class ShowDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tmdb_id: int
    media_type: Literal['tv'] = 'tv'
    name: str
    year: Optional[int] = None
    overview: Optional[str] = None
    poster_url: Optional[str] = None
    backdrop_url: Optional[str] = None
    genres: List[str] = []
    status: Optional[str] = None
    first_air_date: Optional[str] = None
    last_air_date: Optional[str] = None
    number_of_seasons: int = 0
    vote_average: float = 0.0
    vote_count: int = 0
    seasons: List[SeasonSummary] = []


class SeasonDetail(BaseModel):
    season_number: int
    name: str = ""
    overview: Optional[str] = None
    episodes: List[Episode] = []


class VideoFile(BaseModel):
    index: int
    name: str
    size: int
    downloaded: int = 0
    progress: float = 0.0
    mime_type: str
    stream_url: str
    season: Optional[int] = None
    episode: Optional[int] = None


class MovieCredits(BaseModel):
    director: Optional[str] = None
    cast: List[CastMember] = []

class MovieMedia(BaseModel):
    poster: Optional[str] = None
    backdrop: Optional[str] = None
    trailer: Optional[str] = None

class Review(BaseModel):
    source: ReviewSource
    author: Optional[str] = None
    content: str
    rating: Optional[str] = None
    url: Optional[str] = None
    date: Optional[datetime] = None
    
class RelatedMovie(BaseModel):
    title: str
    url: HttpUrl
    image: Optional[str] = None
    critic_score: Optional[int] = None
    audience_score: Optional[int] = None
    

class DetailedMovie(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
    )
    
    # Basic movie info from YTS
    id: str
    title: str
    year: int
    rating: str
    link: HttpUrl
    genre: str
    img: HttpUrl
    description: Optional[str] = None
    torrents: List[Torrent]
    
    # Extended movie details
    imdb_id: Optional[str] = None
    plot: Optional[str] = None
    runtime: Optional[str] = None
    language: Optional[str] = None
    country: Optional[str] = None
    awards: Optional[str] = None
    
    # Organized nested data
    ratings: MovieRating = MovieRating()
    credits: MovieCredits = MovieCredits()
    media: MovieMedia = MovieMedia()
    reviews: List[Review] = []
    related_movies: List[RelatedMovie] = []

class TorrentStatus(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
    )
    
    id: str
    movie_title: str
    quality: str
    state: TorrentState
    magnet: Optional[str] = None
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
    tmdb_id: int
    quality: Literal['720p', '1080p', '2160p'] = '1080p'
    save_path: Optional[str] = None
    media_type: Literal['movie', 'tv'] = 'movie'
    season: Optional[int] = Field(None, ge=0)
    episode: Optional[int] = Field(None, ge=1)

class TorrentAction(BaseModel):
    # 'stop' is accepted as a legacy alias of 'pause'. Use DELETE to remove.
    action: Literal['pause', 'resume', 'stop']


class TorrentBatchAction(BaseModel):
    action: Literal['pause', 'resume', 'clear_completed', 'retry']
    delete_files: bool = False


class TorrentBatchResult(BaseModel):
    id: str
    success: bool


class TorrentBatchResponse(BaseModel):
    action: str
    succeeded: int
    failed: int
    results: List[TorrentBatchResult]


class ScheduleConfig(BaseModel):
    model_config = ConfigDict(
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
        from_attributes=True,
    )
    
    key: str
    value: Any
    description: Optional[str] = None
    updated_at: datetime
    
    
# User models
class UserCreate(BaseModel):
    username: str
    display_name: str
    avatar: str = None

class UserUpdate(BaseModel):
    display_name: str = None
    avatar: str = None

class UserSettingsModel(BaseModel):
    maturity_restriction: str = "none"
    require_passcode: bool = False
    passcode: Optional[str] = None
    theme: str = "dark"
    default_quality: Literal['720p', '1080p', '2160p'] = "1080p"
    download_path: Optional[str] = None

class UserResponse(BaseModel):
    id: UUID
    username: str
    display_name: str
    avatar: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    settings: UserSettingsModel

class UserSettingsResponse(BaseModel):
    id: str
    user_id: str
    maturity_restriction: str
    require_passcode: bool
    theme: str
    default_quality: Literal['720p', '1080p', '2160p']
    download_path: Optional[str] = None


# Streaming models
class StreamingProgressCreate(BaseModel):
    torrent_id: str
    movie_id: str
    current_time: float
    duration: Optional[float] = None
    percentage: float
    completed: bool = False
    file_index: Optional[int] = None
    title: Optional[str] = None

class StreamingProgressUpdate(BaseModel):
    current_time: float
    duration: Optional[float] = None
    percentage: float
    completed: bool = False

class StreamingProgressResponse(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
    )

    id: str
    user_id: str
    torrent_id: Optional[str] = None  # NULL after the torrent is removed (FK ON DELETE SET NULL); history survives
    movie_id: str
    current_time: float
    duration: Optional[float] = None
    percentage: float
    completed: bool
    last_watched_at: datetime
    created_at: datetime
    updated_at: datetime
    file_index: Optional[int] = None
    title: Optional[str] = None


# Watchlist models
class WatchlistItemCreate(BaseModel):
    content_id: str
    tmdb_id: str
    media_type: str   # "movie" | "tv"
    title: Optional[str] = None
    poster_url: Optional[str] = None
    year: Optional[int] = None
    vote_average: Optional[float] = None


class WatchlistItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    content_id: str
    tmdb_id: str
    media_type: str
    title: Optional[str] = None
    poster_url: Optional[str] = None
    year: Optional[int] = None
    vote_average: Optional[float] = None
    added_at: datetime
    created_at: datetime


class WatchlistItemUpdate(BaseModel):
    title: Optional[str] = None
    poster_url: Optional[str] = None
    year: Optional[int] = None
    vote_average: Optional[float] = None


# Activity models
class ActivityCountResponse(BaseModel):
    """Active-download summary returned by GET /api/v1/activity/count."""
    active_downloads: int
    aggregate_progress: float  # 0.0–100.0, mean progress across active torrents
    max_active_downloads: int  # configured concurrent-download ceiling (ARM-capped)
