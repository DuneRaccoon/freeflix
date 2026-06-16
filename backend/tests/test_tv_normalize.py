from app.providers.catalog import normalize_show, normalize_season, normalize_episode


SHOW = {
    "id": 76479, "name": "The Boys", "overview": "Vigilantes...",
    "poster_path": "/p.jpg", "backdrop_path": "/b.jpg", "first_air_date": "2019-07-25",
    "last_air_date": "2026-05-20", "status": "Ended", "number_of_seasons": 5,
    "vote_average": 8.4, "vote_count": 12000,
    "genres": [{"id": 10765, "name": "Sci-Fi & Fantasy"}, {"id": 10759, "name": "Action & Adventure"}],
    "seasons": [
        {"season_number": 0, "name": "Specials", "episode_count": 74, "poster_path": "/s0.jpg", "air_date": "2019-05-01"},
        {"season_number": 1, "name": "Season 1", "episode_count": 8, "poster_path": "/s1.jpg", "air_date": "2019-07-25"},
    ],
}

SEASON = {
    "season_number": 1, "name": "Season 1", "overview": "...",
    "episodes": [
        {"episode_number": 1, "name": "The Name of the Game", "overview": "o",
         "runtime": 62, "still_path": "/e1.jpg", "air_date": "2019-07-25", "vote_average": 7.5},
    ],
}


def test_normalize_show():
    s = normalize_show(SHOW)
    assert s.tmdb_id == 76479 and s.name == "The Boys"
    assert s.year == 2019 and s.number_of_seasons == 5 and s.status == "Ended"
    assert s.genres == ["Sci-Fi & Fantasy", "Action & Adventure"]
    assert s.poster_url == "https://image.tmdb.org/t/p/w500/p.jpg"
    assert len(s.seasons) == 2 and s.seasons[1].episode_count == 8


def test_normalize_season_and_episode():
    sd = normalize_season(SEASON)
    assert sd.season_number == 1 and len(sd.episodes) == 1
    e = sd.episodes[0]
    assert e.episode_number == 1 and e.runtime == 62
    assert e.still_url == "https://image.tmdb.org/t/p/w300/e1.jpg"
