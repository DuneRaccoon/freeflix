from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, 
    Integer, String, Text, JSON, func
)
from sqlalchemy.orm import relationship, Session
import datetime
from typing import Dict, Any, Optional, List

from app.database.mixins import Model, generate_uuid
from app.models import TorrentStatus, TorrentState, ScheduleResponse, ScheduleConfig, SearchParams


class Torrent(Model):
    """SQLAlchemy model for torrent entries."""
    __tablename__ = "torrents"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    movie_cache_id = Column(String, ForeignKey("movie_cache.id"), nullable=True)
    movie_title = Column(String, nullable=False, index=True)
    quality = Column(String, nullable=False)
    magnet = Column(Text, nullable=False)
    url = Column(String, nullable=False)
    save_path = Column(String, nullable=False)
    sizes = Column(JSON, nullable=True)
    
    # Status information
    state = Column(String, nullable=False, default="queued")
    progress = Column(Float, nullable=False, default=0.0)
    error_message = Column(String, nullable=True)
    
    # Resume data for restarting torrents
    resume_data = Column(Text, nullable=True)
    
    # Additional metadata
    meta_data = Column(JSON, nullable=True)
    
    # Relationships
    download_logs = relationship("TorrentLog", back_populates="torrent", cascade="all, delete-orphan")
    movie_cache = relationship("MovieCache", foreign_keys=[movie_cache_id], back_populates="torrents")
    
    user_id = Column(String, ForeignKey("users.id"), nullable=True)  # Nullable for backward compatibility
    user = relationship("User", back_populates="downloads")
    
    def to_status(self) -> TorrentStatus:
        """Convert database Torrent model to TorrentStatus Pydantic model."""
        # Extract metadata fields
        meta_data = self.meta_data or {}
        
        return TorrentStatus(
            id=self.id,
            movie_title=self.movie_title,
            quality=self.quality,
            state=TorrentState(self.state),
            magnet=self.magnet,
            progress=self.progress,
            download_rate=meta_data.get('download_rate', 0.0),
            upload_rate=meta_data.get('upload_rate', 0.0),
            total_downloaded=meta_data.get('total_downloaded', 0),
            total_uploaded=meta_data.get('total_uploaded', 0),
            num_peers=meta_data.get('num_peers', 0),
            save_path=self.save_path,
            created_at=self.created_at,
            updated_at=self.updated_at,
            eta=meta_data.get('eta'),
            error_message=self.error_message
        )
    
    def update_from_status(self, status: TorrentStatus, db: Session = None) -> None:
        """Update torrent from TorrentStatus."""
        self.state = status.state.value
        self.progress = status.progress
        self.error_message = status.error_message
        
        # Update metadata
        metadata = self.meta_data or {}
        metadata.update({
            'download_rate': status.download_rate,
            'upload_rate': status.upload_rate,
            'total_downloaded': status.total_downloaded,
            'total_uploaded': status.total_uploaded,
            'num_peers': status.num_peers,
            'eta': status.eta
        })
        self.meta_data = metadata
        
        # If session provided, commit changes
        if db:
            db.add(self)
            db.commit()
            db.refresh(self)
    
    @classmethod
    def find_active(cls, db: Session) -> List["Torrent"]:
        """Find all active torrents (not finished or errored)."""
        return db.query(cls).filter(
            ~cls.state.in_(['finished', 'error', 'stopped'])
        ).all()
    
    def add_log(self, db: Session, message: str, level: str = "INFO", 
                state: str = None, progress: float = None, 
                download_rate: float = None) -> "TorrentLog":
        """Add a log entry for this torrent."""
        log = TorrentLog(
            torrent_id=self.id,
            message=message,
            level=level,
            state=state or self.state,
            progress=progress or self.progress,
            download_rate=download_rate
        )
        db.add(log)
        db.commit()
        return log


class TorrentLog(Model):
    """SQLAlchemy model for logging torrent download progress and events."""
    __tablename__ = "torrent_logs"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    torrent_id = Column(String, ForeignKey("torrents.id", ondelete="CASCADE"), nullable=False)
    timestamp = Column(DateTime, nullable=False, default=datetime.datetime.now(datetime.timezone.utc))
    message = Column(Text, nullable=False)
    level = Column(String, nullable=False, default="INFO")
    
    # Status at time of log
    state = Column(String, nullable=True)
    progress = Column(Float, nullable=True)
    download_rate = Column(Float, nullable=True)  # kB/s
    
    # Relationship
    torrent = relationship("Torrent", back_populates="download_logs")
    
    @classmethod
    def get_recent_logs(cls, db: Session, torrent_id: str, limit: int = 10) -> List["TorrentLog"]:
        """Get recent logs for a torrent."""
        return db.query(cls).filter(
            cls.torrent_id == torrent_id
        ).order_by(
            cls.timestamp.desc()
        ).limit(limit).all()


