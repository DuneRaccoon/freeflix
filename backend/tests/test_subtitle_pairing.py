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
