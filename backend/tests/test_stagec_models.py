import os
os.environ.setdefault("DB_PATH", "/tmp/test_stagec.db")

from app.database.session import Base, engine, get_db
from app.database.models.torrents import Torrent
from app.database.models.streaming import UserStreamingProgress
from app.models import StreamingProgressCreate


def setup_module(_):
    Base.metadata.create_all(bind=engine)


def test_torrent_has_media_identity_columns():
    cols = {c.name for c in Torrent.__table__.columns}
    assert {"tmdb_id", "media_type", "season", "episode"} <= cols


def test_progress_has_file_index_and_title_columns():
    cols = {c.name for c in UserStreamingProgress.__table__.columns}
    assert {"file_index", "title"} <= cols


def test_progress_create_schema_fields():
    p = StreamingProgressCreate(torrent_id="t", movie_id="tv:76479:s1:e3",
                                current_time=10.0, percentage=5.0, file_index=2, title="The Boys S01E03")
    assert p.file_index == 2 and p.title == "The Boys S01E03"
    p2 = StreamingProgressCreate(torrent_id="t", movie_id="movie:603", current_time=1, percentage=1)
    assert p2.file_index is None and p2.title is None
