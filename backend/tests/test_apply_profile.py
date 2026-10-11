"""``apply_profile``: the stable second sort, and the absent-profile guarantee.

This is the file where a rule in ``services/capability.py`` either changes which
multi-gigabyte file gets downloaded or it does not. ``evaluate`` is pure and order-free;
everything here is about **position in the list**, because position is what ``/download``
reads (``candidates[0]``, skipping marks) and what the television shows first.

**Every reordering test asserts the pre-profile order explicitly, in the same function.**
That is not ceremony. Three ways a test in this file can be worthless, all of them seen in
this repo:

* a fixture where health, bucket or seeds already agrees with the capability order, so the
  reordering it "proves" would happen with the capability term deleted. ``-seeds`` is a
  near-unique integer, so any term placed after it is never consulted — a weight mutation
  then cannot discriminate at all. **So every cost fixture here holds health, bucket, seeds
  AND bytes equal and differs in exactly one token**, and the penalised candidate is always
  the one that would otherwise win;
* a reject asserted through a helper predicate rather than through the output order. A
  ``_rejects(c) is True`` proves nothing about what gets started, so every reject row here
  reads the position in ``apply_profile``'s return value;
* an ``is`` assertion on a tuple, which cannot fail (``tuple(t) is t`` is True). The
  identity test below is on a **list**, where ``list(l) is l``, ``l[:] is l``,
  ``sorted(l) is l`` and ``[x for x in l if True] is l`` are all False. Do not copy that
  assertion onto a tuple: that is exactly how task 4's registry test came back green under
  its own mutation.

Each test is named for the property it pins or the mutation it catches, so the point of a
row survives the next reader.

Fixture titles are real scene-shaped names and their parsed facts are asserted in
``test_fixture_titles_parse_to_the_facts_these_tests_assume`` — if a title stopped
parsing the way this file assumes, every downstream row would still be green and would be
measuring nothing.
"""
import hashlib

import pytest

from app.models import TorrentCandidate, TorrentHit
from app.providers.quality import parse_quality, parse_release_facts
from app.services import capability as cap
from app.services.capability import (
    BASIS_LG_TABLE,
    BASIS_PRODUCT,
    EFFECT_COST,
    EFFECT_REJECT,
    PROFILE_ID,
    STATE_IN_FORCE,
    Rule,
    _HEALTH_ORDER,
    apply_profile,
)
from app.services.torrents_select import classify_health, rank_candidates

# The snapshot's own helpers and matrix, imported rather than copied: a second copy of the
# fixture matrix could drift from the file the hostile-table test compares against, and a
# snapshot test over a drifted matrix is a test of nothing. (``test_capability_evaluate.py``
# already imports from ``test_release_facts`` for the same reason.)
from test_selector_baseline import (
    THRESHOLDS,
    _cases,
    _hit as _baseline_hit,
    _load_document,
)

BYTES = 1_000_000

# --------------------------------------------------------------------------------------
# Fixture titles. Every penalised title below has a control that differs from it in
# exactly one token, pinned by ``test_fixture_pairs_differ_in_exactly_one_token``.
# --------------------------------------------------------------------------------------

#: Tier A: H.264 + Dolby. The only combination this project has ever actually played.
#: cost -20.
A_1080 = "Movie.2020.1080p.BluRay.x264.DD5.1-GRP"
#: A_1080 plus one token, ``DV``. R5 (+30) on top of tier A (-20) -> cost +10.
A_1080_DV = "Movie.2020.1080p.DV.BluRay.x264.DD5.1-GRP"
#: Tier A at 720p, for the downgrade-walk rows. cost -20.
A_720 = "Movie.2020.720p.BluRay.x264.DD5.1-GRP"
#: Tier A with E-AC3 instead of AC3 — the audio the measurement actually delivered.
A_1080_DDP = "Movie.2020.1080p.WEB-DL.x264.DDP5.1-GRP"
#: Tier B: HEVC + Dolby, documented but unmeasured. cost -10.
B_1080 = "Movie.2020.1080p.BluRay.x265.DDP5.1-GRP"
#: Nothing matches: H.264, no audio token, no container, no range. cost 0.
PLAIN_1080 = "Movie.2020.1080p.BluRay.x264-GRP"
#: PLAIN_1080 one bucket down: still nothing matches. cost 0.
PLAIN_720 = "Movie.2020.720p.BluRay.x264-GRP"
#: PLAIN_1080 with one token changed, ``x264`` -> ``AV1``. R6, cost +40.
AV1_1080 = "Movie.2020.1080p.BluRay.AV1-GRP"
#: PLAIN_1080 with one token changed, ``x264`` -> ``XviD``. R7, cost +200 — strictly
#: larger than R3-R6 combined, which is the magnitude §7.2 calls a "heavy penalty".
XVID_1080 = "Movie.2020.1080p.BluRay.XviD-GRP"
#: DTS-HD at 1080p: R4 matches but is SHADOW, so it reports and costs nothing.
DTSHD_1080 = "Movie.2020.1080p.BluRay.x264.DTS-HD.MA.5.1-GRP"
#: 2160p tier B. R1 withholds it unless 4K was opted into. cost -10.
B_2160 = "Movie.2020.2160p.BluRay.x265.DDP5.1-GRP"
#: 2160p tier A — the best bonus in the table, and still a reject for a 1080p ask.
A_2160 = "Movie.2020.2160p.WEB-DL.x264.DDP5.1-GRP"
#: 2160p + DTS-HD: R2, the only AV reject, and the only rule with a published LG table
#: row behind it. ``incapable`` whether or not 4K was opted into.
DTSHD_2160 = "Movie.2020.2160p.BluRay.x265.DTS-HD.MA.5.1-GRP"


