"""What :func:`evaluate` does, one rule at a time, on pairs that differ in one token.

Every rule gets a **pair of fact-dicts differing in exactly one key**, and the difference
is asserted mechanically (:func:`test_each_pair_differs_in_exactly_one_token`) — so no row
here can pass because some *other* rule produced the verdict. The pair's expected outcome
is written down as data in :data:`PAIRS` rather than derived from the rule it tests: a test
that computes its expectation from ``rule.cost`` and ``rule.state`` cannot fail when those
cells are mutated, which is the exact defect this stage has found five times already.

**On ``test_every_rule_is_observable``, and why it is not enough.** The plan asks for it to
catch two things: an unsatisfiable predicate, and "a row whose effect is already fully
implied by another row". It catches only the first. ``matched`` is total by design — it
names every rule whose predicate was true — so *any* rule that can match at all changes
``matched`` and passes, including a rule whose predicate is a duplicate of its neighbour's.
:func:`test_no_rule_is_implied_by_another` is the test that does the second job: it requires
a fixture in the pool on which each ordered pair of rules disagrees. Reported as a plan
finding rather than papered over.
"""
import dataclasses
import itertools

import pytest

from app.providers.quality import ReleaseFacts, parse_release_facts
from app.services import capability as cap

# The selector suites' own release titles. None of them names a codec, an audio track or a
# container, and the profile must treat all three unknowns as free — imported rather than
# retyped so the guarantee tracks the fixtures it is about.
from test_release_facts import SELECTOR_FIXTURE_TITLES

RULES_BY_ID = {rule.id: rule for rule in cap.RULES}

#: Hard-coded on the test side, deliberately. Reading these from ``rule.state`` would make
#: the shadow assertions derive their expectation from the very cell reading 18 promotes,
#: and flipping that cell would then come back green.
SHADOWED_IDS = ("dts-at-1080p", "dtshd-truehd-at-1080p")
SKIPPED_IDS = ("hevc-2160p-over-60mbps",)


def _facts(**kwargs) -> ReleaseFacts:
    return ReleaseFacts(**kwargs)


def _ids(verdict) -> set:
    return {match.rule_id for match in verdict.matched}


# (rule id, allow_2160p, facts that match, facts that do not, cost delta, reject label).
#
# ``delta`` is what this rule does to the verdict's cost, written out by hand: 0 for a
# reject (ordered by its own flag, outermost), 0 for a shadowed or skipped rule (it matches,
# it is reported, it reorders nothing), and the weight itself for an in-force cost or bonus.
PAIRS = (
    (
        "withheld-2160p",
        False,
        {"resolution": 2160},
        {"resolution": 1080},
        0,
        "withheld",
    ),
    (
        "dts-family-at-2160p",
        True,
        {"resolution": 2160, "audio": frozenset({"dtshd"})},
        {"resolution": 2160, "audio": frozenset({"eac3"})},
        0,
        "incapable",
    ),
    (
        "dts-at-1080p",
        False,
        {"resolution": 1080, "audio": frozenset({"dts"})},
        {"resolution": 1080, "audio": frozenset({"ac3"})},
        0,
        None,
    ),
    (
        "dtshd-truehd-at-1080p",
        False,
        {"resolution": 1080, "audio": frozenset({"truehd"})},
        {"resolution": 1080, "audio": frozenset({"eac3"})},
        0,
        None,
    ),
    (
        "dolby-vision",
        False,
        {"dynamic_range": "dv"},
        {"dynamic_range": "hdr10"},
        30,
        None,
    ),
    (
        "av1",
        False,
        {"video_family": "av1"},
        {"video_family": "hevc"},
        40,
        None,
    ),
    (
        "container-proxy-xvid-divx",
        False,
        {"container_guess": "avi"},
        {"container_guess": None},
        200,
        None,
    ),
    (
        "preferred-measured",
        False,
        {"video_family": "h264", "audio": frozenset({"eac3"})},
        {"video_family": "h264", "audio": frozenset({"dts"})},
        -20,
        None,
    ),
    (
        "documented-ok",
        False,
        {"video_family": "hevc", "audio": frozenset({"aac"})},
        {"video_family": "hevc", "audio": frozenset({"dts"})},
        -10,
        None,
    ),
    (
        # The whole R10 proof in one row: the pair differs **only** in a field the backend
        # cannot supply today, and with it supplied the rule fires. Both sides also match
        # R9, which is why the assertions below work on the *difference* rather than on the
        # absolute sets.
        "hevc-2160p-over-60mbps",
        True,
        {
            "video_family": "hevc",
            "resolution": 2160,
            "audio": frozenset({"eac3"}),
            "bitrate_mbps": 80.0,
        },
        {
            "video_family": "hevc",
            "resolution": 2160,
            "audio": frozenset({"eac3"}),
            "bitrate_mbps": None,
        },
        0,
        None,
    ),
)

