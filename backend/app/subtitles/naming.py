"""Pairing a sidecar subtitle to its video, and guessing its language. PURE.

No libtorrent session, no DB, no persistence, no `settings` read. Every RETURN VALUE
here is a function of the strings it is handed, which is why it is the one part of
stage 9 that can be tested exhaustively. ONE exception, added in review and named
rather than hidden: a pairing rung that refuses an ambiguous match writes a line at
INFO (`_decline`). That is a write to the log and nothing else — it changes no answer —
and it is here because a silent fall-through is exactly how `pair()` shipped with two
rungs that returned on the first of several matches.

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

# The five rungs of D20, in the order `pair()` tries them. `none` is the honest
# bottom: an unpairable sidecar is still LISTED (the picker shows it), it simply
# carries no episode and says so.
PAIR_SOURCES = ("stem", "dir", "parse", "single", "none")

# Rendered on the picker row (D20). `stem` and `single` deliberately share the plain
# label: in both cases the filename or the torrent's shape names the video outright,
# so there is nothing inferred to confess. `dir`, `parse` and `none` each get their own
# words, because collapsing any two of them would make the television say the same
# sentence about two different degrees of confidence.
_PAIR_SOURCE_SUFFIX = {
    "stem": "",
    "single": "",
    "dir": " (matched by folder)",
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

def _decline(rung: str, sub_rel: str, claimants: Sequence[int]) -> None:
    """Say, at INFO, that a rung refused an ambiguous match and fell through.

    The count is the point. "Nothing matched" and "three videos matched" are different
    facts about the same `none`, and only the second one says the parse is not
    discriminating. The rung and the sidecar are named because this line is the only
    trace a refusal leaves — `pair()`'s return value cannot distinguish a rung that
    declined from a rung that never fired.
    """
    logger.info(
        f"sidecar pairing: rung {rung!r} declined {sub_rel!r} — "
        f"{len(claimants)} videos claim it (indices {sorted(claimants)}); "
        f"falling through to the next rung"
    )


def pair(rel_path: str,
         video_files: Sequence[Mapping[str, Any]]) -> Tuple[Optional[int], str]:
    """Pair a sidecar at `rel_path` to one of `video_files`.

    `rel_path` is TORRENT-RELATIVE (`ti.file_at(i).path`). Each entry of
    `video_files` is a mapping carrying `index` (the torrent's own file index) and
    `rel_path` (see `_entry_rel_path`). Returns `(video_index | None, pair_source)`
    with `pair_source` one of `PAIR_SOURCES`.

    **Rungs 1, 2 and 3 all REFUSE an ambiguous match.** A rung takes an answer only
    when exactly ONE video claims the sidecar; when two or more do, it logs at INFO
    (`_decline`) and falls through to the next rung, which may still resolve the same
    sidecar uniquely. Rungs 4 and 5 cannot be ambiguous: rung 4 is only reached when
    the torrent has exactly one video, and rung 5 claims nothing.

    This RE-DECIDES D20's rung contract, which specified the refusal for rung 3 only.
    Review measured what rungs 1 and 2 did instead — see the comment on rung 1 — and
    the rule is that a rung which can be wrong must not outrank the rung that checks.

    The five rungs, in order (D20):

    1. `stem` — the sidecar's basename stem, with tag tokens peeled, equals a video's
       basename stem. Refused when more than one video's stem matches.
    2. `dir`  — the sidecar's nearest ancestor directory NAME equals a video's
       basename stem. Refused when more than one video's stem matches. Cannot use
       `parse_episode`: measured,
       `parse_episode("Subs/E01.srt")` is None, because `_SXXEYY` is
       `[Ss](\\d{1,2})[\\s._-]?[Ee](\\d{1,3})` and a bare `E01` matches neither it nor
       `_XNOTATION`. The directory's whole NAME is used, not `Path(...).stem`, because
       `PurePosixPath("Pack.S01E05").stem` is `"Pack.S01"` — a season-episode suffix
       looks exactly like a file extension.
    3. `parse` — `parse_episode` over the segments BELOW the torrent root, required to
       agree with the paired video's own parse, and refused when more than one video
       agrees.
    4. `single` — a one-video torrent. There is nothing else it could belong to.
    5. `none`  — unpaired. Still listed, with no episode claimed.
    """
    videos = [(int(v["index"]), _entry_rel_path(v)) for v in video_files]
    if not videos:
        return None, "none"

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
    stem_matches = []
    for index, vrel in videos:
        vstem_tokens = _tokens(PurePosixPath(_parts(vrel)[-1]).stem)
        if vstem_tokens and vstem_tokens in sub_candidates:
            stem_matches.append(index)
    if len(stem_matches) == 1:
        return stem_matches[0], "stem"
    if stem_matches:
        _decline("stem", sub_rel, stem_matches)

    # Rung 2 — the nearest ancestor directory. Same refusal, same reason.
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
                _decline("dir", sub_rel, dir_matches)

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
        if len(agreeing) == 1:
            return agreeing[0], "parse"
        if len(agreeing) > 1:
            _decline("parse", sub_rel, agreeing)

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
    outright. `dir`, `parse` and `none` each confess their own degree of inference,
    and the three sentences are deliberately different: a folder match, an
    episode-number match and no match at all are three different things to be told
    while deciding whether to trust what is on screen.
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
