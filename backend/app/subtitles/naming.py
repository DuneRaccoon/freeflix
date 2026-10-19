"""Pairing a sidecar subtitle to its video, and guessing its language. PURE.

No libtorrent session, no DB, no persistence, no `settings` read. Every RETURN VALUE
here is a function of the strings it is handed, which is why it is the one part of
stage 9 that can be tested exhaustively. ONE exception, added in review and named
rather than hidden: a pairing rung that meets an ambiguous claim writes a line at
INFO — either `_decline` (it refused and fell through) or `_nearest_claimant` (it
broke the ambiguity by directory proximity). Those are writes to the log and nothing
else — they change no answer — and they are here because a silent fall-through is
exactly how `pair()` shipped with two rungs that returned on the first of several
matches, and because a pairing reached by proximity is a guess an operator should be
able to find after the fact.

Two mechanisms, both from the stage 9 plan:

* `pair()` — D20's five-rung ladder, which returns **which rung it took**. That return
  is not telemetry: a mis-paired sidecar is the one failure in this stage with no error
  anywhere (valid WebVTT, correct readiness, a true sentence about everything except
  whose episode it is), so the rung is carried to the picker row and the transport cell
  as `(matched by folder)` / `(matched by episode number)` / `· guessed`. It is also the
  only way a test can tell a correct answer from a correct-by-accident one — for
  `Pack/Pack.S01E03.en.srt` the stem rung and the parse rung agree on the episode, so
  without the exposed rung, deleting the stem rung is undetectable.
* `guess_language()` — D21's exact token match. `'en' in name.lower()` is the measured
  trap: `Movie.French.srt` contains `fr-EN-ch`, and the same class hits `Children`,
  `Golden` and `Kingsman`.

NO CORPUS BACKS ANY OF THIS. `backend/tests/data/releases.tsv` is 370 title rows of
nine columns with no path column; `grep -cE '\\.srt|Subs/'` over it is 0. Every naming
convention assumed here is hand-authored, and reading 37 (the device readings sheet) is
what will eventually say whether the rung order and the token tables match real
releases. What the test suite can settle is that each rung is reachable, that the rung
it reports is the rung it took, and that the measured traps are avoided.
"""
import re
from pathlib import PurePosixPath
from typing import Any, List, Mapping, Optional, Sequence, Tuple

from loguru import logger

from app.providers.episodes import parse_episode

# D21: tokens split on this and nothing else. Exact token match, never a substring.
_TOKEN_SPLIT = re.compile(r"[._\-\s]+")

# The five rungs of D20, in the order `pair()` tries them, PLUS `near`. `none` is the
# honest bottom: an unpairable sidecar is still LISTED (the picker shows it), it simply
# carries no episode and says so.
#
# `near` is NOT a sixth rung. It is how rungs 1 and 2 resolve an ambiguous claim — the
# claimant whose directory sits closest to the sidecar's, taken only when that claimant
# is unique — and it is listed immediately after the two rungs that can return it. It
# is a separate source rather than `stem`/`dir` because the suffix table exists so the
# television can confess how an episode was identified, and "its name matched exactly
# one video" and "its name matched several and I took the closest" are different
# confidences. A viewer looking at the wrong episode's subtitles needs to be able to
# tell which of those happened.
PAIR_SOURCES = ("stem", "dir", "near", "parse", "single", "none")

# Rendered on the picker row (D20). `stem` and `single` deliberately share the plain
# label: in both cases the filename or the torrent's shape names the video outright,
# so there is nothing inferred to confess. `dir`, `near`, `parse` and `none` each get
# their own words, because collapsing any two of them would make the television say the
# same sentence about two different degrees of confidence.
#
# `near` is the weakest of the four that confess, and its words say the thing that
# makes it weak: SEVERAL videos claimed this sidecar and one of them was closer. D20's
# cell sub-line appends `· guessed` for `dir` and `parse`; `near` joins them (tasks
# 10-16 are not built, so no renderer has to be changed for that yet).
_PAIR_SOURCE_SUFFIX = {
    "stem": "",
    "single": "",
    "dir": " (matched by folder)",
    "near": " (nearest of several matches)",
    "parse": " (matched by episode number)",
    "none": " (unmatched)",
}

# What `guess_language` reports when no token resolves. A null language is HONEST and
# the entry stays offerable — D21 renders it `kind="captions"` with NO `srclang`,
# because HTML requires a non-empty `srclang` for `kind="subtitles"` and a guessed `en`
# is a lie the viewer cannot see.
UNKNOWN_LANGUAGE_LABEL = "Unknown"

# D21: modifiers, not languages. They ride along as flags.
_MODIFIER_TOKENS = ("forced", "sdh", "cc")

