import os
os.environ.setdefault("DB_PATH", "/tmp/test_catalog.db")

from app.database.session import Base, engine, get_db
from app.database.models.catalog import CatalogItemCache


def setup_module(_):
    Base.metadata.create_all(bind=engine)


def test_upsert_then_get_roundtrips():
    with get_db() as db:
        CatalogItemCache.upsert_list_item(db, tmdb_id=999001, title="Test Movie", year=2020,
                                          overview="o", poster_url="p", backdrop_url="b",
                                          genre_ids=[18], genres=["Drama"], vote_average=7.5,
                                          vote_count=10, popularity=5.0, original_language="en")
    with get_db() as db:
        row = CatalogItemCache.get(db, "movie", 999001)
        assert row is not None
        assert row.title == "Test Movie" and row.year == 2020


def test_upsert_is_idempotent_on_media_type_tmdb_id():
    with get_db() as db:
        CatalogItemCache.upsert_list_item(db, tmdb_id=999002, title="A", year=2001)
        CatalogItemCache.upsert_list_item(db, tmdb_id=999002, title="A (updated)", year=2001)
    with get_db() as db:
        rows = db.query(CatalogItemCache).filter_by(media_type="movie", tmdb_id=999002).all()
        assert len(rows) == 1 and rows[0].title == "A (updated)"
