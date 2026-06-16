from app.models import ShowDetail, SeasonSummary, SeasonDetail, Episode, TorrentRequest


def test_show_detail_defaults():
    s = ShowDetail(tmdb_id=76479, name="The Boys")
    assert s.media_type == "tv" and s.number_of_seasons == 0 and s.seasons == []


def test_season_detail_with_episodes():
    sd = SeasonDetail(season_number=1, name="Season 1",
                      episodes=[Episode(episode_number=1, name="Pilot", runtime=62)])
    assert sd.episodes[0].episode_number == 1 and sd.episodes[0].runtime == 62


def test_season_summary():
    ss = SeasonSummary(season_number=2, name="Season 2", episode_count=8)
    assert ss.episode_count == 8


def test_torrent_request_tv_fields():
    r = TorrentRequest(tmdb_id=76479, quality="1080p", media_type="tv", season=1, episode=3)
    assert r.media_type == "tv" and r.season == 1 and r.episode == 3
    rm = TorrentRequest(tmdb_id=603, quality="1080p")
    assert rm.media_type == "movie" and rm.season is None