# ISO 639-1, code -> English name. The full set on purpose: a curated short list
# silently drops a real language, and the mitigation for a two-letter code that is also
# an English word (`no` Norwegian, `is` Icelandic, `it` Italian, `or` Oriya, `be`
# Belarusian, `my` Burmese, `so` Somali, `to` Tonga, `am` Amharic, `as` Assamese) is
# D21's own: the paired video's stem tokens are removed before any lookup, so a title
# word only survives when it is in the sidecar's name and NOT in the video's. There is
# no corpus here to measure the residual risk against.
#
# KNOWN GAP, named rather than quietly widened: ISO 639-2 three-letter codes (`eng`,
# `fre`/`fra`, `ger`/`deu`, `spa`, `jpn`) are NOT in this table and do not resolve.
# D21 specifies two tables — codes and English names — and adding a third is a scope
# decision this task does not own. Such a sidecar gets `lang=None`, which is still
# offerable and still honest about what it does not know.
_CODE_TO_NAME = {
    "aa": "Afar", "ab": "Abkhazian", "ae": "Avestan", "af": "Afrikaans",
    "ak": "Akan", "am": "Amharic", "an": "Aragonese", "ar": "Arabic",
    "as": "Assamese", "av": "Avaric", "ay": "Aymara", "az": "Azerbaijani",
    "ba": "Bashkir", "be": "Belarusian", "bg": "Bulgarian", "bh": "Bihari",
    "bi": "Bislama", "bm": "Bambara", "bn": "Bengali", "bo": "Tibetan",
    "br": "Breton", "bs": "Bosnian", "ca": "Catalan", "ce": "Chechen",
    "ch": "Chamorro", "co": "Corsican", "cr": "Cree", "cs": "Czech",
    "cu": "Church Slavic", "cv": "Chuvash", "cy": "Welsh", "da": "Danish",
    "de": "German", "dv": "Divehi", "dz": "Dzongkha", "ee": "Ewe",
    "el": "Greek", "en": "English", "eo": "Esperanto", "es": "Spanish",
    "et": "Estonian", "eu": "Basque", "fa": "Persian", "ff": "Fulah",
    "fi": "Finnish", "fj": "Fijian", "fo": "Faroese", "fr": "French",
    "fy": "Western Frisian", "ga": "Irish", "gd": "Scottish Gaelic",
    "gl": "Galician", "gn": "Guarani", "gu": "Gujarati", "gv": "Manx",
    "ha": "Hausa", "he": "Hebrew", "hi": "Hindi", "ho": "Hiri Motu",
    "hr": "Croatian", "ht": "Haitian", "hu": "Hungarian", "hy": "Armenian",
    "hz": "Herero", "ia": "Interlingua", "id": "Indonesian", "ie": "Interlingue",
    "ig": "Igbo", "ii": "Sichuan Yi", "ik": "Inupiaq", "io": "Ido",
    "is": "Icelandic", "it": "Italian", "iu": "Inuktitut", "ja": "Japanese",
    "jv": "Javanese", "ka": "Georgian", "kg": "Kongo", "ki": "Kikuyu",
    "kj": "Kuanyama", "kk": "Kazakh", "kl": "Kalaallisut", "km": "Khmer",
    "kn": "Kannada", "ko": "Korean", "kr": "Kanuri", "ks": "Kashmiri",
    "ku": "Kurdish", "kv": "Komi", "kw": "Cornish", "ky": "Kyrgyz",
    "la": "Latin", "lb": "Luxembourgish", "lg": "Ganda", "li": "Limburgish",
    "ln": "Lingala", "lo": "Lao", "lt": "Lithuanian", "lu": "Luba-Katanga",
    "lv": "Latvian", "mg": "Malagasy", "mh": "Marshallese", "mi": "Maori",
    "mk": "Macedonian", "ml": "Malayalam", "mn": "Mongolian", "mr": "Marathi",
    "ms": "Malay", "mt": "Maltese", "my": "Burmese", "na": "Nauru",
    "nb": "Norwegian Bokmal", "nd": "North Ndebele", "ne": "Nepali",
    "ng": "Ndonga", "nl": "Dutch", "nn": "Norwegian Nynorsk", "no": "Norwegian",
    "nr": "South Ndebele", "nv": "Navajo", "ny": "Nyanja", "oc": "Occitan",
    "oj": "Ojibwa", "om": "Oromo", "or": "Oriya", "os": "Ossetian",
    "pa": "Punjabi", "pi": "Pali", "pl": "Polish", "ps": "Pashto",
    "pt": "Portuguese", "qu": "Quechua", "rm": "Romansh", "rn": "Rundi",
    "ro": "Romanian", "ru": "Russian", "rw": "Kinyarwanda", "sa": "Sanskrit",
    "sc": "Sardinian", "sd": "Sindhi", "se": "Northern Sami", "sg": "Sango",
    "si": "Sinhala", "sk": "Slovak", "sl": "Slovenian", "sm": "Samoan",
    "sn": "Shona", "so": "Somali", "sq": "Albanian", "sr": "Serbian",
    "ss": "Swati", "st": "Southern Sotho", "su": "Sundanese", "sv": "Swedish",
    "sw": "Swahili", "ta": "Tamil", "te": "Telugu", "tg": "Tajik",
    "th": "Thai", "ti": "Tigrinya", "tk": "Turkmen", "tl": "Tagalog",
    "tn": "Tswana", "to": "Tonga", "tr": "Turkish", "ts": "Tsonga",
    "tt": "Tatar", "tw": "Twi", "ty": "Tahitian", "ug": "Uighur",
    "uk": "Ukrainian", "ur": "Urdu", "uz": "Uzbek", "ve": "Venda",
    "vi": "Vietnamese", "vo": "Volapuk", "wa": "Walloon", "wo": "Wolof",
    "xh": "Xhosa", "yi": "Yiddish", "yo": "Yoruba", "za": "Zhuang",
    "zh": "Chinese", "zu": "Zulu",
}

