from app.models import TorrentHit
from app.providers.quality import parse_quality
from app.services.torrents_select import rank_candidates


def _hit(title, seeds, byts=1_000_000, magnet=None):
    return TorrentHit(
        title=title, seeds=seeds, peers=0, bytes=byts,
        magnet=magnet or f"magnet:?xt=urn:btih:{abs(hash(title)) % (16**16):016x}",
        hash="", quality=parse_quality(title),
    )


THR = {"min_seeds": 1, "healthy_seeds": 5}


def test_exact_quality_healthy_first_seeds_desc():
    hits = [
        _hit("M.2020.1080p.A", 10),
        _hit("M.2020.1080p.B", 50),
        _hit("M.2020.720p.C", 999),
    ]
    out = rank_candidates(hits, "1080p", **THR)
    assert out[0].quality == "1080p" and out[0].seeds == 50
    assert out[1].quality == "1080p" and out[1].seeds == 10


def test_floor_filters_dead_when_alternatives_exist():
    # 0-seed 1080p is "dead"; a healthy 720p exists -> dead drops below healthy downgrade
    hits = [
        _hit("M.2020.1080p.Dead", 0),
        _hit("M.2020.720p.Healthy", 30),
    ]
    out = rank_candidates(hits, "1080p", **THR)
    assert out[0].health == "healthy" and out[0].quality == "720p"
    assert out[-1].health == "dead" and out[-1].quality == "1080p"


def test_downgrade_walk_when_exact_bucket_absent():
    hits = [
        _hit("M.2020.720p.A", 20),
        _hit("M.2020.480p.B", 99),
    ]
    out = rank_candidates(hits, "1080p", **THR)
    # exact 1080p absent -> walk down: 720p (healthy) before 480p (healthy)
    assert [c.quality for c in out] == ["720p", "480p"]


def test_bytes_tiebreak_zero_never_outranks_real_release():
    hits = [
        _hit("M.2020.1080p.Zero", 100, byts=0),
        _hit("M.2020.1080p.Real", 100, byts=1500),
    ]
    out = rank_candidates(hits, "1080p", **THR)
    assert out[0].bytes == 1500
    assert out[1].bytes == 0


def test_dead_only_still_returned():
    hits = [_hit("M.2020.1080p.Dead", 0)]
    out = rank_candidates(hits, "1080p", **THR)
    assert len(out) == 1 and out[0].health == "dead"


def test_low_ranks_below_healthy_downgrade():
    # 1080p low (seeds=2) vs 720p healthy (seeds=30): healthy downgrade wins
    hits = [
        _hit("M.2020.1080p.Low", 2),
        _hit("M.2020.720p.Healthy", 30),
    ]
    out = rank_candidates(hits, "1080p", **THR)
    assert out[0].quality == "720p" and out[0].health == "healthy"
    assert out[1].quality == "1080p" and out[1].health == "low"


def test_empty_hits_returns_empty():
    assert rank_candidates([], "1080p", **THR) == []
