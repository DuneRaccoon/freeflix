"""Measured-defect tests for :func:`parse_release_facts`.

Every row below exists because a specific pattern, written the way the three regexes above
it in ``providers/quality.py`` are written, gets that title **wrong**. The id of each row
names the defect, so a mutation report can say which rows reddened.

Three rules this file is written to:

1. **Whole-object equality.** A row asserts the entire :class:`ReleaseFacts`, not one
   field, so a pattern that accidentally starts matching something else reddens here
   rather than in stage 8's rules engine.
2. **Every enum member has a positive and a negative row**
   (:func:`test_every_audio_token_has_a_positive_and_a_negative_row`). A pattern with no
   fixture is a pattern nobody tested.
3. **Counts are pinned** (:func:`test_enum_and_fixture_table_sizes_are_pinned`), because a
   parametrised test that iterates an exported list silently loses coverage when the list
   shrinks.
"""
import dataclasses

import pytest

from app.providers.quality import (
    AUDIO_TOKENS,
    BIT_DEPTHS,
    CONTAINER_TOKENS,
    DYNAMIC_RANGES,
    VIDEO_FAMILIES,
    ReleaseFacts,
    parse_release_facts,
    parse_release_info,
)


def _facts(**kwargs) -> ReleaseFacts:
    """A ReleaseFacts with 'unknown' everywhere but the fields a row names."""
    return ReleaseFacts(**kwargs)