class Schedule(Model):
    """SQLAlchemy model for scheduled download jobs."""
    __tablename__ = "schedules"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=True)
    cron_expression = Column(String, nullable=False)
    search_params = Column(JSON, nullable=False)
    quality = Column(String, nullable=False)
    max_downloads = Column(Integer, nullable=False, default=1)
    enabled = Column(Boolean, nullable=False, default=True)
    
    # Execution information
    last_run = Column(DateTime, nullable=True)
    next_run = Column(DateTime, nullable=False)
    last_run_status = Column(String, nullable=True)
    
    # Relationships
    execution_logs = relationship("ScheduleLog", back_populates="schedule", cascade="all, delete-orphan")
    
    user_id = Column(String, ForeignKey("users.id"), nullable=True)  # Nullable for backward compatibility
    user = relationship("User", back_populates="schedules")
    
    def to_response(self) -> ScheduleResponse:
        """Convert database Schedule model to ScheduleResponse Pydantic model."""
        search_params = SearchParams(**self.search_params)
        
        return ScheduleResponse(
            id=self.id,
            name=self.name,
            config=ScheduleConfig(
                name=self.name,
                cron_expression=self.cron_expression,
                search_params=search_params,
                quality=self.quality,
                max_downloads=self.max_downloads,
                enabled=self.enabled
            ),
            next_run=self.next_run,
            last_run=self.last_run,
            status=self.last_run_status or "scheduled"
        )
    
    def update_from_config(self, config: ScheduleConfig, next_run: datetime.datetime = None, db: Session = None) -> None:
        """Update schedule from ScheduleConfig."""
        self.name = config.name
        self.cron_expression = config.cron_expression
        self.search_params = config.search_params.model_dump()
        self.quality = config.quality
        self.max_downloads = config.max_downloads
        self.enabled = config.enabled
        
        if next_run:
            self.next_run = next_run
        
        # If session provided, commit changes
        if db:
            db.add(self)
            db.commit()
            db.refresh(self)
    
    def add_log(self, db: Session, status: str, message: str = None, 
                results: Dict[str, Any] = None) -> "ScheduleLog":
        """Add a log entry for this schedule."""
        log = ScheduleLog(
            schedule_id=self.id,
            status=status,
            message=message,
            results=results
        )
        db.add(log)
        db.commit()
        return log
    
    @classmethod
    def get_enabled(cls, db: Session) -> List["Schedule"]:
        """Get all enabled schedules."""
        return db.query(cls).filter(cls.enabled == True).all()


class ScheduleLog(Model):
    """SQLAlchemy model for logging schedule executions."""
    __tablename__ = "schedule_logs"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    schedule_id = Column(String, ForeignKey("schedules.id", ondelete="CASCADE"), nullable=False)
    execution_time = Column(DateTime, nullable=False, default=datetime.datetime.now(datetime.timezone.utc))
    status = Column(String, nullable=False)
    message = Column(Text, nullable=True)
    results = Column(JSON, nullable=True)  # Store results like number of movies found, downloaded, etc.
    
    # Relationship
    schedule = relationship("Schedule", back_populates="execution_logs")
    
    @classmethod
    def get_recent_logs(cls, db: Session, schedule_id: str, limit: int = 10) -> List["ScheduleLog"]:
        """Get recent logs for a schedule."""
        return db.query(cls).filter(
            cls.schedule_id == schedule_id
        ).order_by(
            cls.execution_time.desc()
        ).limit(limit).all()


