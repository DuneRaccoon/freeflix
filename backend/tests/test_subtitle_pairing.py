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
correct-by-accident one. The same holds for ``near``, added in the proximity round: the
reviewer's two fixtures answer the RIGHT file under it, and the only thing that
separates that from the pre-fix module's right-file-by-luck is which source is reported.

THE AMBIGUITY RULE these rows pin, in one sentence, because it has been re-decided
THREE times: rungs 1 and 2 break several claimants by DIRECTORY PROXIMITY and take the answer
only when the deepest-shared claimant is unique; a tie proximity cannot break declines
and falls through, as does every rung-3 ambiguity. Each half has its own fixture, each
fixture says which half, and ``test_the_answer_does_not_depend_on_the_order_of_the_video_files``
covers every one of them across EVERY permutation of its video list.
"""
import itertools

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
    rather than left implicit, so flipping it is a deliberate edit. The other four are
    pairwise distinct, and a collapse is what this row exists to catch — "matched by
    folder", "nearest of several matches", "matched by episode number" and "unmatched"
    are four different things to be told while deciding whether to trust what is on
    screen.

    `near` is the one added in the proximity round, and it is a SEPARATE source rather
    than a reuse of `stem`/`dir` for exactly this reason: "its name matched one video"
    and "its name matched several and I took the closest" are different confidences,
    and a viewer looking at the wrong episode's subtitles needs to be able to tell
    which happened.
    """
    labels = {source: track_label("English", source) for source in PAIR_SOURCES}

    assert labels["stem"] == "English"
    assert labels["single"] == "English"

    confessing = [labels["dir"], labels["near"], labels["parse"], labels["none"]]
    assert labels["dir"] == "English (matched by folder)"
    assert labels["near"] == "English (nearest of several matches)"
    assert labels["parse"] == "English (matched by episode number)"
    assert len(set(confessing + [labels["stem"]])) == 5
    assert all(label.startswith("English") for label in labels.values())


def test_every_source_pair_can_return_is_a_key_of_the_suffix_table():
    """``track_label`` subscripts ``_PAIR_SOURCE_SUFFIX`` bare, so a source with no
    entry is a ``KeyError`` inside the sidecar list endpoint — a 500 for a whole
    torrent, on the television, in the one code path with no console.

    THIS IS AN AST SCAN OF ``pair()``'S RETURN SITES, not a loop over ``PAIR_SOURCES``,
    and the difference is the whole point. The row this replaces iterated
    ``PAIR_SOURCES`` and called ``track_label`` on each member. That row could fail
    while the tuple was written out by hand beside the map; it CANNOT fail now that
    ``PAIR_SOURCES`` is derived from the map's own keys, because then every member is a
    key by construction. Deriving the tuple removed one way to make the mistake and
    turned its guard into a tautology at the same moment.

    And neither form ever covered the way the mistake actually gets made. ``pair()``
    does not draw its answers from ``PAIR_SOURCES``: every rung returns a STRING
    LITERAL written inline at its own ``return``. So a new rung returning ``"best"``,
    or a typo in an existing one, diverges from both the map and the tuple, and a test
    that only relates the map to the tuple is green for it. The three-way agreement is
    what matters, and this is the only row that asserts it.
    """
    import ast
    import inspect

    tree = ast.parse(inspect.getsource(naming))
    fn = next(
        (n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "pair"),
        None,
    )
    # POSITIVE CONTROL, first, and in two parts: this file's own reflex is to assert a
    # collected set and this repo has shipped `== []` assertions over recorders that
    # never recorded. If `pair` is ever renamed, or its returns stop being tuples of
    # (index, source), the scan silently collects nothing and every assertion below
    # passes vacuously.
    assert fn is not None, "pair() not found — the scan is measuring nothing"

    returned = set()
    for node in ast.walk(fn):
        if isinstance(node, ast.Return) and node.value is not None:
            for sub in ast.walk(node.value):
                if isinstance(sub, ast.Constant) and isinstance(sub.value, str):
                    returned.add(sub.value)

    assert len(returned) >= 6, (
        f"the scan found only {sorted(returned)} — fewer source literals than the "
        "ladder has rungs, so it is not reading pair()'s returns"
    )

    # The three-way agreement, asserted in both directions so a STALE entry is caught
    # as well as a missing one: a suffix for a rung that no longer exists is copy the
    # television can never show, and it is how the table outlives the ladder.
    assert returned == set(naming._PAIR_SOURCE_SUFFIX), (
        f"pair() can return {sorted(returned)}; the suffix table has "
        f"{sorted(naming._PAIR_SOURCE_SUFFIX)}"
    )
    assert returned == set(PAIR_SOURCES), (
        f"pair() can return {sorted(returned)}; PAIR_SOURCES is {sorted(PAIR_SOURCES)}"
    )

    # And every one of them renders, which is the harm itself rather than its cause.
    for source in sorted(returned):
        assert track_label("Unknown", source).startswith("Unknown")


