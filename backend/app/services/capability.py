"""What this television can decode, how sure we are, and what would settle it.

One profile exists: **``lg-webos22-floor``**. Its name carries three facts, in order —
the vendor and platform family, **the table the rules are a function of**, and the
posture (a deliberate floor, not a device match).

**Why the webOS 22 table, for a set that measured as webOS 25.** The only AV tables
anyone on this project has read are LG's webOS **22** ones (spec §3.2); nobody has read a
webOS 25 table in any form, and "webOS 25" is itself an inference from a measured Chromium
120 — the model SKU and the verbatim user agent are both still untranscribed (reading 26).
That alone would make the 22 derivation *conservative*. What makes it the **safer** one is
the hardware: **the engine was upgraded by software, and the decoder silicon is 2022.**
LG's webOS 25 table describes 2025 model-year hardware; applying it to a Re:New-upgraded
2022 panel would claim decoders this panel may never have had. ``legacy-target.test.ts``
already states the same principle for CSS — a newer browser engine does not make a TV GPU
faster — and CLAUDE.md repeats it. A later *measured* profile is a **new id**
(``lg-qned99-measured``), never a quiet edit to this one's rules.

**Honesty is the point of the table's shape.** Most of these rules rest on a vendor
document for the wrong platform version, one rests on a product decision, one on this
project's single real playback measurement, and one cannot be evaluated at all because its
input does not exist anywhere in the backend. So every rule carries:

* ``basis`` — a **closed set**, where each value *licenses a ceiling*
  (:data:`BASIS_CEILING`): only ``lg-table`` and ``product`` may REJECT; ``lg-doc``,
  ``inferred`` and ``guess`` may cost only; ``no-input`` forces effect ``none``.
* ``state`` — ``in_force``, ``shadow`` (it matches, it is reported, it reorders nothing) or
  ``skipped`` (present, inert, provably plumbed).
* ``settled_by`` — the reading ids from :data:`READINGS_ROWS` that would retire the guess.
  Required for every basis that is not yet settled; checked both directions by the
  integrity tests, so a reading nothing claims and a rule pointing at a reading that does
  not exist are both red.
* ``why`` — the reasoning, including the places this table knowingly deviates from LG's
  own wording (R2) and from its own name (R9).

:func:`evaluate` is **total**: it returns the worst *in-force* effect **plus** ``matched``,
which names *every* rule that matched including shadowed and skipped ones with its state.
That is what makes a rule which deliberately reorders nothing still observable — a shadow
rule is a row in ``matched`` with a cost of zero, not an absence.

The integrity tests in ``tests/test_capability_table.py`` are the mechanism that makes a
dishonest table red; they are deliberately **tests** rather than import-time asserts, so a
bad edit reddens one named row instead of killing the backend at import and burying which
invariant broke.

Imports: ``app.providers.quality`` only. No DB, no HTTP, no ``settings``, and **no import
of ``torrents_select``** — nothing in the selector changes in this stage, and an import
here would invite the next change to.

Ordering is **not** here. :func:`evaluate` answers "what does this release claim, and what
does the profile think of it"; where that verdict sits in the ranking is ``apply_profile``'s
job (stage 8 task 5), which is why ``evaluate`` has no production caller yet.

The prose readings sheet these rows mirror is
``docs/superpowers/plans/2026-10-11-tv-stage8-device-readings.md``; :data:`READINGS_ROWS`
is the machine-readable half, **in Python**, because nothing here parses markdown.
"""
from dataclasses import dataclass
from typing import Callable, Dict, FrozenSet, Optional, Tuple

from app.providers.quality import CONTAINER_TOKENS, ReleaseFacts

# --------------------------------------------------------------------------------------
# Vocabulary
# --------------------------------------------------------------------------------------

#: A rule that rejects: the candidate is marked and never auto-chosen. Nothing is filtered.
EFFECT_REJECT = "reject"
#: A rule that penalises: "worse, but it will play."
EFFECT_COST = "cost"
#: A rule that prefers: a negative cost.
EFFECT_BONUS = "bonus"
#: A rule that does nothing at all, on purpose, with a reason in ``why``.
EFFECT_NONE = "none"