# (id, title, expected facts). Expectations are written by hand, from the token the title
# names — never by running the parser and copying what came back.
ROWS = [
    # -- audio: the boundary is digit-tolerant, because a scene name glues ----------------
    # ``\bdd\b`` does not match this. It is the single most common audio spelling there is.
    (
        "dd5.1-glued-to-channel-count",
        "Movie.2020.1080p.BluRay.DD5.1.x264-GRP",
        _facts(audio=frozenset({"ac3"}), video_family="h264", resolution=1080),
    ),
    # ...and ``\bdd\b`` DOES match this, which is how the house style passes review while
    # failing the case above. Must stay green when the DD pattern is mutated back to ``\b``.
    (
        "dd-plus-is-eac3-not-ac3",
        "Movie.2021.1080p.WEB-DL.DD+5.1.H.264-NTb",
        _facts(audio=frozenset({"eac3"}), video_family="h264", resolution=1080),
    ),
    (
        "ddp5.1-the-amzn-standard",
        "Movie.2021.1080p.WEB-DL.DDP5.1.x264-NTb",
        _facts(audio=frozenset({"eac3"}), video_family="h264", resolution=1080),
    ),
    (
        "dd-plus-spelled-out",
        "Movie.2021.1080p.WEB-DL.DDPlus.5.1.x264-GRP",
        _facts(audio=frozenset({"eac3"}), video_family="h264", resolution=1080),
    ),
    # ``ac3`` matches INSIDE ``E-AC3`` — the hyphen supplies its left boundary. Reddens if
    # ``ac3`` is scanned before ``eac3``.
    (
        "e-ac3-must-not-be-read-as-ac3",
        "Movie.2021.2160p.WEB-DL.E-AC3.5.1.Atmos.HEVC-GRP",
        _facts(audio=frozenset({"eac3", "atmos"}), video_family="hevc", resolution=2160),
    ),
    (
        "eac3-unhyphenated",
        "Movie.2021.1080p.WEB-DL.EAC3.2.0.x264-GRP",
        _facts(audio=frozenset({"eac3"}), video_family="h264", resolution=1080),
    ),
    (
        "plain-ac3",
        "Movie.2020.1080p.BluRay.AC3.x264-GRP",
        _facts(audio=frozenset({"ac3"}), video_family="h264", resolution=1080),
    ),
    (
        "aac2.0-glued-to-channel-count",
        "Movie.2019.1080p.WEBRip.AAC2.0.x264-GRP",
        _facts(audio=frozenset({"aac"}), video_family="h264", resolution=1080),
    ),
    # Two audio tracks in one title, which is why ``audio`` is a set and not a string. Also
    # the leftmost-match row: ``source`` parses as 'BluRay' here, so ``remux`` cannot be a
    # read of ``source``.
    (
        "two-tracks-and-remux-behind-bluray",
        "Movie.2016.2160p.UHD.BluRay.REMUX.HEVC.DTS-HD.MA.TrueHD.7.1.Atmos-GRP",
        _facts(
            audio=frozenset({"dtshd", "truehd", "atmos"}),
            video_family="hevc",
            remux=True,
            resolution=2160,
        ),
    ),
    # ``\bdts\b`` does not match ``DTSHD``, and ``dts`` scanned before ``dtshd`` would
    # report the wrong family for the hyphenated spelling.
    (
        "dtshd-unhyphenated",
        "Movie.2016.1080p.BluRay.DTSHD.MA.5.1.x264-GRP",
        _facts(audio=frozenset({"dtshd"}), video_family="h264", resolution=1080),
    ),
    (
        "dtshd-without-ma",
        "Show.S01.2160p.BluRay.DTS-HD.5.1.HEVC-GRP",
        _facts(audio=frozenset({"dtshd"}), video_family="hevc", resolution=2160),
    ),
    (
        "plain-dts",
        "Movie.2016.1080p.BluRay.DTS.5.1.x264-GRP",
        _facts(audio=frozenset({"dts"}), video_family="h264", resolution=1080),
    ),
    # Deliberate: DTS:X is recorded as the DTS family, not as a token of its own, because
    # every rule that reads this set treats the family as one thing.
    (
        "dts-x-is-the-dts-family",
        "Movie.2016.2160p.BluRay.DTS-X.7.1.HEVC-GRP",
        _facts(audio=frozenset({"dts"}), video_family="hevc", resolution=2160),
    ),
    # -- bit depth: two independent guards, one row each ----------------------------------
    # Guard 1, the 8|10|12 domain. A codec IS named here, so the codec co-requirement does
    # not cover this row: only the domain does. Reddens if ``(8|10|12)`` becomes ``(\d+)``.
    (
        "24bit-is-an-audio-sample-depth-not-a-video-one",
        "Concert.2020.1080p.x264.FLAC.24bit.48kHz",
        _facts(audio=frozenset({"flac"}), video_family="h264", resolution=1080),
    ),
    # Guard 2, the codec co-requirement. 10 IS in the domain here, so only the
    # co-requirement covers this row. Reddens if the co-requirement is dropped.
    (
        "10bit-with-no-codec-is-not-a-video-bit-depth",
        "Movie.2019.1080p.BluRay.10Bit.DD5.1-GRP",
        _facts(audio=frozenset({"ac3"}), resolution=1080),
    ),
    (
        "8bit-in-domain",
        "Movie.2020.1080p.BluRay.8bit.x264.AAC-GRP",
        _facts(audio=frozenset({"aac"}), video_family="h264", bit_depth=8, resolution=1080),
    ),
    (
        "12bit-in-domain-with-dv-and-truehd",
        "Movie.2022.2160p.UHD.BluRay.REMUX.DV.HEVC.12bit.TrueHD.7.1.Atmos-GRP",
        _facts(
            audio=frozenset({"truehd", "atmos"}),
            video_family="hevc",
            bit_depth=12,
            dynamic_range="dv",
            remux=True,
            resolution=2160,
        ),
    ),
    # -- codec family: AVC and Hi10P both parse as None through _CODEC today --------------
    # An AVC remux is the profile's most *preferable* class, so a release the television
    # plays best is currently a release it knows nothing about.
    (
        "avc-remux-is-h264",
        "Movie.2016.1080p.BluRay.REMUX.AVC.DTS-HD.MA.5.1-GRP",
        _facts(audio=frozenset({"dtshd"}), video_family="h264", remux=True, resolution=1080),
    ),
    # Hi10P is a bit depth written as a profile name, with no "bit" anywhere in the title.
    (
        "hi10p-is-h264-at-10-bit",
        "Show.S01E01.720p.Hi10P.AAC-GRP",
        _facts(audio=frozenset({"aac"}), video_family="h264", bit_depth=10, resolution=720),
    ),
    (
        "dotted-h.264-season-pack",
        "Show.S01.1080p.AMZN.WEB-DL.DDP5.1.H.264-NTb",
        _facts(audio=frozenset({"eac3"}), video_family="h264", resolution=1080),
    ),
    (
        "av1-with-opus",
        "Movie.2023.1080p.WEB-DL.Opus.2.0.AV1-GRP",
        _facts(audio=frozenset({"opus"}), video_family="av1", resolution=1080),
    ),
    # -- the container proxy --------------------------------------------------------------
    (
        "xvid-implies-avi",
        "Movie.2005.DVDRip.XviD.MP3-GRP",
        _facts(audio=frozenset({"mp3"}), video_family="xvid", container_guess="avi"),
    ),
    (
        "divx-implies-avi-too",
        "Movie.2004.DVDRip.DivX.AC3-GRP",
        _facts(audio=frozenset({"ac3"}), video_family="xvid", container_guess="avi"),
    ),
    # ``TS`` here is a telesync, not MPEG-TS. This row pins that it changes nothing.
    (
        "ts-is-a-telesync-not-a-container-with-xvid",
        "Movie.2020.TS.XviD-GRP",
        _facts(video_family="xvid", container_guess="avi"),
    ),
    # The same title without XviD: the only row that can tell ``container_guess is None``
    # from ``'ts'``, so it is the one that reddens when ``ts`` is added as a container.
    (
        "ts-is-a-telesync-not-a-container-no-xvid",
        "Movie.2020.TS.x264-GRP",
        _facts(video_family="h264"),
    ),
    # -- dynamic range: written from scratch, not split off `hdr` -------------------------
    # ``_HDR`` matches a bare ``DV`` but misses exactly these three spellings.
    (
        "dovi",
        "Movie.2021.2160p.DoVi.HEVC.DDP5.1-GRP",
        _facts(
            audio=frozenset({"eac3"}), video_family="hevc", dynamic_range="dv", resolution=2160
        ),
    ),
    (
        "dotted-dolby.vision",
        "Movie.2021.2160p.Dolby.Vision.HEVC.DDP5.1-GRP",
        _facts(
            audio=frozenset({"eac3"}), video_family="hevc", dynamic_range="dv", resolution=2160
        ),
    ),
    (
        # GLUED, deliberately. The dotted `DV.P8` spelling is carried by the BARE `dv`
        # alternative (its right boundary tolerates the following `.`), so this row named
        # the `dv[-. _]?p?8` branch while never exercising it: deleting that branch changed
        # 0 of ~2,165 test parses. `DVP8` is the only spelling that needs it, and without
        # this row a boundary rework could drop it and silently stop R5's 30-point
        # Dolby-Vision penalty from firing on it, with the suite still green.
        "dv-profile-8-glued",
        "Movie.2021.2160p.DVP8.HEVC.DDP5.1-GRP",
        _facts(
            audio=frozenset({"eac3"}), video_family="hevc", dynamic_range="dv", resolution=2160
        ),
    ),
    (
        "dv-profile-8-spelled-out",
        "Movie.2021.2160p.Profile.8.HEVC.DDP5.1-GRP",
        _facts(
            audio=frozenset({"eac3"}), video_family="hevc", dynamic_range="dv", resolution=2160
        ),
    ),
    # Must stay green when ``dovi`` is removed: HDR is not the gap, DV is.
    (
        "hdr-is-hdr10",
        "Your.Name.2016.2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.5.1-SWT",
        _facts(
            audio=frozenset({"dtshd"}),
            video_family="hevc",
            bit_depth=10,
            dynamic_range="hdr10",
            resolution=2160,
        ),
    ),
    # The legal 4K Atmos release: DDP carries it, so the profile's 2160p audio reject must
    # not fire on the word 'atmos'.
    (
        "hdr10-plus-with-legal-4k-atmos",
        "Movie.2021.2160p.HDR10+.HEVC.DDP5.1.Atmos-GRP",
        _facts(
            audio=frozenset({"eac3", "atmos"}),
            video_family="hevc",
            dynamic_range="hdr10",
            resolution=2160,
        ),
    ),
    (
        "hlg",
        "Show.S01E01.2160p.HLG.HEVC.AAC-GRP",
        _facts(
            audio=frozenset({"aac"}), video_family="hevc", dynamic_range="hlg", resolution=2160
        ),
    ),
    # ``HDRip`` is a source, and it is already in ``_SOURCE``. It is not HDR.
    (
        "hdrip-is-a-source-not-a-dynamic-range",
        "Movie.2020.1080p.HDRip.x264.AAC-GRP",
        _facts(audio=frozenset({"aac"}), video_family="h264", resolution=1080),
    ),
    # ``DVDRip`` is a source. It is not Dolby Vision.
    (
        "dvdrip-is-a-source-not-dolby-vision",
        "Movie.2020.DVDRip.XviD.AC3-GRP",
        _facts(audio=frozenset({"ac3"}), video_family="xvid", container_guess="avi"),
    ),
    # -- resolution: explicit NNNNp beats the 4k|uhd marketing proxy ----------------------
    # The containment row. ``parse_quality`` says '2160p' for this title and is deliberately
    # left that way; see ``test_quality.py``.
    (
        "explicit-1080p-beats-uhd-marketing",
        "Movie.2020.1080p.UHD.BluRay.DD5.1.x265-GRP",
        _facts(audio=frozenset({"ac3"}), video_family="hevc", resolution=1080),
    ),
    # No explicit token at all: the proxy is the only thing left, and it answers 2160.
    (
        "4k-uhd-proxy-with-no-explicit-token",
        "Movie.2020.4K.UHD.BluRay.x265-GRP",
        _facts(video_family="hevc", resolution=2160),
    ),
    # Interlaced is not a resolution, for the same reason ``parse_quality`` refuses it.
    # WHAT EXCLUDES IT is the pattern's required literal ``p`` -- NOT a right boundary. That
    # distinction is the whole of the two rows below, so do not "tidy" this into a lookahead.
    (
        "480i-is-not-a-resolution",
        "Show.2020.480i.HDTV.XviD-GRP",
        _facts(video_family="xvid", container_guess="avi"),
    ),
    # A RESOLUTION GLUED TO THE NEXT TOKEN, which EZTV, MeGusta, SPLiCE and MAZE all ship:
    # 12 of the 888 titles cached in this install, 10 of them 2160p. A ``(?![a-z])`` on
    # ``_RESOLUTION_TOKEN`` rejected the ``H`` of ``2160pHD`` under IGNORECASE and left
    # ``resolution=None`` -- which made BOTH of the profile's only two rejects structurally
    # unreachable (R1 and R2 key on ``facts.resolution``) while R9 still paid its bonus, so
    # an un-opted-in 4K release was PROMOTED past bucket-correct 1080p rows instead of being
    # withheld. These two rows are the whole coverage for that: before them the fix changed
    # 0 of ~2,165 test-string parses, in either direction.
    (
        "glued-2160pHD-is-still-a-2160-resolution",
        "The Odyssey 2026 2160pHD TELESYNC HEVC AAC2 0-SPLiCE",
        _facts(audio={"aac"}, video_family="hevc", resolution=2160),
    ),
    (
        "glued-1080pHD-is-still-a-1080-resolution",
        "Moana 2026 1080pHD WEB Eng Multi Subs EZTV",
        _facts(resolution=1080),
    ),
    (
        "no-resolution-token-at-all",
        "Movie.2020.x264-GRP",
        _facts(video_family="h264"),
    ),
    (
        "episode-naming-no-audio-named",
        "Show.S02E05.720p.HDTV.x264-GRP",
        _facts(video_family="h264", resolution=720),
    ),
    # -- the film's own title is parsed as metadata too, so the left boundary matters -----
    (
        "dd-inside-the-word-Dead",
        "Dead.Man.Walking.1995.1080p.BluRay.x264-GRP",
        _facts(video_family="h264", resolution=1080),
    ),
    (
        "dd-inside-the-word-Paddington",
        "Paddington.2014.1080p.BluRay.x264-GRP",
        _facts(video_family="h264", resolution=1080),
    ),
    # -- bitrate is absent, not computed --------------------------------------------------
    (
        "a-title-that-names-a-bitrate-still-reports-none",
        "Movie.2021.2160p.HEVC.80Mbps.DDP5.1-GRP",
        _facts(audio=frozenset({"eac3"}), video_family="hevc", resolution=2160),
    ),
]

