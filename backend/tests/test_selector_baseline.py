"""The before-picture of candidate ranking, captured at the base of stage 8.

Three things live here, and all three are **descriptive, not prescriptive**: they record
what ``rank_candidates`` does today so that stage 8's changes are visible as a diff
rather than asserted from memory.

1. **A golden snapshot** (``data/rank_snapshot.json``) of the full ordering for a fixture
   matrix: every ask in ``{2160p, 1080p, 720p, 480p, ''}`` crossed with every bucket —
   including the unparsed ``''`` bucket — at seeds 0/2/30, plus the pairs that isolate
   each individual term of the sort key. The file is **data, generated once from
   unmodified code** and committed; it is read, never recomputed. Regenerate with::

       docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \\
           -e PYTHONPATH=/opt/freeflix backend python tests/test_selector_baseline.py

   Task 5 (``apply_profile``) must reproduce this byte-for-byte when no client profile is
   supplied — that is the no-profile guarantee, and this file is what it is checked
   against.

2. **Both quality-leak mechanisms**, each pinned in its own test. They are *independent*:
   leak (a) is the health term outranking the bucket term, leak (b) is the bucket term
   leaking on its own with every hit equally healthy. Stage 8 exists to close leak (b)
   for this television and to make leak (a) deliberate rather than accidental; **task 5's
   ``apply_profile`` is what inverts both.** Until it lands these tests assert the leak —
   so when task 5 lands they are expected to change, and changing them is the point.

   Neither leak was pinned anywhere in the tree before this file: no fixture in
   ``test_rank_candidates.py`` constructs a 2160p hit at all, and the only 2160p-against-a
   -1080p-ask fixtures (``test_torrents_select.py``, ``test_select_best_shim.py``) go
   through ``select_best``, which filters to the exact bucket first and therefore cannot
   leak by construction.

3. The deterministic fixture helpers the two above share. Magnets are derived with sha1
   over ``(title, seeds, bytes)`` because ``_source_id`` falls back to ``sha1(magnet)``
   for a hit with no infohash — fixtures that share a magnet share a ``source_id``, which
   is exactly the defect repaired in ``test_torrents_select.py`` — and because
   ``PYTHONHASHSEED`` is unset in the backend image, so a ``hash()``-derived magnet is a
   different string on every run and no snapshot over it could be stable.
"""
import hashlib
import json
from pathlib import Path

import pytest

from app.models import TorrentHit
from app.providers.quality import parse_quality
from app.services.torrents_select import rank_candidates

SNAPSHOT_PATH = Path(__file__).parent / "data" / "rank_snapshot.json"

# The thresholds the snapshot was generated under. Recorded in the file and asserted, so
# a change to them is a visible failure rather than a silent re-interpretation of every
# health value in it. seeds 0 -> dead, 2 -> low, 30 -> healthy.
THRESHOLDS = {"min_seeds": 1, "healthy_seeds": 5}

ASKS = ["2160p", "1080p", "720p", "480p", ""]
BUCKETS = ["2160p", "1080p", "720p", "480p", ""]
SEEDS = [0, 2, 30]
BYTES = 1_000_000

# A token that `parse_quality` maps to the bucket. "NoRes" matches none of its four
# patterns, so that hit lands in the unparsed ("") bucket -- bucket_order's last real
# entry, and the one no other test in the tree exercises through rank_candidates.
_TOKEN = {"2160p": "2160p", "1080p": "1080p", "720p": "720p", "480p": "480p", "": "NoRes"}


def _title(bucket: str, seeds: int, byts: int) -> str:
    """A unique, parseable title per (bucket, seeds, bytes).

    Deliberately carries no ``SNN``, ``Season NN`` or ``Complete`` token: those make
    ``_is_season_pack`` true, which is not part of the sort key but is a snapshot field,
    so an accidental match would be a confusing diff. ``test_fixtures_are_not_season_packs``
    pins that.
    """
    return f"Baseline.2020.{_TOKEN[bucket]}.BluRay.x264.sd{seeds}.by{byts}-GRP"


def _hit(bucket: str, seeds: int, byts: int = BYTES) -> TorrentHit:
    title = _title(bucket, seeds, byts)
    digest = hashlib.sha1(f"{title}|{seeds}|{byts}".encode()).hexdigest()
    return TorrentHit(
        title=title, seeds=seeds, peers=0, bytes=byts,
        magnet=f"magnet:?xt=urn:btih:{digest}", hash="",
        quality=parse_quality(title),
    )


