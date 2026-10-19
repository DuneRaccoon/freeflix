"""Stage 9: guessing a sidecar's language, and keeping the picker small.

PROVENANCE OF EVERY FIXTURE IN THIS FILE, stated once. No corpus of sidecar filenames
exists in this repository — ``backend/tests/data/releases.tsv`` is 370 title rows with
no path column and zero ``.srt`` — so every name below is a HAND-AUTHORED assumption
taken from the stage 9 plan's D21 and its design notes. What this file settles is that
the lookup is an EXACT TOKEN match, that the three measured substring traps come back
``None``, that ``hi`` is withheld, and that the per-language dedup keeps one row. What
it cannot settle is whether these naming conventions occur in the wild, or whether
"refuse rather than guess" is the right default for this household's library — reading
37 decides that.

The rows below pass ``video_stem=""`` unless the row is specifically about the
video-stem subtraction. That is deliberate: with a stem supplied, a ``None`` row could
come back ``None`` because the token was subtracted rather than because the table
declined it, and the assertion would no longer be about the table. The subtraction has
its own two-armed test further down.
"""
from app.subtitles.naming import (
    UNKNOWN_LANGUAGE_LABEL,
    dedupe_by_language,
    guess_language,
)


# ---------------------------------------------------------- (f) the substring traps

def test_a_language_name_token_resolves():
    """`Movie.French.srt` is the measured trap for `'en' in name.lower()`: the name
    contains `fr-EN-ch`."""
    assert guess_language("Movie.French.srt", "")[0] == "fr"


def test_children_is_not_english():
    """`'en' in "children"` is True. An exact token match declines it."""
    assert guess_language("Children.srt", "")[0] is None


def test_golden_years_is_not_english():
    """`'en' in "golden"` is True, and `'ar' in "years"` is too."""
    assert guess_language("Golden.Years.srt", "")[0] is None


def test_kingsman_is_not_a_language():
    """NAMED LIMIT OF THIS ROW, so nobody reads it as the `'en'` guard.

    The plan groups `Kingsman` with `Children` and `Golden` as a trap for
    `'en' in name.lower()`. Measured here: it is not one — `kingsman` contains no
    `en`, so that specific mutation leaves THIS row green while reddening the other
    three. What it does catch is the wider class the plan means: a substring scan over
    the ISO 639-1 CODE table, which finds `an` (Aragonese), `ki` (Kikuyu) and `ng`
    (Ndonga) inside `kingsman`. Mutation measured: replacing the exact-token loop with
    a `for code in sorted(_LOOKUP_CODES): if code in stem.lower()` scan reddens all
    four rows in this group, this one included.
    """
    assert guess_language("Kingsman.srt", "")[0] is None


# ----------------------------------------------------------- (g) the rendered label

def test_a_leading_track_index_is_not_part_of_the_label():
    """The label is read from the code table, never from the filename.

    Asserting the LABEL and not only the code is what discriminates here: a
    `label = stem` implementation returns the right code and puts `2_English` on the
    television. The code assertion cannot see that.
    """
    code, label, flags = guess_language("Subs/2_English.srt", "Pack.S01E05")
    assert code == "en"
    assert label == "English"
    assert flags == []


def test_an_unresolved_language_still_carries_a_renderable_label():
    """A null language is honest and the entry stays offerable (D21): it renders
    `kind="captions"` with NO `srclang`, because HTML requires a non-empty `srclang`
    for `kind="subtitles"` and a guessed `en` is a lie the viewer cannot see. So the
    label must still be a sentence the picker can show."""
    code, label, _ = guess_language("Subs/3_Unknown.Dialect.srt", "")
    assert code is None
    assert label == UNKNOWN_LANGUAGE_LABEL
    assert label


# ---------------------------------------------------------------- (h) the hi refusal

def test_hi_is_refused_because_it_means_two_things():
    """`hi` is Hindi in ISO 639-1 and "hearing impaired" in subtitle filenames, and
    nothing in a filename separates them. Both wrong answers are confidently wrong
    rather than visibly unknown, so the code is withheld from the lookup table."""
    code, label, flags = guess_language("Movie.hi.srt", "")
    assert code is None
    assert label == UNKNOWN_LANGUAGE_LABEL
    # And it is not quietly reported as a hearing-impaired FLAG either, which would be
    # the same guess wearing a different hat.
    assert flags == []


def test_the_modifier_tokens_are_flags_and_not_languages():
    """`forced`/`sdh`/`cc` are modifiers (D21). They ride along as flags and never
    occupy the language slot."""
    assert guess_language("Movie.en.forced.srt", "") == ("en", "English", ["forced"])
    assert guess_language("Movie.en.SDH.srt", "") == ("en", "English", ["sdh"])
    assert guess_language("Movie.fr.cc.srt", "") == ("fr", "French", ["cc"])
    assert guess_language("Movie.forced.srt", "") == (
        None, UNKNOWN_LANGUAGE_LABEL, ["forced"])


# ------------------------------------------------- the paired video's own stem tokens

def test_a_language_word_inside_the_title_is_subtracted():
    """D21's subtraction, in the case it exists for.

    `The French Connection` has a language name in its TITLE. Both arms are needed:
    with the tag present the tag must win, and with no tag the title word must not be
    mistaken for one. Dropping the subtraction leaves the first arm green — `fr` is
    still the answer — and reddens the second, which is the arm that matters.
    """
    video_stem = "The.French.Connection.1971.1080p.BluRay.x264-GRP"
    assert guess_language("The.French.Connection.1971.fr.srt", video_stem)[0] == "fr"
    assert guess_language("The.French.Connection.1971.srt", video_stem)[0] is None