_PARAMS = [pytest.param(*row, id=row[0]) for row in PAIRS]


def test_every_rule_in_the_table_has_a_pair():
    """A rule with no pair is a rule nobody tested, and a pair with no rule is a typo."""
    assert [row[0] for row in PAIRS] == [rule.id for rule in cap.RULES]
    assert len(PAIRS) == 10


@pytest.mark.parametrize("rule_id,allow,on,off,delta,label", _PARAMS)
def test_each_pair_differs_in_exactly_one_token(rule_id, allow, on, off, delta, label):
    """The guard against a fixture that satisfies its rule for the wrong reason.

    Already in the tree as a defect: ``test_parse_quality_4k_and_uhd_map_to_2160p`` uses
    ``4K.UHD``, where both tokens agree, so it pins nothing about the mixed case. A pair
    that differs in two fields cannot tell you which one the rule read.
    """
    assert set(on) == set(off), f"{rule_id}: the pair names different fields"
    differing = [key for key in on if on[key] != off[key]]
    assert len(differing) == 1, (
        f"{rule_id}: the pair differs in {differing}, not in exactly one token"
    )


@pytest.mark.parametrize("rule_id,allow,on,off,delta,label", _PARAMS)
def test_the_matching_side_adds_exactly_this_rule_and_nothing_else(
    rule_id, allow, on, off, delta, label
):
    """``matched`` is total, so the rule under test must be the *only* new entry."""
    matched = cap.evaluate(_facts(**on), allow_2160p=allow)
    unmatched = cap.evaluate(_facts(**off), allow_2160p=allow)

    assert _ids(matched) - _ids(unmatched) == {rule_id}
    assert _ids(unmatched) <= _ids(matched), (
        f"{rule_id}: the non-matching side matched something the matching side did not — "
        "the pair is not a one-token difference in effect"
    )
    entry = next(m for m in matched.matched if m.rule_id == rule_id)
    rule = RULES_BY_ID[rule_id]
    assert (entry.state, entry.effect) == (rule.state, rule.effect), (
        "matched reports the state and effect off the table, so a shadowed row is visible "
        "as shadowed from outside"
    )


@pytest.mark.parametrize("rule_id,allow,on,off,delta,label", _PARAMS)
def test_the_verdict_each_rule_produces(rule_id, allow, on, off, delta, label):
    """The cost delta and the reject label, both written by hand in :data:`PAIRS`.

    This is the row that reddens when a weight moves, when tier A is levelled with tier B,
    and — the one that matters most — when a shadowed rule is promoted: its measured delta
    stops being 0 while the expectation here still says 0.
    """
    matched = cap.evaluate(_facts(**on), allow_2160p=allow)
    unmatched = cap.evaluate(_facts(**off), allow_2160p=allow)

    assert matched.cost == unmatched.cost + delta, (
        f"{rule_id}: matching cost {matched.cost} vs non-matching {unmatched.cost}, "
        f"expected a delta of {delta}"
    )
    assert matched.reason == label
    assert matched.rejected is (label is not None)
    assert unmatched.rejected is False and unmatched.reason is None