def _cases() -> "dict[str, dict]":
    """Every snapshot case, as ``name -> {"ask", "hits"}``, defined in code.

    The case list lives here rather than in the JSON so that a missing or unmounted
    snapshot file is a **failure**, not an empty parametrisation. ``backend/pyproject.toml``
    has no ``[tool.pytest.ini_options]``, so ``empty_parameter_set_mark`` is the default
    ``skip`` and a file-driven parametrisation would report green-by-skipping.
    """
    cases: "dict[str, dict]" = {}

    # The matrix: every ask against every bucket at every health tier.
    for ask in ASKS:
        cases[f"matrix:ask={ask or 'unparsed'}"] = {
            "ask": ask,
            "hits": [(b, s, BYTES) for b in BUCKETS for s in SEEDS],
        }

    # The health-versus-maximum-bucket-distance boundary: a healthy hit in the LAST
    # bucket (unparsed) against a low-health hit in the exact bucket. Health wins today,
    # which is leak (a) at its widest -- the asked bucket loses to a release whose
    # resolution is unknown.
    cases["boundary:healthy-unparsed-vs-low-exact"] = {
        "ask": "1080p",
        "hits": [("", 30, BYTES), ("1080p", 2, BYTES)],
    }
    # The same boundary one notch in: healthy 480p (last *parsed* bucket) against a
    # low-health exact 1080p.
    cases["boundary:healthy-480p-vs-low-exact"] = {
        "ask": "1080p",
        "hits": [("480p", 30, BYTES), ("1080p", 2, BYTES)],
    }

    # The bytes term, isolated: equal health, equal bucket, equal seeds.
    cases["bytes:zero-never-outranks-real"] = {
        "ask": "1080p",
        "hits": [("1080p", 100, 0), ("1080p", 100, 1500)],
    }

    # The seeds term, isolated: equal health, equal bucket, equal bytes. Only a pair
    # inside ONE bucket can discriminate `-seeds`, because across buckets the bucket term
    # is reached first and decides; so there is one of these per bucket that matters.
    for bucket in ("2160p", "1080p", "720p"):
        cases[f"seeds:same-bucket-desc:{bucket}"] = {
            "ask": bucket,
            "hits": [(bucket, 10, BYTES), (bucket, 50, BYTES), (bucket, 30, BYTES)],
        }

    return cases


def _rank(case: dict) -> "list[dict]":
    hits = [_hit(*spec) for spec in case["hits"]]
    return [c.model_dump() for c in rank_candidates(hits, case["ask"], **THRESHOLDS)]


def _build_document() -> dict:
    return {
        "_comment": [
            "GOLDEN SNAPSHOT of rank_candidates() at the base of stage 8 "
            "(branch feat/tv-stage8-codec-profile, off master 6227e71).",
            "Generated from unmodified production code. This file is DATA: the test reads "
            "it, it is never recomputed at assertion time.",
            "Regenerate with: docker compose run --rm "
            "-v \"$(pwd)/backend/tests:/opt/freeflix/tests\" "
            "-e PYTHONPATH=/opt/freeflix backend "
            "python tests/test_selector_baseline.py",
            "Task 5 (apply_profile) must reproduce this exactly when no client profile is "
            "supplied. If a stage-8 change alters it, that change is NOT no-profile-safe.",
        ],
        "thresholds": THRESHOLDS,
        "cases": {
            name: {
                "ask": case["ask"],
                "hits": [list(spec) for spec in case["hits"]],
                "ranked": _rank(case),
            }
            for name, case in _cases().items()
        },
    }


def _load_document() -> dict:
    with SNAPSHOT_PATH.open() as fh:
        return json.load(fh)


# --------------------------------------------------------------------------------------
# The golden snapshot
# --------------------------------------------------------------------------------------

def test_snapshot_file_is_present():
    """Fails loudly rather than skipping when the file is not in the container.

    ``backend/tests`` is not bind-mounted by the dev override, so a run without the
    explicit ``-v`` mount (and before ``make build``) does not see this data file at all.
    """
    assert SNAPSHOT_PATH.is_file(), (
        f"{SNAPSHOT_PATH} missing. Mount the tests dir: docker compose run --rm "
        '-v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest'
    )


def test_snapshot_records_the_thresholds_it_was_generated_under():
    assert _load_document()["thresholds"] == THRESHOLDS