def test_the_last_matching_token_wins():
    """A language tag is written at the end of a name; a title word that survived the
    subtraction is written earlier."""
    assert guess_language("Spanish.Harlem.1080p.en.srt", "")[0] == "en"


# ------------------------------------------------------------------ (i) the dedup

# Four English sidecars and one French, as a 20-language `Subs/` tree would present
# them. Shaped so that each term of the preference order has a row that only it can
# answer: the FORCED entry carries the shortest path (so dropping the non-forced
# preference changes the winner), and one non-forced entry is lexicographically first
# but longer (so dropping the length term changes the winner too).
MANY_ENGLISH = [
    # 18 characters, and forced: the shortest path in the group.
    {"index": 4, "rel_path": "Subs/en.forced.srt", "lang": "en", "flags": ["forced"]},
    # 23 characters, and lexicographically first of the three full tracks.
    {"index": 5, "rel_path": "Subs/0_English.Full.srt", "lang": "en", "flags": []},
    # 19 characters: the shortest FULL track, and the expected winner.
    {"index": 6, "rel_path": "Subs/14_English.srt", "lang": "en", "flags": []},
    {"index": 7, "rel_path": "Subs/15_English.SDH.srt", "lang": "en", "flags": ["sdh"]},
    {"index": 8, "rel_path": "Subs/16_French.srt", "lang": "fr", "flags": []},
]


def test_one_row_per_language():
    """Three English sidecars plus a forced one collapse to a single picker row, and
    the French one survives. A 20-language tree is otherwise 20+ rows on a surface
    where `move` never wraps."""
    kept = dedupe_by_language(MANY_ENGLISH)
    assert [entry["index"] for entry in kept] == [6, 8]


def test_a_forced_track_loses_to_a_full_one():
    """A forced track carries only the foreign-dialogue lines. Offering it as
    "English" while a full English track exists is a worse answer, so the preference
    is non-forced first — ahead of the shorter path, which this fixture's forced entry
    has."""
    kept = dedupe_by_language(MANY_ENGLISH)
    assert all("forced" not in (entry["flags"] or []) for entry in kept)


def test_the_shortest_path_breaks_the_remaining_tie():
    """Between two full English tracks the shorter path wins, not the
    lexicographically first one — `Subs/0_English.Full.srt` sorts before
    `Subs/14_English.srt` and loses to it. Dropping the length term from the
    preference order picks index 5 instead."""
    kept = dedupe_by_language(MANY_ENGLISH)
    assert [entry["index"] for entry in kept if entry["lang"] == "en"] == [6]


def test_the_dedup_preserves_input_order():
    """The lister orders rows by torrent file index; the dedup filters, never
    reorders."""
    kept = dedupe_by_language(list(reversed(MANY_ENGLISH)))
    assert [entry["index"] for entry in kept] == [8, 6]


def test_null_language_entries_are_not_collapsed():
    """A DECISION, pinned rather than left an omission.

    D21 says one entry per language, and `None` is not a language. Three
    unknown-language sidecars have nothing to tell them apart but their paths, so
    folding them into one would silently hide two files the viewer could otherwise
    try, and the picker would claim one row where three files exist. Collapsing them
    is a deliberate edit to this assertion.
    """
    entries = [
        {"index": 1, "rel_path": "Subs/1.srt", "lang": None, "flags": []},
        {"index": 2, "rel_path": "Subs/2.srt", "lang": None, "flags": []},
        {"index": 3, "rel_path": "Subs/3.srt", "lang": None, "flags": []},
    ]
    assert [entry["index"] for entry in dedupe_by_language(entries)] == [1, 2, 3]


def test_the_dedup_is_a_no_op_on_distinct_languages():
    entries = [
        {"index": 1, "rel_path": "Subs/en.srt", "lang": "en", "flags": []},
        {"index": 2, "rel_path": "Subs/fr.srt", "lang": "fr", "flags": []},
        {"index": 3, "rel_path": "Subs/de.srt", "lang": "de", "flags": []},
    ]
    assert dedupe_by_language(entries) == entries


# ------------------------------------------------------------------- the table itself

def test_the_code_table_is_an_exact_token_match_not_a_prefix_match():
    """Two-letter codes that are also English words (`no`, `is`, `it`, `so`, `to`) are
    IN the table on purpose — dropping a real language is worse than the residual
    risk, and D21's video-stem subtraction is the mitigation. What keeps them safe is
    that the match is on a whole token: `Nobody.srt` is not Norwegian."""
    assert guess_language("Nobody.srt", "")[0] is None
    assert guess_language("Island.srt", "")[0] is None
    assert guess_language("Movie.no.srt", "")[0] == "no"


def test_three_letter_iso_639_2_codes_do_not_resolve():
    """A NAMED GAP, not a bug to be fixed here. D21 specifies two tables — ISO 639-1
    codes and English names — and `eng`/`fre`/`ger` are in neither. Such a sidecar is
    still listed and still offerable; it simply reports no language, which renders
    `kind="captions"` with no `srclang`. Adding a third table is a scope decision this
    task does not own; reading 37 is what says whether it is worth one."""
    assert guess_language("Movie.eng.srt", "")[0] is None
    assert guess_language("Movie.fre.srt", "")[0] is None