# -------------------- ambiguity: rungs 1 and 2 break it by proximity, or else refuse

# REVIEW FINDING (task 4, finding 1) and the fixtures are the reviewer's own, measured
# against the shipped module in a one-off container before the first fix:
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
# `f049a5f` made both rungs collect every claimant and refuse unless exactly one, which
# turned these two fixtures into `(None, "none")`. THE SECOND ROUND re-decided that, and
# these are the rows that say so: both rungs compared basename stems only and ignored
# where the sidecar SITS, and the shared-directory depths here are
#
#   {0: 1, 1: 2}   for BOTH sidecars  — measured in a one-off container
#
# so Season 1's file is derivable, uniquely and in either file order. Refusing yielded
# NO subtitle for every sidecar in the layout D20 cites to justify rung 2 existing.
#
# HAND-AUTHORED like every fixture in this file, and the shape is D20's own: a
# multi-season "Complete" pack with per-season folders and BARE episode basenames. What
# makes it ambiguous is that both videos' basename stems are the same string, `E01`, and
# what makes PROXIMITY the only thing that can break it is that the season lives only in
# a segment `parse_episode` cannot read — measured, `parse_episode("Season 1/E01.en.srt")`
# is None, because `_SXXEYY` wants `S<digits>` adjacent to `E<digits>` and the `/`
# breaks it, so rung 3 cannot resolve these and `near` is not a shortcut past a rung
# that would have done better.
AMBIGUOUS_SEASON_VIDEOS = [
    {"index": 0, "rel_path": "Show.Complete/Season 2/E01.mkv", "size": 900_000_000},
    {"index": 1, "rel_path": "Show.Complete/Season 1/E01.mkv", "size": 900_000_000},
]
AMBIGUOUS_STEM_SIDECAR = "Show.Complete/Season 1/E01.en.srt"
AMBIGUOUS_DIR_SIDECAR = "Show.Complete/Season 1/Subs/E01/2_English.srt"


def test_the_stem_rung_breaks_an_ambiguous_match_by_directory_proximity():
    """The reviewer's stem case, answering the RIGHT season's file.

    The whole tuple is asserted. The index is half the claim and the source is the
    other half: `(1, "stem")` would be the right file wearing a confidence the module
    did not earn, which is what this stage's whole `pair_source` graft exists to make
    impossible, and it is the one thing that reddens when a proximity resolution is
    reported as the rung that was ambiguous.
    """
    assert pair(AMBIGUOUS_STEM_SIDECAR, AMBIGUOUS_SEASON_VIDEOS) == (1, "near")


def test_the_directory_rung_breaks_an_ambiguous_match_by_directory_proximity():
    """The reviewer's dir case. Pinned separately from the row above because the two
    rungs are separate loops with separate tiebreak calls: reverting either one alone
    leaves the other row green — measured, both ways, in the mutation round."""
    assert pair(AMBIGUOUS_DIR_SIDECAR, AMBIGUOUS_SEASON_VIDEOS) == (1, "near")


