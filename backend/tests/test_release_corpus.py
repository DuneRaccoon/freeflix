"""The frozen corpus: ``parse_release_facts`` measured against hand labels, as exact
per-field, per-direction confusion counts.

Why a corpus at all
===================
Every capability rule in ``services/capability.py`` bottoms out in a regex over a scene
name. ``normalize_hit`` (``providers/catalog.py:59-70``) keeps seven upstream keys — title,
seeds, peers, bytes, magnetUrl, hash, source — and the upstream ``api=torrents`` response
carries no file list, while libtorrent's file list exists only *after* the torrent has been
added, i.e. after the decision. **At selection time the title is all there is**, so parser
precision *is* the profile's accuracy. §11.2's table test over synthetic candidates measures
the engine; this measures the parser.

Where the titles came from
==========================
6131 distinct real release titles, no invented ones:

* 888 from ``catalog_items.torrents_json`` (``psql``, free, offline). Movies only —
  ``set_torrents`` has exactly one caller (``services/movies.py:97``) and ``services/tv.py``
  never calls it, so ``SxxExx`` and season-pack names are *structurally absent* from the
  cache. Both ``torrents_json`` and ``detail_json`` are write-only caches (nothing in the
  backend reads either); reading them with ``psql`` was corpus material and did not add a
  reader.
* 5164 from a live harvest, ``backend/scripts/harvest_release_titles.py``, 125 queries at
  1.4s apart.
* 79 from a targeted nature-documentary sweep, which is where the single real HLG title came
  from, and 72 from a sweep for films whose own names read as metadata.

370 were picked by **raw keyword stratification** — never by running the parser — so that
every label value a column can take has rows, and then hand-labelled.

How the labels were written
===========================
**By reading the titles, once, and never regenerated with the parser under test.** A corpus
produced by the parser proves only that the parser is deterministic. Two labelling rules
were applied uniformly and are stated here because they decide the disputable rows:

1. **A label names the tokens visibly present in the received string**, read the way a human
   reads a scene name — no reconstructing text the provider clipped. So
   ``...8bit.SDR.DTS-H ...`` is labelled ``dts`` (DTS is visible; "HD" is not), while
   ``[1080p.BDRemux...]`` is labelled ``remux=true``, because the word *Remux* really is
   there, merely glued to "BD".
2. **A bit depth is labelled only where the title states a depth as a depth** — a number
   adjacent to ``bit``/``bits``, or the profile name ``Hi10P``, which *is* a stated depth.
   ``HEVC10`` states a codec and a bare number, so it is labelled ``None``.

Both rules cut against the parser as often as for it: the measured false negatives below are
real misses, not label slips.

What this does NOT prove
========================
**The labels are labels about titles, not about files.** A title names tracks — often
several — and the MKV it describes may carry a compatibility AC3 track the television plays
happily. So rejecting on the presence of DTS discards playable files, and accepting on the
presence of DD accepts files whose *default* track is DTS. The title cannot settle it and
nothing in the image can probe the file before the decision: the file list does not exist
until the torrent is added. **That is also exactly the confidence the selector will ever
have**, which is why it is the right thing to measure — but it is a measurement of claims,
not of content, and no number here licenses a statement about what will actually play.

Two further limits, both measured rather than asserted:

* **The upstream truncates long names.** 44 of these 370 titles arrive ending in `` ...``
  (614 of the 6052 harvested, ~10%), and the clip lands precisely on the richest releases —
  the 2160p remuxes the profile cares most about. ``test_truncated_titles_are_measured``
  pins the count, and the compound cost is visible in the numbers: six of the eight
  ``bit_depth=10`` false negatives are rows whose *codec* token was clipped off, which then
  suppressed the bit depth through the codec co-requirement.
* **A film's own title is parsed as metadata.** This is live today — ``Web.of.Lies.S01...``
  parses ``source='WEB-DL'`` through :func:`parse_release_info` — and the corpus now carries
  a measured instance for :func:`parse_release_facts`: the 2025 film *Opus*, whose every
  release name begins with the word, supplies **all 8** of the ``opus`` false positives.
  See ``test_film_title_read_as_metadata``.
"""
import csv
from pathlib import Path
from typing import Dict, List, NamedTuple, Optional, Tuple

