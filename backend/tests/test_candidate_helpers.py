import hashlib
from app.models import TorrentHit
from app.services.torrents_select import _source_id, _is_season_pack


def _hit(title="x", magnet="magnet:?xt=urn:btih:abc", hsh=""):
    return TorrentHit(title=title, magnet=magnet, hash=hsh)


def test_source_id_prefers_hash():
    h = _hit(hsh="ABCDEF123456")
    assert _source_id(h) == "abcdef123456"


def test_source_id_parses_btih_from_magnet():
    h = _hit(magnet="magnet:?xt=urn:btih:2385EB80D5F99EFD&dn=foo", hsh="")
    assert _source_id(h) == "2385eb80d5f99efd"


def test_source_id_falls_back_to_sha1_of_magnet():
    magnet = "https://example.test/not-a-magnet"
    h = _hit(magnet=magnet, hsh="")
    assert _source_id(h) == hashlib.sha1(magnet.encode()).hexdigest()


def test_is_season_pack_true_for_season_only():
    assert _is_season_pack("Show.Name.S01.1080p.WEB") is True


def test_is_season_pack_true_for_complete():
    assert _is_season_pack("Show Name Complete Series 1080p") is True


def test_is_season_pack_false_for_single_episode():
    assert _is_season_pack("Show.Name.S01E04.1080p.WEB") is False


def test_is_season_pack_false_for_movie():
    assert _is_season_pack("Movie.Name.2020.1080p.BluRay") is False