def _hit(title: str, seeds: int, byts: int = BYTES) -> TorrentHit:
    """A hit with a distinct magnet per (title, seeds, bytes).

    sha1 rather than ``hash()``: ``PYTHONHASHSEED`` is unset in the backend image, so a
    ``hash()``-derived magnet differs per process — and ``_source_id`` falls back to
    ``sha1(magnet)``, so hits sharing a magnet share a ``source_id`` and any ordering
    assertion over them is decided by ``dict`` collapse rather than by the sort key. That
    defect is real and was repaired in ``test_torrents_select.py`` by task 1.
    """
    digest = hashlib.sha1(f"{title}|{seeds}|{byts}".encode()).hexdigest()
    return TorrentHit(
        title=title, seeds=seeds, peers=0, bytes=byts,
        magnet=f"magnet:?xt=urn:btih:{digest}", hash="",
        quality=parse_quality(title),
    )


def _ranked(specs, ask: str):
    """Today's real ranking for ``specs`` — ``(title, seeds)`` or ``(title, seeds, bytes)``.

    Fixtures go through ``rank_candidates`` rather than being hand-built, so every row in
    this file measures the second sort **composed with** the first one, which is the only
    composition production ever performs.
    """
    return rank_candidates([_hit(*spec) for spec in specs], ask, **THRESHOLDS)


def _titles(candidates):
    return [c.release_title for c in candidates]


def _verdicts(candidates):
    return [(c.release_title, c.device_verdict) for c in candidates]


# A table that rejects everything at the maximum penalty. Used only by the hostile-table
# identity rows: it is non-vacuous *because* it is absurd — if the unprofiled path read
# the registry at all, this table would reorder and mark every row in the golden snapshot.
_HOSTILE_RULES = (
    Rule(
        id="hostile-reject-everything",
        when=lambda facts, allow_2160p: True,
        effect=EFFECT_REJECT,
        cost=10 ** 6,
        basis=BASIS_PRODUCT,
        state=STATE_IN_FORCE,
        settled_by=(),
        verdict="incapable",
        why="test-only hostile table; see test_apply_profile.py",
    ),
)


# --------------------------------------------------------------------------------------
# The fixtures themselves, pinned. Without this row every row below could be vacuous.
# --------------------------------------------------------------------------------------

@pytest.mark.parametrize(
    "title,bucket,resolution,family,audio,dynamic_range,container",
    [
        (A_1080, "1080p", 1080, "h264", {"ac3"}, None, None),
        (A_1080_DV, "1080p", 1080, "h264", {"ac3"}, "dv", None),
        (A_1080_DDP, "1080p", 1080, "h264", {"eac3"}, None, None),
        (A_720, "720p", 720, "h264", {"ac3"}, None, None),
        (B_1080, "1080p", 1080, "hevc", {"eac3"}, None, None),
        (PLAIN_1080, "1080p", 1080, "h264", set(), None, None),
        (PLAIN_720, "720p", 720, "h264", set(), None, None),
        (AV1_1080, "1080p", 1080, "av1", set(), None, None),
        (XVID_1080, "1080p", 1080, "xvid", set(), None, "avi"),
        (DTSHD_1080, "1080p", 1080, "h264", {"dtshd"}, None, None),
        (B_2160, "2160p", 2160, "hevc", {"eac3"}, None, None),
        (A_2160, "2160p", 2160, "h264", {"eac3"}, None, None),
        (DTSHD_2160, "2160p", 2160, "hevc", {"dtshd"}, None, None),
    ],
)
def test_fixture_titles_parse_to_the_facts_these_tests_assume(
    title, bucket, resolution, family, audio, dynamic_range, container
):
    """The bucket AND the facts, because the two parsers are independent.

    ``parse_quality`` decides the selector's bucket and ``parse_release_facts`` decides the
    rules' input; a title that parses differently from what this file assumes would leave
    every ordering row below green and measuring something else.
    """
    assert parse_quality(title) == bucket
    facts = parse_release_facts(title)
    assert facts.resolution == resolution
    assert facts.video_family == family
    assert set(facts.audio) == audio
    assert facts.dynamic_range == dynamic_range
    assert facts.container_guess == container


