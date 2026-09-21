import re
from pydantic import BaseModel, HttpUrl, Field, validator, ConfigDict, AfterValidator
from typing import Optional, List, Tuple, Literal, Dict, Union, Any, Annotated
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
    BLOCKED = "blocked"

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
    # The raw TMDB path (e.g. "/abc123.jpg"). The avatar picker sends THIS, not
    # `image`, so the backend builds the URL it fetches and the client never
    # chooses a host.
    profile_path: Optional[str] = None


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


class TorrentCandidate(BaseModel):
    """A ranked, health-classified torrent option surfaced to the UI / picker."""
    source_id: str          # stable id, prefer infohash; fallback to a hash of the magnet
    magnet: str
    quality: str            # "2160p"|"1080p"|"720p"|"480p"|""
    seeds: int
    peers: int
    bytes: int
    health: str             # "healthy"|"low"|"dead"
    is_season_pack: bool
    release_title: str


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
    block_reason: Optional[str] = None   # set when state == 'blocked' (content guard)
    chosen_quality: Optional[str] = None  # quality actually selected (after any downgrade)


class TorrentRequest(BaseModel):
    tmdb_id: int
    quality: Literal['720p', '1080p', '2160p'] = '1080p'
    save_path: Optional[str] = None
    media_type: Literal['movie', 'tv'] = 'movie'
    season: Optional[int] = Field(None, ge=0)
    episode: Optional[int] = Field(None, ge=1)
    # Explicit user choice from the source picker (WS1/WS2). When set, it overrides
    # the server's ranked top pick. `magnet` wins over `source_id` if both are given.
    magnet: Optional[str] = None
    source_id: Optional[str] = None

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
    
    
# ─── Profile models ──────────────────────────────────────────────────────────
# The storage layer still calls these "users" (the table cannot be renamed — five FK
# constraints point at users.id and there is no migration framework), but since the
# instance-claim work a row means a PROFILE owned by an Account.

# Mirrors frontend/src/lib/avatars/resolve.ts. Shape only — membership is not
# checked here, because the catalog is a frontend concern and an unknown but
# well-formed id already degrades to a monogram at render time.
_AVATAR_RE = re.compile(
    r"house:[a-z0-9][a-z0-9-]{0,63}"
    r"|cached:[a-f0-9]{8,64}"
    r"|/avatars/avatar[1-8]\.svg"
)


def _check_avatar(v: str) -> str:
    # "" is a legitimate value: it CLEARS the avatar (see api/users.py:221-223).
    if v == "":
        return v
    if len(v) > 128 or not _AVATAR_RE.fullmatch(v):
        raise ValueError("invalid avatar reference")
    return v


# The legacy /avatars/avatarN.svg spelling is accepted on WRITE so that a client
# running stale JS through a deploy cannot 422 its own profile save. New code
# never mints it; the frontend resolver maps it on read.
AvatarValue = Annotated[str, AfterValidator(_check_avatar)]


class UserCreate(BaseModel):
    # `username` is generated server-side now. The old client-side generator
    # (`slug-${Date.now()...}`) could collide against the instance-global UNIQUE
    # constraint and surfaced only as a generic "could not create profile" toast.
    display_name: str
    avatar: Optional[AvatarValue] = None

class UserUpdate(BaseModel):
    display_name: Optional[str] = None
    avatar: Optional[AvatarValue] = None

class UserSettingsUpdate(BaseModel):
    """Request body for PUT /users/{id}/settings.

    `passcode` is WRITE-ONLY: it is hashed on arrival and never appears in any
    response. Send an empty string to clear it.
    """
    maturity_restriction: Optional[str] = None
    require_passcode: Optional[bool] = None
    passcode: Optional[str] = None
    theme: Optional[str] = None
    default_quality: Optional[Literal['720p', '1080p', '2160p']] = None
    download_path: Optional[str] = None

class UserSettingsResponse(BaseModel):
    """Never carries the passcode.

    The previous shape leaked every profile's PLAINTEXT passcode through
    `UserResponse.settings` on `GET /users` and `GET /users/{id}`. `has_passcode` and
    `passcode_len` are all the keypad needs (it draws that many dots and auto-submits
    on the last digit); the code itself is verified server-side by POST
    /users/{id}/unlock.
    """
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    maturity_restriction: str = "none"
    require_passcode: bool = False
    has_passcode: bool = False
    passcode_len: Optional[int] = None
    theme: str = "dark"
    default_quality: Literal['720p', '1080p', '2160p'] = "1080p"
    download_path: Optional[str] = None