def test_a_proximity_resolved_pair_confesses_it_in_its_label():
    """End to end, from the paths to the sentence on the television.

    The two rows above pin what `pair()` returns; this one pins that the returned
    source reaches the picker row as a DIFFERENT sentence from a unique match. Reporting
    a proximity resolution as `stem`/`dir` renders the plain "English" — a row with
    nothing to confess about a pairing that was chosen out of two candidates — and that
    is the mutation this row exists to catch. The table-coverage row above catches the
    other half (a new source with no suffix entry raises `KeyError` on the television,
    in the one code path with no console).
    """
    _index, source = pair(AMBIGUOUS_STEM_SIDECAR, AMBIGUOUS_SEASON_VIDEOS)
    assert track_label("English", source) == "English (nearest of several matches)"
    assert track_label("English", source) != track_label("English", "stem")

    _index, source = pair(AMBIGUOUS_DIR_SIDECAR, AMBIGUOUS_SEASON_VIDEOS)
    assert track_label("English", source) == "English (nearest of several matches)"
    assert track_label("English", source) != track_label("English", "dir")


# THE TIE. The same two-seasons-one-basename ambiguity, with the sidecar moved to a
# top-level `Subs/` folder so it is EQUIDISTANT from both season folders: the shared
# depths are {0: 1, 1: 1}, the greatest is shared, and proximity has nothing to say.
# This is the half of the decision that did not change — an ambiguity the paths cannot
# break still declines and falls through, and for this layout no later rung can read a
# `Season 1` folder either, so `none` is the only answer that is not a coin flip.
#
# HAND-AUTHORED. A flat `Subs/` tree at the root of a multi-season pack is the same
# convention as `DIR_FIXTURE_SIDECAR` above, one level higher.
TIE_SEASON_VIDEOS = [
    {"index": 0, "rel_path": "Show.Complete/Season 1/E01.mkv", "size": 900_000_000},
    {"index": 1, "rel_path": "Show.Complete/Season 2/E01.mkv", "size": 900_000_000},
]
TIE_STEM_SIDECAR = "Show.Complete/Subs/E01.en.srt"
TIE_DIR_SIDECAR = "Show.Complete/Subs/E01/2_English.srt"


def test_the_stem_rung_refuses_an_ambiguity_proximity_cannot_break():
    index, source = pair(TIE_STEM_SIDECAR, TIE_SEASON_VIDEOS)
    assert source not in ("stem", "near")
    assert (index, source) == (None, "none")


def test_the_directory_rung_refuses_an_ambiguity_proximity_cannot_break():
    """Separate loop, separate tiebreak call, separate row — same reason as above."""
    index, source = pair(TIE_DIR_SIDECAR, TIE_SEASON_VIDEOS)
    assert source not in ("dir", "near")
    assert (index, source) == (None, "none")


# THE MAXIMUM TIED AMONG THREE, which is a different arithmetic from the two-way tie
# and the reason `_nearest_claimant` computes the maximal SET rather than asking whether
# all the depths agree. Depths here are {0: 1, 1: 2, 2: 2}: not all equal, so an
# implementation that declines only on "every claimant is equidistant" resolves this one
# and returns a claimant chosen out of two equally near ones. Measured: that mutation
# reddens this row and NOTHING else in this file or `test_subtitle_language.py`, so this
# is its only instrument.
#
# HAND-AUTHORED and DELIBERATELY SYNTHETIC: its job is the arithmetic, not realism. Two
# videos cannot tie at the deepest shared segment while sitting in the same folder (they
# would need the same basename), so the third claimant has to be nested deeper, and
# `Season 1/Extras/E01.mkv` is the least implausible way to write that.
NESTED_TIE_VIDEOS = [
    {"index": 0, "rel_path": "Show.Complete/Season 2/E01.mkv", "size": 900_000_000},
    {"index": 1, "rel_path": "Show.Complete/Season 1/E01.mkv", "size": 900_000_000},
    {"index": 2, "rel_path": "Show.Complete/Season 1/Extras/E01.mkv", "size": 90_000_000},
]