import pytest

from app.providers.quality import (
    AUDIO_TOKENS,
    BIT_DEPTHS,
    CONTAINER_TOKENS,
    DYNAMIC_RANGES,
    VIDEO_FAMILIES,
    parse_release_facts,
)

CORPUS_PATH = Path(__file__).parent / "data" / "releases.tsv"

#: The resolutions :attr:`ReleaseFacts.resolution` can report. Not exported from
#: ``quality.py`` because ``_RESOLUTION_TOKEN`` is the authority there; restated here and
#: pinned by :func:`test_label_domain_is_pinned` so a widened token pattern shows up as a
#: failure rather than as silently unmeasured values.
RESOLUTIONS: Tuple[int, ...] = (480, 720, 1080, 2160)

SHAPES: Tuple[str, ...] = ("movie", "episode", "pack")

#: The three naming shapes each need this many rows. The cache cannot supply the last two at
#: all, so this floor is what forces the live harvest to have happened.
MIN_ROWS_PER_SHAPE = 40
MIN_ROWS = 300
MAX_ROWS = 800


class Row(NamedTuple):
    shape: str
    resolution: Optional[int]
    audio: frozenset
    video_family: Optional[str]
    bit_depth: Optional[int]
    dynamic_range: Optional[str]
    container_guess: Optional[str]
    remux: bool
    title: str


def _load() -> List[Row]:
    """Parse the TSV, or return ``[]`` if it is not there.

    Returning ``[]`` rather than raising is deliberate and is what makes guard 1 work: a
    missing or unmounted corpus must leave :func:`test_corpus_min_rows` free to *fail*
    instead of erroring the whole module at collection time. ``backend/tests`` is baked into
    the image and not bind-mounted, so "not there" is a routine state, not an exotic one.
    """
    if not CORPUS_PATH.exists():
        return []
    out: List[Row] = []
    with CORPUS_PATH.open(encoding="utf-8") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for raw in reader:
            out.append(Row(
                shape=raw["shape"],
                resolution=int(raw["resolution"]) if raw["resolution"] else None,
                audio=frozenset(t for t in raw["audio"].split("|") if t),
                video_family=raw["video_family"] or None,
                bit_depth=int(raw["bit_depth"]) if raw["bit_depth"] else None,
                dynamic_range=raw["dynamic_range"] or None,
                container_guess=raw["container_guess"] or None,
                remux=raw["remux"] == "true",
                title=raw["title"],
            ))
    return out


ROWS: List[Row] = _load()


# --------------------------------------------------------------------------------------
# The label domain: every value every column can take, derived from quality.py's own
# exports rather than re-spelled. They are hyphen-free (``dtshd``, ``truehd``, ``eac3``)
# and ``container_guess`` emits ``'avi'``, never ``'xvid'``.
# --------------------------------------------------------------------------------------
def _domain() -> List[Tuple[str, str]]:
    keys: List[Tuple[str, str]] = []
    keys += [("audio", t) for t in sorted(AUDIO_TOKENS)]
    keys += [("video_family", v) for v in sorted(VIDEO_FAMILIES)]
    keys += [("dynamic_range", v) for v in sorted(DYNAMIC_RANGES)]
    keys += [("container_guess", v) for v in sorted(CONTAINER_TOKENS)]
    keys += [("bit_depth", str(v)) for v in sorted(BIT_DEPTHS)]
    keys += [("resolution", str(v)) for v in RESOLUTIONS]
    keys += [("remux", "true")]
    return keys


DOMAIN: List[Tuple[str, str]] = _domain()