@pytest.mark.parametrize(
    "penalised,control,expected_difference",
    [
        # One token ADDED. The cleanest shape there is.
        (A_1080_DV, A_1080, {"DV"}),
        # One token SUBSTITUTED: for R6 and R7 the penalised property *is* the codec, so
        # no pair can share it — "differs in one token" means one swap, not one addition.
        (AV1_1080, PLAIN_1080, {"AV1", "x264"}),
        (XVID_1080, PLAIN_1080, {"XviD", "x264"}),
    ],
)
def test_fixture_pairs_differ_in_exactly_one_token(penalised, control, expected_difference):
    """The one-token discipline, mechanically. A pair that differs twice proves nothing:
    hazard 3 in the stage plan is a fixture that satisfies a rule for the wrong reason, and
    the tree already contains one (``4K.UHD``, where both tokens agree).
    """
    def tokens(title):
        return set(title.replace("-", ".").split("."))

    assert tokens(penalised) ^ tokens(control) == expected_difference


# --------------------------------------------------------------------------------------
# The absent-profile guarantee
# --------------------------------------------------------------------------------------

def test_no_profile_returns_the_very_same_list_object():
    """``profile is None`` -> ``return candidates``. Asserted ``is``, not ``==``.

    Sound because the subject is a **list**: ``list(l)``, ``l[:]``, ``sorted(l)`` and
    ``[x for x in l if True]`` are all new objects, so each of those as the ``None`` path
    reddens this row even though every one of them returns an equal list.
    """
    candidates = _ranked([(A_1080, 30), (B_1080, 30)], "1080p")
    assert apply_profile(candidates, None, allow_2160p=False) is candidates
    assert apply_profile(candidates, allow_2160p=False) is candidates
    assert apply_profile(candidates, None, allow_2160p=True) is candidates


def test_no_profile_leaves_every_candidate_unannotated():
    """Annotating on the ``None`` path reddens this. The web must stay byte-identical."""
    candidates = _ranked([(DTSHD_2160, 30), (XVID_1080, 30), (A_1080, 30)], "1080p")
    out = apply_profile(candidates, None, allow_2160p=False)
    assert [c.device_verdict for c in out] == [None, None, None]
    assert [c.device_reasons for c in out] == [[], [], []]


def test_the_two_new_fields_are_defaulted_and_not_shared_between_instances():
    """Nine-field construction still constructs (``test_sources_endpoint.py``), and the
    mutable default is per-instance.

    The second half pins framework behaviour on purpose: ``device_reasons: List[str] = []``
    is only safe because pydantic copies a mutable default per instance. If that list were
    ever shared — a plain class attribute, a ``Field(default=SHARED)``, a switch to a
    dataclass — annotating one candidate would annotate every candidate in the process, and
    no ordering test in this file would notice.
    """
    def nine_fields():
        return TorrentCandidate(
            source_id="a", magnet="magnet:?xt=urn:btih:a", quality="1080p", seeds=1,
            peers=0, bytes=1, health="healthy", is_season_pack=False,
            release_title=A_1080,
        )

    one, two = nine_fields(), nine_fields()  # two independent constructions, not a copy
    assert one.device_verdict is None and one.device_reasons == []
    assert two.device_verdict is None and two.device_reasons == []
    one.device_reasons.append("x")
    assert two.device_reasons == [], "the mutable default must not be shared"
    assert nine_fields().device_reasons == [], "nor shared with later instances"


def test_an_unknown_profile_id_raises_rather_than_ranking_unprofiled():
    """The quietest possible failure in this stage is "the profile did not run and the
    response looked fine". An id that is not in the registry is a programming error, so it
    is loud; returning ``candidates`` here would make a typo indistinguishable from the
    desktop path.
    """
    candidates = _ranked([(A_1080, 30)], "1080p")
    with pytest.raises(ValueError, match="unknown capability profile"):
        apply_profile(candidates, "lg-webos25-measured", allow_2160p=False)


def test_the_registry_is_what_apply_profile_reads(monkeypatch):
    """Non-vacuity for the two hostile-table rows below.

    If ``PROFILES`` were not consulted at call time, the monkeypatch there would be inert
    and those rows would pass for the wrong reason. Here the same patch must visibly take
    effect: every candidate rejected, marked by the hostile rule's id.
    """
    monkeypatch.setattr(cap, "PROFILES", {PROFILE_ID: _HOSTILE_RULES})
    candidates = _ranked([(A_1080, 30), (B_1080, 30)], "1080p")
    out = apply_profile(candidates, PROFILE_ID, allow_2160p=False)
    assert [c.device_verdict for c in out] == ["incapable", "incapable"]
    assert [c.device_reasons for c in out] == [
        ["hostile-reject-everything:in_force"], ["hostile-reject-everything:in_force"]
    ]