@pytest.mark.parametrize("rule_id,allow,on,off,delta,label", _PARAMS)
def test_every_rule_is_observable(rule_id, allow, on, off, delta, label):
    """Integrity test 7: an unsatisfiable predicate fails here instead of sitting in the
    table forever looking enforced.

    It is weaker than the plan claims — see this module's docstring — so it is paired with
    :func:`test_no_rule_is_implied_by_another`.
    """
    matched = cap.evaluate(_facts(**on), allow_2160p=allow)
    unmatched = cap.evaluate(_facts(**off), allow_2160p=allow)
    assert matched != unmatched
    assert (matched.rejected, matched.cost) != (unmatched.rejected, unmatched.cost) or (
        matched.matched != unmatched.matched
    )


# Every fact-dict either side of every pair, under both asks, plus the two shapes no pair
# covers: nothing known at all, and a 12-bit HEVC.
POOL = tuple(
    (_facts(**facts), allow)
    for facts in [row[2] for row in PAIRS] + [row[3] for row in PAIRS]
    for allow in (False, True)
) + (
    (ReleaseFacts(), False),
    (ReleaseFacts(), True),
    (_facts(video_family="hevc", audio=frozenset({"eac3"}), bit_depth=12), True),
)


def test_no_rule_is_implied_by_another():
    """A row whose predicate is already another row's cannot be observed through ``matched``.

    Two rules that agree on every fixture are one rule with two names: deleting either
    changes nothing a test can see, and the table reads as if it enforced two things.
    """
    for left, right in itertools.combinations(cap.RULES, 2):
        disagreements = [
            facts
            for facts, allow in POOL
            if left.when(facts, allow) != right.when(facts, allow)
        ]
        assert disagreements, (
            f"{left.id} and {right.id} agree on every fixture in the pool — one of them is "
            "unobservable, or the pool is missing the case that separates them"
        )


@pytest.mark.parametrize(
    "rule_id", SHADOWED_IDS + SKIPPED_IDS, ids=SHADOWED_IDS + SKIPPED_IDS
)
def test_a_shadow_or_skipped_rule_never_changes_the_effect(rule_id):
    """It matches, it is reported, it reorders **nothing**.

    This is the row reading 18 will redden on purpose: promoting R3 is a one-cell edit to
    ``state``, and the promotion must be visible here rather than silently changing the
    library's order. The ids are hard-coded above precisely so the flip cannot make this
    test skip the rule it is about.
    """
    rule_id_, allow, on, off, _delta, _label = next(
        row for row in PAIRS if row[0] == rule_id
    )
    matched = cap.evaluate(_facts(**on), allow_2160p=allow)
    unmatched = cap.evaluate(_facts(**off), allow_2160p=allow)

    assert matched.cost == unmatched.cost, (
        f"{rule_id_} is not in force, so it must not move the cost"
    )
    assert matched.rejected == unmatched.rejected
    assert matched.reason == unmatched.reason
    assert rule_id_ in _ids(matched), "...but it must still be reported"
    assert _ids(matched) != _ids(unmatched)


# -- unknown is free -------------------------------------------------------------------


@pytest.mark.parametrize("allow", [False, True])
def test_a_release_that_claims_nothing_matches_nothing(allow):
    verdict = cap.evaluate(ReleaseFacts(), allow_2160p=allow)
    assert verdict == cap.Verdict(rejected=False, reason=None, cost=0, matched=())


@pytest.mark.parametrize("title", SELECTOR_FIXTURE_TITLES)
@pytest.mark.parametrize("allow", [False, True])
def test_every_selector_fixture_title_is_free(title, allow):
    """The shape that makes "unknown is free" testable, on the real fixture titles.

    These name no container, no codec and no audio track, so the whole table must be silent
    on them. R7 firing on ``container_guess is None`` reddens every one of these rows.
    """
    verdict = cap.evaluate(parse_release_facts(title), allow_2160p=allow)
    assert verdict.cost == 0 and verdict.rejected is False, verdict
    assert verdict.matched == ()


# -- real titles, end to end through the parser ----------------------------------------


def test_the_legal_4k_atmos_release_is_not_rejected():
    """The deliberate deviation from LG's wording, measured.

    Atmos rides on E-AC3 here (DDP5.1), which §3.2's Ultra HD table permits. A rule that
    vetoed the word "Atmos" would reject a release the television can play — and this is
    the row that reddens when it does.
    """
    facts = parse_release_facts("Movie.2021.2160p.HDR10+.HEVC.DDP5.1.Atmos-GRP")
    assert facts.audio == {"eac3", "atmos"}, "the parser still reports the flag"

    verdict = cap.evaluate(facts, allow_2160p=True)
    assert verdict.rejected is False and verdict.reason is None
    assert _ids(verdict) == {"documented-ok"}
    assert verdict.cost == -10


