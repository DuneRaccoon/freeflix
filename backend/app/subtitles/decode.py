"""The decode ladder: a sidecar's bytes to text, or an honest refusal.

Stage 9, D18. A sidecar arrives as bytes with no declared encoding, and the
television has no way to show "this looks wrong" — a mojibaked track is
invisible as a *fault* and visible as *nonsense* for the length of the film. So
this module answers `(text, None)` or `(None, "encoding-unknown")` and never
anything in between.

The ladder, in order:

  1. a BOM, obeyed and never second-guessed (`utf-8-sig`, UTF-16 LE/BE);
  2. UTF-8 strict **and** no NUL in the result;
  3. `settings.subtitle_encoding`, when the owner declared one;
  4. cp1252 strict, gated by whole-file non-ASCII-letter density;
  5. refuse.

Four things are deliberately absent, each because it was measured:

* **No latin-1 fallback.** `bytes.decode("latin-1")` raises on *zero* of 256
  bytes, so a latin-1 rung is not a fallback at all: it is a guarantee that
  garbage is served instead of refused. It is the exact shape this module
  exists to prevent.
* **No `errors="replace"` on any rung.** It converts a failed decode into a
  successful one carrying U+FFFD, which is both the "visible nonsense" outcome
  above and the thing that makes every other decode test in
  `test_subtitle_decode.py` unfalsifiable — one `errors="replace"` and every
  arm of the ladder returns text, so no mutation of any rung can redden.
* **No bespoke detector.** One was built and measured 7/13 — identical to this
  naive ladder and wrong on worse rows, because a latin-1 mojibake of Cyrillic
  is 100% letters in one script, so character-category scoring cannot separate
  it from real text.
* **No `charset_normalizer`.** It measured 10/12 and is importable in the image
  today, but only because `backend/Dockerfile:6` sets
  `POETRY_VIRTUALENVS_CREATE=false` and `:25` pip-installs poetry into the same
  site-packages. It is in neither `backend/pyproject.toml`'s dependencies nor
  any `[[package]]` block of `poetry.lock`, so importing it here would make the
  app's import depend on a transitive dependency of the build tool — any
  slimming of the Dockerfile turns that into an ImportError at app import.
  Declaring it properly is a one-line change plus an image rebuild and belongs
  in its own task with its own red tests (plan: "Decisions taken on the user's
  behalf", point 2).

Pure: no I/O, no session, no persistence. Reads one setting at call time so the
owner's override can be monkeypatched in a test.
"""
from __future__ import annotations

import codecs
from typing import Optional, Tuple

from loguru import logger

from app.config import settings

# The one refusal reason this module produces. `api/subtitles.py`'s VTT route
# turns it into a 415 naming it, so the viewer gets one sentence they can act on
# (set `SUBTITLE_ENCODING`) instead of two hours of nonsense.
REFUSAL_ENCODING_UNKNOWN = "encoding-unknown"

# --- the density gate, and exactly what it can and cannot see -----------------
#
# Refuse when more than this fraction of the LETTERS in the WHOLE decoded file
# are non-ASCII. Measured on hand-authored fixtures (the same ones pinned in
# `test_subtitle_decode.py`), density of the cp1252 decode:
#
#     Russian cp1251, 7 cues              1.0000   <- refused, correctly
#     Polish  cp1250, 7 cues              0.0613   <- accepted (and mangled;
#                                                     see the blind spot below)
#     Turkish cp1254, 3 cues              0.1343   <- accepted (blind spot)
#     French  cp1252, 2 cues              0.1522   <- accepted, correctly
#     French  cp1252, the 4-letter "Cafe" 0.2500   <- accepted, correctly
#
# TWO limits, written here because both are measured and neither is fixable by
# moving the number:
#
# 1. It detects a wrong SCRIPT, not a wrong CODEPAGE within Latin. Turkish
#    cp1254 read as cp1252 scores 0.1343 and sails through with its
#    `g-breve s-cedilla I-dot dotless-i` mangled. A threshold low enough to
#    catch it (below 0.1343) would refuse the real French file above, which
#    scores 0.1522. The Polish file is not part of that argument: at 0.0613 it
#    is below the Turkish row and would survive such a move.
# 2. It aggregates over a FILE, and it is weakest on short ones. A single
#    heavily diacritic Polish line measures 0.50 *on its own* and would be
#    refused if the gate ran per line; the same text inside a 7-cue file
#    measures 0.0613. That is why the gate is whole-file, and it is also why a
#    one-cue non-Latin sidecar is the case most likely to slip past.
#
# The gate applies to rung 4 ONLY. A BOM and the owner's `SUBTITLE_ENCODING`
# are declarations, not guesses, and density-gating a declaration would refuse
# exactly the Cyrillic library the override exists to serve (real Cyrillic
# decoded correctly as cp1251 scores ~1.0 too — the metric cannot tell "all
# non-ASCII letters because it is Russian" from "all non-ASCII letters because
# it is mojibake"; only the declaration can).
MAX_NON_ASCII_LETTER_DENSITY = 0.35

