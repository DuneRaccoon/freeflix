"""Integrity tests for the capability table: the mechanism that makes a dishonest row red.

Nothing here calls :func:`evaluate`. These tests read the table as data and assert the
properties that keep it honest, because the failure mode this stage is most exposed to is
not a wrong answer — it is a row that **looks** enforced and is not, or a guess that has
quietly become a refusal to play.

Six of the plan's seven integrity tests live here. The seventh,
``test_every_rule_is_observable``, needs fixtures and lives in
``test_capability_evaluate.py`` beside them — together with
``test_no_rule_is_implied_by_another``, which exists because observability as the plan
defines it **cannot** catch a duplicated row (see that file's docstring).

Two things are deliberately tests rather than import-time asserts: the basis ceiling and
the token spellings. An import-time check would take the backend down and bury which
invariant moved; a test names the row.
"""
import pytest

from app.providers.quality import (
    AUDIO_TOKENS,
    BIT_DEPTHS,
    CONTAINER_TOKENS,
    DYNAMIC_RANGES,
    VIDEO_FAMILIES,
)
from app.services import capability as cap

RULES_BY_ID = {rule.id: rule for rule in cap.RULES}

#: The ten rules, in the order the plan's table numbers them. Named here so a deleted or
#: renamed rule fails in one obvious place rather than silently shrinking every
#: parametrised test below.
EXPECTED_RULE_IDS = (
    "withheld-2160p",            # R1
    "dts-family-at-2160p",       # R2
    "dts-at-1080p",              # R3
    "dtshd-truehd-at-1080p",     # R4
    "dolby-vision",              # R5
    "av1",                       # R6
    "container-proxy-xvid-divx",  # R7
    "preferred-measured",        # R8
    "documented-ok",             # R9
    "hevc-2160p-over-60mbps",    # R10
)


def test_the_table_is_the_ten_rules_in_order():
    """A count and an order pin, beside every parametrised test that walks ``RULES``.

    A parametrised test that iterates an exported tuple loses coverage *silently* when the
    tuple shrinks: delete a rule and its rows stop running rather than failing. Bump this
    deliberately, with rows, never to make a run green.
    """
    assert tuple(rule.id for rule in cap.RULES) == EXPECTED_RULE_IDS
    assert len(cap.RULES) == 10
    assert len(RULES_BY_ID) == 10, "duplicate rule ids hide one of the two rows"


def test_the_profile_registry_holds_exactly_this_table():
    """The client sends a name; the table lives here (§7.2).

    One profile, and ``evaluate`` defaults to its rules — so the registry is load-bearing
    rather than decorative. A second television is a new id with its own tuple.

    This asserts the **contents**, not identity, and that is deliberate: ``x is RULES``
    cannot fail for a tuple. Measured in this image — ``tuple(t) is t``, ``t[:] is t`` and
    ``t + () is t`` are all True, so every obvious way of writing "a copy" hands back the
    same object. (The same assertion on a *list* is falsifiable: ``list(l) is l`` and
    ``l[:] is l`` are both False — which is why task 5's ``apply_profile`` identity
    guarantee can legitimately be asserted with ``is``.)
    """
    assert cap.PROFILE_ID == "lg-webos22-floor"
    assert list(cap.PROFILES) == [cap.PROFILE_ID]
    assert [rule.id for rule in cap.PROFILES[cap.PROFILE_ID]] == list(EXPECTED_RULE_IDS)


# -- integrity test 1: the closed sets -------------------------------------------------


@pytest.mark.parametrize("rule", cap.RULES, ids=[r.id for r in cap.RULES])
def test_every_rule_declares_a_basis_a_state_and_an_effect_from_its_closed_set(rule):
    assert rule.basis in cap.BASES, f"{rule.id}: basis {rule.basis!r} is not in the closed set"
    assert rule.state in cap.STATES, f"{rule.id}: state {rule.state!r} is not in the closed set"
    assert rule.effect in cap.EFFECTS, f"{rule.id}: effect {rule.effect!r} is not an effect"
    assert rule.why.strip(), f"{rule.id}: every row states why it says what it says"