def test_the_same_release_is_withheld_when_4k_was_not_asked_for():
    """One token of difference from the row above — the ask, not the release."""
    facts = parse_release_facts("Movie.2021.2160p.HDR10+.HEVC.DDP5.1.Atmos-GRP")
    verdict = cap.evaluate(facts, allow_2160p=False)
    assert verdict.rejected is True and verdict.reason == "withheld"
    assert _ids(verdict) == {"withheld-2160p", "documented-ok"}


def test_a_4k_truehd_atmos_remux_is_incapable_on_the_carrier():
    """Atmos on TrueHD, which §3.2 forbids at 4K. The veto is on ``truehd``."""
    facts = parse_release_facts(
        "Movie.2016.2160p.UHD.BluRay.REMUX.HEVC.DTS-HD.MA.TrueHD.7.1.Atmos-GRP"
    )
    assert facts.audio == {"dtshd", "truehd", "atmos"}

    verdict = cap.evaluate(facts, allow_2160p=True)
    assert verdict.rejected is True and verdict.reason == "incapable"
    assert _ids(verdict) == {"dts-family-at-2160p"}


def test_incapable_beats_withheld_when_a_candidate_matches_both():
    """Opting into 4K would not help this release, so the label must not say it would.

    ``withheld`` reads as "press 4K"; ``incapable`` reads as "this cannot play here". A
    2160p DTS-HD release asked for at 1080p is both, and only one of those sentences is
    true.
    """
    facts = parse_release_facts("Movie.2016.2160p.BluRay.DTS-HD.MA.5.1.HEVC-GRP")
    verdict = cap.evaluate(facts, allow_2160p=False)
    assert _ids(verdict) == {"withheld-2160p", "dts-family-at-2160p"}
    assert verdict.reason == "incapable"


def test_the_uhd_mislabel_is_contained_by_facts_resolution():
    """``parse_quality`` buckets this title as 2160p; the profile does not withhold it.

    That containment is the whole reason task 2 gave ``ReleaseFacts`` its own resolution
    instead of reordering ``_QUALITY_PATTERNS`` for every desktop user.
    """
    from app.providers.quality import parse_quality

    title = "Movie.2020.1080p.UHD.BluRay.DD5.1.x265-GRP"
    assert parse_quality(title) == "2160p"
    assert parse_release_facts(title).resolution == 1080

    verdict = cap.evaluate(parse_release_facts(title), allow_2160p=False)
    assert verdict.rejected is False
    assert _ids(verdict) == {"documented-ok"}


def test_an_avi_release_carries_the_heavy_penalty_and_a_1080p_h264_one_does_not():
    heavy = cap.evaluate(parse_release_facts("Movie.2005.DVDRip.XviD.MP3-GRP"), allow_2160p=False)
    assert _ids(heavy) == {"container-proxy-xvid-divx"}
    assert heavy.cost == 200 and heavy.rejected is False

    preferred = cap.evaluate(
        parse_release_facts("Movie.2020.1080p.BluRay.DD5.1.x264-GRP"), allow_2160p=False
    )
    assert _ids(preferred) == {"preferred-measured"}
    assert preferred.cost == -20


def test_costs_stack_and_a_bonus_can_be_outweighed():
    """Two in-force penalties sum; a tier-A bonus does not excuse a Dolby Vision MKV."""
    both = cap.evaluate(
        _facts(dynamic_range="dv", container_guess="avi"), allow_2160p=False
    )
    assert _ids(both) == {"dolby-vision", "container-proxy-xvid-divx"}
    assert both.cost == 230

    outweighed = cap.evaluate(
        _facts(video_family="h264", audio=frozenset({"eac3"}), dynamic_range="dv"),
        allow_2160p=False,
    )
    assert outweighed.cost == 10, "a 30-point penalty against a 20-point bonus"
    assert outweighed.rejected is False