class UserResponse(BaseModel):
    # `id` is a plain str, not UUID: the column is `Column(String, primary_key=True)`
    # and a seeded or non-uuid id would 500 at serialization time under UUID.
    id: str
    username: str
    display_name: str
    avatar: Optional[str] = None
    account_id: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    settings: UserSettingsResponse

class PasscodeUnlockRequest(BaseModel):
    passcode: str

class PasscodeUnlockResponse(BaseModel):
    ok: bool


# ─── Instance claim / auth models ────────────────────────────────────────────

class InstanceStatusResponse(BaseModel):
    """Public. Drives the frontend's boot decision; never leaks the claim code."""
    claimed: bool
    needs_claim: bool
    instance_name: Optional[str] = None
    claimed_at: Optional[datetime] = None

class ClaimRequest(BaseModel):
    claim_code: str
    email: str
    # The owner signs in with a password; members are magic-link only. It is chosen here,
    # at claim time, but only takes effect once the emailed link proves the address.
    password: str

class ClaimResponse(BaseModel):
    sent: bool
    delivered: bool = False
    # Populated only when no mail provider is configured, so a self-hosted operator
    # can still finish the claim. Never populated once Resend is wired up.
    action_url: Optional[str] = None

class MagicLinkRequest(BaseModel):
    email: str

class PasswordSignInRequest(BaseModel):
    email: str
    password: str

class PasswordResetRequest(BaseModel):
    """Asks for a set-a-new-password link. Owner accounts only; the response is a
    constant either way so it cannot be used to find out who owns the instance."""
    email: str

class PasswordResetConfirm(BaseModel):
    token: str
    password: str

class AuthCapabilityResponse(BaseModel):
    """What /signin/owner needs to render, without naming anyone.

    ``password_min_length`` is a published rule, not a secret. Nothing here varies by
    address — the page never asks the server about a specific account.
    """
    password_min_length: int

class MagicLinkResponse(BaseModel):
    """Byte-identical for known, unknown, revoked and rate-limited addresses, so the
    sign-in form is not an email-enumeration oracle."""
    sent: bool = True
    delivered: bool = False
    action_url: Optional[str] = None

class VerifyTokenRequest(BaseModel):
    token: str

class VerifyTokenResponse(BaseModel):
    ok: bool
    redirect: str = "/"
    claimed: bool = False

class AccountResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: Optional[str] = None
    role: Literal['owner', 'member']
    status: Literal['pending_email', 'invited', 'active', 'revoked']
    display_name: Optional[str] = None
    last_login_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

class SessionResponse(BaseModel):
    """GET /auth/me — the single frontend bootstrap call."""
    account: AccountResponse
    profiles: List[UserResponse] = []

class InviteCreateRequest(BaseModel):
    email: str
    # Attach the invite to an existing `pending_email` account created by the upgrade
    # migration, so that household member keeps their profiles, watch progress and
    # watchlist instead of starting over.
    account_id: Optional[str] = None

class InviteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    role: str = "member"
    expires_at: Optional[datetime] = None
    accepted_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

class InviteSendResponse(BaseModel):
    invite: InviteResponse
    sent: bool
    delivered: bool = False
    action_url: Optional[str] = None

class InvitePreviewRequest(BaseModel):
    token: str

class InvitePreviewResponse(BaseModel):
    email: str
    invited_by: Optional[str] = None
    instance_name: Optional[str] = None
    expires_at: Optional[datetime] = None

class InviteAcceptRequest(BaseModel):
    token: str
    display_name: str
    avatar: Optional[AvatarValue] = None

class MemberResponse(BaseModel):
    account: AccountResponse
    profile_count: int = 0
    profile_names: List[str] = []
    is_you: bool = False

class MembersResponse(BaseModel):
    members: List[MemberResponse] = []
    invites: List[InviteResponse] = []

class TransferOwnershipRequest(BaseModel):
    account_id: str

class InstanceSettingsUpdate(BaseModel):
    instance_name: Optional[str] = None

class OkResponse(BaseModel):
    ok: bool = True


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