def test_a_maximum_tied_between_two_of_three_claimants_still_refuses():
    assert pair(AMBIGUOUS_STEM_SIDECAR, NESTED_TIE_VIDEOS) == (None, "none")
    assert pair(AMBIGUOUS_STEM_SIDECAR,
                list(reversed(NESTED_TIE_VIDEOS))) == (None, "none")


# The FALL-THROUGH, which is the other half of the decision: a rung that refuses
# CONTINUES rather than returning `none` on the spot, because a later rung may resolve
# the same sidecar uniquely and correctly. Same two-videos-one-basename ambiguity as
# above, but here the per-episode folders DO parse (`Pack.S01E01` / `Pack.S02E01`), so
# rung 3 can tell the two apart where rungs 1 and 2 cannot. Measured, both of these
# answered `(0, "stem")` / `(0, "dir")` before the first fix — the right file by luck
# under the wrong rung, and the wrong file when the list was reversed.
FALLTHROUGH_VIDEOS = [
    {"index": 0, "rel_path": "Show/Pack.S01E01/E01.mkv", "size": 800_000_000},
    {"index": 1, "rel_path": "Show/Pack.S02E01/E01.mkv", "size": 800_000_000},
]
FALLTHROUGH_STEM_SIDECAR = "Show/Pack.S01E01/E01.en.srt"
FALLTHROUGH_DIR_SIDECAR = "Show/Pack.S01E01/E01/3_English.srt"

# The same two videos, with the sidecars moved into a top-level `Subs/` tree so that
# both per-episode folders are EQUIDISTANT from them (depths {0: 1, 1: 1}). These are
# NEW paths: for the two above, rungs 1/2 find a unique nearest and HOLD it (which is
# what `test_a_held_proximity_answer_does_not_pre_empt_the_parse_rung` records), so a
# rung declining outright needs an ambiguity proximity cannot break. What this pair pins is
# unchanged — proximity ties, the rung declines, and rung 3, which reads `Pack.S01E01`
# below the torrent root, resolves the same sidecar correctly. Make a declining rung
# return `(None, "none")` on the spot and these two go `none`.
TIE_FALLTHROUGH_STEM_SIDECAR = "Show/Subs/Pack.S01E01/E01.en.srt"
TIE_FALLTHROUGH_DIR_SIDECAR = "Show/Subs/Pack.S01E01/E01/3_English.srt"


def test_an_ambiguous_stem_falls_through_to_a_rung_that_can_resolve_it():
    """Rung 1 ties and declines, rung 2's folder (`Pack.S01E01`) matches no video stem,
    and rung 3 resolves it — so the answer is right AND says which rung earned it."""
    assert pair(TIE_FALLTHROUGH_STEM_SIDECAR, FALLTHROUGH_VIDEOS) == (0, "parse")


def test_an_ambiguous_directory_falls_through_to_a_rung_that_can_resolve_it():
    """The same for rung 2: the sidecar's folder is the bare `E01`, which both videos
    claim and neither is nearer, and the episode below the torrent root resolves it to
    exactly one."""
    assert pair(TIE_FALLTHROUGH_DIR_SIDECAR, FALLTHROUGH_VIDEOS) == (0, "parse")