def test_a_named_12_bit_hevc_gets_no_bonus_and_no_penalty():
    """R9 is narrower than its name: 12-bit is outside the table its basis is.

    LG lists Main / Main10. A positively named 12-bit HEVC therefore earns no "documented"
    bonus — and is still never penalised and never rejected, which is the "no bit-depth
    gate" the stage records as a known gap rather than a feature.
    """
    documented = cap.evaluate(
        _facts(video_family="hevc", audio=frozenset({"eac3"}), bit_depth=10),
        allow_2160p=False,
    )
    assert documented.cost == -10

    twelve_bit = cap.evaluate(
        _facts(video_family="hevc", audio=frozenset({"eac3"}), bit_depth=12),
        allow_2160p=False,
    )
    assert twelve_bit.matched == ()
    assert twelve_bit.cost == 0 and twelve_bit.rejected is False

    unknown_depth = cap.evaluate(
        _facts(video_family="hevc", audio=frozenset({"eac3"})), allow_2160p=False
    )
    assert unknown_depth.cost == -10, "unknown must be free, and here that means documented"


# -- R10: a deferral, not code nobody wrote --------------------------------------------


def test_r10_fires_the_moment_a_bitrate_exists_and_cannot_fire_without_one():
    """The proof that R10 is plumbed and only its input is absent.

    No title can produce a bitrate — ``parse_release_facts`` returns ``None`` even for a
    title that names "80Mbps" — and no runtime reaches the selector, so the field is
    always ``None`` in stage 8. Inject one and the rule matches, which is the difference
    between a deferral and a row nobody wrote.
    """
    title = "Movie.2021.2160p.HEVC.80Mbps.DDP5.1-GRP"
    facts = parse_release_facts(title)
    assert facts.bitrate_mbps is None, "the title says 80Mbps and the parser still says None"

    without = cap.evaluate(facts, allow_2160p=True)
    assert "hevc-2160p-over-60mbps" not in _ids(without)

    with_bitrate = cap.evaluate(
        dataclasses.replace(facts, bitrate_mbps=80.0), allow_2160p=True
    )
    assert with_bitrate != without, "the verdict must change — that is the plumbing proof"
    assert "hevc-2160p-over-60mbps" in _ids(with_bitrate)

    entry = next(
        m for m in with_bitrate.matched if m.rule_id == "hevc-2160p-over-60mbps"
    )
    assert (entry.state, entry.effect) == (cap.STATE_SKIPPED, cap.EFFECT_NONE)
    assert with_bitrate.cost == without.cost, "it fires, and it still reorders nothing"


@pytest.mark.parametrize(
    "mbps,fires",
    [(None, False), (10.0, False), (60.0, False), (60.1, True), (120.0, True)],
)
def test_the_60_mbps_ceiling_is_the_one_section_3_2_states(mbps, fires):
    """``3840x2160@60P Main/Main10@L5.1, maximum 60 Mbps`` — so 60 passes and 60.1 does not."""
    facts = _facts(
        video_family="hevc",
        resolution=2160,
        audio=frozenset({"eac3"}),
        bitrate_mbps=mbps,
    )
    verdict = cap.evaluate(facts, allow_2160p=True)
    assert ("hevc-2160p-over-60mbps" in _ids(verdict)) is fires


def test_the_bitrate_rule_reads_the_resolution_and_the_codec_too():
    """A 1080p HEVC at 200 Mbps is not what §3.2's 4K ceiling is about, and neither is AV1."""
    for facts in (
        _facts(video_family="hevc", resolution=1080, bitrate_mbps=200.0),
        _facts(video_family="av1", resolution=2160, bitrate_mbps=200.0),
    ):
        assert "hevc-2160p-over-60mbps" not in _ids(
            cap.evaluate(facts, allow_2160p=True)
        )


# -- totality --------------------------------------------------------------------------

_AUDIO_SETS = (
    frozenset(),
    frozenset({"ac3"}),
    frozenset({"eac3", "atmos"}),
    frozenset({"dts"}),
    frozenset({"dtshd", "truehd", "atmos"}),
    frozenset({"aac", "flac"}),
)