#: **Absolute**, beside the derived list. ``DOMAIN`` is built by iterating exported sets, so
#: deleting a member of ``AUDIO_TOKENS`` would silently delete that member's own test rows
#: and everything would stay green. 10 audio + 4 codec + 3 range + 1 container + 3 depth +
#: 4 resolution + 1 remux.
DOMAIN_SIZE = 26

#: ``(tp, fp, fn)`` per ``(field, value)``, measured against the hand labels in the TSV and
#: then frozen. **Integers, per field and per direction — never an aggregate ratio.** The
#: two directions have opposite costs: a missed 2160p-DTS reject is a black screen on the
#: television, while an over-eager one silently discards a playable release. A percentage
#: absorbs a regression in either, and a future parser change then produces a judgement call
#: instead of a diff.
#:
#: Every non-zero ``fp``/``fn`` here is a real, named parser limit — see the docstrings of
#: :func:`test_film_title_read_as_metadata`, :func:`test_digit_glued_and_misspelt_audio`,
#: :func:`test_bit_depth_codec_corequirement_cost` and
#: :func:`test_remux_and_codec_left_boundary_cost`.
EXPECTED: Dict[Tuple[str, str], Tuple[int, int, int]] = {
    ("audio", "aac"): (27, 0, 0),
    ("audio", "ac3"): (45, 0, 0),
    ("audio", "atmos"): (68, 0, 1),
    ("audio", "dts"): (12, 0, 0),
    ("audio", "dtshd"): (54, 0, 0),
    ("audio", "eac3"): (59, 0, 0),
    ("audio", "flac"): (13, 0, 0),
    ("audio", "mp3"): (7, 0, 0),
    ("audio", "opus"): (22, 8, 0),
    ("audio", "truehd"): (42, 0, 1),
    ("video_family", "av1"): (29, 0, 0),
    ("video_family", "h264"): (141, 0, 0),
    ("video_family", "hevc"): (122, 0, 1),
    ("video_family", "xvid"): (29, 0, 0),
    ("dynamic_range", "dv"): (41, 0, 0),
    ("dynamic_range", "hdr10"): (35, 0, 0),
    ("dynamic_range", "hlg"): (1, 0, 0),
    ("container_guess", "avi"): (29, 0, 0),
    ("bit_depth", "8"): (6, 0, 0),
    ("bit_depth", "10"): (49, 0, 8),
    ("bit_depth", "12"): (0, 0, 0),
    ("resolution", "480"): (21, 0, 0),
    ("resolution", "720"): (26, 0, 0),
    ("resolution", "1080"): (184, 0, 0),
    ("resolution", "2160"): (99, 0, 0),
    ("remux", "true"): (51, 0, 1),
}

#: Guard 2's floor: a value with no rows can report "0 false negatives" from a corpus that
#: never exercised it.
MIN_LABEL_ROWS = 5

#: The two values the real world would not supply, each pinned at its exact count with the
#: reason. Asserted as an **exact** mapping, so a third scarce value cannot be slipped in to
#: dodge the floor, and a value that becomes plentiful must be removed from here.
SCARCE: Dict[Tuple[str, str], int] = {
    # One instance in 6131 harvested titles (Tokyo.Vice.S01.HLG.2160p.WEB.H265-GGEZ), found
    # only by a targeted sweep of BBC-style nature documentaries. HLG is a broadcast
    # transfer function and the scene almost never names it.
    ("dynamic_range", "hlg"): 1,
    # Zero instances in 6131. 12-bit is in BIT_DEPTHS because the pattern admits it, but no
    # release name in this provider's corpus states it. The member is therefore *reachable
    # but unwitnessed*, which is a different and more honest claim than "tested".
    ("bit_depth", "12"): 0,
}


