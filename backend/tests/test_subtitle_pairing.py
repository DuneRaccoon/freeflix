"""Stage 9: the five-rung sidecar pairing ladder, and the rung it reports.

PROVENANCE OF EVERY FIXTURE IN THIS FILE, stated once. There is no corpus of sidecar
filenames anywhere in this repository: ``backend/tests/data/releases.tsv`` is 370 title
rows of nine columns with no path column, and ``grep -cE '\\.srt|Subs/'`` over it is 0.
So every layout below is a HAND-AUTHORED assumption, taken from the stage 9 plan's D20
and its design notes, and each one carries its own note about which rung it is there to
exercise and why it discriminates. What this file can settle: that each rung is
reachable, that ``pair_source`` names the rung actually taken, and that the two measured
traps (a range-named torrent root, a basename-only pairing) are avoided. What it cannot
settle: whether the rung ORDER is right when two rungs disagree on a real release, or
whether any of these conventions occurs in the wild. Reading 37 decides that.

Why ``pair_source`` is asserted everywhere rather than only the index: for
``Pack/Pack.S01E03.en.srt`` the stem rung and the parse rung AGREE on the answer, so
deleting the stem rung changes no index and is invisible to an index-only assertion.
The exposed rung is the only instrument that separates a correct answer from a
correct-by-accident one.
"""
import pytest

from app.subtitles import naming
from app.subtitles.naming import PAIR_SOURCES, pair, track_label


# --------------------------------------------------------------------------- (a) dir

# A season pack whose sidecars live in per-episode folders under `Subs/`. The episode
# number appears ONLY in the folder, never in the subtitle's own basename — which is
# what makes this fixture discriminate: a pairing built from `Path(p).name` (the shape
# `manager.py:1094` uses for its episode map) sees `2_English.srt` and has nothing to
# go on. A fixture named `Pack.S01E05.en.srt` cannot discriminate it, because the
# episode is then in both places. Two videos, so the single-video rung cannot answer.
DIR_FIXTURE_VIDEOS = [
    {"index": 1, "rel_path": "Pack.S01/Pack.S01E05.mkv", "size": 900_000_000},
    {"index": 2, "rel_path": "Pack.S01/Pack.S01E06.mkv", "size": 900_000_000},
]
DIR_FIXTURE_SIDECAR = "Pack.S01/Subs/Pack.S01E05/2_English.srt"


def test_the_directory_rung_pairs_a_sidecar_whose_basename_names_no_episode():
    assert pair(DIR_FIXTURE_SIDECAR, DIR_FIXTURE_VIDEOS) == (1, "dir")


def test_the_directory_rung_uses_the_whole_folder_name_not_its_path_stem():
    """`PurePosixPath("Pack.S01E05").stem` is `"Pack.S01"` — an SxxEyy suffix looks
    exactly like a file extension. Taking `.stem` of the directory would compare
    `Pack.S01` against a video stem and miss, falling through to a rung that cannot
    answer for this layout. Pinned separately from the row above because the two break
    for different reasons and a reader needs to know which."""
    index, source = pair("Pack.S01/Subs/Pack.S01E06/2_English.srt",
                         DIR_FIXTURE_VIDEOS)
    assert (index, source) == (2, "dir")


# ------------------------------------------------------------------------- (b) parse

# THE MEASURED TRAP. `parse_episode` is an `re.search` taking the first left-to-right
# match (`providers/episodes.py:14-16`), so a RANGE-NAMED torrent root overrides a
# correct later segment: with the root in, this sidecar's path parses to (1, 1) and the
# truth is (1, 4). Ten of the 94 `shape=episode` rows in `releases.tsv` are range-named
# and 0 of 119 `pack` rows parse any episode, so the trap set is exactly the releases
# most likely to ship a multi-sidecar `Subs/` tree.
#
# The video basenames deliberately carry their full release suffix, so they do NOT equal
# the subtitle folder's name. That is what pushes this fixture past the `dir` rung and
# makes rung 3 the one under test — asserted by `pair_source == "parse"`.
BB_ROOT = "Breaking.Bad.S01E01-07.1080p.BluRay"
TRAP_VIDEOS = [
    {"index": 0, "rel_path": f"{BB_ROOT}/Breaking.Bad.S01E01.1080p.BluRay.x264-GRP.mkv",
     "size": 2_000_000_000},
    {"index": 1, "rel_path": f"{BB_ROOT}/Breaking.Bad.S01E04.1080p.BluRay.x264-GRP.mkv",
     "size": 2_100_000_000},
]
TRAP_SIDECAR = f"{BB_ROOT}/Subs/Breaking.Bad.S01E04/3_English.srt"