# BOTH RUNGS AMBIGUOUS, BOTH BROKEN BY PROXIMITY, AND THE TWO ANSWERS DIFFER — the only
# shape in which rung 1's held candidate outranking rung 2's is observable at all. Four
# videos, two episodes across two seasons; the sidecar is NAMED `E01` and sits in an
# `E02` folder, which is a packer's misfile of exactly the kind the ladder exists to
# survive.
#
#   rung 1  claimants {0, 1} (both stems are `E01`)  dir-depths {0: 1, 1: 2} -> HOLD 1
#   rung 2  claimants {2, 3} (parent folder is `E02`) dir-depths {2: 1, 3: 2} -> would be 3
#   rung 3  `parse_episode("Season 2/E02/E01.en.srt")` is None — a bare `E01` matches
#           neither `_SXXEYY` nor `_XNOTATION` — so the parse declines and rung 3b runs.
#
# Index 1 is Season 2's `E01.mkv`: the sidecar's own NAME decides which episode, and
# where it sits decides which season. Without the precedence guard the answer is index
# 3, Season 2's `E02.mkv` — the right season and the WRONG EPISODE, with a folder
# overriding the file's own name. Same rule as everywhere else in this ladder, applied
# between two guesses instead of between a guess and a check.
PRECEDENCE_VIDEOS = [
    {"index": 0, "rel_path": "Show/Season 1/E01.mkv", "size": 800_000_000},
    {"index": 1, "rel_path": "Show/Season 2/E01.mkv", "size": 800_000_000},
    {"index": 2, "rel_path": "Show/Season 1/E02.mkv", "size": 800_000_000},
    {"index": 3, "rel_path": "Show/Season 2/E02.mkv", "size": 800_000_000},
]
PRECEDENCE_SIDECAR = "Show/Season 2/E02/E01.en.srt"


def test_the_stem_rungs_held_answer_outranks_the_directory_rungs():
    """Rung 1 holds a proximity answer and rung 2 must not overwrite it.

    FOUND BY MUTATION, not by design: the precedence guard shipped with a comment
    claiming this and nothing in the suite could see it — dropping the `held_near is
    None` condition left all 51 rows green. See the note above for why this layout is
    the only one that discriminates (both rungs ambiguous, both resolvable by proximity,
    and resolving to DIFFERENT videos — which needs the two rungs to match disjoint sets
    of videos, i.e. the sidecar's stem and its parent folder naming different episodes).

    Asserted in every file order, because a four-video fixture has 24 of them and the
    whole point of `_nearest_claimant`'s maximal-set shape is that none of them matters.
    """
    answers = {pair(PRECEDENCE_SIDECAR, list(order))
               for order in itertools.permutations(PRECEDENCE_VIDEOS)}
    assert answers == {(1, "near")}, f"answered {sorted(answers)} across 24 orderings"


def test_a_held_proximity_answer_does_not_pre_empt_the_parse_rung():
    """THE THIRD CORRECTION, and the row a reversal has to come and edit.

    These are the two fixtures the fall-through rows used before the tiebreak existed.
    Rungs 1 and 2 find an ambiguity in both and break it by proximity — but the answer
    is HELD, not returned, so rung 3 still runs, reads the episode number below the
    torrent root, agrees with exactly one video and reports the stronger `parse`.

    Why the hold exists at all: returning the proximity answer immediately was measured
    to change the INDEX, not merely the label. Enumerated over 720,657 coherent
    two-video layouts, 68 answer a different index under proximity than under the parse,
    and the row below this one is a worked counterexample where proximity picks the
    WRONG season's file. The docstring this replaces claimed the two always agree
    ("a rung-1 ambiguity means the video basenames are bare and identical and the
    episode therefore lives in the same folder proximity measures") — that universal was
    false, and the enumeration is what falsified it.

    So the rule, in priority order: a rung that can be wrong must not outrank the rung
    that checks; and silence is better than a wrong answer but worse than a right one.
    The tiebreak serves the second rule, the hold serves the first.

    This row is NOT the one that pins the tiebreak doing anything — the proximity answer
    is invisible here precisely because rung 3 answers first.
    `test_proximity_breaks_the_tie_identically_in_either_file_order` is where a held
    answer is actually consumed (rung 3 cannot parse a bare `Season 1/E01`).
    """
    assert pair(FALLTHROUGH_STEM_SIDECAR, FALLTHROUGH_VIDEOS) == (0, "parse")
    assert pair(FALLTHROUGH_DIR_SIDECAR, FALLTHROUGH_VIDEOS) == (0, "parse")