# D21, explicitly: `hi` returns None. It is Hindi in ISO 639-1 and "hearing impaired"
# in subtitle filenames, and nothing in a filename separates the two. A wrong `hi`
# means either a Hindi track labelled as captions-for-the-deaf or the reverse, and both
# are confidently wrong rather than visibly unknown. It stays in `_CODE_TO_NAME` (so a
# trailing `.hi` is still recognised as a TAG and stripped by the stem rung) and is
# withheld only from the lookup below.
_AMBIGUOUS_CODES = {"hi"}

_LOOKUP_CODES = {c for c in _CODE_TO_NAME if c not in _AMBIGUOUS_CODES}

# Aliases a release actually writes that are not the ISO English name. Deliberately
# short: each one is a word whose mapping is unambiguous. `mandarin` -> `zh` is as far
# as this goes; `cantonese` is `yue`, which has no 639-1 code, so it is left to resolve
# as None rather than mislabelled as Chinese.
_NAME_ALIASES = {
    "brazilian": "pt",
    "castilian": "es",
    "farsi": "fa",
    "flemish": "nl",
    "mandarin": "zh",
}

_NAME_TO_CODE = {
    name.lower(): code
    for code, name in _CODE_TO_NAME.items()
    if code not in _AMBIGUOUS_CODES
}
_NAME_TO_CODE.update(_NAME_ALIASES)


# --------------------------------------------------------------------- tokenising

def _tokens(text: str) -> Tuple[str, ...]:
    """Lowercased tokens of `text`, split on D21's separator set."""
    return tuple(t for t in _TOKEN_SPLIT.split(text.lower()) if t)


def _is_tag_token(token: str) -> bool:
    """True for a token that is a TAG on a name rather than part of the name.

    The numeric arm is capped at two digits on purpose: a 1-2 digit token is a track
    index (`2_English.srt`, `3_English.srt` — the convention the plan's own fixtures
    use), while a 4-digit token is a year and is part of the title, so stripping it
    would stop `Movie.2020.en.srt` ever matching `Movie.2020.mkv`.
    """
    if token in _MODIFIER_TOKENS:
        return True
    if token in _CODE_TO_NAME or token in _NAME_TO_CODE:
        return True
    return token.isdigit() and len(token) <= 2


def _core_tokens(stem: str) -> Tuple[str, ...]:
    """`stem`'s tokens with tag tokens peeled off both ends.

    Both ends, because the two conventions in the wild put the tag in different
    places: `Pack.S01E03.en.srt` trails it, and a track index leads.

    CORRECTED IN REVIEW: `2_English.srt` is NOT the case the leading loop handles. Its
    trailing loop eats `english` and then the `2`, so the leading loop never runs, and
    deleting that loop outright left every row of this stage's two test files green.
    The leading loop earns its place only when the LAST token is not a tag, as in
    `2_Movie.2020.en.srt` — which is now the fixture that pins it, in
    `test_the_stem_rung_peels_a_leading_track_index_and_a_language_name`.

    Peeling is iterative (`Movie.en.forced.srt` sheds two tokens) and stops at the
    first non-tag token, so an interior token is never removed.
    """
    toks = list(_tokens(stem))
    while toks and _is_tag_token(toks[-1]):
        toks.pop()
    while toks and _is_tag_token(toks[0]):
        toks.pop(0)
    return tuple(toks)


def _parts(rel_path: str) -> Tuple[str, ...]:
    """Path segments of a torrent-relative path, separator-normalised."""
    return PurePosixPath(str(rel_path).replace("\\", "/")).parts


def _entry_rel_path(entry: Mapping[str, Any]) -> str:
    """The torrent-RELATIVE path of a video-file or sidecar entry.

    `rel_path` is the contract. `path` is accepted as an alias only while it is
    relative, and an ABSOLUTE `path` raises: `TorrentManager.get_video_files` builds
    `path` as `save_path / fi.path` (`manager.py:1081`), and handing that list here
    would silently prepend the save path's own segments — so `/downloads` becomes the
    "torrent root" and D20's root exclusion, which exists because a range-named root
    overrides a correct later segment, would exclude the wrong segment. That failure
    produces a confident wrong pairing with no error anywhere, which is precisely the
    class this module's whole shape is built to make visible. Loud beats silent.
    """
    rel = entry.get("rel_path")
    if rel is None:
        rel = entry.get("path")
    if rel is None:
        raise ValueError("video file entry carries neither 'rel_path' nor 'path'")
    rel = str(rel).replace("\\", "/")
    if rel.startswith("/"):
        raise ValueError(
            "pair() needs TORRENT-RELATIVE paths; got an absolute one. Pass the "
            "metadata path under the key 'rel_path' rather than a save-path-joined one."
        )
    return rel