def _measure() -> Tuple[Dict[Tuple[str, str], Tuple[int, int, int]],
                        Dict[Tuple[str, str], Tuple[List[str], List[str]]]]:
    """Compare the parser against the TSV's hand labels. Returns counts and offenders.

    ``tp``/``fp``/``fn`` are always defined against the *file*. That is what makes guard 3
    work: flip a hand label in the TSV and the measurement moves, because nothing here
    recomputes the expected side from the parser.
    """
    counts = {k: [0, 0, 0] for k in DOMAIN}
    offenders: Dict[Tuple[str, str], Tuple[List[str], List[str]]] = {
        k: ([], []) for k in DOMAIN
    }

    def score(key, in_label: bool, in_parsed: bool, title: str) -> None:
        if in_label and in_parsed:
            counts[key][0] += 1
        elif in_parsed and not in_label:
            counts[key][1] += 1
            offenders[key][0].append(title)
        elif in_label and not in_parsed:
            counts[key][2] += 1
            offenders[key][1].append(title)

    for row in ROWS:
        facts = parse_release_facts(row.title)
        for token in sorted(AUDIO_TOKENS):
            score(("audio", token), token in row.audio, token in facts.audio, row.title)
        singles = (
            ("video_family", sorted(VIDEO_FAMILIES), row.video_family, facts.video_family),
            ("dynamic_range", sorted(DYNAMIC_RANGES), row.dynamic_range, facts.dynamic_range),
            ("container_guess", sorted(CONTAINER_TOKENS), row.container_guess,
             facts.container_guess),
            ("bit_depth", sorted(BIT_DEPTHS), row.bit_depth, facts.bit_depth),
            ("resolution", list(RESOLUTIONS), row.resolution, facts.resolution),
        )
        for field, values, label, parsed in singles:
            for value in values:
                score((field, str(value)), label == value, parsed == value, row.title)
        score(("remux", "true"), row.remux, facts.remux, row.title)

    return {k: tuple(v) for k, v in counts.items()}, offenders


MEASURED, OFFENDERS = _measure()


def _label_rows(field: str, value: str) -> int:
    """How many rows carry this value as a *positive* hand label."""
    if field == "audio":
        return sum(1 for r in ROWS if value in r.audio)
    if field == "remux":
        return sum(1 for r in ROWS if r.remux)
    want = int(value) if field in ("bit_depth", "resolution") else value
    return sum(1 for r in ROWS if getattr(r, field) == want)


# ======================================================================================
# Guard 1 — the corpus exists and is big enough.
#
# THIS IS THE FIRST MUTATION TARGET. ``git mv`` the TSV aside and this test must FAIL. It
# is the only thing standing between an unmounted corpus and a green no-op: there is no
# ``[tool.pytest.ini_options]`` in ``backend/pyproject.toml``, so ``empty_parameter_set_mark``
# is the default ``skip`` and every per-row parametrisation below reports as *skipped*, not
# failed, when ``ROWS`` is empty. ``backend/tests`` is baked into the image and NOT
# bind-mounted by the dev override, so the file is invisible in the container until
# ``make build`` or an explicit
# ``-v "$(pwd)/backend/tests:/opt/freeflix/tests"`` mount.
# ======================================================================================
def test_corpus_min_rows():
    assert CORPUS_PATH.exists(), (
        f"{CORPUS_PATH} is missing. In a container this usually means tests were not "
        f"mounted: the dev override mounts only backend/app and serve.py. Use "
        f'-v "$(pwd)/backend/tests:/opt/freeflix/tests" or `make build`.'
    )
    assert MIN_ROWS <= len(ROWS) <= MAX_ROWS, f"corpus has {len(ROWS)} rows"


@pytest.mark.parametrize("shape", SHAPES)
def test_corpus_covers_every_naming_shape(shape):
    """A floor per shape, because the two TV shapes cannot come from the local cache.

    ``set_torrents`` has one caller (``services/movies.py:97``) and ``services/tv.py`` never
    calls it, so ``SxxExx`` and season-pack names exist in the corpus only because the live
    harvest ran. This floor is what fails if someone rebuilds the corpus from the cache
    alone.
    """
    n = sum(1 for r in ROWS if r.shape == shape)
    assert n >= MIN_ROWS_PER_SHAPE, f"{shape}: {n} rows, floor {MIN_ROWS_PER_SHAPE}"


