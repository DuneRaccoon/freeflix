from app.services.content_id import resolve_content_id


def test_movie_uses_build_content_id():
    assert resolve_content_id(
        media_type="movie", tmdb_id=603, season=None, episode=None,
        file_name="The.Matrix.1999.mkv", file_index=0, precomputed=None,
    ) == "movie:603"


def test_tv_uses_stored_season_episode_first():
    assert resolve_content_id(
        media_type="tv", tmdb_id=76479, season=1, episode=3,
        file_name="whatever.mkv", file_index=4, precomputed={"4": {"season": 2, "episode": 9}},
    ) == "tv:76479:s1:e3"


def test_tv_uses_precomputed_when_no_stored_episode():
    assert resolve_content_id(
        media_type="tv", tmdb_id=76479, season=None, episode=None,
        file_name="badname.mkv", file_index=4, precomputed={"4": {"season": 2, "episode": 9}},
    ) == "tv:76479:s2:e9"


def test_tv_parses_filename_when_no_stored_no_precompute():
    assert resolve_content_id(
        media_type="tv", tmdb_id=76479, season=None, episode=None,
        file_name="The.Boys.S01E03.1080p.mkv", file_index=2, precomputed=None,
    ) == "tv:76479:s1:e3"


def test_tv_misnamed_file_falls_back_to_file_index_never_none():
    # No stored S/E, no precompute, filename has no parseable S/E -> deterministic fallback.
    cid = resolve_content_id(
        media_type="tv", tmdb_id=76479, season=None, episode=None,
        file_name="random_release_group_file.mkv", file_index=7, precomputed=None,
    )
    assert cid == "tv:76479:s0:e7"
    assert cid is not None


def test_no_tmdb_id_is_none():
    assert resolve_content_id(
        media_type="tv", tmdb_id=None, season=1, episode=3,
        file_name="x.mkv", file_index=0, precomputed=None,
    ) is None