EFFECTS: FrozenSet[str] = frozenset({EFFECT_REJECT, EFFECT_COST, EFFECT_BONUS, EFFECT_NONE})

#: Measured on this set, by this project. Exactly one reading exists (§11.5's playback run)
#: and its caveats are in R8's ``why``.
BASIS_MEASURED = "measured"
#: A published row in one of LG's webOS 22 AV tables (spec §3.2).
BASIS_LG_TABLE = "lg-table"
#: LG documentation that states a defect or a limit in prose rather than in a table row.
BASIS_LG_DOC = "lg-doc"
#: Derived from something LG published about *other* hardware, or from a scope that does
#: not cover this panel.
BASIS_INFERRED = "inferred"
#: A guess. §7.2's own cell says "unverified".
BASIS_GUESS = "guess"
#: The rule's input does not exist anywhere in the backend. Forces ``EFFECT_NONE``.
BASIS_NO_INPUT = "no-input"
#: A product decision, not an AV claim (spec §7.3 and decision 9).
BASIS_PRODUCT = "product"

BASES: FrozenSet[str] = frozenset({
    BASIS_MEASURED, BASIS_LG_TABLE, BASIS_LG_DOC, BASIS_INFERRED,
    BASIS_GUESS, BASIS_NO_INPUT, BASIS_PRODUCT,
})

#: The ceiling each basis licenses. A basis may always do *less* than its ceiling allows —
#: R9's basis is ``lg-table`` and it only awards a bonus — but never more. This is the
#: single table that stops "we think" from becoming "we refuse to play it".
BASIS_CEILING: Dict[str, FrozenSet[str]] = {
    BASIS_PRODUCT: frozenset({EFFECT_REJECT, EFFECT_COST, EFFECT_BONUS, EFFECT_NONE}),
    BASIS_LG_TABLE: frozenset({EFFECT_REJECT, EFFECT_COST, EFFECT_BONUS, EFFECT_NONE}),
    BASIS_MEASURED: frozenset({EFFECT_COST, EFFECT_BONUS, EFFECT_NONE}),
    BASIS_LG_DOC: frozenset({EFFECT_COST, EFFECT_NONE}),
    BASIS_INFERRED: frozenset({EFFECT_COST, EFFECT_NONE}),
    BASIS_GUESS: frozenset({EFFECT_COST, EFFECT_NONE}),
    BASIS_NO_INPUT: frozenset({EFFECT_NONE}),
}

#: In force: its effect reaches the ordering.
STATE_IN_FORCE = "in_force"
#: Shadow: it matches, it is reported in ``matched``, and it reorders **nothing**. The
#: spec's §7.2 table says SHADOW. Promotion is a one-cell edit to this field.
STATE_SHADOW = "shadow"
#: Skipped: present in code, inert, and provably plumbed. The spec says NOT IMPLEMENTED.
STATE_SKIPPED = "skipped"

STATES: FrozenSet[str] = frozenset({STATE_IN_FORCE, STATE_SHADOW, STATE_SKIPPED})

#: Bases whose rules are not settled yet, and therefore **must** name the reading that
#: would settle them. ``lg-table``, ``lg-doc`` and ``product`` may name one too (R2 names
#: 24, R5 names 21, R9 names 16/17/23) — a published table row is still worth confirming on
#: the set. What is forbidden is an *unsettled* rule with nowhere to go.
UNSETTLED_BASES: FrozenSet[str] = frozenset({BASIS_INFERRED, BASIS_GUESS, BASIS_NO_INPUT})

#: The two reject labels, in the order that decides a candidate matching both. A candidate
#: can match R1 **and** R2 — a 2160p DTS-HD release asked for at 1080p — and ``incapable``
#: wins, because it is the true statement: opting into 4K would not help, that release
#: cannot play here at any ask. Task 6's refusal copy depends on this ("every candidate
#: ``withheld``-**only**" is the 4K-only message; "any candidate ``incapable``" is the
#: other), and the ordering is pinned by a test.
REJECT_PRECEDENCE: Tuple[str, ...] = ("incapable", "withheld")