def test_every_row_has_a_shape_from_the_pinned_set():
    unknown = sorted({r.shape for r in ROWS} - set(SHAPES))
    assert not unknown, f"unknown shapes in the corpus: {unknown}"


# ======================================================================================
# Guard 2 — label coverage. Without this, "0 false negatives on DTS" can be reported from a
# corpus containing no DTS rows at all.
# ======================================================================================
def test_label_domain_is_pinned():
    """The domain is derived from exported sets, so pin its size absolutely beside it.

    Without this, deleting ``'dtshd'`` from ``AUDIO_TOKENS`` would delete that token's own
    parametrised rows and the suite would stay green — the "parametrised rows that iterate
    an exported list" shape.
    """
    assert len(DOMAIN) == DOMAIN_SIZE, f"domain is {len(DOMAIN)} keys, pinned at {DOMAIN_SIZE}"
    assert len(set(DOMAIN)) == DOMAIN_SIZE, "duplicate keys in the label domain"
    assert len(AUDIO_TOKENS) == 10
    assert len(VIDEO_FAMILIES) == 4
    assert len(DYNAMIC_RANGES) == 3
    assert len(CONTAINER_TOKENS) == 1
    assert len(BIT_DEPTHS) == 3


def test_expected_table_covers_the_whole_domain_and_nothing_else():
    """Key-set equality, so a new enum member needs a counted row rather than silence."""
    assert sorted(EXPECTED) == sorted(DOMAIN), (
        f"missing from EXPECTED: {sorted(set(DOMAIN) - set(EXPECTED))}; "
        f"stale in EXPECTED: {sorted(set(EXPECTED) - set(DOMAIN))}"
    )
    assert len(EXPECTED) == DOMAIN_SIZE


def test_scarce_values_are_exactly_the_pinned_ones():
    """The exemption list is itself pinned, so it cannot grow to dodge the floor."""
    below = {k: _label_rows(*k) for k in DOMAIN if _label_rows(*k) < MIN_LABEL_ROWS}
    assert below == SCARCE, (
        f"values below the {MIN_LABEL_ROWS}-row floor are {below}, pinned as {SCARCE}. "
        f"A newly scarce value means the corpus lost rows; a newly plentiful one must be "
        f"removed from SCARCE."
    )


@pytest.mark.parametrize("key", DOMAIN, ids=lambda k: f"{k[0]}-{k[1]}")
def test_every_label_value_has_positive_and_negative_rows(key):
    """Both directions need rows: positives make ``fn`` measurable, negatives make ``fp``."""
    positives = _label_rows(*key)
    negatives = len(ROWS) - positives
    if key in SCARCE:
        assert positives == SCARCE[key], f"{key}: {positives} rows, pinned at {SCARCE[key]}"
    else:
        assert positives >= MIN_LABEL_ROWS, f"{key}: only {positives} positive rows"
    assert negatives >= MIN_LABEL_ROWS, f"{key}: only {negatives} negative rows"


def _row_id(row) -> str:
    """Tolerate pytest's empty-parameter-set sentinel.

    Measured, because it is the difference between guard 1 working and guard 1 being
    useless: with ``ROWS == []`` and ``empty_parameter_set_mark`` at its default ``skip``,
    pytest still builds **one** parameter set holding a ``NOTSET`` sentinel and calls this
    function on it. A bare ``lambda r: r.title[:60]`` raises ``AttributeError`` there, which
    pytest reports as ``ValueError: error raised while trying to determine id`` — a
    **collection error**, not a skip. That aborts collection of the whole module, so
    ``test_corpus_min_rows`` never runs and an absent corpus produces an opaque interrupt
    instead of the one readable failure it is supposed to produce.
    """
    return str(getattr(row, "title", "no-corpus"))[:60]