# Every release title used as a fixture by the selector suites. None of them names a codec,
# an audio track or a container, and the profile must treat all three unknowns as free.
SELECTOR_FIXTURE_TITLES = [
    "M.2020.1080p.A",
    "M.2020.1080p.B",
    "M.2020.1080p.Dead",
    "M.2020.1080p.Zero",
    "M.2020.1080p.Real",
    "M.2020.1080p.Low",
    "M.2020.1080p.BluRay",
    "M.2020.1080p.WEB",
]


@pytest.mark.parametrize(
    "title,expected", [pytest.param(t, e, id=i) for i, t, e in ROWS]
)
def test_parse_release_facts_table(title, expected):
    assert parse_release_facts(title) == expected


def test_enum_and_fixture_table_sizes_are_pinned():
    """Absolute counts, beside every test that iterates one of these collections.

    A parametrised test that walks an exported list loses coverage silently when the list
    shrinks: delete a pattern and its rows stop running rather than failing. These numbers
    are the tripwire. Bump them deliberately, with rows, never to make a run green.
    """
    assert len(AUDIO_TOKENS) == 10, AUDIO_TOKENS
    assert len(CONTAINER_TOKENS) == 1, CONTAINER_TOKENS
    assert len(VIDEO_FAMILIES) == 4, VIDEO_FAMILIES
    assert len(DYNAMIC_RANGES) == 3, DYNAMIC_RANGES
    assert len(BIT_DEPTHS) == 3, BIT_DEPTHS
    # 42 at task 2; 44 after the two glued-resolution rows the whole-branch review's
    # critical finding required (a lookahead had made both profile rejects unreachable).
    assert len(ROWS) == 44
    assert len(SELECTOR_FIXTURE_TITLES) == 8
    ids = [row_id for row_id, _, _ in ROWS]
    assert len(set(ids)) == len(ids), "duplicate row ids hide one of the two rows"