@pytest.mark.parametrize("name", sorted(_cases()))
@pytest.mark.parametrize("allow_2160p", [False, True])
def test_a_hostile_table_cannot_reach_the_unprofiled_path(monkeypatch, name, allow_2160p):
    """The golden snapshot, byte-for-byte, with a registry that rejects everything.

    Both call forms — ``profile=None`` and the argument omitted — over task 1's whole
    fixture matrix. The point is structural rather than statistical: the desktop path is
    not "equivalent to today's", it is the same list object, built by the same ranking
    function, never shown to the table.
    """
    monkeypatch.setattr(cap, "PROFILES", {PROFILE_ID: _HOSTILE_RULES})
    recorded = _load_document()["cases"][name]["ranked"]
    case = _cases()[name]
    hits = [_baseline_hit(*spec) for spec in case["hits"]]

    for call in (
        lambda c: apply_profile(c, None, allow_2160p=allow_2160p),
        lambda c: apply_profile(c, allow_2160p=allow_2160p),
    ):
        ranked = rank_candidates(hits, case["ask"], **THRESHOLDS)
        out = call(ranked)
        assert out is ranked
        dumps = [c.model_dump() for c in out]
        assert len(dumps) == len(recorded), name
        assert dumps == recorded, name


# --------------------------------------------------------------------------------------
# Invariants: nothing filtered, health never touched, health map never drifts
# --------------------------------------------------------------------------------------

@pytest.mark.parametrize(
    "specs,ask,allow_2160p",
    [
        # Every candidate rejected (R1, 1080p ask): dropping rejects would empty the list.
        ([(B_2160, 30), (A_2160, 999), (DTSHD_2160, 2)], "1080p", False),
        # Mixed: one reject, one penalty, one bonus, one dead.
        ([(DTSHD_2160, 30), (XVID_1080, 30), (A_1080, 30), (B_1080, 0)], "1080p", True),
        # Nothing rejected at all.
        ([(A_1080, 30), (B_1080, 30), (PLAIN_1080, 30)], "1080p", False),
    ],
)
def test_nothing_is_ever_filtered(specs, ask, allow_2160p):
    """``len(out) == len(candidates)``, always, and the membership is identical.

    ``/sources`` is advisory: the web's alternatives modal and the in-player switcher are
    both guarded on a non-empty list, so dropping rows would make the web play a bad
    release with no warning instead of offering a better one. Refusing is ``/download``'s
    job, on the mark. A reject that is dropped instead of partitioned reddens here.
    """
    candidates = _ranked(specs, ask)
    out = apply_profile(candidates, PROFILE_ID, allow_2160p=allow_2160p)
    assert len(out) == len(candidates)
    assert sorted(c.source_id for c in out) == sorted(c.source_id for c in candidates)


def test_capability_never_changes_health():
    """A penalised **healthy** candidate still reports ``health == 'healthy'``.

    Folding the cost into ``health`` reddens this. That field drives the web's badges and
    its ``hasHealthierAlt`` gate (``health === 'healthy' && quality !== resolved``), so a
    cost folded into health would make a device-rejected release the alternative the modal
    actively *recommends* — and accepting that offer ships a magnet, which takes
    ``/download``'s verbatim bypass.
    """
    specs = [(XVID_1080, 30), (DTSHD_2160, 30), (A_1080, 2), (B_1080, 0)]
    candidates = _ranked(specs, "1080p")
    before = {c.release_title: c.health for c in candidates}
    assert before == {
        XVID_1080: "healthy", DTSHD_2160: "healthy", A_1080: "low", B_1080: "dead",
    }
    out = apply_profile(candidates, PROFILE_ID, allow_2160p=False)
    assert {c.release_title: c.health for c in out} == before
    # And specifically the penalised one, named, because that is the folding mutation.
    assert next(c for c in out if c.release_title == XVID_1080).health == "healthy"


@pytest.mark.parametrize("seeds", [0, 1, 4, 5, 100])
def test_health_order_knows_every_value_classify_health_can_return(seeds):
    """Drift pin. ``_HEALTH_ORDER`` is a **copy** of a map that lives as a local inside
    ``rank_candidates``, and ``capability.py`` may not import the selector — so the only
    guard available is this one. seeds 0 -> dead, 1/4 -> low, 5/100 -> healthy.
    """
    assert classify_health(seeds, **THRESHOLDS) in _HEALTH_ORDER


