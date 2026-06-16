from app.providers.episodes import parse_episode


def test_parse_standard_sxxexx():
    assert parse_episode("The.Boys.S01E03.1080p.WEB.h264-GRP.mkv") == (1, 3)
    assert parse_episode("The Boys S05E08 1080p.mkv") == (5, 8)
    assert parse_episode("show.s02e10.720p.mkv") == (2, 10)


def test_parse_xnotation():
    assert parse_episode("Show - 1x04 - Title.mkv") == (1, 4)
    assert parse_episode("Show.12x07.mkv") == (12, 7)


def test_parse_no_match_returns_none():
    assert parse_episode("Some.Movie.2016.1080p.BluRay.mkv") is None
    assert parse_episode("random.mkv") is None


def test_parse_prefers_sxxexx_over_year():
    assert parse_episode("Show.2019.S03E02.mkv") == (3, 2)