def test_every_basis_in_the_closed_set_has_a_ceiling():
    """A basis with no ceiling row would license anything, silently."""
    assert set(cap.BASIS_CEILING) == set(cap.BASES)
    assert set(cap.UNSETTLED_BASES) <= set(cap.BASES)


@pytest.mark.parametrize("rule", cap.RULES, ids=[r.id for r in cap.RULES])
def test_no_rule_exceeds_the_ceiling_its_basis_licenses(rule):
    """The one table that stops "we think" from becoming "we refuse to play it".

    Only ``lg-table`` and ``product`` may reject; ``lg-doc``, ``inferred`` and ``guess``
    may cost only; ``no-input`` forces ``none``.
    """
    licensed = cap.BASIS_CEILING[rule.basis]
    assert rule.effect in licensed, (
        f"{rule.id}: basis {rule.basis!r} licenses {sorted(licensed)}, "
        f"not {rule.effect!r}"
    )


@pytest.mark.parametrize("rule", cap.RULES, ids=[r.id for r in cap.RULES])
def test_the_sign_of_a_cost_agrees_with_the_effect_it_is_declared_as(rule):
    """A penalty is positive, a bonus is negative, a reject and a no-op are 0.

    Without this, a "bonus" with a positive weight would demote the release it claims to
    prefer, and the effect column would be decoration.
    """
    if rule.effect == cap.EFFECT_COST:
        assert rule.cost > 0, f"{rule.id}: a cost that does not cost"
    elif rule.effect == cap.EFFECT_BONUS:
        assert rule.cost < 0, f"{rule.id}: a bonus that does not prefer"
    else:
        assert rule.cost == 0, (
            f"{rule.id}: {rule.effect!r} carries no weight — a reject is ordered by its "
            "own flag, outermost, and a no-op by nothing at all"
        )


# -- integrity test 2 + 3: provenance, both directions ---------------------------------

READING_IDS = {row.id for row in cap.READINGS_ROWS}


def test_the_readings_sheet_is_pinned():
    """Rows 16-26, numbered from 16 so the project's reading ids stay globally unique."""
    assert [row.id for row in cap.READINGS_ROWS] == [str(n) for n in range(16, 27)]
    assert len(cap.READINGS_ROWS) == 11
    assert {row.id for row in cap.READINGS_ROWS if row.standalone} == {"22", "26"}
    assert {row.id for row in cap.READINGS_ROWS if row.gating} == {"16", "18", "23"}
    for row in cap.READINGS_ROWS:
        assert row.reading.strip() and row.instrument.strip() and row.effect_on_rules.strip(), (
            f"reading {row.id}: a blank cell is a failure, not a pass"
        )


@pytest.mark.parametrize("rule", cap.RULES, ids=[r.id for r in cap.RULES])
def test_an_unsettled_rule_names_the_reading_that_would_retire_it(rule):
    """``settled_by`` is required for every basis that is not settled yet.

    NOTE on the plan's wording: integrity test 2 says "required **iff** basis ∈
    {inferred, guess, no-input}". The literal *iff* is contradicted by the plan's own rules
    table, which gives R2 (``lg-table``) reading 24, R5 (``lg-doc``) reading 21 and R9
    (``lg-table``) readings 16/17/23 — and integrity test 3 needs those claims, because
    without them readings 16, 17, 21, 23 and 24 are claimed by nobody. So the enforced
    rule is: **required** for an unsettled basis, **permitted** for a documented one, and
    **forbidden** for the two bases that nothing on a television could settle — a product
    decision and an already-taken measurement.
    """
    if rule.basis in cap.UNSETTLED_BASES:
        assert rule.settled_by, (
            f"{rule.id}: basis {rule.basis!r} is a guess with nowhere to go — name the "
            "reading that would retire it"
        )
    elif rule.basis in (cap.BASIS_PRODUCT, cap.BASIS_MEASURED):
        assert not rule.settled_by, (
            f"{rule.id}: basis {rule.basis!r} is not settled by a reading on the set"
        )