# WHAT THE PRE-EMPTION COSTS WHEN THE PATHS DISAGREE, found by a review that enumerated
# the pre-emption instead of reasoning about it. A complete-series pack with per-episode
# folders; the subtitles for Season 2's episode are filed under Season 1's `Subs/` tree,
# which is a misfile a packer makes and the pairing ladder exists to survive.
#
#   videos  0: .../Season 1/Show.S01E01/E01.mkv   below-root parse (1, 1), dir-depth 2
#           1: .../Season 2/Show.S02E01/E01.mkv   below-root parse (2, 1), dir-depth 1
#   sidecar    .../Season 1/Subs/E01/Show.S02E01.en.srt   below-root parse (2, 1)
#
# Rung 2 fires first: the sidecar's parent folder is the bare `E01`, which BOTH videos'
# basenames match, so proximity breaks it — and proximity reads only the leading
# segments, where this sidecar says `Season 1`. Rung 3 would have read the sidecar's own
# basename, `Show.S02E01`, and agreed with exactly one video. Measured, in a one-off
# container, against both modules:
#
#   8708913 (before the tiebreak): (1, "parse")  <- Season 2's file, order-independent
#   HEAD    (after  the tiebreak): (0, "near")   <- Season 1's file, order-independent
#
# So the tiebreak does not only trade a label here: it trades a CORRECT pairing for a
# wrong one, rendered `English (nearest of several matches)`, with no error anywhere —
# the exact failure D20 says this module exists to make visible. Pinned rather than
# fixed because the fix is a rung-order decision (defer the proximity candidate until
# rung 3 has failed) that this review does not own. A reversal reddens this row, which
# is the point of writing it down.
#
# HAND-AUTHORED, like every fixture here. What makes it a counterexample and not
# adversarial nonsense: both videos follow ONE convention, at one depth, and no single
# path contradicts itself. Only the sidecar's LOCATION contradicts its NAME.
MISFILED_SEASON_VIDEOS = [
    {"index": 0, "rel_path": "Show.Complete/Season 1/Show.S01E01/E01.mkv",
     "size": 800_000_000},
    {"index": 1, "rel_path": "Show.Complete/Season 2/Show.S02E01/E01.mkv",
     "size": 800_000_000},
]
MISFILED_SIDECAR = "Show.Complete/Season 1/Subs/E01/Show.S02E01.en.srt"
# The same layout with the sidecar filed where its name says it belongs. The control
# matters: without it, the row above is also green for a tiebreak that always answers
# index 0, and "proximity picked the wrong one" would be indistinguishable from
# "proximity picked the first one".
WELL_FILED_SIDECAR = "Show.Complete/Season 2/Subs/E01/Show.S02E01.en.srt"


def test_the_parse_rung_outranks_proximity_when_the_two_contradict_each_other():
    """THE COUNTEREXAMPLE THAT DECIDED THE RUNG ORDER, and now the row that pins it.

    A misfiled sidecar: its own name says `S02E01`, the packer filed it under Season
    1's `Subs/` tree. Rung 2 fires (the bare `E01` parent folder matches BOTH videos'
    basenames) and proximity reads only the leading segments, where the sidecar says
    `Season 1` — so proximity answers index 0, Season 1's file. Rung 3 reads the
    sidecar's own basename and agrees with exactly one video, index 1. The name is the
    stronger evidence, so `parse` wins and the sidecar reaches the episode it is
    actually for.

    Measured under the immediate-return form this replaces: `(0, "near")` in both file
    orders, i.e. the wrong season's file, reported under a source whose label confesses
    only that it was "the nearest of several matches". That is the failure D20 says the
    exposed rung exists to make visible, produced by the ladder itself.

    Both the misfile and the control now answer index 1, and that is the point rather
    than a weakness: name and location disagree in the first and agree in the second,
    and the answer is the same because the name decides both times. The control still
    earns its place — it is what makes "the parse won" distinguishable from "a tiebreak
    that always answers index 1".
    """
    assert pair(MISFILED_SIDECAR, MISFILED_SEASON_VIDEOS) == (1, "parse")
    assert pair(MISFILED_SIDECAR, list(reversed(MISFILED_SEASON_VIDEOS))) == (1, "parse")

    assert pair(WELL_FILED_SIDECAR, MISFILED_SEASON_VIDEOS) == (1, "parse")
    assert pair(WELL_FILED_SIDECAR,
                list(reversed(MISFILED_SEASON_VIDEOS))) == (1, "parse")