def test_every_audio_token_has_a_positive_and_a_negative_row():
    """A pattern with no fixture is a pattern nobody tested.

    A token added to ``_AUDIO_PATTERNS`` with no row fails here, rather than sitting in the
    parser never matching anything and never being noticed.
    """
    positives = {token for _, _, expected in ROWS for token in expected.audio}
    negatives = {
        token
        for token in AUDIO_TOKENS
        if any(token not in expected.audio for _, _, expected in ROWS)
    }
    assert positives == set(AUDIO_TOKENS), (
        "audio tokens with no row that expects them: "
        f"{sorted(set(AUDIO_TOKENS) - positives)}"
    )
    assert negatives == set(AUDIO_TOKENS), (
        "audio tokens expected by every single row (so no row proves they can be absent): "
        f"{sorted(set(AUDIO_TOKENS) - negatives)}"
    )


def test_every_container_token_has_a_positive_and_a_negative_row():
    positives = {
        expected.container_guess for _, _, expected in ROWS if expected.container_guess
    }
    negatives = {
        token
        for token in CONTAINER_TOKENS
        if any(expected.container_guess != token for _, _, expected in ROWS)
    }
    assert positives == set(CONTAINER_TOKENS), (
        f"container tokens with no row: {sorted(set(CONTAINER_TOKENS) - positives)}"
    )
    assert negatives == set(CONTAINER_TOKENS), (
        f"container tokens no row proves absent: {sorted(set(CONTAINER_TOKENS) - negatives)}"
    )


