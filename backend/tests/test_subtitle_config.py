"""Stage 9: the two sidecar-subtitle extension sets, and the admission bounds.

POLICY NOTE — what this file can and cannot be evidence of. These are *settings*
assertions. Every field here is env-overridable the moment it is declared
(pydantic-settings' ``extra='forbid'`` applies only to **un**declared keys), so a
hostile or careless ``.env`` defeats every assertion below: ``Settings()`` reads
``.env`` on construction. What is pinned here is the shipped DEFAULTS and the
relationships between them, which is where a code change goes wrong.

The request-time guard is a different thing and lives elsewhere: the sidecar
lister intersects its own hard-coded listed set with ``settings.subtitle_extensions``
rather than trusting the setting, and that is tested in ``test_sidecar_lister.py``
(stage 9 task 3), whose fixture monkeypatches ``.exe`` into the setting and
asserts it is still absent from the listing. Do not read a green run here as
"a bad extension cannot reach the lister".

Extension *casing* is not asserted here. It is asserted once, for all four
extension sets together, in ``test_content_guard_config.py`` — a second witness
to one rule is this repo's own documented anti-pattern.
"""
from app.config import Settings


def test_subtitle_extensions_are_disjoint_from_video_extensions():
    """A subtitle extension must never also count as playable video.

    ``video_extensions`` is the predicate behind "this torrent has playable
    video" (whose failure path removes the torrent and rmtree's it), behind
    ``/files``, behind which file a stream resolves to, and behind
    ``prioritize_video_files``' priority-7 branch. An overlap would let a
    subtitle-only release pass the content guard, double a pack's ``/files``, let
    a ``.srt`` resolve as the streamable file, and hand a 30 KB text file
    priority 7 in competition with the playhead.
    """
    s = Settings()
    # Non-emptiness first: the empty set is disjoint from everything, so without
    # this the assertion below would pass for a field someone had emptied.
    assert s.subtitle_extensions, "subtitle_extensions must not be empty"
    assert not (s.subtitle_extensions & s.video_extensions)


def test_subtitle_extensions_are_disjoint_from_blocked_extensions():
    """A listed subtitle extension must never be one that hard-blocks a torrent.

    LIMIT OF THIS ASSERTION, stated so nobody mistakes it for a live guard: as
    shipped today it is **not falsifiable by any realistic mistake** — no text
    subtitle extension is anywhere near ``blocked_extensions``, which is a list of
    executables and disk images. It is pinned for the day somebody widens either
    list (``.iso``/``.bin`` are already in the blocked one, so container-ish and
    archive-ish entries are clearly in scope there), because the failure mode is
    silent and unrecoverable: ``_block_torrent`` removes the torrent and
    ``safe_rmtree``s the save path, with no unblock path.
    """
    s = Settings()
    assert s.subtitle_extensions, "subtitle_extensions must not be empty"
    assert not (s.subtitle_extensions & s.blocked_extensions)


def test_image_subtitle_formats_are_in_neither_set():
    """``.sub``/``.idx``/``.sup`` are excluded here and nowhere else.

    VobSub (``.sub``+``.idx``) and PGS (``.sup``) are *image* subtitle formats:
    the extension cannot tell text from image, a latin-1 decode of either never
    raises, and none of the three appears in ``blocked_extensions`` or in
    ``video_extensions`` — so no other test in this suite has an opinion about
    them. Listing one would offer a picker row that can only ever emit garbage.
    """
    s = Settings()
    image_only = {".sub", ".idx", ".sup"}
    assert image_only & s.subtitle_extensions == set()
    assert image_only & s.subtitle_convertible_extensions == set()


def test_convertible_subtitles_are_a_subset_of_listed_subtitles():
    """Everything we offer to convert must be something we list.

    NOT the ASS guard. Moving ``.ass`` into ``subtitle_convertible_extensions``
    keeps this assertion green, because ``.ass`` *is* listed — verified by
    mutation. What reddens for that mistake is the converter's own ASS-refusal
    row (stage 9 task 6). What this catches is the opposite direction: a
    convertible entry that the lister will never surface, i.e. a route that can
    be asked for a format no picker row can offer.
    """
    s = Settings()
    assert s.subtitle_convertible_extensions, "convertible set must not be empty"
    assert s.subtitle_convertible_extensions <= s.subtitle_extensions
    # And the membership the two-set split EXISTS for, pinned in the one direction
    # nothing else here can witness. Measured in review: DELETING `.ass`/`.ssa`
    # from the listed set, or `.vtt` from the convertible one, leaves every other
    # assertion in this file and in `test_content_guard_config.py` green — a
    # subset relation still holds over a smaller set, so it cannot see a deletion,
    # and the docstring above claims to pin "the shipped DEFAULTS".
    #   `.ass`/`.ssa` LISTED -> D17's unselectable row carrying the format, i.e.
    #     stage 8's "a visible row with effect NONE" shape. Drop them and the
    #     picker shows no row at all for anime, which is the opposite decision.
    #   `.vtt` CONVERTIBLE -> D17's "one URL kind, one code path": a `.vtt` is
    #     re-validated through the same decode-and-emit path, never passed
    #     through, because a signature-valid `.vtt` with `00:00:1.000` timings is
    #     a silent zero-cue file.
    assert {".ass", ".ssa"} <= s.subtitle_extensions
    assert ".vtt" in s.subtitle_convertible_extensions


def test_admission_bounds_and_encoding_defaults():
    """The shipped admission bounds, and no configured encoding override.

    The span cap is the structural half of the cost control: admitting a sidecar
    costs ``extra_pieces * piece_length``, so a pad-aligned 20-language ``Subs/``
    tree is ~1.6 GiB at an 8 MiB piece however small the files are. The budget is
    the other half — an admitted piece that never arrives holds the torrent below
    100% forever. ``subtitle_encoding`` ships as ``None``: with no owner override
    the decode ladder refuses rather than serving mojibake.
    """
    s = Settings()
    assert s.subtitle_max_bytes == 4_194_304
    assert s.subtitle_admit_max_pieces == 4
    assert s.subtitle_admit_budget_ms == 45_000
    assert s.subtitle_encoding is None