def test_health_order_has_exactly_the_three_tiers_and_in_the_right_direction():
    """A fourth value added to ``_HEALTH_ORDER`` reddens this, and so does a tier renamed
    in ``classify_health`` — the set equality is in both directions.
    """
    assert set(_HEALTH_ORDER) == {classify_health(s, **THRESHOLDS) for s in (0, 1, 4, 5, 100)}
    assert _HEALTH_ORDER["healthy"] < _HEALTH_ORDER["low"] < _HEALTH_ORDER["dead"]
    assert len(set(_HEALTH_ORDER.values())) == 3


def test_applying_a_profile_never_reorders_two_candidates_by_health():
    """The behavioural half of the drift pin: the second sort agrees with the first one
    about what "healthier" means. Invert ``_HEALTH_ORDER`` and this reddens even though
    every key is still present.
    """
    # Same title shape, same bucket, same bytes: only the seeder count differs, so health
    # is the only term that can be deciding — and every candidate has the same cost.
    candidates = _ranked([(A_1080, 0), (A_1080, 30), (A_1080, 2)], "1080p")
    assert [c.health for c in candidates] == ["healthy", "low", "dead"]
    out = apply_profile(candidates, PROFILE_ID, allow_2160p=False)
    assert [c.health for c in out] == ["healthy", "low", "dead"]


def test_a_health_string_the_profile_has_never_heard_of_sorts_last_without_raising():
    """``TorrentCandidate.health`` is a plain ``str``. ``_to_candidate`` only ever writes a
    ``classify_health`` return value, so this is unreachable from the endpoints — but a
    ``KeyError`` inside a sort key would surface as an opaque 500, and the branch is cheap
    enough to exercise rather than to argue about.
    """
    candidates = _ranked([(A_1080, 30), (B_1080, 30)], "1080p")
    candidates[0].health = "quantum"
    out = apply_profile(candidates, PROFILE_ID, allow_2160p=False)
    assert [c.health for c in out] == ["healthy", "quantum"]


def test_equal_cost_candidates_keep_their_pre_profile_order_exactly():
    """Stability, which is the whole mechanism: bucket/seeds/bytes order inside a
    (reject, health) group must survive byte-for-byte, because the capability term is the
    only thing the second sort adds.
    """
    specs = [(A_1080, 50), (A_1080, 30), (A_720, 999), (A_720, 6), (A_1080, 2), (A_720, 0)]
    candidates = _ranked(specs, "1080p")
    before = [(c.release_title, c.seeds) for c in candidates]
    out = apply_profile(candidates, PROFILE_ID, allow_2160p=False)
    assert [(c.release_title, c.seeds) for c in out] == before
    # Non-vacuity: this fixture really does exercise several buckets and health tiers.
    assert len({t for t, _ in before}) == 2
    assert {c.health for c in out} == {"healthy", "low", "dead"}


# --------------------------------------------------------------------------------------
# Costs: the penalty has to move something, or it is decoration
# --------------------------------------------------------------------------------------

@pytest.mark.parametrize(
    "penalised,control,rule_id",
    [
        (A_1080_DV, A_1080, "dolby-vision:in_force"),
        (AV1_1080, PLAIN_1080, "av1:in_force"),
        (XVID_1080, PLAIN_1080, "container-proxy-xvid-divx:in_force"),
    ],
)
def test_a_penalty_demotes_the_candidate_that_would_otherwise_win(
    penalised, control, rule_id
):
    """health, bucket, seeds AND bytes held equal; the pair differs in one token.

    With every other term of both sort keys tied, the pre-profile order is the **input**
    order (Python's sort is stable) — so the penalised release is put first on input and
    is therefore the one that would otherwise be downloaded. The pre-profile order is
    asserted here rather than assumed.

    **This is the row the stage lives or dies on:** drop the capability element from the
    key and rely on stability alone, and the pre-profile order survives — red.
    """
    candidates = _ranked([(penalised, 30), (control, 30)], "1080p")
    assert _titles(candidates) == [penalised, control], "pre-profile: the penalised one wins"
    out = apply_profile(candidates, PROFILE_ID, allow_2160p=False)
    assert _titles(out) == [control, penalised]
    assert rule_id in next(c for c in out if c.release_title == penalised).device_reasons
    # Nothing here is a refusal: a penalty means "worse, but it will play".
    assert [c.device_verdict for c in out] == [None, None]


def test_the_container_proxy_outweighs_every_within_bucket_guess():
    """R7 > R3-R6, through the ordering rather than by reading the constants.

    AV1 (+40) and XviD (+200) at the same health, bucket, seeds and bytes: XviD must lose
    to AV1. Equalise the two weights and this reddens; the arithmetic claim §7.2 calls a
    "heavy penalty" is therefore pinned where it is observable.
    """
    candidates = _ranked([(XVID_1080, 30), (AV1_1080, 30)], "1080p")
    assert _titles(candidates) == [XVID_1080, AV1_1080], "pre-profile: input order"
    out = apply_profile(candidates, PROFILE_ID, allow_2160p=False)
    assert _titles(out) == [AV1_1080, XVID_1080]