def test_the_parse_rung_excludes_the_torrent_root():
    """The root is EXCLUDED, not merely deprioritised.

    The fixture discriminates because the root parses to a DIFFERENT episode than the
    truth: including it yields (1, 1), which belongs to another file in the same
    torrent. A root that parsed to nothing, or to the same episode, would leave this
    assertion green under the mutation.
    """
    assert pair(TRAP_SIDECAR, TRAP_VIDEOS) == (1, "parse")


def test_the_parse_rung_requires_the_paired_video_to_agree():
    """A sidecar whose episode no video claims is unpaired, not paired to the nearest
    guess. Same root, same `Subs/` convention, an episode that is not in the torrent."""
    assert pair(f"{BB_ROOT}/Subs/Breaking.Bad.S01E07/3_English.srt",
                TRAP_VIDEOS) == (None, "none")


# -------------------------------------------------------------------- (c) rung order

# The rung-order fixture. The stem rung and the parse rung AGREE here — both resolve to
# E03 — so only the reported rung can tell them apart. `Pack` is the torrent root, and
# the root's own name matches no video stem, so the `dir` rung does not intervene.
ORDER_VIDEOS = [
    {"index": 0, "rel_path": "Pack/Pack.S01E03.mkv", "size": 800_000_000},
    {"index": 1, "rel_path": "Pack/Pack.S01E04.mkv", "size": 800_000_000},
]


def test_the_stem_rung_runs_before_the_parse_rung():
    assert pair("Pack/Pack.S01E03.en.srt", ORDER_VIDEOS) == (0, "stem")


def test_the_stem_rung_peels_a_trailing_modifier_as_well_as_a_language():
    """`Movie.en.forced.srt` sheds two tokens, so peeling has to be iterative rather
    than one token deep."""
    assert pair("Pack/Pack.S01E04.en.forced.srt", ORDER_VIDEOS) == (1, "stem")


def test_the_stem_rung_does_not_peel_a_four_digit_year():
    """A 1-2 digit trailing token is a track index; a four-digit one is part of the
    title. Peeling the year would stop `Movie.2020.en.srt` ever reaching
    `Movie.2020.mkv`, and the fallback rungs cannot answer for a flat two-video
    torrent — so this would silently become `none`."""
    videos = [
        {"index": 0, "rel_path": "Movie.2020.mkv", "size": 1_000},
        {"index": 1, "rel_path": "Other.2021.mkv", "size": 1_000},
    ]
    assert pair("Movie.2020.en.srt", videos) == (0, "stem")


def test_the_stem_rung_peels_a_leading_track_index_and_a_language_name():
    """Two peels that no other row in this file reaches. Found GREEN by review.

    `_core_tokens` peels tag tokens off BOTH ends, and `_is_tag_token` treats a full
    English language NAME as a tag. Measured in review: deleting the leading-peel loop
    outright, and dropping the `_NAME_TO_CODE` arm of `_is_tag_token`, each left all 32
    rows of this stage green. The `dir` and `parse` rungs answer for every
    `2_English.srt` fixture above, so rung 1 never saw a leading index, and no sidecar
    above spells its language out in full.

    HAND-AUTHORED, like every fixture here. Two videos and a flat torrent, so the `dir`
    rung has no ancestor directory to use and the `single` rung has two candidates, and
    neither name parses an episode — so without the peel each of these falls all the
    way through to `(None, "none")`.
    """
    videos = [
        {"index": 0, "rel_path": "Movie.2020.mkv", "size": 1_000},
        {"index": 1, "rel_path": "Other.2021.mkv", "size": 1_000},
    ]
    # A leading track index with a trailing language CODE. The trailing loop takes the
    # `en` and then stops on the four-digit year, so the LEADING loop is the only thing
    # that can remove the `2`.
    assert pair("2_Movie.2020.en.srt", videos) == (0, "stem")
    # The language written out in full, which is a tag only by way of the English-name
    # table — the code table holds `en`, never `english`.
    assert pair("Movie.2020.English.srt", videos) == (0, "stem")


# ------------------------------------------------------------------------ (d) single

