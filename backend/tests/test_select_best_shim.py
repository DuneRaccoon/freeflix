from app.models import TorrentHit
from app.providers.quality import parse_quality
from app.services.torrents_select import select_best


def _hit(title, seeds, byts=1000, magnet=None):
    return TorrentHit(
        title=title, seeds=seeds, peers=0, bytes=byts,
        magnet=magnet or f"magnet:?xt=urn:btih:{abs(hash((title, seeds, byts))) % (16**16):016x}",
        hash="", quality=parse_quality(title),
    )


def test_shim_returns_torrenthit_type():
    hits = [_hit("M.2020.1080p.A", 50)]
    out = select_best(hits, "1080p")
    assert isinstance(out, TorrentHit)


def test_shim_picks_highest_seeded_exact_bucket():
    hits = [_hit("M.2020.1080p.A", 50), _hit("M.2020.1080p.B", 120),
            _hit("M.2020.2160p.C", 999)]
    assert select_best(hits, "1080p").seeds == 120


def test_shim_none_when_bucket_absent():
    hits = [_hit("M.2020.720p.W", 80)]
    assert select_best(hits, "2160p") is None


def test_shim_bytes_zero_never_wins_tiebreak():
    # parity with rank_candidates bytes-tiebreak: real release wins at equal seeds
    hits = [_hit("M.2020.1080p.Zero", 100, byts=0),
            _hit("M.2020.1080p.Real", 100, byts=5000)]
    assert select_best(hits, "1080p").bytes == 5000