@pytest.mark.parametrize("row", ROWS, ids=_row_id)
def test_row_labels_are_inside_the_domain(row):
    """Catches a typo'd hand label, which would otherwise read as a parser defect.

    This is the parametrisation guard 1 talks about: with the TSV moved aside ``ROWS`` is
    empty, so these report as *skipped*, not failed.
    """
    assert row.audio <= AUDIO_TOKENS, f"unknown audio token(s): {row.audio - AUDIO_TOKENS}"
    assert row.video_family in VIDEO_FAMILIES or row.video_family is None
    assert row.dynamic_range in DYNAMIC_RANGES or row.dynamic_range is None
    assert row.container_guess in CONTAINER_TOKENS or row.container_guess is None
    assert row.bit_depth in BIT_DEPTHS or row.bit_depth is None
    assert row.resolution in RESOLUTIONS or row.resolution is None
    assert row.bit_depth is None or row.bit_depth in BIT_DEPTHS


# ======================================================================================
# The measurement. Exact integers, per field and per direction.
# ======================================================================================
def _msg(key, measured, expected) -> str:
    fps, fns = OFFENDERS[key]
    lines = [
        f"{key[0]} contains {key[1]}: "
        f"tp={measured[0]} fp={measured[1]} fn={measured[2]} "
        f"(pinned tp={expected[0]} fp={expected[1]} fn={expected[2]})",
    ]
    for title in fps:
        lines.append(f"  FP (parser says yes, label says no): {title}")
    for title in fns:
        lines.append(f"  FN (label says yes, parser says no): {title}")
    return "\n".join(lines)


@pytest.mark.parametrize("key", DOMAIN, ids=lambda k: f"{k[0]}-{k[1]}")
def test_confusion_counts_are_exact(key):
    """The deliverable: ``tp``/``fp``/``fn`` per field and direction, as integers.

    Guard 3: flip one hand label in the TSV and the matching count moves, proving the
    numbers are compared against the file and not recomputed from the parser.

    Guard 4: loosen one audio pattern in ``quality.py`` by a character and a specific ``fp``
    rises here, with the newly offending titles named in the message.
    """
    assert MEASURED[key] == EXPECTED[key], _msg(key, MEASURED[key], EXPECTED[key])


def test_no_field_is_silently_unmeasured():
    """Every key must have been *exercised*: tp+fp+fn+correct-negatives must cover all rows.

    An all-zero key with rows in the corpus would mean the scoring loop never reached that
    field — the "fixture whose values collide so a deleted guard changes nothing" shape, one
    level up.
    """
    exercised = {k for k, v in MEASURED.items() if sum(v) > 0}
    unexercised = sorted(set(DOMAIN) - exercised)
    # Only a value with *zero* hand-labelled rows can legitimately score nothing, and even
    # then only while the parser produces no false positive for it. ``hlg`` has one row and
    # is therefore exercised; ``bit_depth=12`` has none.
    allowed = sorted(k for k, n in SCARCE.items() if n == 0)
    assert unexercised == allowed, (
        f"keys with no tp/fp/fn at all: {unexercised}; only {allowed} may be unexercised, "
        f"and only because the real world supplied no rows for them."
    )


# ======================================================================================
# Named findings. Each one is a non-zero cell above, written out so the next reader does
# not have to re-derive why the number is not zero.
# ======================================================================================
def test_film_title_read_as_metadata():
    """Parsing the film's own title as metadata is live, and here it is measured.

    ``Web.of.Lies.S01.1080p.BluRay.x264`` already parses ``source='WEB-DL'`` and
    ``Cam.2018...WEB-DL`` parses ``source='CAM'`` through :func:`parse_release_info`. The new
    fields inherit the whole class, and the 2025 film *Opus* is the instance: every one of
    its release names opens with the word, so the parser reads Opus **audio** on releases
    whose actual audio is DDP, AAC or unnamed.

    All 8 ``opus`` false positives are this film, and nothing else in 370 titles produces
    one. The label side is what a human reads — a word before the year is the film's name —
    which is exactly the discrimination no regex over the title can make.
    """
    fps = OFFENDERS[("audio", "opus")][0]
    assert len(fps) == 8, f"opus fp is {len(fps)}, expected 8:\n" + "\n".join(fps)
    assert all("Opus" in t or "Опус" in t for t in fps), fps
    # The counterpart: the same sweep's `Cam (2018)` rows leak into parse_release_info's
    # `source`, not into ReleaseFacts, so they contribute no fp here.
    cam = [r for r in ROWS if r.title.startswith("Cam.2018")]
    assert len(cam) == 2
    for row in cam:
        assert "opus" not in parse_release_facts(row.title).audio