def test_a_single_video_torrent_pairs_by_shape():
    """A flat one-video torrent. The sidecar's stem DIFFERS from the video's on
    purpose: if it matched, rungs 1 and 3 would agree with rung 4 and deleting any of
    them would be green."""
    videos = [{"index": 0, "rel_path": "Movie.2020.mkv", "size": 1_500_000_000}]
    assert pair("English.srt", videos) == (0, "single")


# -------------------------------------------------------------------------- (e) none

# Two videos and a flat `Subs/` folder with no episode hint anywhere: not in the
# basename, not in the folder, not parseable. The honest answer is `none`.
NO_HINT_VIDEOS = [
    {"index": 1, "rel_path": "Pack.S01/Pack.S01E01.mkv", "size": 700_000_000},
    {"index": 2, "rel_path": "Pack.S01/Pack.S01E02.mkv", "size": 1_400_000_000},
]


def test_an_unpairable_sidecar_is_not_handed_to_the_largest_video():
    """`get_video_file_info` (`manager.py:1134`) and the resume-data reader (`:1266`)
    both fall back to `max(files, key=size)`, because for a STREAM an unspecified index
    means "the movie". Inheriting that here would caption one episode's dialogue over
    whichever file happens to be biggest, with no error anywhere. The fixture's second
    video is deliberately twice the size of the first, so the fallback's answer differs
    from `None`."""
    assert pair("Pack.S01/Subs/2_English.srt", NO_HINT_VIDEOS) == (None, "none")


def test_a_torrent_with_no_video_files_pairs_to_nothing():
    assert pair("Subs/2_English.srt", []) == (None, "none")


# ------------------------------------------------------- the relative-path contract

def test_an_absolute_video_path_is_refused_rather_than_mispaired():
    """`get_video_files` builds `path` as `save_path / fi.path` (`manager.py:1081`).
    Feeding that list here would prepend the save path's segments, so `/downloads`
    becomes the "torrent root" and D20's root exclusion would drop the wrong segment —
    a confident wrong pairing with no error anywhere. The alias raises instead."""
    with pytest.raises(ValueError):
        pair("Movie/Movie.en.srt",
             [{"index": 0, "path": "/downloads/Movie/Movie.mkv"}])


def test_a_relative_path_alias_is_accepted():
    """`path` is honoured while it is relative, so a caller that has not yet adopted
    `rel_path` is not silently wrong — only an absolute one is refused."""
    assert pair("Movie/Movie.en.srt",
                [{"index": 0, "path": "Movie/Movie.mkv"}]) == (0, "stem")


# ---------------------------------------------------------------- (j) the vocabulary

def test_every_pair_source_renders_a_distinct_sentence():
    """What the picker row says about how the pairing was reached (D20).

    `stem` and `single` share the plain label BY DECISION: in both cases the names say
    it outright, so there is nothing inferred to confess. The equality is asserted
    rather than left implicit, so flipping it is a deliberate edit. The other three are
    pairwise distinct, and a collapse is what this row exists to catch — "matched by
    folder", "matched by episode number" and "unmatched" are three different things to
    be told while deciding whether to trust what is on screen.
    """
    labels = {source: track_label("English", source) for source in PAIR_SOURCES}

    assert labels["stem"] == "English"
    assert labels["single"] == "English"

    confessing = [labels["dir"], labels["parse"], labels["none"]]
    assert labels["dir"] == "English (matched by folder)"
    assert labels["parse"] == "English (matched by episode number)"
    assert len(set(confessing + [labels["stem"]])) == 4
    assert all(label.startswith("English") for label in labels.values())


def test_the_label_suffix_table_covers_every_pair_source():
    """A rung with no suffix entry would raise a KeyError at render time, on the
    television, in the one code path that has no console."""
    for source in PAIR_SOURCES:
        rendered = track_label("Unknown", source)
        assert isinstance(rendered, str)
        assert rendered.startswith("Unknown")


# ----------------------------------------- ambiguity: rungs 1, 2 and 3 all refuse