def test_tier_a_outranks_tier_b_at_the_same_health_bucket_and_seeds():
    """The project's one real measurement must be visible in the ordering.

    If H.264 and HEVC shared a single "preferred" tier, the combination that has actually
    played on this television would score identically to the one nobody has ever played.
    Tier B is put first on input, so the reversal is the assertion.
    """
    candidates = _ranked([(B_1080, 30), (A_1080_DDP, 30)], "1080p")
    assert _titles(candidates) == [B_1080, A_1080_DDP], "pre-profile: input order"
    out = apply_profile(candidates, PROFILE_ID, allow_2160p=False)
    assert _titles(out) == [A_1080_DDP, B_1080]


def test_a_penalised_healthy_release_still_outranks_an_unpenalised_dead_one():
    """Capability sits **below** health, deliberately: a penalty means "worse, but it will
    play", while a release under ``min_seeds`` will not start at all.

    Move the capability element **before** ``health_rank`` and this reddens — the XviD
    release carries the largest penalty in the table (+200) and must still win, because the
    alternative is a swarm that cannot start.
    """
    candidates = _ranked([(XVID_1080, 30), (A_1080, 0)], "1080p")
    assert [(c.release_title, c.health) for c in candidates] == [
        (XVID_1080, "healthy"), (A_1080, "dead"),
    ]
    out = apply_profile(candidates, PROFILE_ID, allow_2160p=False)
    assert _titles(out) == [XVID_1080, A_1080]
    assert [c.device_verdict for c in out] == [None, None]


def test_a_shadow_rule_is_reported_and_reorders_nothing():
    """R3/R4 ship in shadow: §7.2's own cell calls the DTS-at-1080p rule *unverified*, and
    reading 18 is what would promote it. Shadow means the match is **reported** and costs
    nothing, which is the "a rule that deliberately reorders nothing is still observable"
    claim, at the ordering layer.

    When reading 18 promotes R4 to ``in_force`` this row is expected to change — that is
    the one-cell edit task 4's mutation list describes, and this test is where it shows up.
    """
    candidates = _ranked([(DTSHD_1080, 30), (PLAIN_1080, 30)], "1080p")
    assert _titles(candidates) == [DTSHD_1080, PLAIN_1080], "pre-profile: input order"
    out = apply_profile(candidates, PROFILE_ID, allow_2160p=False)
    assert _titles(out) == [DTSHD_1080, PLAIN_1080], "a shadow rule must not reorder"
    reasons = next(c for c in out if c.release_title == DTSHD_1080).device_reasons
    assert reasons == ["dtshd-truehd-at-1080p:shadow"], reasons


# --------------------------------------------------------------------------------------
# The 4K opt-in and the two refusals. Today's red rows are the opt-OUT.
# --------------------------------------------------------------------------------------

def test_withheld_2160p_ranks_below_a_low_health_1080p_and_a_healthy_720p():
    """The hole this stage exists to close — leak (a), inverted.

    Pre-profile, ``health_rank`` is the first element of the sort key and ``bucket_order``
    makes 2160p the first downgrade target, so a healthy 999-seed 2160p is what a 1080p ask
    gets while the only exact 1080p is low-health. After the profile it is **last**, marked
    ``withheld``, below both.

    **This is the row that proves the 4K gate cannot be a weight.** Give R1 a cost instead
    of a reject — even ``cost=10**6`` — and this reddens, because ``health_rank`` precedes
    the cost term and the 2160p is the healthy one: no finite penalty can push it below a
    low-health release.
    """
    candidates = _ranked([(B_2160, 999), (A_1080, 2), (A_720, 30)], "1080p")
    assert [(c.release_title, c.seeds, c.health) for c in candidates] == [
        (B_2160, 999, "healthy"), (A_720, 30, "healthy"), (A_1080, 2, "low"),
    ], "pre-profile: the 4K release is what a 1080p ask gets today"

    out = apply_profile(candidates, PROFILE_ID, allow_2160p=False)
    assert _titles(out) == [A_720, A_1080, B_2160]
    assert _verdicts(out) == [(A_720, None), (A_1080, None), (B_2160, "withheld")]


def test_withheld_2160p_loses_to_a_720p_with_every_candidate_equally_healthy():
    """Leak (b), inverted — the mechanism leak (a) cannot explain.

    No exact 1080p exists, both hits are healthy and bytes are equal, so only the bucket
    term can be deciding pre-profile: a 6-seed 2160p beats a 999-seed 720p because
    ``-seeds`` is reached only when the bucket indices tie. After the profile the 720p
    wins, and the 2160p is marked.
    """
    candidates = _ranked([(A_720, 999), (B_2160, 6)], "1080p")
    assert {c.health for c in candidates} == {"healthy"}, "no health mismatch in leak (b)"
    assert _titles(candidates) == [B_2160, A_720], "pre-profile: 166x fewer seeders wins"
    out = apply_profile(candidates, PROFILE_ID, allow_2160p=False)
    assert _verdicts(out) == [(A_720, None), (B_2160, "withheld")]