def _torrent_root(paths: Sequence[str]) -> Optional[str]:
    """The torrent's own root folder, or None when the torrent is flat.

    A single-folder torrent prefixes every file with the same first segment; a flat
    multi-file torrent has files at the top level. The SHARED FIRST SEGMENT is what
    tells the two apart.

    CORRECTED IN REVIEW: the `len(segs) < 2` conjunct is defensive, not load-bearing.
    Deleting it left every row of this stage's two test files green, and it can only
    change an answer when a file sits at the top level carrying a name equal to the
    folder every other file is under — which no realistic layout produces. It is kept
    because getting the root wrong matters in one direction only: excluding a segment
    that is not a root would throw away a real episode hint. No test pins it and none
    can without a pathological fixture, so it is named here rather than claimed.
    """
    firsts = set()
    for p in paths:
        segs = _parts(p)
        if len(segs) < 2:
            return None
        firsts.add(segs[0])
    if len(firsts) != 1:
        return None
    return firsts.pop()


def _below_root(rel_path: str, root: Optional[str]) -> str:
    """`rel_path` with the torrent root dropped, as one `/`-joined string.

    Joined, and searched left to right, because that is what `parse_episode` does
    (`providers/episodes.py:14-16` is an `re.search`) and D20's measured trap lives in
    exactly that behaviour: `Breaking.Bad.S01E01-07.1080p.BluRay/Subs/
    Breaking.Bad.S01E04/3_English.srt` parses to (1, 1) with the root in, because the
    range-named root's `S01E01` is the first match and OVERRIDES the correct later
    segment.

    A REFUSED alternative, named because it looks better and is not: scanning segments
    innermost-outward would make the root harmless and the exclusion unnecessary. It
    also makes the exclusion untestable — with the root tried last, including it
    changes no answer on any fixture — and it quietly re-decides D20. The exclusion is
    kept, with the search form `parse_episode` actually has.
    """
    segs = _parts(rel_path)
    if root is not None and segs and segs[0] == root:
        segs = segs[1:]
    return "/".join(segs)


# ------------------------------------------------------------------------ pairing

def _decline(rung: str, sub_rel: str, claimants: Sequence[int],
             tied: bool = False) -> None:
    """Say, at INFO, that a rung refused an ambiguous match and fell through.

    The count is the point. "Nothing matched" and "three videos matched" are different
    facts about the same `none`, and only the second one says the parse is not
    discriminating. The rung and the sidecar are named because this line is the only
    trace a refusal leaves — `pair()`'s return value cannot distinguish a rung that
    declined from a rung that never fired.

    `tied` says WHICH refusal this is. Rungs 1 and 2 reach a decline only after the
    proximity tiebreak failed to separate the claimants, and rung 3 declines without
    trying it at all; writing the same sentence for both would tell an operator that
    proximity was tried where it was not.
    """
    logger.info(
        f"sidecar pairing: rung {rung!r} declined {sub_rel!r} — "
        f"{len(claimants)} videos claim it (indices {sorted(claimants)})"
        + (" and directory proximity is tied between them" if tied else "")
        + "; falling through to the next rung"
    )


def _dir_segments(rel_path: str) -> Tuple[str, ...]:
    """The DIRECTORY segments of a torrent-relative path: its parts, basename dropped.

    The basename is dropped rather than kept because the thing being compared is WHERE
    two files sit, and a sidecar's basename can never equal a video's (the extensions
    differ), so keeping it would contribute a guaranteed mismatch at the end of every
    comparison. For the realistic layouts in `test_subtitle_pairing.py` the two
    scorings answer identically — see `_nearest_claimant`'s note on that mutation.
    """
    return _parts(rel_path)[:-1]


def _shared_depth(a: Sequence[str], b: Sequence[str]) -> int:
    """How many LEADING segments `a` and `b` have in common.

    Leading, and stopping at the first difference: `Season 1` and `Season 2` under one
    root share exactly one segment, which is the whole arithmetic the tiebreak rests
    on. A set intersection or a suffix comparison would score some of these layouts
    the same way and is not what "proximity" means here.
    """
    depth = 0
    for left, right in zip(a, b):
        if left != right:
            break
        depth += 1
    return depth