def test_digit_glued_and_misspelt_audio():
    """Two audio false negatives, one per cause, each a single real title.

    ``...TrueHD7 1Atmos HEV`` glues the channel count to the next token, and
    ``(?<![a-z0-9])`` on the ``atmos`` pattern refuses a digit on its left — the same
    boundary that makes ``DDP5.1`` work on the *right* costs this on the left. And
    ``...REMUX.1080p.TRUHD.51.AC351...`` spells TrueHD without the ``e``, which no amount of
    separator tolerance reaches.

    Both are deliberately left as misses rather than patched: widening the left boundary to
    admit a preceding digit would make ``AC351`` readable as ``AC3`` *and* ``51`` as a token
    start, and a ``tru(e)?hd`` alternative would start matching release-group names. The
    cost is two titles in 370, written down.
    """
    atmos_fn = OFFENDERS[("audio", "atmos")][1]
    truehd_fn = OFFENDERS[("audio", "truehd")][1]
    assert len(atmos_fn) == 1 and "1Atmos" in atmos_fn[0], atmos_fn
    assert len(truehd_fn) == 1 and "TRUHD" in truehd_fn[0], truehd_fn


def test_bit_depth_codec_corequirement_cost():
    """Eight ``bit_depth`` false negatives, and six of them are upstream truncation.

    The co-requirement (a depth is reported only beside a video codec token) exists because
    ``Concert.2020.FLAC.24bit.48kHz`` would otherwise report an *audio* sample depth as a
    video one. Its cost, measured: six ``...UHD BluRay HDR10 10bit AC-3 TrueHD7 1 ...`` rows
    where the provider clipped the title *before* the codec, so a stated 10-bit depth is
    suppressed by the absence of a token that was present in the real release name; and two
    ProRes rows that state ``10-bit``/``10 bit`` and name no codec from
    ``VIDEO_FAMILIES`` at all.

    This is the one place where the truncation hazard and a parser rule compound, and it is
    why the truncation count is pinned separately below.
    """
    fns = OFFENDERS[("bit_depth", "10")][1]
    assert len(fns) == 8, f"bit_depth=10 fn is {len(fns)}:\n" + "\n".join(fns)
    clipped = [t for t in fns if t.endswith(("HE", "HEV", "1", "At", "A"))]
    assert len(clipped) == 6, f"expected 6 codec-clipped rows, got {len(clipped)}:\n" + "\n".join(clipped)
    prores = [t for t in fns if "ProRes" in t]
    assert len(prores) == 2, prores


def test_remux_and_codec_left_boundary_cost():
    """``BDRemux`` and ``HDR10HEVC``: one false negative each, both from the left boundary.

    ``(?<![a-z0-9])`` is what keeps ``RemuxDoc`` (a release group) from reading as a remux
    and ``HDRip`` from reading as HDR — both of which the corpus also contains, as correct
    negatives. The same boundary refuses ``BDRemux`` and the ``HEVC`` in ``HDR10HEVC``. The
    trade is deliberate: a false *positive* on remux or codec changes which release the
    television is sent, while these two misses only forgo a preference.
    """
    assert OFFENDERS[("remux", "true")][1] == [
        "Goodfellas *1990*[1080p.BDRemux.VC-1.DTS 5.1.Custom-Leon 345]"
    ]
    hevc_fn = OFFENDERS[("video_family", "hevc")][1]
    assert len(hevc_fn) == 1 and "HDR10HEVC" in hevc_fn[0], hevc_fn
    # The correct negatives that justify the boundary, asserted so the trade is visible.
    assert not parse_release_facts(
        "Spider-Man: Brand New Day (2026) 2160p 4K HDR10 DV WEB-DL Dual Audio "
        "[Hindi + English] ESub ~ RemuxDoc"
    ).remux
    assert parse_release_facts(
        "Tenet (2020) 480p HDRip (ORG) Hindi Dubbed HDRip x264 AAC ESub B ..."
    ).dynamic_range is None