# --------------------------------------------------------------------------------------
# Token spellings
# --------------------------------------------------------------------------------------
#
# Every spelling below is a *subset* of a domain set exported by ``providers.quality``.
# They are written out here rather than derived, because a subset cannot be derived from
# the whole, and ``quality.py`` is not this module's to edit. The drift guard is therefore
# a **subset test** per constant in ``test_capability_table.py``: a token renamed in
# ``quality.py`` reddens one named row there. An import-time check was considered and
# rejected — it would take the backend down and bury which spelling moved.

#: §3.2's Ultra HD table permits only Dolby Digital / Dolby Digital Plus / AAC at 3840x2160,
#: so these three are out of spec at 4K. ``atmos`` is deliberately **absent**: it is a flag
#: beside a carrier, not a carrier — see R2's ``why``.
_DTS_FAMILY: FrozenSet[str] = frozenset({"dts", "dtshd", "truehd"})

#: The audio §3.2's Ultra HD table does permit, and the audio §7.2's "preferred" row names.
_DOLBY_OR_AAC: FrozenSet[str] = frozenset({"ac3", "eac3", "aac"})

_FAMILY_H264 = "h264"
_FAMILY_HEVC = "hevc"
_FAMILY_AV1 = "av1"

_RANGE_DV = "dv"

#: LG's table lists HEVC **Main / Main10** — 8-bit and 10-bit. A positively named 12-bit
#: HEVC is outside the document R9's basis is, so it gets no bonus; it is **not** penalised
#: and never rejected, which is the gap the plan records as "no bit-depth gate". ``None``
#: (the common case: a title that names no depth) is treated as documented, because unknown
#: must always be free and an unnamed depth is overwhelmingly 8 or 10.
_DOCUMENTED_HEVC_DEPTHS: FrozenSet[int] = frozenset({8, 10})

#: The ceiling §3.2 states for HEVC 4K: ``3840x2160@60P Main/Main10@L5.1, maximum 60 Mbps``.
#: Read by R10, which cannot fire — see :data:`READINGS_ROWS` row 25.
_HEVC_2160P_MBPS_CEILING = 60.0


# --------------------------------------------------------------------------------------
# Readings
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Reading:
    """One row of the stage-8 readings sheet, machine-readable.

    Numbered from 16 so the project's reading ids stay globally unique and continuous;
    rows 1-15 belong to earlier stages' sheets.
    """

    #: The row number, as a string, exactly as a rule's ``settled_by`` names it.
    id: str
    #: What is to be read on the set. A verbatim string or the words "not taken"; a blank
    #: is a failure, not a pass.
    reading: str
    #: Whether a stage gate hangs on it.
    gating: bool
    #: What takes the reading.
    instrument: str
    #: Which rule it promotes, retires or inverts.
    effect_on_rules: str
    #: True when this reading **settles no rule**: it measures a premise, or a fact about
    #: the device, rather than a claim the table makes. It may still be *cited* by a rule
    #: as the nearest reading that bears on it — row 22 is cited by R7 for exactly that
    #: reason, and R7's ``why`` records that no reading in the sheet would retire it. The
    #: flag is what licenses an unclaimed row; it does not forbid a claimed one.
    standalone: bool = False