def _nearest_claimant(rung: str, sub_rel: str, claimants: Sequence[int],
                      rel_by_index: Mapping[int, str]) -> Optional[int]:
    """The ONE claimant sitting closest to the sidecar, or None when two tie for it.

    Each claimant is scored by `_shared_depth` between its directory and the sidecar's.
    The answer is the claimant whose score is strictly the greatest; when the greatest
    score is shared by two or more claimants, this returns None and the caller declines
    exactly as it did before the tiebreak existed.

    ORDER-INDEPENDENT BY CONSTRUCTION, and that is the point of the shape rather than a
    nicety. `max(claimants, key=...)` returns the FIRST maximal element, which is the
    order-dependence this whole mechanism was added to remove: `video_files` arrives in
    the torrent's own file-index order, a property of how the release was packed and
    not of what it contains. So the MAXIMAL SET is computed and its size checked.
    `max()` appears here only over the depth VALUES, where the answer is a number and
    cannot depend on iteration order. Pinned by
    `test_proximity_breaks_the_tie_identically_in_either_file_order`, not by this
    paragraph.

    ONE MUTATION IS ANNOTATED RATHER THAN TESTED, in the shape of X2 (`_torrent_root`):
    scoring the shared prefix of the FULL paths, basenames included, instead of the
    directories. Measured — it answers identically on every fixture in
    `test_subtitle_pairing.py`, and that is not a gap in the fixtures. The two scorings
    can only differ when one path's directory list runs out and the sidecar's whole
    BASENAME equals the other path's next directory segment, i.e. when a release ships
    a folder named exactly `E01.en.srt`. No realistic layout produces that, so it is
    named here rather than claimed as tested.
    """
    sub_dir = _dir_segments(sub_rel)
    depths = {
        index: _shared_depth(sub_dir, _dir_segments(rel_by_index[index]))
        for index in claimants
    }
    deepest = max(depths.values())
    nearest = sorted(index for index, depth in depths.items() if depth == deepest)
    if len(nearest) != 1:
        return None
    logger.info(
        f"sidecar pairing: rung {rung!r} broke an ambiguous claim on {sub_rel!r} by "
        f"directory proximity — {len(claimants)} videos claimed it "
        f"(indices {sorted(claimants)}); index {nearest[0]} shares {deepest} leading "
        f"path segment(s) with it and no other claimant shares as many; reported as "
        f"'near', not as {rung!r}"
    )
    return nearest[0]