def test_a_rejected_release_with_the_best_bonus_in_the_table_still_ranks_last():
    """``rejected`` is the **outermost** key element, so a reject is never the auto-pick
    whatever else it has going for it.

    The 2160p here is tier A (-20, the best bonus in the table) and healthy; the control
    matches no rule at all (cost 0) and is a bucket further down the downgrade walk, so
    pre-profile the reject is first. Drop ``rejected`` from the key and the bonus keeps it
    there — red. This is a *different* fixture from the leak-(a) row above on purpose: one
    position error is invisible to the other's fixture.
    """
    candidates = _ranked([(A_2160, 30), (PLAIN_720, 30)], "1080p")
    assert _titles(candidates) == [A_2160, PLAIN_720], (
        "pre-profile: with no exact 1080p, bucket_order puts 2160p ahead of 720p"
    )
    out = apply_profile(candidates, PROFILE_ID, allow_2160p=False)
    assert _verdicts(out) == [(PLAIN_720, None), (A_2160, "withheld")]


def test_the_4k_opt_in_is_the_only_difference_between_the_two_calls():
    """"With 4K on, a 2160p can win" passes with **zero code written**, so it is asserted
    here only as one half of a both-directions pair.

    The isolation is deliberate: the first two calls differ in **nothing but the
    ``allow_2160p`` argument** — same hits, same ask, same ranking — and both candidates are
    tier B, so their costs are equal and the capability term cannot move either. The only
    observable difference is therefore the mark, which is exactly what R1 contributes.
    The third call is the real 4K ask, where the 2160p ranks first.
    """
    specs = [(B_1080, 30), (B_2160, 30)]

    off = apply_profile(_ranked(specs, "1080p"), PROFILE_ID, allow_2160p=False)
    assert _verdicts(off) == [(B_1080, None), (B_2160, "withheld")]

    on = apply_profile(_ranked(specs, "1080p"), PROFILE_ID, allow_2160p=True)
    assert _verdicts(on) == [(B_1080, None), (B_2160, None)]

    asked = apply_profile(_ranked(specs, "2160p"), PROFILE_ID, allow_2160p=True)
    assert _verdicts(asked) == [(B_2160, None), (B_1080, None)]


def test_with_4k_opted_in_a_dts_hd_2160p_is_incapable_and_a_1080p_tier_a_wins():
    """The discriminating pair, and the whole stage in one assertion.

    A healthy 2160p HEVC + DTS-HD at **900** seeds against a healthy 2160p HEVC + E-AC3 at
    **10** — a 90x swarm advantage — plus a 1080p H.264 + E-AC3. 4K **is** opted into, so
    R1 does not fire and R2 is the only reject: ``incapable``, on the carrier rather than on
    the word "Atmos", whether or not 4K was asked for.

    The winner is the **1080p** release, because tier A (-20) beats tier B (-10) once the
    rejected row is partitioned out — which is the bonus ordering doing real work rather
    than decorating a verdict.
    """
    candidates = _ranked([(DTSHD_2160, 900), (B_2160, 10), (A_1080_DDP, 30)], "2160p")
    assert [(c.release_title, c.seeds, c.health) for c in candidates] == [
        (DTSHD_2160, 900, "healthy"), (B_2160, 10, "healthy"), (A_1080_DDP, 30, "healthy"),
    ], "pre-profile: the DTS-HD release is what a 4K ask gets today"

    out = apply_profile(candidates, PROFILE_ID, allow_2160p=True)
    assert _verdicts(out) == [
        (A_1080_DDP, None), (B_2160, None), (DTSHD_2160, "incapable"),
    ]


def test_a_2160p_dts_hd_release_is_incapable_rather_than_withheld_for_a_1080p_ask():
    """``REJECT_PRECEDENCE``, through the ordering. The candidate matches R1 **and** R2 and
    the label must be ``incapable``: opting into 4K would not help, that release cannot
    play here at any ask. Task 6's 404 copy depends on telling those two apart.
    """
    candidates = _ranked([(DTSHD_2160, 30), (A_1080, 30)], "1080p")
    out = apply_profile(candidates, PROFILE_ID, allow_2160p=False)
    assert _verdicts(out) == [(A_1080, None), (DTSHD_2160, "incapable")]
    assert next(c for c in out if c.release_title == DTSHD_2160).device_reasons == [
        "withheld-2160p:in_force", "dts-family-at-2160p:in_force",
    ]