def test_every_video_family_dynamic_range_and_bit_depth_has_a_row():
    """Same property for the three single-valued enums, including the ``None`` case."""
    families = {expected.video_family for _, _, expected in ROWS}
    ranges = {expected.dynamic_range for _, _, expected in ROWS}
    depths = {expected.bit_depth for _, _, expected in ROWS}
    assert VIDEO_FAMILIES | {None} == families, VIDEO_FAMILIES - families
    assert DYNAMIC_RANGES | {None} == ranges, DYNAMIC_RANGES - ranges
    assert BIT_DEPTHS | {None} == depths, BIT_DEPTHS - depths
    assert {True, False} == {expected.remux for _, _, expected in ROWS}


def test_parsed_values_stay_inside_the_declared_domains():
    """The contract ``services/capability.py`` keys on, asserted against real parses."""
    for row_id, title, _ in ROWS + [(t, t, None) for t in SELECTOR_FIXTURE_TITLES]:
        facts = parse_release_facts(title)
        assert facts.audio <= AUDIO_TOKENS, row_id
        assert facts.video_family in VIDEO_FAMILIES | {None}, row_id
        assert facts.bit_depth in BIT_DEPTHS | {None}, row_id
        assert facts.dynamic_range in DYNAMIC_RANGES | {None}, row_id
        assert facts.container_guess in CONTAINER_TOKENS | {None}, row_id
        assert facts.resolution in {2160, 1080, 720, 480, None}, row_id
        assert isinstance(facts.remux, bool), row_id