def test_the_answer_does_not_depend_on_the_order_of_the_video_files():
    """THE ROW WITH TEETH. `video_files` arrives in the torrent's own file-index order,
    which is a property of how the release was packed and not of what it contains, so
    an answer that depends on it is a coin flip wearing a rung's name. Before the first
    fix, the first two pairs below answered index 0 forward and index 1 reversed.

    EVERY PERMUTATION, not a reversal. CORRECTED IN REVIEW: this row used to compare
    `videos` against `list(reversed(videos))`, which for the three-claimant fixture is
    2 of its 6 orderings — and a two-element sample is the weakest instrument there is
    for a property stated over all of them. `itertools.permutations` costs nothing here
    (the widest fixture has three videos) and turns "these two orders agree" into the
    claim actually being made: `pair()` is a function of its inputs as a SET.

    One distinct answer across all orderings is the whole assertion on purpose: it
    holds whether the honest answer is `none` (the tie pairs), a proximity resolution
    or a `parse`, and it reddens both under the first-match revert and under a tiebreak
    written as `max(claimants, key=depth)` — which returns the first maximal element
    and so flips with the list whenever the greatest depth is shared. Measured under
    that mutation: 5 of the 10 cases below go order-dependent.
    """
    cases = [
        (AMBIGUOUS_STEM_SIDECAR, AMBIGUOUS_SEASON_VIDEOS),
        (AMBIGUOUS_DIR_SIDECAR, AMBIGUOUS_SEASON_VIDEOS),
        (TIE_STEM_SIDECAR, TIE_SEASON_VIDEOS),
        (TIE_DIR_SIDECAR, TIE_SEASON_VIDEOS),
        (AMBIGUOUS_STEM_SIDECAR, NESTED_TIE_VIDEOS),
        (FALLTHROUGH_STEM_SIDECAR, FALLTHROUGH_VIDEOS),
        (FALLTHROUGH_DIR_SIDECAR, FALLTHROUGH_VIDEOS),
        (TIE_FALLTHROUGH_STEM_SIDECAR, FALLTHROUGH_VIDEOS),
        (TIE_FALLTHROUGH_DIR_SIDECAR, FALLTHROUGH_VIDEOS),
        (MISFILED_SIDECAR, MISFILED_SEASON_VIDEOS),
    ]
    for sidecar, videos in cases:
        answers = {pair(sidecar, list(order))
                   for order in itertools.permutations(videos)}
        assert len(answers) == 1, (
            f"{sidecar} answered {sorted(answers)} across "
            f"{len(list(itertools.permutations(videos)))} orderings"
        )


def test_proximity_breaks_the_tie_identically_in_either_file_order():
    """Equality alone would be green if BOTH orders answered `none`, which is exactly
    what the pre-tiebreak module did — so the reviewer's two cases get their value
    asserted in both directions. Index 1 is Season 1's file, forward and reversed."""
    for sidecar in (AMBIGUOUS_STEM_SIDECAR, AMBIGUOUS_DIR_SIDECAR):
        forward = pair(sidecar, AMBIGUOUS_SEASON_VIDEOS)
        backward = pair(sidecar, list(reversed(AMBIGUOUS_SEASON_VIDEOS)))
        assert forward == (1, "near"), f"{sidecar} forward answered {forward}"
        assert backward == (1, "near"), f"{sidecar} reversed answered {backward}"


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


