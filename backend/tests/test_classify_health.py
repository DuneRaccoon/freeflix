import pytest
from app.models import TorrentCandidate
from app.services.torrents_select import classify_health


def test_classify_dead_below_min_seeds():
    assert classify_health(0, min_seeds=1, healthy_seeds=5) == "dead"


def test_classify_low_at_min_seeds():
    # seeds == min_seeds is NOT dead; below healthy_seeds is low
    assert classify_health(1, min_seeds=1, healthy_seeds=5) == "low"


def test_classify_low_just_below_healthy():
    assert classify_health(4, min_seeds=1, healthy_seeds=5) == "low"


def test_classify_healthy_at_threshold():
    assert classify_health(5, min_seeds=1, healthy_seeds=5) == "healthy"


def test_classify_healthy_above():
    assert classify_health(100, min_seeds=1, healthy_seeds=5) == "healthy"


def test_candidate_model_round_trips():
    c = TorrentCandidate(
        source_id="abc", magnet="magnet:?xt=urn:btih:abc", quality="1080p",
        seeds=10, peers=3, bytes=2_000_000_000, health="healthy",
        is_season_pack=False, release_title="M.2020.1080p.BluRay",
    )
    assert c.health == "healthy"
    assert c.is_season_pack is False
    assert c.source_id == "abc"