def pair(rel_path: str,
         video_files: Sequence[Mapping[str, Any]]) -> Tuple[Optional[int], str]:
    """Pair a sidecar at `rel_path` to one of `video_files`.

    `rel_path` is TORRENT-RELATIVE (`ti.file_at(i).path`). Each entry of
    `video_files` is a mapping carrying `index` (the torrent's own file index) and
    `rel_path` (see `_entry_rel_path`). Returns `(video_index | None, pair_source)`
    with `pair_source` one of `PAIR_SOURCES`.

    **No rung ever guesses between equals.** A rung takes an answer when exactly ONE
    video claims the sidecar. When two or more do:

    * **rungs 1 and 2 try DIRECTORY PROXIMITY, and HOLD the answer** — each claimant is
      scored by how many leading path segments its directory shares with the sidecar's,
      and the claimant whose score is strictly the greatest wins, reported as **`near`**
      rather than as `stem`/`dir` so the television can say it picked the closest of
      several rather than the only one. The scoring is a pure function of the two paths
      and therefore ORDER-INDEPENDENT — `_nearest_claimant` computes the maximal SET and
      checks its size, because `max()` over a list silently returns the first maximal
      element, which is exactly the order-dependence this mechanism removes.
      **A held answer is used only after rung 3 has had its turn and found nothing**
      (rung 3b). Returning it immediately let a guess pre-empt a check and was measured
      to change the INDEX, not merely the label, on 68 of 720,657 enumerated two-video
      layouts — see the comment on rung 1 for the worked misfile. Rung 1's held
      candidate outranks rung 2's.
    * **an UNBREAKABLE TIE still declines.** When the greatest score is shared by two
      or more claimants, the rung logs at INFO (`_decline`) and falls through to the
      next rung, which may still resolve the same sidecar uniquely.
    * **rung 3 does not use the tiebreak at all** and refuses outright. Two videos
      agreeing on one episode means the parse is not discriminating, and proximity
      there would be a second guess stacked on a first. Pinned by
      `test_the_parse_rung_does_not_use_the_proximity_tiebreak`, so extending it is a
      deliberate edit.

    Rungs 4 and 5 cannot be ambiguous: rung 4 is only reached when the torrent has
    exactly one video, and rung 5 claims nothing.

    This RE-DECIDES D20's rung contract THREE times, in three review rounds. D20
    specified the refusal for rung 3 only; the first round measured what rungs 1 and 2
    did instead (see the comment on rung 1) and made them refuse; the second round
    measured that refusing is not the best available answer when the paths themselves
    say which video is meant, and added the tiebreak; the third round measured that
    returning the tiebreak's answer immediately OVERRODE rung 3 and picked the wrong
    season's file on a misfiled sidecar, and deferred it to rung 3b. Two rules came out
    of that, in this order of priority: **a rung that can be wrong must not outrank the
    rung that checks**, and silence is better than a wrong answer but worse than a right
    one. The second rule is what the tiebreak is for; the first is why it waits.

    The rungs, in order (D20, as re-decided):

    1. `stem` — the sidecar's basename stem, with tag tokens peeled, equals a video's
       basename stem. Several matches are broken by proximity, whose answer is HELD for
       rung 3b rather than returned, and refused when proximity ties.
    2. `dir`  — the sidecar's nearest ancestor directory NAME equals a video's
       basename stem. Same tiebreak, same hold, same refusal. Cannot use
       `parse_episode`: measured,
       `parse_episode("Subs/E01.srt")` is None, because `_SXXEYY` is
       `[Ss](\\d{1,2})[\\s._-]?[Ee](\\d{1,3})` and a bare `E01` matches neither it nor
       `_XNOTATION`. The directory's whole NAME is used, not `Path(...).stem`, because
       `PurePosixPath("Pack.S01E05").stem` is `"Pack.S01"` — a season-episode suffix
       looks exactly like a file extension.
    3. `parse` — `parse_episode` over the segments BELOW the torrent root, required to
       agree with the paired video's own parse, and refused outright when more than one
       video agrees.
    3b. `near` — the proximity answer rung 1 or rung 2 held back, now that the parse has
       declined. Never overrides rung 3: a sidecar whose own name names an episode is
       answered by that name, and one whose name says nothing is answered by where it
       sits.
    4. `single` — a one-video torrent. There is nothing else it could belong to.
    5. `none`  — unpaired. Still listed, with no episode claimed.
    """
    videos = [(int(v["index"]), _entry_rel_path(v)) for v in video_files]
    if not videos:
        return None, "none"
    rel_by_index = {index: vrel for index, vrel in videos}

    sub_rel = str(rel_path).replace("\\", "/")
    sub_segs = _parts(sub_rel)
    if not sub_segs:
        return None, "none"

    sub_stem = PurePosixPath(sub_segs[-1]).stem
    sub_candidates = {t for t in (_tokens(sub_stem), _core_tokens(sub_stem)) if t}

    # Rung 1 — the stem. Compared against each video's RAW stem tokens: a video name
    # carries no language or `forced` tag, so peeling one would only ever lose a real
    # token. Both the sidecar's raw and peeled forms are offered, so
    # `Movie.2020.en.srt` reaches `Movie.2020.mkv` and `Movie.2020.srt` still does.
    #
    # CORRECTED IN REVIEW, and this re-decides D20: this loop used to `return` on the
    # FIRST match without looking for a second, and so did rung 2. Measured against the
    # shipped module, on the exact multi-season "Complete" shape D20 cites to justify
    # rung 2 existing at all:
    #
    #   videos  = [0: "Show.Complete/Season 2/E01.mkv",
    #              1: "Show.Complete/Season 1/E01.mkv"]
    #   pair("Show.Complete/Season 1/E01.en.srt", videos)             -> (0, "stem")
    #   pair("Show.Complete/Season 1/Subs/E01/2_English.srt", videos) -> (0, "dir")
    #   pair("Show.Complete/Season 1/E01.en.srt", reversed(videos))   -> (1, "stem")
    #
    # Season TWO's file for a Season 1 sidecar; flipping with file-index order; and
    # reported as `stem`, which `track_label` renders as a plain "English" with nothing
    # to confess. The one failure this module exists to make visible, made invisible by
    # the two rungs that run before the one that guards against it. So both collect
    # every claimant and take an answer only when there is exactly one.
    #
    # CORRECTED AGAIN, in the following review round: collecting every claimant and
    # then refusing threw away an answer the PATHS already contained. Both rungs
    # compared basename stems only and ignored where the sidecar SITS, and on the exact
    # shape above the shared-directory depths are {0: 1, 1: 2} — measured — so Season
    # 1's file is derivable, uniquely and in either file order, for both of those
    # sidecars. A multi-season "Complete" pack with per-season folders and bare episode
    # basenames is D20's own justification for rung 2 existing and a very common release
    # shape, and refusing there yielded NO subtitle for every sidecar in it. Honest
    # silence beats a wrong answer; a right answer beats both. So an ambiguous claim is
    # broken by proximity (`near`), and only a tie proximity cannot break declines.
    # CORRECTED A THIRD TIME, and this is the form that ships: a proximity answer is
    # HELD, not returned. Returning it here let a GUESS pre-empt a CHECK — rung 3 reads
    # the sidecar's own name, and proximity reads only where the packer filed it.
    # Enumerated over 720,657 coherent two-video layouts, 68 answer a DIFFERENT INDEX
    # under proximity than under the parse, and the measured counterexample is a
    # packer's misfile, which is the case a pairing ladder exists to survive:
    #
    #   videos  0: "Show.Complete/Season 1/Show.S01E01/E01.mkv"   dir-depth 2
    #           1: "Show.Complete/Season 2/Show.S02E01/E01.mkv"   dir-depth 1
    #   sidecar    "Show.Complete/Season 1/Subs/E01/Show.S02E01.en.srt"
    #
    # Rung 2 fires (both basenames match the bare `E01` parent folder), proximity reads
    # the leading segments and sees `Season 1`, and the answer is index 0 — while the
    # sidecar's own name says `S02E01` and rung 3 agrees with exactly one video, index
    # 1. So `held_near` carries the candidate past rung 3 and is used only if the parse
    # finds nothing. This restores the rule the first correction stated and the second
    # one broke: A RUNG THAT CAN BE WRONG MUST NOT OUTRANK THE RUNG THAT CHECKS. The
    # two reviewer fixtures above are unaffected (rung 3 cannot parse `Season 1/E01`),
    # so nothing is lost by deferring, and holding costs one local variable.
    held_near: Optional[int] = None

    stem_matches = []
    for index, vrel in videos:
        vstem_tokens = _tokens(PurePosixPath(_parts(vrel)[-1]).stem)
        if vstem_tokens and vstem_tokens in sub_candidates:
            stem_matches.append(index)
    if len(stem_matches) == 1:
        return stem_matches[0], "stem"
    if stem_matches:
        nearest = _nearest_claimant("stem", sub_rel, stem_matches, rel_by_index)
        if nearest is not None:
            held_near = nearest
        else:
            _decline("stem", sub_rel, stem_matches, tied=True)

    # Rung 2 — the nearest ancestor directory. Same tiebreak, same refusal, same
    # reasons. The two rungs are separate loops with separate guards on purpose:
    # reverting the tiebreak in one leaves the other's rows green, so each has its own
    # proximity row and its own tie row.
    if len(sub_segs) >= 2:
        dir_tokens = _tokens(sub_segs[-2])
        if dir_tokens:
            dir_matches = []
            for index, vrel in videos:
                vstem_tokens = _tokens(PurePosixPath(_parts(vrel)[-1]).stem)
                if vstem_tokens and vstem_tokens == dir_tokens:
                    dir_matches.append(index)
            if len(dir_matches) == 1:
                return dir_matches[0], "dir"
            if dir_matches:
                nearest = _nearest_claimant("dir", sub_rel, dir_matches, rel_by_index)
                if nearest is None:
                    _decline("dir", sub_rel, dir_matches, tied=True)
                elif held_near is None:
                    # Rung 1's held candidate outranks rung 2's, for the same reason an
                    # unambiguous `stem` outranks an unambiguous `dir`: the sidecar's own
                    # name is stronger evidence than the folder it sits in. Only reachable
                    # when BOTH rungs were ambiguous and both broke by proximity.
                    held_near = nearest

    # Rung 3 — the episode number, below the torrent root, agreeing with the video.
    root = _torrent_root([sub_rel] + [vrel for _, vrel in videos])
    sub_episode = parse_episode(_below_root(sub_rel, root))
    if sub_episode is not None:
        agreeing = [
            index for index, vrel in videos
            if parse_episode(_below_root(vrel, root)) == sub_episode
        ]
        # Exactly one, or none. Two videos claiming one episode means the parse is not
        # discriminating, and a coin flip there is the invisible mis-pair this module
        # exists to prevent: the cue text would be valid, timed and about the wrong
        # episode, with no error event, no status code and no device reading to catch
        # it. `none` is the honest answer.
        #
        # NO PROXIMITY TIEBREAK HERE, deliberately, and it is not a free improvement:
        # rungs 1 and 2 break a tie between claimants that each matched a NAME exactly,
        # so proximity only chooses between equally exact matches. Rung 3's claimants
        # agree on an episode number that the parse has already shown it cannot tell
        # apart, so proximity would be a second guess stacked on a first. Measured:
        # extending the tiebreak here changes `test_the_parse_rung_does_not_use_the_
        # proximity_tiebreak` from `none` to a resolved index, which is that row's job.
        if len(agreeing) == 1:
            return agreeing[0], "parse"
        if len(agreeing) > 1:
            _decline("parse", sub_rel, agreeing)

    # Rung 3b — the proximity answer rung 1 or rung 2 held back, used ONLY now that the
    # parse has had its turn and found nothing. This is the whole of the third
    # correction: the guess is still available, it just no longer outranks the check.
    # Note what it does NOT do — it never overrides rung 3. A sidecar whose own name
    # names an episode is answered by that name; a sidecar whose name says nothing is
    # answered by where it sits. `near` is reported either way, so the television
    # confesses the weaker provenance in the label it already renders.
    if held_near is not None:
        return held_near, "near"

    # Rung 4 — a single-video torrent.
    if len(videos) == 1:
        return videos[0][0], "single"

    # Rung 5. Note what is NOT here: a largest-video fallback. `get_video_file_info`
    # (`manager.py:1134`) and the resume-data reader (`:1266`) both do
    # `max(files, key=size)` because for a STREAM an unspecified index means "the
    # movie". For a sidecar it would mean captioning episode 1's dialogue over
    # whichever file happens to be biggest, under a cell reading `Subtitles - EN`.
    return None, "none"