#: The stage-8 readings sheet, frozen, **in Python**. The prose copy is
#: ``docs/superpowers/plans/2026-10-11-tv-stage8-device-readings.md`` and the two are
#: cross-linked; this one is what the integrity tests read, because nothing here parses
#: markdown.
READINGS_ROWS: Tuple[Reading, ...] = (
    Reading(
        id="16",
        reading="HEVC Main 8-bit at 1080p direct-plays",
        gating=True,
        instrument="diag clip 1",
        effect_on_rules=(
            "Confirms R9. Failure INVERTS it: HEVC becomes a reject at every resolution "
            "and the 4K opt-in is withdrawn."
        ),
    ),
    Reading(
        id="17",
        reading="HEVC Main10 at 1080p direct-plays",
        gating=False,
        instrument="diag clip 2",
        effect_on_rules=(
            "Confirms R9's 10-bit half - a different decoder profile from Main, which "
            "§7.2 names in the same breath."
        ),
    ),
    Reading(
        id="18",
        reading=(
            "DTS at 1080p - and whether a failure is a silent-but-playing picture or a "
            "hard MediaError"
        ),
        gating=True,
        instrument="diag clip 3 + the operator's audio answer",
        effect_on_rules=(
            "Promotes R3 from shadow to in_force (silence) or to reject (hard failure). "
            "The second half decides it and no other document in this repo asks it."
        ),
    ),
    Reading(
        id="19",
        reading="DTS-HD MA and TrueHD at 1080p",
        gating=False,
        instrument="real file",
        effect_on_rules="Promotes or retires R4.",
    ),
    Reading(
        id="20",
        reading="AV1 at 1080p",
        gating=False,
        instrument="real file",
        effect_on_rules="Retires or re-justifies R6, whose own scope excludes this panel.",
    ),
    Reading(
        id="21",
        reading=(
            "A Dolby Vision MKV - or 'no sample in this library' recorded as such"
        ),
        gating=False,
        instrument="real file",
        effect_on_rules="Retires or confirms R5.",
    ),
    Reading(
        id="22",
        reading="A .mp4 and a .ts from the library play",
        gating=False,
        instrument="real files",
        effect_on_rules=(
            "R7's PREMISE, not R7 itself: only .mkv is measured, and "
            "settings.video_extensions admits thirteen containers outside the allow-list."
        ),
        standalone=True,
    ),
    Reading(
        id="23",
        reading=(
            "One genuine 2160p HEVC release plays end to end off a still-downloading "
            "torrent"
        ),
        gating=True,
        instrument="real release, tens of GB, ARM cap of two",
        effect_on_rules=(
            "Gates the 4K opt-in's 'done' claim and nothing else. The one row no clip can "
            "fake, and the only test of the Pi-throughput risk that was lowered on a "
            "single 1080p observation."
        ),
    ),
    Reading(
        id="24",
        reading="DTS or TrueHD at 2160p",
        gating=False,
        instrument="real release",
        effect_on_rules="Confirms R2 - the only AV reject, documentation-only today.",
    ),
    Reading(
        id="25",
        reading=(
            "Sustained bitrate of a 2160p title that plays versus one that stalls, "
            "stating which it measured"
        ),
        gating=False,
        instrument="real releases",
        effect_on_rules=(
            "Reinstates R10. The row must say it cannot separate decoder refusal from Pi "
            "throughput."
        ),
    ),
    Reading(
        id="26",
        reading="Model SKU and verbatim navigator.userAgent",
        gating=False,
        instrument="/bigscreen/diag",
        effect_on_rules=(
            "Untranscribed since stage 3, and the only facts that could ever justify "
            "re-deriving this profile from the webOS 25 table - which would be a new "
            "profile id, not an edit to this one."
        ),
        standalone=True,
    ),
)


# --------------------------------------------------------------------------------------
# Rules
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Rule:
    """One row of the capability table.

    ``(id, when, effect, cost, basis, state, settled_by, why)`` as the stage-8 plan
    specifies, plus ``verdict`` — the label a reject reports to the client
    (``withheld`` / ``incapable``). The plan's eight-field tuple has nowhere to put those
    two strings, and ``device_verdict`` on the wire is exactly one of them, so the field is
    additive and defaulted; a test requires it on every rejecting rule and forbids it on
    every other.
    """

    #: Stable, greppable, and the string that reaches ``device_reasons``.
    id: str
    #: ``when(facts, allow_2160p) -> bool``. Pure, and **unknown must always be free**: a
    #: title that names no codec, no audio and no container must match nothing.
    when: Callable[[ReleaseFacts, bool], bool]
    #: One of :data:`EFFECTS`, within this rule's :data:`BASIS_CEILING`.
    effect: str
    #: Signed. A penalty is positive, a bonus is negative, and ``reject``/``none`` are 0 —
    #: a reject is ordered by its own flag, outermost, not by a weight.
    cost: int
    #: One of :data:`BASES`.
    basis: str
    #: One of :data:`STATES`.
    state: str
    #: Reading ids from :data:`READINGS_ROWS`.
    settled_by: Tuple[str, ...]
    #: Why this row says what it says, including any deviation from LG's wording.
    why: str
    #: The client-visible label, for a reject only.
    verdict: Optional[str] = None