def test_snapshot_covers_exactly_the_cases_defined_in_code():
    """No case may be added to the code and silently left unsnapshotted, or vice versa."""
    assert set(_load_document()["cases"]) == set(_cases())


def test_snapshot_matrix_covers_every_ask_bucket_health_combination():
    """The matrix itself is load-bearing; this pins its shape, not the ranking."""
    cases = _cases()
    assert [a for a in ASKS] == ["2160p", "1080p", "720p", "480p", ""]
    assert "" in BUCKETS, "the unparsed bucket must be in the matrix"
    for ask in ASKS:
        hits = cases[f"matrix:ask={ask or 'unparsed'}"]["hits"]
        assert len(hits) == len(BUCKETS) * len(SEEDS) == 15
        assert {b for b, _s, _y in hits} == set(BUCKETS)
        assert {s for _b, s, _y in hits} == {0, 2, 30}
    # The three seed values must straddle all three health tiers, or the matrix pins
    # nothing about the health term.
    ranked = _rank(cases["matrix:ask=1080p"])
    assert {c["health"] for c in ranked} == {"dead", "low", "healthy"}


@pytest.mark.parametrize("name", sorted(_cases()))
def test_golden_snapshot_matches_todays_ranking(name):
    """Today's ordering, read from the committed file -- not recomputed."""
    recorded = _load_document()["cases"][name]
    case = _cases()[name]
    assert recorded["ask"] == case["ask"]
    assert [tuple(spec) for spec in recorded["hits"]] == [tuple(s) for s in case["hits"]], (
        "the fixture inputs drifted from the ones the snapshot was generated from; "
        "regenerate deliberately, do not edit the expectation"
    )
    assert _rank(case) == recorded["ranked"]


def test_fixtures_are_not_season_packs():
    """No baseline title may trip ``_is_season_pack``; ``sd30`` must not read as ``S30``."""
    for case in _cases().values():
        for row in _rank(case):
            assert row["is_season_pack"] is False, row["release_title"]


def test_fixture_source_ids_are_distinct_within_a_case():
    """The snapshot is only meaningful if each row identifies one hit."""
    for name, case in _cases().items():
        ranked = _rank(case)
        assert len({r["source_id"] for r in ranked}) == len(ranked), name


def test_fixture_magnets_are_stable_across_processes():
    """A regenerated snapshot must be byte-identical, so no magnet may use ``hash()``."""
    assert _hit("1080p", 30).magnet == (
        "magnet:?xt=urn:btih:"
        + hashlib.sha1(
            f"{_title('1080p', 30, BYTES)}|30|{BYTES}".encode()
        ).hexdigest()
    )


def test_before_bytes_term_orders_larger_first_with_zero_last():
    """The bytes term's real, falsifiable property: descending, 0 last.

    **Finding, task 1.** ``_effective_bytes``'s ``else -1`` sentinel
    (``torrents_select.py:43``) is **inert for every non-negative byte count**, and its
    docstring ("a 0-byte release must not outrank a real one") describes something the
    plain ``-bytes`` term already delivers. The sort key holds
    ``-_effective_bytes(bytes)``, so a real release contributes a negative number and a
    0-byte release contributes ``+1``; drop the sentinel (``return byts``) and the 0-byte
    release contributes ``0`` — still greater than every negative, still last. Verified by
    mutation: ``else -1`` -> ``else 0`` and ``return byts`` each leave this file,
    ``test_rank_candidates.py`` and ``test_select_best_shim.py`` **entirely green**. Only a
    negative ``bytes`` could tell the two apart, and nothing produces one.

    So the three pre-existing "0-byte never wins" tests do not pin the sentinel they look
    like they pin; what they pin is the **direction** of the term, which ``return -byts``
    does redden. This test asserts that directly, over three sizes rather than two, so the
    ordering is asserted rather than inferred from a single comparison.
    """
    hits = [_hit("1080p", 100, 0), _hit("1080p", 100, 1500), _hit("1080p", 100, 500)]
    out = rank_candidates(hits, "1080p", **THRESHOLDS)
    assert [c.bytes for c in out] == [1500, 500, 0]


# --------------------------------------------------------------------------------------
# Leak (a): the health term outranks the bucket term
# --------------------------------------------------------------------------------------