@pytest.mark.parametrize("rule", cap.RULES, ids=[r.id for r in cap.RULES])
def test_every_reading_a_rule_names_exists(rule):
    for reading_id in rule.settled_by:
        assert reading_id in READING_IDS, (
            f"{rule.id}: settled_by names reading {reading_id!r}, which is not a row of "
            "READINGS_ROWS — a rule pointing at a reading nobody will take"
        )


def test_every_reading_is_claimed_by_a_rule_or_is_standalone():
    """The other direction: a reading nothing claims is a sitting nobody needs.

    Rows 22 and 26 are flagged ``standalone`` because they **settle no rule**: 22 measures
    a premise (whether the containers R7 does *not* penalise actually play) and 26 a fact
    about the device (SKU and user agent).

    Row 22 is *both* claimed and flagged, and that is deliberate. The plan's integrity test
    3 is a disjunction, so the two are consistent — but the reason is worth writing down:
    the sheet contains **no reading that would retire R7**, because nothing in it plays an
    AVI. R7 cites 22 as the nearest reading that bears on it and records the gap in its own
    ``why``. The flag is what licenses an *unclaimed* row; it does not forbid a claimed one.
    """
    claimed = {reading_id for rule in cap.RULES for reading_id in rule.settled_by}
    standalone = {row.id for row in cap.READINGS_ROWS if row.standalone}
    unaccounted = READING_IDS - claimed - standalone
    assert not unaccounted, (
        f"readings claimed by no rule and not flagged standalone: {sorted(unaccounted)}"
    )
    assert claimed & standalone == {"22"}, (
        "exactly one reading is both claimed and flagged as settling nothing — see R7's "
        f"why for the gap that leaves; got {sorted(claimed & standalone)}"
    )


# -- integrity test 4: exactly two rejects ---------------------------------------------


def test_exactly_two_rules_reject_and_only_a_table_or_the_product_may():
    """Every other rule is a weight. This is the whole posture of the profile.

    §7.2 contemplates one movement — penalty to reject — so the number of rules that can
    make a release unplayable on this television is a number worth asserting.
    """
    rejects = [rule for rule in cap.RULES if rule.effect == cap.EFFECT_REJECT]
    assert [rule.id for rule in rejects] == ["withheld-2160p", "dts-family-at-2160p"]
    assert {rule.basis for rule in rejects} == {cap.BASIS_PRODUCT, cap.BASIS_LG_TABLE}


@pytest.mark.parametrize("rule", cap.RULES, ids=[r.id for r in cap.RULES])
def test_a_reject_carries_a_label_the_television_can_read_and_nothing_else_does(rule):
    """``device_verdict`` on the wire is exactly one of these two strings.

    A reject with no label would reach the client as a falsy verdict, and
    ``if not candidate.device_verdict`` is what skips it — so an unlabelled reject would be
    auto-downloaded. A label on a non-rejecting rule is the mirror defect: it would read as
    a refusal in ``device_reasons``.
    """
    if rule.effect == cap.EFFECT_REJECT:
        assert rule.verdict in cap.REJECT_PRECEDENCE, (
            f"{rule.id}: a reject's label must be one of {cap.REJECT_PRECEDENCE}"
        )
    else:
        assert rule.verdict is None, f"{rule.id}: only a reject carries a verdict label"


def test_reject_precedence_is_pinned_and_covers_every_label_in_use():
    """``incapable`` before ``withheld``, and the order is load-bearing.

    A candidate can match both rejects — a 2160p DTS-HD release asked for at 1080p — and
    task 6's refusal copy tells "enable 4K and it will work" apart from "this cannot play
    here" on exactly this label. Reversing the tuple makes the television offer an action
    that would not help.
    """
    assert cap.REJECT_PRECEDENCE == ("incapable", "withheld")
    labels = {rule.verdict for rule in cap.RULES if rule.effect == cap.EFFECT_REJECT}
    assert labels == set(cap.REJECT_PRECEDENCE)


