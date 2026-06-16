"""Cache for catalog items keyed by (media_type, tmdb_id)."""
import datetime
from sqlalchemy import Column, String, Integer, Float, Text, JSON, DateTime, UniqueConstraint
from sqlalchemy.orm import Session

from app.database.mixins import Model, generate_uuid
from app.config import settings


class CatalogItemCache(Model):
    __tablename__ = "catalog_items"
    __table_args__ = (UniqueConstraint("media_type", "tmdb_id", name="uq_catalog_media_tmdb"),)

    id = Column(String, primary_key=True, default=generate_uuid)
    media_type = Column(String, nullable=False, default="movie", index=True)
    tmdb_id = Column(Integer, nullable=False, index=True)

    title = Column(String, nullable=False)
    year = Column(Integer, nullable=True)
    overview = Column(Text, nullable=True)
    poster_url = Column(String, nullable=True)
    backdrop_url = Column(String, nullable=True)
    genre_ids = Column(JSON, nullable=True)
    genres = Column(JSON, nullable=True)
    vote_average = Column(Float, default=0.0)
    vote_count = Column(Integer, default=0)
    popularity = Column(Float, default=0.0)
    original_language = Column(String, nullable=True)

    detail_json = Column(JSON, nullable=True)
    torrents_json = Column(JSON, nullable=True)
    fetched_at = Column(DateTime, nullable=True)
    detail_fetched_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)

    @classmethod
    def get(cls, db: Session, media_type: str, tmdb_id: int):
        return db.query(cls).filter_by(media_type=media_type, tmdb_id=tmdb_id).first()

    @classmethod
    def upsert_list_item(cls, db: Session, *, tmdb_id: int, media_type: str = "movie", **fields):
        now = datetime.datetime.now(datetime.timezone.utc)
        row = cls.get(db, media_type, tmdb_id)
        if row is None:
            row = cls(id=generate_uuid(), media_type=media_type, tmdb_id=tmdb_id)
            db.add(row)
        for key, value in fields.items():
            setattr(row, key, value)
        row.fetched_at = now
        row.expires_at = now + datetime.timedelta(days=settings.cache_movies_for)
        db.flush()
        return row

    def set_detail(self, db: Session, detail_json: dict):
        self.detail_json = detail_json
        self.detail_fetched_at = datetime.datetime.now(datetime.timezone.utc)
        db.flush()

    def set_torrents(self, db: Session, torrents_json: list):
        self.torrents_json = torrents_json
        db.flush()
