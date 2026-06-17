from app.services.content_id import build_content_id


def test_movie_content_id():
    assert build_content_id("movie", 603, None, None) == "movie:603"


def test_tv_episode_content_id():
    assert build_content_id("tv", 76479, 1, 3) == "tv:76479:s1:e3"


def test_tv_without_episode_is_none():
    assert build_content_id("tv", 76479, 1, None) is None


def test_missing_tmdb_id_is_none():
    assert build_content_id("movie", None, None, None) is None
    assert build_content_id("tv", None, 1, 3) is None
