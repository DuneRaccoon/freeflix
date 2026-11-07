"""Who watched each download (spec 2026-11-06 section 3.2), and the numbers behind it."""

from types import SimpleNamespace

from app.database.models import Torrent as DbTorrent
from app.database.models.streaming import UserStreamingProgress
from app.database.models.users import User
from app.services.watch_share import percents_from_rows, profile_percents, watched_by_map


def _users(db_session):
    users = {}
    for uid, name in (("A", "Ann"), ("B", "Bob"), ("C", "Cy")):
        u = User(id=uid, username=name.lower(), display_name=name)
        db_session.add(u)
        users[uid] = u
    db_session.flush()
    return users


def _torrent(db_session, tid, **kw):
    t = DbTorrent(
        id=tid, movie_title=tid, quality="1080p", magnet=f"magnet:?xt=urn:btih:{tid}",
        url=f"magnet:?xt=urn:btih:{tid}", save_path=f"/tmp/{tid}", state="downloading", **kw,
    )
    db_session.add(t)
    db_session.flush()
    return t


def _progress(db_session, uid, torrent, pct, completed=False, file_index=None, key=None):
    db_session.add(UserStreamingProgress(
        user_id=uid, torrent_id=torrent.id, movie_id=key or f"{torrent.id}:{uid}:{file_index}",
        percentage=pct, completed=completed, file_index=file_index,
    ))
    db_session.flush()


def _row(user_id, percentage, completed=False, file_index=None):
    return SimpleNamespace(user_id=user_id, percentage=percentage, completed=completed,
                           file_index=file_index)


def _pack(db_session, tid, episodes):
    return _torrent(db_session, tid, media_type="tv", tmdb_id=1, season=1, episode=None,
                    precomputed_episodes=episodes)


def test_movie_percent_is_the_row_and_completed_is_100(db_session):
    t = _torrent(db_session, "m", media_type="movie", tmdb_id=1)
    rows = [_row("A", 80.0), _row("B", 50, completed=True), _row("C", 0.0)]
    assert percents_from_rows(t, rows) == {"A": 80.0, "B": 100.0}


def test_pack_averages_over_every_episode(db_session):
    eps = {str(i): {"season": 1, "episode": i + 1} for i in range(4)}
    t = _pack(db_session, "p", eps)
    rows = [_row("A", 100, file_index=0), _row("A", 100, file_index=1),
            _row("B", 10, completed=True, file_index=2)]
    assert percents_from_rows(t, rows) == {"A": 50.0, "B": 25.0}


def test_pack_without_map_counts_distinct_file_indexes(db_session):
    t = _pack(db_session, "p", None)
    rows = [_row("A", 90, file_index=0), _row("B", 30, file_index=1), _row("B", 30, file_index=2)]
    assert percents_from_rows(t, rows) == {"A": 30.0, "B": 20.0}


def test_pack_with_no_indexes_counts_as_one(db_session):
    t = _pack(db_session, "p", None)
    assert percents_from_rows(t, [_row("A", 40.0)]) == {"A": 40.0}


def test_rows_of_other_torrents_are_ignored(db_session):
    _users(db_session)
    x = _torrent(db_session, "x", media_type="movie", tmdb_id=1)
    y = _torrent(db_session, "y", media_type="movie", tmdb_id=1)
    _progress(db_session, "A", x, 90.0)
    assert profile_percents(db_session, y) == {}
    assert profile_percents(db_session, x) == {"A": 90.0}


def test_watched_by_map_sorts_and_includes_empty(db_session):
    _users(db_session)
    m = _torrent(db_session, "m", media_type="movie", tmdb_id=1)
    n = _torrent(db_session, "n", media_type="movie", tmdb_id=2)
    _progress(db_session, "B", m, 30.0)
    _progress(db_session, "A", m, 80.0)
    result = watched_by_map(db_session, [m, n])
    assert [w.profile_id for w in result["m"]] == ["A", "B"]
    assert result["m"][0].display_name == "Ann"
    assert result["n"] == []


def test_watched_by_on_a_pack_is_the_season_average(db_session):
    _users(db_session)
    eps = {str(i): {"season": 1, "episode": i + 1} for i in range(4)}
    p = _pack(db_session, "p", eps)
    _progress(db_session, "A", p, 100.0, file_index=0)
    _progress(db_session, "A", p, 100.0, file_index=1)
    assert watched_by_map(db_session, [p])["p"][0].percent == 50.0
