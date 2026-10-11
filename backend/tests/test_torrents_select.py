"""``select_best`` / ``available_qualities``.

**Fixture note (stage 8, task 1).** ``_hit`` used to pass ``magnet="magnet:x"`` for every
hit. ``_source_id`` (``app/services/torrents_select.py:21``) falls back to
``sha1(magnet)`` when a hit carries no infohash, so every fixture hit collapsed to one
id; ``by_id = {_source_id(h): h for h in matching}`` (``:115``) kept only the *last*
matching hit and ``by_id.get(top_id, matching[0])`` (``:116``) returned it whatever the
ranking said. Both ordering tests below therefore passed on **input order alone** — with
the old helper, reversing either ``hits`` list reddened them with no production change.
Each hit now derives a distinct magnet from ``(title, seeds, bytes)``, and
:func:`test_select_best_is_independent_of_input_order` is the guard that keeps it so.
"""
import hashlib
import itertools

import pytest

from app.models import TorrentHit
from app.providers.quality import parse_quality
from app.services.torrents_select import select_best, available_qualities, _source_id


def _hit(title, seeds, byts=1000):
    """A hit with a magnet distinct per (title, seeds, bytes).

    Derived with sha1 rather than ``hash()`` so it is stable across processes:
    ``PYTHONHASHSEED`` is unset in the backend image, so ``hash(str)`` differs on every
    run.
    """
    digest = hashlib.sha1(f"{title}|{seeds}|{byts}".encode()).hexdigest()
    return TorrentHit(title=title, seeds=seeds, bytes=byts,
                      magnet=f"magnet:?xt=urn:btih:{digest}",
                      quality=parse_quality(title))


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


def test_fixture_hits_have_distinct_source_ids():
    """The property the two ordering tests above silently depended on."""
    hits = [_hit("M.2020.1080p.BluRay", 50), _hit("M.2020.1080p.WEB", 120),
            _hit("M.2020.1080p.WEB", 121), _hit("M.2020.1080p.WEB", 121, byts=2000)]
    assert len({_source_id(h) for h in hits}) == len(hits)


@pytest.mark.parametrize("order", list(itertools.permutations(range(3))))
def test_select_best_is_independent_of_input_order(order):
    """``select_best`` must not depend on where the winner sits in ``hits``.

    This is the guard on the fixture repair: with the old ``magnet="magnet:x"`` helper
    the permutations that put the 120-seed release anywhere but last returned the
    50-seed one instead.
    """
    hits = [_hit("M.2020.1080p.BluRay", 50), _hit("M.2020.1080p.WEB", 120),
            _hit("M.2020.2160p.BluRay", 999)]
    permuted = [hits[i] for i in order]
    best = select_best(permuted, "1080p")
    assert best.quality == "1080p" and best.seeds == 120