def test_truncated_titles_are_measured():
    """The provider clips long names, and the clip lands on the releases that matter most.

    614 of the 6052 harvested titles end in `` ...`` — about one in ten — and the ones that
    get clipped are the longest, which is to say the feature-rich 2160p remuxes. 44 are in
    this corpus. Pinned as a count because it is a property of the *upstream*, not of the
    parser: no parser change can move this number, and a future harvest that no longer shows
    it is a change in the provider worth noticing.
    """
    truncated = [r.title for r in ROWS if r.title.endswith(" ...")]
    assert len(truncated) == 44, f"{len(truncated)} truncated rows:\n" + "\n".join(truncated)
    # A clip that removed a token outright, kept as the worked example.
    clipped_atmos = (
        "1917.2019.2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.TrueHD.7.1.A ..."
    )
    assert clipped_atmos in truncated
    assert "atmos" not in parse_release_facts(clipped_atmos).audio


def test_resolutions_outside_the_domain_report_none():
    """8K and interlaced names read as ``resolution is None``, which no rule may penalise.

    Both are in the corpus as hand-labelled ``None`` rather than as misses, because the
    field's domain really is ``{2160, 1080, 720, 480}``: ``480i`` is not what the bucket
    means, and a ``4320p`` upscale is above everything the profile reasons about. Worth
    knowing for the 4K gate: an 8K release is *not* withheld as un-opted-in 4K, because it
    does not read as 2160 at all.
    """
    interlaced = "Cowboy Bebop S01E01 Asteroid Blues 1080i DTS-HD MA 5 1 AVC REMUX-FraMeSToR"
    eight_k = (
        "The Last of Us -S01E01-4320p HDR Ai Upscale 7.1 Atmos+5.1 MultiDub/Sub MKV -Mesc"
    )
    assert any(r.title == interlaced and r.resolution is None for r in ROWS)
    assert any(r.title == eight_k and r.resolution is None for r in ROWS)
    assert parse_release_facts(interlaced).resolution is None
    assert parse_release_facts(eight_k).resolution is None


def test_unknown_is_free_rows_exist():
    """Rows that name nothing must parse to nothing, or "unknown is free" is untestable.

    One row is excluded, and the exclusion is the point: ``Opus (2025) [720p] [BluRay]
    [YTS.MX]`` names no codec, no container and no audio, yet the parser reads ``opus``
    off the film's own name. It is counted as a false positive by
    :func:`test_film_title_read_as_metadata` instead of being quietly dropped here.
    """
    bare = [r for r in ROWS
            if not r.audio and r.video_family is None and r.container_guess is None
            and r.dynamic_range is None and r.bit_depth is None and not r.remux]
    excluded = [r for r in bare if r.title.startswith(("Opus", "Опус"))]
    assert len(excluded) == 1, [r.title for r in excluded]
    bare = [r for r in bare if r not in excluded]
    assert len(bare) >= 5, f"only {len(bare)} all-unknown rows"
    for row in bare:
        facts = parse_release_facts(row.title)
        assert facts.audio == frozenset(), (row.title, facts.audio)
        assert facts.video_family is None, (row.title, facts.video_family)
        assert facts.container_guess is None, (row.title, facts.container_guess)
        assert facts.dynamic_range is None, (row.title, facts.dynamic_range)
        assert facts.bit_depth is None, (row.title, facts.bit_depth)
        assert facts.remux is False, row.title