# -- integrity test 5: R10 is inert, and says so ---------------------------------------


def test_a_no_input_rule_is_inert_and_carries_its_reason():
    """R10 ships present, inert and provably plumbed.

    The "reason is non-empty" half is weak on its own — every rule's ``why`` is non-empty,
    asserted above — so the teeth here are ``effect == none`` **and** ``cost == 0`` **and**
    the reason naming the reading that would reinstate it. Giving R10 a weight reddens this
    row and the basis-ceiling row together.
    """
    no_input = [rule for rule in cap.RULES if rule.basis == cap.BASIS_NO_INPUT]
    assert [rule.id for rule in no_input] == ["hevc-2160p-over-60mbps"]
    rule = no_input[0]
    assert rule.effect == cap.EFFECT_NONE
    assert rule.cost == 0
    assert rule.state == cap.STATE_SKIPPED
    assert rule.settled_by == ("25",)
    assert "no runtime reaches the selector" in rule.why
    assert "25" in rule.why


def test_the_three_states_are_the_vocabulary_the_spec_table_uses():
    """IN FORCE / SHADOW / NOT IMPLEMENTED, because a six-month reader opens the spec.

    The two shadowed rows are the DTS-at-1080p pair and nothing else: §7.2 calls that cell
    unverified, and shadow is only defensible where a *specified* reading can promote it
    (18, 19). R6 is the rule that is weak on its own evidence and stays in force anyway,
    because §11.2 requires a real AV1 penalty.
    """
    by_state = {}
    for rule in cap.RULES:
        by_state.setdefault(rule.state, []).append(rule.id)
    assert sorted(by_state[cap.STATE_SHADOW]) == ["dts-at-1080p", "dtshd-truehd-at-1080p"]
    assert by_state[cap.STATE_SKIPPED] == ["hevc-2160p-over-60mbps"]
    assert "av1" in by_state[cap.STATE_IN_FORCE]
    assert set(by_state) == set(cap.STATES), "a state nothing uses, or a state unaccounted for"


# -- integrity test 6: the two strict orderings ----------------------------------------


def test_tier_a_is_strictly_better_than_tier_b():
    """If H.264 and HEVC shared one "preferred" tier, the project's only *reading* would
    score identically to the combination nobody has ever played, and would be invisible in
    the ordering."""
    tier_a = RULES_BY_ID["preferred-measured"]
    tier_b = RULES_BY_ID["documented-ok"]
    assert tier_a.effect == tier_b.effect == cap.EFFECT_BONUS
    assert -tier_a.cost > -tier_b.cost, (
        "tier A's bonus must be strictly greater than tier B's: measured beats documented"
    )
    assert tier_a.basis == cap.BASIS_MEASURED and tier_b.basis == cap.BASIS_LG_TABLE


def test_the_container_proxy_outweighs_every_within_bucket_guess():
    """§7.2 says "heavy penalty", and a flat cost tier would flatten exactly the magnitude
    it bothered to state. Strictly larger than R3-R6 individually **and** summed."""
    heavy = RULES_BY_ID["container-proxy-xvid-divx"]
    guesses = [
        RULES_BY_ID["dts-at-1080p"],
        RULES_BY_ID["dtshd-truehd-at-1080p"],
        RULES_BY_ID["dolby-vision"],
        RULES_BY_ID["av1"],
    ]
    for rule in guesses:
        assert heavy.cost > rule.cost, f"the heavy penalty does not outweigh {rule.id}"
    assert heavy.cost > sum(rule.cost for rule in guesses)