_R1 = Rule(
    id="withheld-2160p",
    when=lambda facts, allow_2160p: facts.resolution == 2160 and not allow_2160p,
    effect=EFFECT_REJECT,
    cost=0,
    basis=BASIS_PRODUCT,
    state=STATE_IN_FORCE,
    settled_by=(),
    verdict="withheld",
    why=(
        "NOT an AV claim: it is §7.3's opt-in. The television asks for 1080p and the "
        "detail screen offers a per-title 4K choice. "
        "**It has to be a reject rather than a cost, for an arithmetic reason**: "
        "rank_candidates consults health before the quality bucket, and bucket_order makes "
        "2160p the FIRST downgrade target for a 1080p ask, so a 2160p candidate sits at "
        "bucket index 1 while a 720p sits at 2. No cost term placed below health can reach "
        "that - a 2160p with the maximum penalty still outranks the 720p. Without the "
        "reject the stage merges green and still hands the set a 2160p release for a 1080p "
        "ask. Unknown resolution is free: only a parsed 2160 fires."
    ),
)

_R2 = Rule(
    id="dts-family-at-2160p",
    when=lambda facts, allow_2160p: (
        facts.resolution == 2160 and bool(facts.audio & _DTS_FAMILY)
    ),
    effect=EFFECT_REJECT,
    cost=0,
    basis=BASIS_LG_TABLE,
    state=STATE_IN_FORCE,
    settled_by=("24",),
    verdict="incapable",
    why=(
        "The only AV reject, and the only rule with a published table row behind it: "
        "§3.2's stricter Ultra HD table permits only Dolby Digital / Dolby Digital Plus / "
        "AAC at 3840x2160, so DTS, DTS-HD MA and TrueHD are out of spec there even though "
        "DTS appears in the generic .mkv row. "
        "**A deliberate deviation from LG's own wording:** §7.2 and §3.2 both name "
        "'Atmos' in that list, but Atmos is not a carrier - it rides on E-AC3 (streaming, "
        "which the table PERMITS at 4K) or on TrueHD (disc, which it forbids). Vetoing the "
        "word would reject a perfectly legal DDP5.1.Atmos 4K release, so this rule vetoes "
        "the CARRIER and ignores the flag. "
        "It reads no allow_2160p: a 2160p DTS-HD release is incapable whether or not 4K "
        "was opted into, and saying so is what lets the 404 copy tell 'enable 4K and it "
        "will work' apart from 'this cannot play here'. In practice R1 has already "
        "rejected the same candidate unless 4K was opted into; see REJECT_PRECEDENCE."
    ),
)

_R3 = Rule(
    id="dts-at-1080p",
    when=lambda facts, allow_2160p: facts.resolution == 1080 and "dts" in facts.audio,
    effect=EFFECT_COST,
    cost=10,
    basis=BASIS_GUESS,
    state=STATE_SHADOW,
    settled_by=("18",),
    why=(
        "§7.2's 1080p cell calls this rule **unverified**: the generic .mkv row lists DTS, "
        "but LG dropped DTS decode on some model years and which years is unknown. "
        "Ships in SHADOW - it matches, it is reported, it reorders nothing - because "
        "reading 18 is cheap (one diag clip) and the failure it guards against is "
        "recoverable by pressing Back, while a guess that reorders the whole library now "
        "has no retirement path but a reading that may never be taken. §11.2 names no "
        "DTS-at-1080p test, so shadowing contradicts nothing written down. "
        "**Promotion is a one-cell edit to `state`** (to in_force if reading 18 shows a "
        "silent-but-playing picture, to a reject if it shows a hard MediaError) and "
        "nothing else about this row changes."
    ),
)