# RUNG 3 DOES NOT GET THE TIEBREAK, and without this fixture that scope is invisible:
# measured, extending `_nearest_claimant` to rung 3 left every other row in this file
# green, including the row above (its two claimants sit in the same folder, so they are
# equidistant from the sidecar and proximity ties anyway).
#
# HAND-AUTHORED: a dual-quality pack with per-quality folders, which is a real release
# shape, and the only way two videos can agree on one parsed episode while sitting at
# DIFFERENT depths from the sidecar. Both files parse to (1, 3) below the root `Show`,
# the sidecar's own path parses to (1, 3), and the shared-directory depths are
# {0: 2, 1: 1} — so a tiebreak at rung 3 would resolve this to index 0 and report
# `near`. The decision is that it does not: rungs 1 and 2 break a tie between claimants
# that each matched a NAME exactly, while rung 3's claimants agree on a number the parse
# has already shown it cannot tell apart, and proximity there is a second guess stacked
# on a first.
PARSE_TIE_VIDEOS = [
    {"index": 0, "rel_path": "Show/1080p/Pack.S01E03.mkv", "size": 2_000_000_000},
    {"index": 1, "rel_path": "Show/720p/Pack.S01E03.mkv", "size": 900_000_000},
]


def test_the_parse_rung_does_not_use_the_proximity_tiebreak():
    assert pair("Show/1080p/Subs/S01E03/3_English.srt",
                PARSE_TIE_VIDEOS) == (None, "none")


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

    The `tied` clause is asserted BOTH ways: rungs 1 and 2 reach a decline only after
    proximity failed to separate the claimants, rung 3 declines without trying it, and
    one sentence for both tells an operator that proximity was tried where it was not.
    """
    recorder = _LogRecorder()
    monkeypatch.setattr(naming, "logger", recorder)

    # A rung that resolves cleanly says nothing at all — this is not a per-pair log.
    assert pair("Pack/Pack.S01E03.en.srt", ORDER_VIDEOS) == (0, "stem")
    assert recorder.info_lines == []

    assert pair(TIE_STEM_SIDECAR, TIE_SEASON_VIDEOS) == (None, "none")
    assert len(recorder.info_lines) == 1
    line = recorder.info_lines[0]
    assert "'stem'" in line
    assert TIE_STEM_SIDECAR in line
    assert "2 videos claim it" in line
    assert "[0, 1]" in line
    assert "proximity is tied" in line

    recorder.info_lines.clear()
    assert pair(TIE_DIR_SIDECAR, TIE_SEASON_VIDEOS) == (None, "none")
    assert len(recorder.info_lines) == 1
    assert "'dir'" in recorder.info_lines[0]
    assert "proximity is tied" in recorder.info_lines[0]

    recorder.info_lines.clear()
    assert pair("Pack/Subs/S01E03/3_English.srt", DUAL_ENCODE_VIDEOS) == (None, "none")
    assert len(recorder.info_lines) == 1
    assert "'parse'" in recorder.info_lines[0]
    assert "proximity" not in recorder.info_lines[0]


def test_a_rung_that_breaks_a_tie_by_proximity_says_so_at_info(monkeypatch):
    """A proximity resolution is a GUESS that answers, and `pair()`'s return value says
    only `near` — not which rung guessed, not which claimants lost, not by how much. The
    operator's only trace is this line, so it carries all three.

    Asserted rather than described because the whole mechanism is one INFO call in an
    otherwise pure module: deleting it changes no answer anywhere, and nothing else in
    this file would notice.
    """
    recorder = _LogRecorder()
    monkeypatch.setattr(naming, "logger", recorder)

    assert pair(AMBIGUOUS_STEM_SIDECAR, AMBIGUOUS_SEASON_VIDEOS) == (1, "near")
    assert len(recorder.info_lines) == 1
    line = recorder.info_lines[0]
    assert "'stem'" in line
    assert AMBIGUOUS_STEM_SIDECAR in line
    assert "2 videos claimed it" in line
    assert "[0, 1]" in line
    assert "index 1 shares 2 leading path segment(s)" in line
    assert "'near'" in line

    recorder.info_lines.clear()
    assert pair(AMBIGUOUS_DIR_SIDECAR, AMBIGUOUS_SEASON_VIDEOS) == (1, "near")
    assert len(recorder.info_lines) == 1
    assert "'dir'" in recorder.info_lines[0]
    assert "index 1 shares 2 leading path segment(s)" in recorder.info_lines[0]