def test_before_leak_a_healthy_2160p_wins_a_1080p_ask_over_a_low_health_1080p():
    """BEFORE-PICTURE. Inverted by task 5 (``apply_profile``).

    The ask is 1080p and a 1080p release exists, but it is low-health; ``health_rank`` is
    the first element of the sort key, so the healthy 2160p is returned first. On this
    television that is a release it may not be able to decode — the viewer asked for
    1080p and gets 2160p because of a seeder count.

    This is mechanism (a) and it is **independent of bucket order**: reordering ``_ORDER``
    does not change this result, because the health term is reached first. Leak (b) below
    is the one bucket order controls.
    """
    hits = [_hit("1080p", 2), _hit("2160p", 30)]
    out = rank_candidates(hits, "1080p", **THRESHOLDS)
    assert [(c.quality, c.seeds, c.health) for c in out] == [
        ("2160p", 30, "healthy"),
        ("1080p", 2, "low"),
    ]


def test_before_leak_a_healthy_unparsed_wins_a_1080p_ask_over_a_low_health_1080p():
    """BEFORE-PICTURE. Inverted by task 5 (``apply_profile``).

    The widest form of (a): health outranks even the maximum bucket distance, so a release
    whose resolution did not parse at all beats the asked bucket.
    """
    hits = [_hit("1080p", 2), _hit("", 30)]
    out = rank_candidates(hits, "1080p", **THRESHOLDS)
    assert [(c.quality, c.seeds, c.health) for c in out] == [
        ("", 30, "healthy"),
        ("1080p", 2, "low"),
    ]


# --------------------------------------------------------------------------------------
# Leak (b): the bucket term leaks on its own, with no health mismatch
# --------------------------------------------------------------------------------------

def test_before_leak_b_6_seed_2160p_beats_999_seed_720p_with_both_healthy():
    """BEFORE-PICTURE. Inverted by task 5 (``apply_profile``).

    No exact 1080p exists, every hit is **healthy**, and bytes are equal — so health and
    bytes are both out of the picture and only the bucket term can be deciding. The
    downgrade walk puts 2160p one position ahead of 720p, and 166x fewer seeders does not
    overcome one position, because ``-seeds`` is only reached when the bucket indices tie.

    This is the exact hole stage 8 closes, and it is the mechanism (a) cannot explain.
    """
    hits = [_hit("720p", 999), _hit("2160p", 6)]
    out = rank_candidates(hits, "1080p", **THRESHOLDS)
    assert [(c.quality, c.seeds, c.health) for c in out] == [
        ("2160p", 6, "healthy"),
        ("720p", 999, "healthy"),
    ]


def test_before_leak_b_2160p_outranks_1080p_for_a_720p_ask():
    """BEFORE-PICTURE. Inverted by task 5 (``apply_profile``).

    The same mechanism with health, seeds **and** bytes all held equal, so bucket order is
    the only remaining variable: asked 720p, no 720p present, and the walk prefers 2160p
    to 1080p purely because ``_ORDER`` is descending.
    """
    hits = [_hit("1080p", 30), _hit("2160p", 30)]
    out = rank_candidates(hits, "720p", **THRESHOLDS)
    assert [(c.quality, c.seeds, c.health) for c in out] == [
        ("2160p", 30, "healthy"),
        ("1080p", 30, "healthy"),
    ]


def test_before_leak_b_is_not_leak_a_in_disguise():
    """Both leaks in one fixture set, asserting they are separate mechanisms.

    If a change kills (b) it must leave (a) standing and vice versa; a fixture that
    cannot tell them apart would make either mutation look like proof of the other.
    """
    # (b): all healthy, bucket decides.
    b_out = rank_candidates([_hit("720p", 999), _hit("2160p", 6)], "1080p", **THRESHOLDS)
    assert {c.health for c in b_out} == {"healthy"}, "leak (b) must have NO health mismatch"
    assert b_out[0].quality == "2160p"
    # (a): health differs, health decides.
    a_out = rank_candidates([_hit("1080p", 2), _hit("2160p", 30)], "1080p", **THRESHOLDS)
    assert {c.health for c in a_out} == {"low", "healthy"}, "leak (a) IS a health mismatch"
    assert a_out[0].quality == "2160p"


if __name__ == "__main__":  # pragma: no cover - regeneration entry point
    # A `__main__` guard, not module-level code: pytest imports this file during
    # collection (see tests/test_torrent.py for what module-level side effects cost).
    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_PATH.write_text(
        json.dumps(_build_document(), indent=2, sort_keys=True) + "\n"
    )
    doc = _load_document()
    print(f"wrote {SNAPSHOT_PATH} :: {len(doc['cases'])} cases, "
          f"{sum(len(c['ranked']) for c in doc['cases'].values())} ranked rows")