class MovieCache(Model):
    """SQLAlchemy model for caching movie information."""
    __tablename__ = "movie_cache"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    title = Column(String, nullable=False, index=True)
    year = Column(Integer, nullable=False)
    link = Column(String, nullable=False, unique=True)
    rating = Column(String, nullable=False)
    genre = Column(String, nullable=False)
    img = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    
    # Extended metadata fields
    imdb_id = Column(String, nullable=True, index=True)
    imdb_rating = Column(String, nullable=True)
    imdb_votes = Column(Integer, nullable=True)
    rotten_tomatoes_rating = Column(String, nullable=True)
    rotten_tomatoes_total_review_count = Column(Integer, nullable=True)
    rotten_tomatoes_critics_reviews = Column(JSON, nullable=True)  # Store as JSON array of review objects
    rotten_tomatoes_audience_rating = Column(String, nullable=True)
    rotten_tomatoes_audience_review_count = Column(Integer, nullable=True)
    rotten_tomatoes_audience_reviews = Column(JSON, nullable=True)  # Store as JSON array of review objects
    metacritic_rating = Column(String, nullable=True)
    metacritic_votes = Column(Integer, nullable=True)
    runtime = Column(String, nullable=True)
    director = Column(String, nullable=True)
    cast = Column(JSON, nullable=True)  # Store as a JSON array of cast members
    plot = Column(Text, nullable=True)  # Full plot
    poster_url = Column(String, nullable=True)  # Higher quality poster if available
    backdrop_url = Column(String, nullable=True)  # Background image
    trailer_url = Column(String, nullable=True)
    awards = Column(String, nullable=True)
    language = Column(String, nullable=True)
    country = Column(String, nullable=True)
    maturity_rating = Column(String, nullable=True)
    reviews = Column(JSON, nullable=True)  # Store as JSON array of review objects
    related_movies = Column(JSON, nullable=True)  # Store as JSON array of related movie links
    movie_info_json = Column(JSON, nullable=True)  # Store full movie info JSON from RT
    
    # Cache the available torrents
    torrents_json = Column(JSON, nullable=False)
    torrents = relationship("Torrent", back_populates="movie_cache", foreign_keys=[Torrent.movie_cache_id])
    
    # Cache control
    fetched_at = Column(DateTime, nullable=False, default=datetime.datetime.now(datetime.timezone.utc))
    extended_data_fetched_at = Column(DateTime, nullable=True)  # When external data was fetched
    expires_at = Column(DateTime, nullable=False)
    
    @classmethod
    def get_with_extended_data(cls, db: Session, url: str) -> Optional["MovieCache"]:
        """Get a movie with extended data if available, otherwise return basic data."""
        now = datetime.datetime.now(datetime.timezone.utc)
        return db.query(cls).filter(
            cls.link == url,
            cls.expires_at > now
        ).first()
        
    @classmethod
    def update_extended_data(cls, db: Session, movie_id: str, extended_data: Dict[str, Any]) -> Optional["MovieCache"]:
        """Update a movie with extended data from external sources."""
        movie = db.query(cls).filter(cls.id == movie_id).first()
        if not movie:
            return None
            
        # Update all provided fields
        for key, value in extended_data.items():
            if hasattr(movie, key):
                if key in {'reviews', 'related_movies'}:
                    setattr(movie, key, [model.model_dump(mode='json') for model in value])
                else:
                    setattr(movie, key, value)
                
        # movie.extended_data_fetched_at = datetime.datetime.now(datetime.timezone.utc)
        movie.extended_data_fetched_at = datetime.datetime.now()
        db.commit()
        db.refresh(movie)
        return movie
    
    def to_detailed_dict(self) -> Dict[str, Any]:
        """Convert to dictionary including extended data."""
        result = self.to_dict()
        # Add nested structures for better organization
        result['ratings'] = {
            'imdb': self.imdb_rating,
            'rottenTomatoes': self.rotten_tomatoes_rating,
            'metacritic': self.metacritic_rating
        }
        result['credits'] = {
            'director': self.director,
            'cast': self.cast or []
        }
        result['media'] = {
            'poster': self.poster_url or self.img,
            'backdrop': self.backdrop_url,
            'trailer': self.trailer_url
        }
        return result

class Setting(Model):
    """SQLAlchemy model for application settings."""
    __tablename__ = "settings"
    
    key = Column(String, primary_key=True)
    value = Column(JSON, nullable=False)
    description = Column(String, nullable=True)
    
    @classmethod
    def get_setting(cls, db: Session, key: str, default: Any = None) -> Any:
        """Get a setting value by key."""
        setting = db.query(cls).filter(cls.key == key).first()
        return setting.value if setting else default
    
    @classmethod
    def set_setting(cls, db: Session, key: str, value: Any, description: str = None) -> "Setting":
        """Set a setting value."""
        setting = db.query(cls).filter(cls.key == key).first()
        
        if setting:
            setting.value = value
            if description:
                setting.description = description
        else:
            setting = cls(key=key, value=value, description=description)
            db.add(setting)
        
        db.commit()
        db.refresh(setting)
        return setting