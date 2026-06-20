# backend/tests/test_torrent_remove_cascade.py
import os
os.environ.setdefault("DB_PATH", "/tmp/test_remove_cascade.db")

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.database.session import Base
# Import models so all tables register on Base.metadata
from app.database.models import Torrent as DbTorrent, TorrentLog  # noqa: F401
from app.database.models.users import User
from app.database.models.streaming import UserStreamingProgress


@pytest.fixture()
def session(tmp_path):
    db_file = tmp_path / "cascade.db"
    engine = create_engine(f"sqlite:///{db_file}", connect_args={"check_same_thread": False})

    # SQLite ignores ON DELETE actions unless foreign_keys pragma is on.
    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    s = Session()
    yield s
    s.close()
    engine.dispose()


def test_deleting_torrent_preserves_watch_history(session):
    user = User(username="u1", display_name="U One")
    session.add(user)
    torrent = DbTorrent(
        movie_title="Dune", quality="1080p", magnet="magnet:?xt=test",
        url="http://x/y.torrent", save_path="/tmp/dune", state="downloading",
    )
    session.add(torrent)
    session.flush()

    progress = UserStreamingProgress(
        user_id=user.id, torrent_id=torrent.id, movie_id="movie:438631",
        current_time=120.0, percentage=10.0,
    )
    log = TorrentLog(torrent_id=torrent.id, message="started", level="INFO")
    session.add_all([progress, log])
    session.commit()

    progress_id = progress.id

    # Hard-delete the torrent
    session.delete(torrent)
    session.commit()

    # Watch history survives, detached (torrent_id NULL); movie_id intact
    kept = session.get(UserStreamingProgress, progress_id)
    assert kept is not None
    assert kept.torrent_id is None
    assert kept.movie_id == "movie:438631"

    # Torrent logs cascade away
    assert session.query(TorrentLog).filter_by(torrent_id=torrent.id).count() == 0