_R4 = Rule(
    id="dtshd-truehd-at-1080p",
    when=lambda facts, allow_2160p: (
        facts.resolution == 1080 and bool(facts.audio & frozenset({"dtshd", "truehd"}))
    ),
    effect=EFFECT_COST,
    cost=20,
    basis=BASIS_GUESS,
    state=STATE_SHADOW,
    settled_by=("19",),
    why=(
        "**A separate rule from R3, not one merged rule**, because §7.2's 1080p cell says "
        "only 'DTS' while §3.2 lumps four codecs together at 2160p, and nothing states "
        "which of them the 1080p rule covers. One merged rule would silently decide that "
        "question. Its own weight, above R3's: a lossless track is a bigger decode ask "
        "than a lossy one, so if either plays it is likelier to be plain DTS. Shadowed for "
        "the same reason as R3, settled by its own reading (19, a real file rather than a "
        "clip, because a DTS-HD MA sample is in the library already)."
    ),
)

_R5 = Rule(
    id="dolby-vision",
    when=lambda facts, allow_2160p: facts.dynamic_range == _RANGE_DV,
    effect=EFFECT_COST,
    cost=30,
    basis=BASIS_LG_DOC,
    state=STATE_IN_FORCE,
    settled_by=("21",),
    why=(
        "§3.2: 'Dolby Vision Profile 8 in MKV is a known direct-play failure.' "
        "**The `in MKV` qualifier is dropped deliberately**: the real container is "
        "unknowable at selection time, so applying the penalty unconditionally is strictly "
        "more conservative than guessing the container in order to narrow it. "
        "Its input is lossy rather than absent - `_HDR` already matched a bare DV token, "
        "and parse_release_facts adds exactly the spellings it missed (DoVi, dotted "
        "Dolby.Vision, HLG, DV.P8)."
    ),
)

_R6 = Rule(
    id="av1",
    when=lambda facts, allow_2160p: facts.video_family == _FAMILY_AV1,
    effect=EFFECT_COST,
    cost=40,
    basis=BASIS_INFERRED,
    state=STATE_IN_FORCE,
    settled_by=("20",),
    why=(
        "**In force rather than shadowed, and the weakness is recorded here instead of in "
        "the effect.** §7.2's own parenthetical scopes this penalty to '2022 LCDs', a "
        "class this QNED is not in - so on its own evidence it would be a candidate for "
        "shadow. It stays in force because §11.2, the one written definition of this "
        "stage's selector test, requires the profile to 'penalise AV1', and a "
        "non-reordering term would contradict it. Reading 20 retires or re-justifies it. "
        "av1 was already in `_CODEC`, so the input works today."
    ),
)

_R7 = Rule(
    id="container-proxy-xvid-divx",
    when=lambda facts, allow_2160p: facts.container_guess in CONTAINER_TOKENS,
    effect=EFFECT_COST,
    cost=200,
    basis=BASIS_INFERRED,
    state=STATE_IN_FORCE,
    settled_by=("22",),
    why=(
        "§7.2 says 'container outside .mkv/.mp4/.ts -> heavy penalty', but **the real "
        "container is not knowable here**: the provider returns seven keys and no file "
        "list, a season pack's torrent name is a directory name, and nothing in the image "
        "can probe a file before the decision is made. So this is named a **codec proxy**, "
        "and it fires only on a positively identified xvid|divx token, which in practice "
        "means AVI. `container_guess is None` means 'not known', never 'not AVI', and is "
        "**always free**. "
        "Its cost is strictly larger than every within-bucket guess (R3-R6), and larger "
        "than all four summed, which is the minimal honest recovery of the word 'heavy' - "
        "a flat cost tier would flatten exactly the magnitude §7.2 bothered to state. "
        "Reading 22 is its premise rather than its confirmation: it measures whether the "
        "containers this rule does NOT penalise actually play."
    ),
)