# ----------------------------------------------------------------------- language

def guess_language(rel_path: str,
                   video_stem: str = "") -> Tuple[Optional[str], str, List[str]]:
    """Guess a sidecar's language from its name. Returns `(code | None, label, flags)`.

    D21: tokens split on `[._\\-\\s]+` and matched EXACTLY against an ISO 639-1 code
    table and an English-name table, with the paired video's own stem tokens removed
    first. `'en' in name.lower()` is the measured trap — `Movie.French.srt` contains
    `fr-EN-ch`, and the same class hits `Children`, `Golden` and `Kingsman`.

    The LAST matching token wins: a language tag is written at the end of a name, and
    a title word that survived the video-stem subtraction is written earlier.

    `label` is always a sentence the picker can show — the table's English name, or
    `UNKNOWN_LANGUAGE_LABEL` when nothing resolves. It is read from the table and
    never from the filename, so a track-index prefix (`2_English.srt`) cannot leak
    onto the screen.

    Only the BASENAME is examined. A language carried by a directory (`Subs/English/
    E01.srt`) does not resolve here and comes back None — named rather than guessed at,
    because `Subs/`, `Subtitles/` and per-release folder names are not a convention
    anything in this repo has measured.
    """
    segs = _parts(str(rel_path).replace("\\", "/"))
    if not segs:
        return None, UNKNOWN_LANGUAGE_LABEL, []
    stem = PurePosixPath(segs[-1]).stem

    tokens = _tokens(stem)
    video_tokens = set(_tokens(video_stem)) if video_stem else set()

    flags = [t for t in _MODIFIER_TOKENS if t in tokens]

    code: Optional[str] = None
    for token in tokens:
        if token in video_tokens:
            continue
        if token in _LOOKUP_CODES:
            code = token
        elif token in _NAME_TO_CODE:
            code = _NAME_TO_CODE[token]

    if code is None:
        return None, UNKNOWN_LANGUAGE_LABEL, flags
    return code, _CODE_TO_NAME[code], flags


