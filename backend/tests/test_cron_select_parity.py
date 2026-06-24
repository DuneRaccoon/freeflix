from app.cron.jobs import select_best as cron_select_best
from app.services.torrents_select import select_best
from app.models import TorrentHit
from app.providers.quality import parse_quality


def _hit(title, seeds, byts=1000):
    return TorrentHit(title=title, seeds=seeds, peers=0, bytes=byts,
                      magnet=f"magnet:?xt=urn:btih:{abs(hash(title)) % (16**16):016x}",
                      hash="", quality=parse_quality(title))


def test_cron_imports_the_shim():
    # cron/jobs.py must keep using the same select_best symbol (return type unchanged)
    assert cron_select_best is select_best


def test_cron_skip_behavior_preserved_when_bucket_absent():
    # cron skips a title when no exact-quality release exists -> shim returns None
    hits = [_hit("Title.2020.720p.WEB", 50)]
    assert cron_select_best(hits, "1080p") is None


def test_cron_picks_exact_quality_release():
    hits = [_hit("Title.2020.1080p.A", 5), _hit("Title.2020.1080p.B", 80)]
    best = cron_select_best(hits, "1080p")
    assert best is not None and best.seeds == 80 and best.quality == "1080p"