@pytest.mark.parametrize("title", SELECTOR_FIXTURE_TITLES)
def test_selector_fixture_titles_are_entirely_unknown(title):
    """Unknown has to be representable, because most of the library is unknown.

    These are the titles every selector test in the suite already uses. They name a
    resolution and nothing else, so the profile has to be able to say "no opinion" about
    them — a rule that penalised ``container_guess is None`` or an empty audio set would
    penalise the whole fixture corpus, and therefore the whole library.
    """
    facts = parse_release_facts(title)
    assert facts.audio == frozenset()
    assert facts.container_guess is None
    assert facts.video_family is None
    assert facts.bit_depth is None
    assert facts.dynamic_range is None
    assert facts.remux is False
    assert facts.resolution == 1080


def test_empty_and_none_titles_parse_to_all_unknown():
    assert parse_release_facts("") == ReleaseFacts()
    assert parse_release_facts(None) == ReleaseFacts()


def test_bitrate_mbps_is_always_none_in_stage_8():
    """Not a guard — a pin on a deliberate absence (rule R10, readings sheet row 25).

    No runtime reaches the selector, so bytes/runtime cannot be computed here. The field
    exists so R10 can be real code with a real predicate; task 4 injects a value into it to
    prove the plumbing is complete. If this ever stops being None, R10 stopped being inert
    and the readings sheet is out of date.
    """
    for _, title, _ in ROWS:
        assert parse_release_facts(title).bitrate_mbps is None, title


def test_release_facts_is_frozen_and_hashable():
    facts = parse_release_facts("Movie.2020.1080p.BluRay.DD5.1.x264-GRP")
    assert dataclasses.is_dataclass(facts)
    with pytest.raises(dataclasses.FrozenInstanceError):
        facts.resolution = 2160
    assert {facts, parse_release_facts("Movie.2020.1080p.BluRay.DD5.1.x264-GRP")} == {facts}


def test_parse_release_info_still_returns_exactly_its_four_keys():
    """It has no production callers, so it was left alone rather than widened.

    Pinned because the cheap-looking move for a future reader is to bolt the new facts onto
    this dict; the capability profile reads :class:`ReleaseFacts`, and a second, divergent
    representation of the same claims is how two parsers end up disagreeing.
    """
    info = parse_release_info("Movie.2021.2160p.WEB-DL.E-AC3.5.1.Atmos.HEVC-GRP")
    assert set(info) == {"quality", "codec", "source", "hdr"}