def test_the_two_shadowed_guesses_carry_their_own_weights():
    """R3 and R4 are separate rules with separate weights, not one merged rule.

    §7.2's 1080p cell says only "DTS" while §3.2 lumps four codecs at 2160p, and nothing
    states which the 1080p rule covers. Equal weights would make the split cosmetic.
    """
    r3 = RULES_BY_ID["dts-at-1080p"]
    r4 = RULES_BY_ID["dtshd-truehd-at-1080p"]
    assert r4.cost > r3.cost, "a lossless track is a bigger decode ask than a lossy one"
    assert r3.settled_by == ("18",) and r4.settled_by == ("19",)


# -- the drift guards on the token spellings -------------------------------------------
#
# capability.py spells a *subset* of each domain, which cannot be derived from the whole,
# and providers/quality.py is not this stage's file to extend. These are the guard: a token
# renamed there reddens one named row here instead of silently never matching.


def test_every_audio_token_the_rules_name_is_a_real_audio_token():
    assert cap._DTS_FAMILY <= AUDIO_TOKENS, (
        f"renamed in quality.py: {sorted(cap._DTS_FAMILY - AUDIO_TOKENS)}"
    )
    assert cap._DOLBY_OR_AAC <= AUDIO_TOKENS, (
        f"renamed in quality.py: {sorted(cap._DOLBY_OR_AAC - AUDIO_TOKENS)}"
    )
    assert cap._DTS_FAMILY == {"dts", "dtshd", "truehd"}
    assert cap._DOLBY_OR_AAC == {"ac3", "eac3", "aac"}
    assert not (cap._DTS_FAMILY & cap._DOLBY_OR_AAC)


def test_atmos_is_a_flag_beside_a_carrier_and_never_a_carrier_itself():
    """The deliberate deviation from LG's own wording, pinned as a property of the table.

    §7.2 and §3.2 both name "Atmos" in the 2160p reject list, but Atmos rides on E-AC3
    (which §3.2 permits at 4K) or on TrueHD (which it forbids). A table that vetoed the
    word would reject a legal DDP5.1.Atmos 4K release.
    """
    assert "atmos" in AUDIO_TOKENS, "the parser still emits it; only the rules ignore it"
    assert "atmos" not in cap._DTS_FAMILY
    assert "atmos" not in cap._DOLBY_OR_AAC
    assert "atmos" in RULES_BY_ID["dts-family-at-2160p"].why.lower()


def test_every_video_family_and_dynamic_range_the_rules_name_is_real():
    named = {cap._FAMILY_H264, cap._FAMILY_HEVC, cap._FAMILY_AV1}
    assert named <= VIDEO_FAMILIES, f"renamed in quality.py: {sorted(named - VIDEO_FAMILIES)}"
    assert cap._RANGE_DV in DYNAMIC_RANGES


def test_the_documented_hevc_depths_are_a_real_subset_of_the_bit_depth_domain():
    """LG's table lists Main / Main10. 12-bit is in the parser's domain and outside LG's."""
    assert cap._DOCUMENTED_HEVC_DEPTHS <= BIT_DEPTHS
    assert cap._DOCUMENTED_HEVC_DEPTHS == {8, 10}
    assert 12 in BIT_DEPTHS and 12 not in cap._DOCUMENTED_HEVC_DEPTHS


def test_the_container_rule_reads_the_exported_domain_rather_than_a_spelling():
    """``container_guess`` emits ``'avi'``, never ``'xvid'`` — so the rule reads the set."""
    assert CONTAINER_TOKENS == {"avi"}
    assert None not in CONTAINER_TOKENS, "unknown must never be a member, or it is not free"


def test_the_module_docstring_carries_the_silicon_argument_for_the_floor_name():
    """The name is a deliverable, and the reason is not a version number.

    Without this the next reader re-litigates "but the set is webOS 25" from the id alone.
    The argument is: the engine was upgraded by software, the decoder silicon is 2022, so
    the 22 table is the *safer* derivation for this set rather than merely a conservative
    one — and a later measured profile is a new id.
    """
    doc = cap.__doc__ or ""
    assert "decoder silicon is 2022" in doc
    assert "safer" in doc
    assert "lg-qned99-measured" in doc, "the new-id escape hatch must be written down"