@pytest.mark.parametrize("allow", [False, True])
def test_evaluate_is_total_over_every_shape_of_facts(allow):
    """It answers for every combination, and its answer is always self-consistent.

    ``rejected`` is read off the matched effects and ``reason`` is only the label, so the
    two can never disagree; ``cost`` is the sum of the in-force matches and nothing else;
    and ``matched`` is in table order, which is what lets a reader diff two verdicts.
    """
    order = [rule.id for rule in cap.RULES]
    checked = 0
    for resolution, audio, family, dynamic_range in itertools.product(
        (None, 480, 720, 1080, 2160),
        _AUDIO_SETS,
        (None, "h264", "hevc", "av1", "xvid"),
        (None, "dv", "hdr10"),
    ):
        facts = _facts(
            resolution=resolution,
            audio=audio,
            video_family=family,
            dynamic_range=dynamic_range,
            container_guess="avi" if family == "xvid" else None,
        )
        verdict = cap.evaluate(facts, allow_2160p=allow)
        checked += 1

        assert verdict.rejected is (verdict.reason is not None)
        assert [m.rule_id for m in verdict.matched] == [
            rule_id for rule_id in order if rule_id in _ids(verdict)
        ], "matched is not in table order"
        assert verdict.cost == sum(
            RULES_BY_ID[m.rule_id].cost
            for m in verdict.matched
            if m.state == cap.STATE_IN_FORCE
        )
        if verdict.rejected:
            assert verdict.reason in cap.REJECT_PRECEDENCE
    assert checked == 450


# -- the registry is a parameter, not decoration ---------------------------------------


def test_a_hostile_table_can_be_injected_and_is_what_decides():
    """``evaluate`` reads the rules it is handed, so :data:`PROFILES` is load-bearing.

    Also the reason task 5 can monkeypatch a registry that rejects everything and still
    prove the no-profile path is untouched.
    """
    hostile = cap.Rule(
        id="hostile-everything",
        when=lambda facts, allow_2160p: True,
        effect=cap.EFFECT_REJECT,
        cost=0,
        basis=cap.BASIS_LG_TABLE,
        state=cap.STATE_IN_FORCE,
        settled_by=(),
        verdict="incapable",
        why="a test's table, never shipped",
    )
    verdict = cap.evaluate(ReleaseFacts(), allow_2160p=False, rules=(hostile,))
    assert verdict.rejected is True and verdict.reason == "incapable"

    assert cap.evaluate(ReleaseFacts(), allow_2160p=False, rules=()) == cap.Verdict(
        rejected=False, reason=None, cost=0, matched=()
    )


def test_a_reject_with_no_label_still_reads_as_rejected():
    """The fallback that stops an unlabelled reject from being auto-downloaded.

    ``device_verdict`` is skipped on falsiness, so a reject whose label went missing must
    not arrive as ``None``. The integrity tests forbid that state in the shipped table;
    this exercises the fallback anyway, so it is not a branch nothing can reach.
    """
    unlabelled = cap.Rule(
        id="unlabelled-reject",
        when=lambda facts, allow_2160p: True,
        effect=cap.EFFECT_REJECT,
        cost=0,
        basis=cap.BASIS_LG_TABLE,
        state=cap.STATE_IN_FORCE,
        settled_by=(),
        why="a test's table, never shipped",
    )
    verdict = cap.evaluate(ReleaseFacts(), allow_2160p=False, rules=(unlabelled,))
    assert verdict.rejected is True
    assert verdict.reason == "unlabelled-reject"


def test_a_shadowed_reject_in_an_injected_table_rejects_nothing():
    """State gates the effect, not just the weight: shadow applies to a reject too."""
    shadowed = cap.Rule(
        id="shadowed-reject",
        when=lambda facts, allow_2160p: True,
        effect=cap.EFFECT_REJECT,
        cost=0,
        basis=cap.BASIS_LG_TABLE,
        state=cap.STATE_SHADOW,
        settled_by=(),
        verdict="incapable",
        why="a test's table, never shipped",
    )
    verdict = cap.evaluate(ReleaseFacts(), allow_2160p=False, rules=(shadowed,))
    assert verdict.rejected is False and verdict.reason is None
    assert _ids(verdict) == {"shadowed-reject"}
