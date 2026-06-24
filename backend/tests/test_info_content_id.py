from types import SimpleNamespace

from app.services.content_id import resolve_content_id


def _resolve_for_torrent(row, file_name, file_index):
    """Mirror of get_video_info's content_id derivation (single source: resolve_content_id)."""
    return resolve_content_id(
        media_type=row.media_type,
        tmdb_id=row.tmdb_id,
        season=row.season,
        episode=row.episode,
        file_name=file_name,
        file_index=file_index,
        precomputed=row.precomputed_episodes,
    )


def test_season_pack_uses_precomputed_over_filename():
    row = SimpleNamespace(
        media_type="tv", tmdb_id=1399, season=None, episode=None,
        precomputed_episodes={"3": {"season": 4, "episode": 9}},
    )
    assert _resolve_for_torrent(row, "garbled.mkv", 3) == "tv:1399:s4:e9"


def test_misnamed_file_never_none():
    row = SimpleNamespace(
        media_type="tv", tmdb_id=1399, season=None, episode=None,
        precomputed_episodes=None,
    )
    cid = _resolve_for_torrent(row, "no_episode_marker.mkv", 6)
    assert cid is not None
    assert cid == "tv:1399:s0:e6"


def test_movie_uses_tmdb_id():
    row = SimpleNamespace(
        media_type="movie", tmdb_id=603, season=None, episode=None,
        precomputed_episodes=None,
    )
    assert _resolve_for_torrent(row, "the.matrix.mkv", 0) == "movie:603"