# Rung 1. A BOM is a declaration of the encoding by the file itself.
#
# `codecs.BOM_UTF16_LE` is `b"\xff\xfe"`, which is also the first two bytes of
# the UTF-32 LE BOM (`b"\xff\xfe\x00\x00"`), so a UTF-32 LE file matches this
# rung and decodes as UTF-16 into a NUL-riddled string — which the NUL guard
# below refuses. That is the honest outcome: no WebVTT sidecar in the wild is
# UTF-32, and refusing beats emitting the garbage.
_BOM_RUNGS: Tuple[Tuple[bytes, str], ...] = (
    (codecs.BOM_UTF8, "utf-8-sig"),
    (codecs.BOM_UTF16_LE, "utf-16"),
    (codecs.BOM_UTF16_BE, "utf-16"),
)


def non_ascii_letter_density(text: str) -> float:
    """Fraction of `text`'s alphabetic characters that are non-ASCII.

    Non-letters (digits, spaces, punctuation) are in NEITHER the numerator nor
    the denominator: an SRT is roughly half timestamps and cue numbers, and
    counting those in the denominator would dilute every file by its own
    formatting — a short dialogue-heavy file and a long one would score
    differently for the same text. Returns 0.0 for text with no letters at all,
    which is "nothing to judge", not "clean": a file with no letters has no
    cues either and the converter refuses it on cue count.
    """
    letters = 0
    non_ascii = 0
    for ch in text:
        if ch.isalpha():
            letters += 1
            if ch > "\x7f":
                non_ascii += 1
    if letters == 0:
        return 0.0
    return non_ascii / letters


def _strict(raw: bytes, codec: str) -> Optional[str]:
    """Decode `raw` as `codec` with strict errors, or None if it cannot.

    `errors` is left at its "strict" default on purpose — see the module
    docstring. `LookupError` is caught separately because rung 3's codec name
    comes from the owner's `.env` and a typo there must refuse, not 500.
    """
    try:
        return raw.decode(codec)
    except UnicodeDecodeError:
        return None
    except LookupError:
        logger.warning(
            f"subtitle_encoding={codec!r} is not a codec Python knows; ignoring it"
        )
        return None


def decode_subtitle(raw: bytes) -> Tuple[Optional[str], Optional[str]]:
    """Decode a sidecar's bytes, or refuse.

    Returns `(text, None)` on success and `(None, "encoding-unknown")` on a
    refusal — never both, never partial text, never U+FFFD. Says nothing about
    whether the text is a subtitle file: an empty input decodes to `""`
    successfully and the converter is what refuses it on cue count.
    """
    # Rung 1 — a BOM, obeyed. No fall-through if it fails to decode: a file
    # that declares UTF-16 and then is not UTF-16 is corrupt, and the cp1252
    # rung below would "succeed" on it by rendering the BOM itself as visible
    # text (`b"\xef\xbb\xbf"` -> "i-diaeresis guillemet section-sign").
    for bom, codec in _BOM_RUNGS:
        if raw.startswith(bom):
            text = _strict(raw, codec)
            if text is None or "\x00" in text:
                return None, REFUSAL_ENCODING_UNKNOWN
            return text, None

    # Rung 2 — UTF-8 strict, AND no NUL. The second conjunct is load-bearing,
    # not hygiene: BOM-less UTF-16 LE and BE both decode as *valid UTF-8* into a
    # NUL-riddled string, which a browser renders as visible U+FFFD garbage with
    # no error of any kind. Refuse rather than continue down the ladder — every
    # rung below maps 0x00 to NUL as well, so no later rung can do better.
    text = _strict(raw, "utf-8")
    if text is not None:
        if "\x00" in text:
            return None, REFUSAL_ENCODING_UNKNOWN
        return text, None

    # Rung 3 — the owner's declared codepage, when they set one. Not
    # density-gated (see the gate's note). A failure here falls through to
    # cp1252 rather than refusing, because the override is a hint about the
    # library, not a claim about this one file.
    declared = (settings.subtitle_encoding or "").strip()
    if declared:
        text = _strict(raw, declared)
        if text is not None and "\x00" not in text:
            return text, None

    # Rung 4 — cp1252, the only guess in the ladder, and so the only gated one.
    text = _strict(raw, "cp1252")
    if text is not None and "\x00" not in text:
        density = non_ascii_letter_density(text)
        if density <= MAX_NON_ASCII_LETTER_DENSITY:
            return text, None
        logger.debug(
            "subtitle decode refused: cp1252 non-ASCII letter density "
            f"{density:.4f} > {MAX_NON_ASCII_LETTER_DENSITY}"
        )

    return None, REFUSAL_ENCODING_UNKNOWN