def test_the_reject_group_is_ordered_by_health_then_cost_rather_than_dumped():
    """The reject group is partitioned, not shuffled: inside it health, then cost, then the
    first sort's bucket/seeds/bytes still decide. That keeps the list a usable *advisory*
    ordering for a client that chooses to ignore the mark — a rejected release is still
    reachable by magnet, because "reject" means never auto-chosen, not unreachable.

    All three here are rejects, so the partition itself is a no-op and the capability term
    is the only thing that can reorder them: tier A (-20) must overtake tier B (-10)
    despite 33x fewer seeders, and the low-health one stays last.
    """
    candidates = _ranked([(B_2160, 999), (A_2160, 30), (DTSHD_2160, 2)], "1080p")
    assert _titles(candidates) == [B_2160, A_2160, DTSHD_2160], "pre-profile: seeds decide"
    out = apply_profile(candidates, PROFILE_ID, allow_2160p=False)
    assert _verdicts(out) == [
        (A_2160, "withheld"), (B_2160, "withheld"), (DTSHD_2160, "incapable"),
    ]


def test_device_reasons_name_every_matched_rule_in_table_order_with_its_state():
    """``device_reasons`` is the honesty mechanism on the wire: it names shadowed and
    skipped matches too, so a rule that deliberately reorders nothing is still visible to a
    reader of the response.

    An accepted release can therefore carry reasons while ``device_verdict`` stays
    ``None``. **That asymmetry is deliberate and load-bearing:** ``/download`` picks with
    ``next(c for c in candidates if not c.device_verdict)``, so an accepted candidate's
    verdict MUST be falsy. (The stage-8 plan also says "with ``client`` set on
    ``/sources``, every candidate carries a non-null ``device_verdict``" — that sentence
    contradicts the skip in the same task and cannot be implemented beside it. The
    profile-ran signal is ``device_reasons`` plus the ordering, not a non-null verdict.)
    """
    candidates = _ranked([(A_1080_DV, 30), (DTSHD_1080, 30), (PLAIN_1080, 30)], "1080p")
    out = apply_profile(candidates, PROFILE_ID, allow_2160p=False)
    by_title = {c.release_title: c for c in out}
    assert by_title[A_1080_DV].device_reasons == [
        "dolby-vision:in_force", "preferred-measured:in_force",
    ], "table order, R5 before R8"
    assert by_title[DTSHD_1080].device_reasons == ["dtshd-truehd-at-1080p:shadow"]
    assert by_title[PLAIN_1080].device_reasons == []
    assert all(c.device_verdict is None for c in out)


def test_an_unlabelled_reject_still_marks_the_candidate_truthily(monkeypatch):
    """``/download`` skips on falsiness, so a reject whose ``verdict`` label went missing
    must not arrive as ``None`` and get auto-downloaded. ``evaluate`` falls back to the
    rule id; this row pins that the fallback survives the trip through ``apply_profile``
    onto the candidate.
    """
    unlabelled = (
        Rule(
            id="unlabelled-reject", when=lambda facts, allow_2160p: facts.resolution == 1080,
            effect=EFFECT_REJECT, cost=0, basis=BASIS_LG_TABLE, state=STATE_IN_FORCE,
            settled_by=(), why="test-only",
        ),
    )
    monkeypatch.setattr(cap, "PROFILES", {PROFILE_ID: unlabelled})
    out = apply_profile(_ranked([(A_1080, 30)], "1080p"), PROFILE_ID, allow_2160p=False)
    assert out[0].device_verdict == "unlabelled-reject"
    assert bool(out[0].device_verdict) is True


def test_a_cost_only_table_cannot_withhold_a_2160p_release(monkeypatch):
    """The arithmetic demonstration, stated directly rather than only as a mutation.

    R1 as a **cost** — here at ten million, far above every weight in the real table — and
    the 2160p release is still what a 1080p ask gets, because ``health_rank`` precedes the
    cost term and the 2160p is the healthy one. No weight can close leak (a); only a reject
    can. This is why ``evaluate`` takes ``allow_2160p`` at all.
    """
    cost_only = (
        Rule(
            id="costly-2160p",
            when=lambda facts, allow_2160p: facts.resolution == 2160 and not allow_2160p,
            effect=EFFECT_COST, cost=10 ** 7, basis=BASIS_PRODUCT, state=STATE_IN_FORCE,
            settled_by=(), why="test-only: the weight that cannot work",
        ),
    )
    monkeypatch.setattr(cap, "PROFILES", {PROFILE_ID: cost_only})
    candidates = _ranked([(B_2160, 999), (A_1080, 2)], "1080p")
    out = apply_profile(candidates, PROFILE_ID, allow_2160p=False)
    assert _titles(out) == [B_2160, A_1080], "a cost below health cannot reach a 4K release"
    assert [c.device_verdict for c in out] == [None, None]
