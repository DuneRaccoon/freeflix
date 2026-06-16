from app.models import TorrentHit
from app.services.torrents_select import select_best, available_qualities


def _hit(title, seeds, byts=1000):
    return TorrentHit(title=title, seeds=seeds, bytes=byts, magnet="magnet:x",
                      quality=__import__("app.providers.quality", fromlist=["parse_quality"]).parse_quality(title))


def test_select_best_picks_highest_seeded_in_bucket():
    hits = [_hit("M.2020.1080p.BluRay", 50), _hit("M.2020.1080p.WEB", 120),
            _hit("M.2020.2160p.BluRay", 999)]
    best = select_best(hits, "1080p")
    assert best.seeds == 120


def test_select_best_tie_breaks_on_larger_bytes():
    hits = [_hit("M.2020.1080p.A", 100, byts=1000), _hit("M.2020.1080p.B", 100, byts=5000)]
    assert select_best(hits, "1080p").bytes == 5000


def test_select_best_none_when_bucket_absent():
    hits = [_hit("M.2020.720p.WEB", 80)]
    assert select_best(hits, "2160p") is None


def test_available_qualities_ordered_desc():
    hits = [_hit("M.720p", 1), _hit("M.2160p", 1), _hit("M.1080p", 1), _hit("M.BDRip", 1)]
    assert available_qualities(hits) == ["2160p", "1080p", "720p"]