# REVIEW FINDING (task 4, finding 1) and the fixtures are the reviewer's own, measured
# against the shipped module in a one-off container before the fix:
#
#   pair(AMBIGUOUS_STEM_SIDECAR, AMBIGUOUS_SEASON_VIDEOS)           -> (0, "stem")
#   pair(AMBIGUOUS_DIR_SIDECAR,  AMBIGUOUS_SEASON_VIDEOS)           -> (0, "dir")
#   pair(AMBIGUOUS_STEM_SIDECAR, reversed(AMBIGUOUS_SEASON_VIDEOS)) -> (1, "stem")
#
# Season TWO's file for a Season 1 sidecar, reported as the most confident rung there
# is, and flipping with file-index order. Rungs 1 and 2 returned on the FIRST match and
# never looked for a second, so the one failure mode this module exists to make visible
# — a confident wrong pairing with no error anywhere — was produced by the two rungs
# that run before the one that guards against it.
#
# HAND-AUTHORED like every fixture in this file, and the shape is D20's own: a
# multi-season "Complete" pack with per-season folders and BARE episode basenames is
# the layout D20 cites to justify rung 2 existing at all. What makes it ambiguous is
# that both videos' basename stems are the same string, `E01`, and what makes it
# unrecoverable is that the season lives only in a segment `parse_episode` cannot read
# — measured, `parse_episode("Season 1/E01.en.srt")` is None, because `_SXXEYY` wants
# `S<digits>` adjacent to `E<digits>` and the `/` breaks it.
AMBIGUOUS_SEASON_VIDEOS = [
    {"index": 0, "rel_path": "Show.Complete/Season 2/E01.mkv", "size": 900_000_000},
    {"index": 1, "rel_path": "Show.Complete/Season 1/E01.mkv", "size": 900_000_000},
]
AMBIGUOUS_STEM_SIDECAR = "Show.Complete/Season 1/E01.en.srt"
AMBIGUOUS_DIR_SIDECAR = "Show.Complete/Season 1/Subs/E01/2_English.srt"


def test_the_stem_rung_refuses_an_ambiguous_match():
    """Two videos whose stems both equal the sidecar's: rung 1 declines.

    The whole tuple is asserted, not just `source != "stem"`. The index is half the
    claim — `(0, "parse")` would be the same wrong season's file under a more honest
    name — and for this layout no later rung can read a `Season 1` folder, so `none` is
    the only answer that is not a coin flip.
    """
    index, source = pair(AMBIGUOUS_STEM_SIDECAR, AMBIGUOUS_SEASON_VIDEOS)
    assert source != "stem"
    assert (index, source) == (None, "none")


def test_the_directory_rung_refuses_an_ambiguous_match():
    """The same two videos, reached through the folder instead of the basename.

    Pinned separately from the row above because the two rungs are separate loops with
    separate guards: reverting either one alone leaves the other row green.
    """
    index, source = pair(AMBIGUOUS_DIR_SIDECAR, AMBIGUOUS_SEASON_VIDEOS)
    assert source != "dir"
    assert (index, source) == (None, "none")


# The FALL-THROUGH, which is the other half of the decision: a rung that refuses
# CONTINUES rather than returning `none` on the spot, because a later rung may resolve
# the same sidecar uniquely and correctly. Same two-videos-one-basename ambiguity as
# above, but here the per-episode folders DO parse (`Pack.S01E01` / `Pack.S02E01`), so
# rung 3 can tell the two apart where rungs 1 and 2 cannot. Measured, both of these
# answered `(0, "stem")` / `(0, "dir")` before the fix — the right file by luck under
# the wrong rung, and the wrong file when the list was reversed.
FALLTHROUGH_VIDEOS = [
    {"index": 0, "rel_path": "Show/Pack.S01E01/E01.mkv", "size": 800_000_000},
    {"index": 1, "rel_path": "Show/Pack.S02E01/E01.mkv", "size": 800_000_000},
]
FALLTHROUGH_STEM_SIDECAR = "Show/Pack.S01E01/E01.en.srt"
FALLTHROUGH_DIR_SIDECAR = "Show/Pack.S01E01/E01/3_English.srt"


def test_an_ambiguous_stem_falls_through_to_a_rung_that_can_resolve_it():
    """Rung 1 declines, rung 2's folder (`Pack.S01E01`) matches no video stem, and
    rung 3 resolves it — so the answer is right AND says which rung earned it. This is
    the row that pins falling through: making rung 1 return `(None, "none")` on
    ambiguity instead of continuing turns this into `none`."""
    assert pair(FALLTHROUGH_STEM_SIDECAR, FALLTHROUGH_VIDEOS) == (0, "parse")


def test_an_ambiguous_directory_falls_through_to_a_rung_that_can_resolve_it():
    """The same for rung 2: the sidecar's folder is the bare `E01`, which both videos
    claim, and the episode below the torrent root resolves it to exactly one."""
    assert pair(FALLTHROUGH_DIR_SIDECAR, FALLTHROUGH_VIDEOS) == (0, "parse")