_R8 = Rule(
    id="preferred-measured",
    when=lambda facts, allow_2160p: (
        facts.video_family == _FAMILY_H264 and bool(facts.audio & _DOLBY_OR_AAC)
    ),
    effect=EFFECT_BONUS,
    cost=-20,
    basis=BASIS_MEASURED,
    state=STATE_IN_FORCE,
    settled_by=(),
    why=(
        "Tier A, and the only row with a reading of this project's own behind it - the "
        "2026-10-07 playback run. **The measurement, verbatim, with its caveats:** a .mkv "
        "(Matroska), H.264, E-AC3 (DDP5.1), streamed off a roughly 26%-complete torrent "
        "and scrubbed inside downloaded bytes, direct-played on the set. What that run did "
        "**not** establish: the resolution was never transcribed (videoWidth x videoHeight "
        "was not copied, so even '1080p' is a release-name claim), the codec and the audio "
        "were read off the release NAME rather than off the file, and §11.5(d) asked for "
        "AC3 while the run delivered E-AC3 - so **plain AC3 is no more measured than HEVC "
        "is.** It is included here because §3.2's Ultra HD table and §7.2's preferred row "
        "both name it beside E-AC3, which is a documentation claim, not a measurement. "
        "Separate from R9 with a strict ordering between them: if H.264 and HEVC shared "
        "one 'preferred' tier, the project's single real reading would score identically "
        "to the combination nobody has ever played and become invisible in the ordering."
    ),
)

_R9 = Rule(
    id="documented-ok",
    when=lambda facts, allow_2160p: (
        facts.video_family == _FAMILY_HEVC
        and bool(facts.audio & _DOLBY_OR_AAC)
        and (facts.bit_depth is None or facts.bit_depth in _DOCUMENTED_HEVC_DEPTHS)
    ),
    effect=EFFECT_BONUS,
    cost=-10,
    basis=BASIS_LG_TABLE,
    state=STATE_IN_FORCE,
    settled_by=("16", "17", "23"),
    why=(
        "Tier B, strictly below A. LG's webOS 22 table lists HEVC **Main / Main10** with "
        "DD / DD+ / AAC, so this combination is documented - and **nobody has ever played "
        "HEVC on this set** (readings 16, 17 and 23 are all untaken). It is admitted "
        "anyway, deliberately: HEVC is the only 4K video codec besides H.264 that §3.2's "
        "Ultra HD table allows, so discouraging it would make the 4K opt-in return nothing "
        "on most titles. "
        "The bit-depth condition is the one place this rule is narrower than its own "
        "`documented-ok` name suggests: a positively named 12-bit HEVC is outside the "
        "table this basis is, so it gets **no bonus** - it is never penalised and never "
        "rejected, which is the 'no bit-depth gate' the stage records as a known gap. "
        "Unknown depth (the common case) counts as documented, because unknown must be "
        "free. Reading 16 is gating, and its FAILURE inverts this row: HEVC would become a "
        "reject at every resolution and the 4K opt-in would be withdrawn."
    ),
)

_R10 = Rule(
    id="hevc-2160p-over-60mbps",
    when=lambda facts, allow_2160p: (
        facts.video_family == _FAMILY_HEVC
        and facts.resolution == 2160
        and facts.bitrate_mbps is not None
        and facts.bitrate_mbps > _HEVC_2160P_MBPS_CEILING
    ),
    effect=EFFECT_NONE,
    cost=0,
    basis=BASIS_NO_INPUT,
    state=STATE_SKIPPED,
    settled_by=("25",),
    why=(
        "bytes / runtime: no runtime reaches the selector; see reading 25. "
        "**A row, not a paragraph in the spec**, so a grep that hits this ceiling cannot "
        "misread it as enforced - and so that the predicate and the plumbing can be proved "
        "complete while the input is absent (a fixture injects a non-None "
        "facts.bitrate_mbps and this rule fires). "
        "Why there is no input, in both directions: rank_candidates receives "
        "List[TorrentHit], which carries bytes and no duration; resolve_title_year's "
        "cache-hit branch reads CatalogItemCache, which has no runtime column; "
        "catalog_items.detail_json does hold MovieDetail.runtime but set_detail has one "
        "caller and is skipped when with_qualities=False - the mode the television's own "
        "detail load uses - while services/tv.py never calls it at all, so a TV row has no "
        "detail_json ever and episode_run_time is never read anywhere in the repo. On top "
        "of that a season pack's bytes cover N episodes against one episode's runtime, "
        "bytes == 0 is a real value the selector already distrusts, and "
        "minutes-read-as-seconds is a 60x error in the REJECTING direction. Five ways to "
        "be silently wrong, which is why this ships inert rather than estimating. "
        "**What the television loses meanwhile, stated:** with 4K opted in there is no "
        "bitrate ceiling at all. The partial cover is an accident, not a design - UHD "
        "remuxes are overwhelmingly DTS-HD MA or TrueHD, so R2 rejects most of them for "
        "entirely the wrong reason, and a DD+ 4K remux at 80 Mbps passes every rule here."
    ),
)