def track_label(language_label: str, pair_source: str) -> str:
    """The picker row's text: the language, plus how the pairing was reached (D20).

    `stem` and `single` render the language alone — in both cases the names said it
    outright. `dir`, `near`, `parse` and `none` each confess their own degree of
    inference, and the four sentences are deliberately different: a folder match, the
    closest of several name matches, an episode-number match and no match at all are
    four different things to be told while deciding whether to trust what is on screen.

    What `near` does NOT carry is which rung reached it — rungs 1 and 2 both report it.
    That is a deliberate collapse (one new source, one new sentence) and the rung is
    kept in the INFO line `_nearest_claimant` writes, so the distinction survives for
    the operator and not for the viewer, who can act on neither.
    """
    return f"{language_label}{_PAIR_SOURCE_SUFFIX[pair_source]}"


def dedupe_by_language(
        entries: Sequence[Mapping[str, Any]]) -> List[Mapping[str, Any]]:
    """One entry per resolved language, input order preserved (D21).

    Preference within a language: a non-`forced` entry over a `forced` one (a forced
    track carries only the foreign-dialogue lines, so offering it as "English" when a
    full English track exists is a worse answer), then the shortest path, then
    lexicographic — so the result is stable rather than dependent on dict iteration.

    `lang is None` entries are NOT collapsed, and that is a decision rather than an
    oversight: their only distinguishing feature is the path, so folding three of them
    into one would silently hide two files the viewer could otherwise try, and the
    picker would claim there is one unknown-language sidecar when there are three.

    That decision has exactly ONE expression in the code below — the `continue` that
    keeps a null out of the grouping — and the shape here is why. The obvious
    formulation (collect the winners, then return "the winners plus every null") says
    it twice, and measured: with two statements of one rule, deleting either leaves the
    behaviour unchanged and the test that pins it cannot fail. So what is computed is
    the set a language group SUPERSEDED. An entry that never joined a group is never in
    it, and removing the `continue` reddens. Quadratic in the number of sidecars, which
    is a handful; `subtitle_max_bytes` and the picker's own rows bound it long before
    this does.
    """
    best: dict = {}
    for position, entry in enumerate(entries):
        lang = entry.get("lang")
        if lang is None:
            continue
        path = _entry_rel_path(entry)
        forced = 1 if "forced" in (entry.get("flags") or []) else 0
        rank = (forced, len(path), path)
        if lang not in best or rank < best[lang][0]:
            best[lang] = (rank, position)
    superseded = set()
    for lang, (_rank, winner) in best.items():
        superseded |= {
            position for position, entry in enumerate(entries)
            if entry.get("lang") == lang and position != winner
        }
    return [
        entry for position, entry in enumerate(entries)
        if position not in superseded
    ]