def test_the_answer_does_not_depend_on_the_order_of_the_video_files():
    """THE ROW WITH TEETH. `video_files` arrives in the torrent's own file-index order,
    which is a property of how the release was packed and not of what it contains, so
    an answer that depends on it is a coin flip wearing a rung's name. Before the fix,
    every pair below answered index 0 forward and index 1 reversed.

    Equality of the two answers is the whole assertion on purpose: it holds whether the
    honest answer is `none` (the first two pairs) or a resolved file (the last two), and
    it reddens under the first-match revert in both shapes.
    """
    cases = [
        (AMBIGUOUS_STEM_SIDECAR, AMBIGUOUS_SEASON_VIDEOS),
        (AMBIGUOUS_DIR_SIDECAR, AMBIGUOUS_SEASON_VIDEOS),
        (FALLTHROUGH_STEM_SIDECAR, FALLTHROUGH_VIDEOS),
        (FALLTHROUGH_DIR_SIDECAR, FALLTHROUGH_VIDEOS),
    ]
    for sidecar, videos in cases:
        forward = pair(sidecar, videos)
        backward = pair(sidecar, list(reversed(videos)))
        assert forward == backward, f"{sidecar} answered {forward} / {backward}"


# Rung 3's own refusal — D20 specified it, and review measured that NOTHING pinned it:
# dropping the `len(agreeing) == 1` guard for a bare `if agreeing:` left all 35 rows of
# this stage's two pairing/language files green. It is cited as the argument for the
# decision above, so it gets a row of its own.
#
# HAND-AUTHORED: a pack carrying two encodes of the same episode, which is what a
# repack or a dual-quality release looks like. The release suffixes differ, so neither
# video stem equals the sidecar's stem or its `S01E03` folder (rungs 1 and 2 find
# nothing at all here, not an ambiguity), and both parse to (1, 3) below the root.
DUAL_ENCODE_VIDEOS = [
    {"index": 0, "rel_path": "Pack/Pack.S01E03.1080p.GRP.mkv", "size": 2_000_000_000},
    {"index": 1, "rel_path": "Pack/Pack.S01E03.720p.OTHER.mkv", "size": 900_000_000},
]


def test_the_parse_rung_refuses_two_videos_claiming_one_episode():
    assert pair("Pack/Subs/S01E03/3_English.srt", DUAL_ENCODE_VIDEOS) == (None, "none")


class _LogRecorder:
    """Records `logger.info` calls and swallows every other level."""

    def __init__(self):
        self.info_lines = []

    def info(self, message, *args, **kwargs):
        self.info_lines.append(str(message))

    def __getattr__(self, _name):
        return lambda *args, **kwargs: None


def test_a_rung_that_declines_on_ambiguity_says_so_at_info(monkeypatch):
    """A silent fall-through is how the first-match bug survived a design round, a plan
    and an implementation: `pair()`'s return value cannot distinguish a rung that
    declined from a rung that never fired, so the refusal has to say so somewhere.

    The count of claimants is asserted, not just the fact of a line, because "nothing
    matched" and "two videos matched" are different facts about the same `none` and only
    the second one says the parse is not discriminating.
    """
    recorder = _LogRecorder()
    monkeypatch.setattr(naming, "logger", recorder)

    # A rung that resolves cleanly says nothing at all — this is not a per-pair log.
    assert pair("Pack/Pack.S01E03.en.srt", ORDER_VIDEOS) == (0, "stem")
    assert recorder.info_lines == []

    assert pair(AMBIGUOUS_STEM_SIDECAR, AMBIGUOUS_SEASON_VIDEOS) == (None, "none")
    assert len(recorder.info_lines) == 1
    line = recorder.info_lines[0]
    assert "'stem'" in line
    assert AMBIGUOUS_STEM_SIDECAR in line
    assert "2 videos claim it" in line
    assert "[0, 1]" in line

    recorder.info_lines.clear()
    assert pair(AMBIGUOUS_DIR_SIDECAR, AMBIGUOUS_SEASON_VIDEOS) == (None, "none")
    assert len(recorder.info_lines) == 1
    assert "'dir'" in recorder.info_lines[0]

    recorder.info_lines.clear()
    assert pair("Pack/Subs/S01E03/3_English.srt", DUAL_ENCODE_VIDEOS) == (None, "none")
    assert len(recorder.info_lines) == 1
    assert "'parse'" in recorder.info_lines[0]