#: The capability table, in rule order. R1 and R2 first because they are the only rejects.
RULES: Tuple[Rule, ...] = (_R1, _R2, _R3, _R4, _R5, _R6, _R7, _R8, _R9, _R10)

#: The one profile that exists. Its name is a deliverable - see the module docstring.
PROFILE_ID = "lg-webos22-floor"

#: The registry. The client sends a profile **name** and the table lives here (§7.2), so a
#: second television is a new id with its own rule tuple, never an edit to this one's.
PROFILES: Dict[str, Tuple[Rule, ...]] = {PROFILE_ID: RULES}


# --------------------------------------------------------------------------------------
# The verdict
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class MatchedRule:
    """One rule that matched, with the state that decides whether it counted."""

    rule_id: str
    state: str
    effect: str


@dataclass(frozen=True)
class Verdict:
    """What the profile thinks of one release. Pure data; it decides no ordering.

    ``matched`` is the honesty mechanism: it names **every** rule whose predicate was
    true, including the shadowed and the skipped ones, so a rule that deliberately
    reorders nothing is still observable from outside.
    """

    #: True iff an **in-force** reject matched.
    rejected: bool
    #: The client-visible label of the reject that decided it (:data:`REJECT_PRECEDENCE`),
    #: else None.
    reason: Optional[str]
    #: The sum of the **in-force** costs. Positive is worse, negative is better, 0 is
    #: "nothing matched, or only shadowed and skipped rules did".
    cost: int
    #: Every rule that matched, in table order.
    matched: Tuple[MatchedRule, ...]


def evaluate(
    facts: ReleaseFacts,
    *,
    allow_2160p: bool,
    rules: Tuple[Rule, ...] = RULES,
) -> Verdict:
    """Apply the capability table to one release's claims. Total, pure, order-free.

    ``allow_2160p`` is the §7.3 opt-in: the television asks for 1080p unless the viewer
    pressed 4K on the detail screen. It is a keyword argument because R1 is the only reason
    it exists and a positional bool at a call site would read as a mystery.

    ``rules`` defaults to the only table there is; it is a parameter so :data:`PROFILES` is
    load-bearing rather than decorative, and so a hostile table can be injected by a test.

    Returns the worst in-force effect **plus** every match. Nothing is filtered, nothing is
    sorted, and ``health`` is never touched - a capability cost folded into health would
    make a device-rejected release the one the web's alternatives modal actively
    recommends.
    """
    matched = tuple(
        MatchedRule(rule_id=rule.id, state=rule.state, effect=rule.effect)
        for rule in rules
        if rule.when(facts, allow_2160p)
    )
    by_id = {rule.id: rule for rule in rules}
    in_force = [by_id[m.rule_id] for m in matched if m.state == STATE_IN_FORCE]

    # ``rejected`` is read off the effects and ``reason`` is only the label, so the two can
    # never disagree. A reject whose label is missing or unknown falls back to the rule id
    # rather than to None: an unlabelled reject must still read as truthy downstream, where
    # ``if not candidate.device_verdict`` is what skips it. The integrity tests forbid the
    # state that needs the fallback, and a test exercises the fallback anyway so it is not
    # a branch nothing can reach.
    labels = [rule.verdict or rule.id for rule in in_force if rule.effect == EFFECT_REJECT]
    reason = next((label for label in REJECT_PRECEDENCE if label in labels), None)
    if reason is None and labels:
        reason = labels[0]

    return Verdict(
        rejected=bool(labels),
        reason=reason,
        cost=sum(rule.cost for rule in in_force),
        matched=matched,
    )
