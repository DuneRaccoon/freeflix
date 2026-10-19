"""Stage 9 task 5: the decode ladder refuses rather than mojibakes.

HOW EVERY FIXTURE HERE IS BUILT, AND WHY IT MATTERS. Every input is **bytes** in
this module — a byte literal, or an ASCII `str` literal with `\\uXXXX` escapes
put through `.encode(...)` (the plan's own idiom for its UTF-16 row). None of
them is a file under ``backend/tests/data/``: git marks a cp1251 file binary, an
editor re-saves it as UTF-8 on the first touch, and the exact bytes are the
whole subject. **A `str` fixture cannot discriminate any decode mutation** — it
is UTF-8 by construction, so every rung of the ladder would answer it the same
way.

Expected text is written as `\\uXXXX` escapes and asserted as **text equality**.
Never as a codec name: German cp1252 is indistinguishable from cp1250 on every
letter of a realistic sample, so an assertion on "which codec won" reddens on a
correct answer. `decode_subtitle` returns no codec name for exactly that
reason.

PROVENANCE OF THE LANGUAGE FIXTURES. Hand-authored dialogue, not sampled from
any release: there is no corpus of real sidecars anywhere in this repo
(`backend/tests/data/releases.tsv` is 370 title rows with no path column and
zero ``.srt``), and the library this ships to contains zero sidecars today. The
measured densities quoted beside each fixture are facts about these bytes; that
they resemble the distribution of real sidecars is an assumption.
"""
import pytest

from app.config import settings
from app.subtitles.decode import (
    MAX_NON_ASCII_LETTER_DENSITY,
    REFUSAL_ENCODING_UNKNOWN,
    decode_subtitle,
    non_ascii_letter_density,
)

# --- the fixtures -------------------------------------------------------------

# (a) The plan's own row. cp1252 `\xe9` is `é`; four letters, one of them
# non-ASCII, so density 0.2500 — accepted, and the closest any correct fixture
# here comes to the gate's limit. NOT valid UTF-8: `\xe9` announces a two-byte
# sequence and `\r` is not a continuation byte.
CP1252_CAFE = b"1\r\n00:00:01,000 --> 00:00:02,000\r\nCaf\xe9\r\n"

# A realistic French sidecar, 2 cues: density 0.1522.
CP1252_FRENCH = (
    b"1\r\n00:00:01,000 --> 00:00:04,000\r\nLe caf"
    b"\xe9 est ferm\xe9 ce soir, d\xe9sol\xe9.\r\n\r"
    b"\n2\r\n00:00:05,000 --> 00:00:08,000\r\nOn ira"
    b" chez ma m\xe8re \xe0 No\xebl.\r\n"
)

# (b) A UTF-8 BOM. `\xef\xbb\xbf` is U+FEFF, which is itself valid UTF-8 — so a
# plain `utf-8` decode SUCCEEDS and leaves a zero-width U+FEFF as the file's
# first character, where a WebVTT parser is looking for the magic.
UTF8_BOM = b"\xef\xbb\xbf1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n"

# A UTF-8 BOM over a body that is not UTF-8. The file declares an encoding and
# then breaks its own declaration.
#
# THE BODY IS LONG ON PURPOSE, and the first draft of this fixture was wrong.
# With the short payload `Caf\xe9`, the cp1252 decode of
# `\xef\xbb\xbf...Caf\xe9` scores 0.4000 (5 letters, 2 of them non-ASCII) and so
# the DENSITY GATE refuses it — measured: the "fall through to cp1252 after a
# failed BOM decode" mutation left the whole file green, because a second,
# unrelated guard happened to catch the same bytes. This 35-letter payload
# scores 0.0571, well inside the gate, so the fixture now discriminates the
# rule it is named for and nothing else.
UTF8_BOM_BROKEN = (
    b"\xef\xbb\xbf1\r\n00:00:01,000 --> 00:00:02,000\r\n"
    b"The caf\xe9 on the corner was closed all week.\r\n"
)

_ASCII_CUE = "1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n"

# (c) BOM-LESS UTF-16, the measured trap: every byte is < 0x80, so the bytes are
# VALID UTF-8 and decode without error into a NUL-riddled string, which a
# browser renders as visible U+FFFD garbage with no error event at all.
UTF16_LE_NO_BOM = _ASCII_CUE.encode("utf-16-le")
UTF16_BE_NO_BOM = _ASCII_CUE.encode("utf-16-be")

# The same text WITH a BOM, which the first rung must honour.
UTF16_LE_BOM = b"\xff\xfe" + UTF16_LE_NO_BOM
UTF16_BE_BOM = b"\xfe\xff" + UTF16_BE_NO_BOM

# (d) Seven cues of hand-authored Russian dialogue, cp1251. Measured: not valid
# UTF-8; cp1252 decodes it WITHOUT error (cp1251's Russian letters live at
# 0xA8/0xB8 and 0xC0-0xFF, all of which cp1252 defines), density 1.0000. So the
# density gate is the only thing between these bytes and two hours of
# `Ïðèâåò`-shaped nonsense on the television. Seven cues and not one line
# because the gate aggregates over a file (see the aggregation test below).
CP1251_RUSSIAN = (
    b"1\r\n00:01:01,000 --> 00:01:02,500\r\n\xcf\xf0"
    b"\xe8\xe2\xe5\xf2, \xff \xe4\xe0\xe2\xed\xee "
    b"\xf2\xe5\xe1\xff \xed\xe5 \xe2\xe8\xe4\xe5\xeb"
    b".\r\n\r\n2\r\n00:02:02,000 --> 00:02:03,500\r"
    b"\n\xcc\xfb \xe4\xee\xeb\xe6\xed\xfb \xef\xee"
    b"\xe3\xee\xe2\xee\xf0\xe8\xf2\xfc \xee\xe1 \xfd"
    b"\xf2\xee\xec \xf1\xe5\xe9\xf7\xe0\xf1.\r\n\r\n"
    b"3\r\n00:03:03,000 --> 00:03:04,500\r\n\xce\xed"
    b" \xf1\xea\xe0\xe7\xe0\xeb, \xf7\xf2\xee \xef"
    b"\xf0\xe8\xe5\xe4\xe5\xf2 \xe7\xe0\xe2\xf2\xf0"
    b"\xe0 \xf3\xf2\xf0\xee\xec.\r\n\r\n4\r\n00:04:0"
    b"4,000 --> 00:04:05,500\r\n\xc3\xe4\xe5 \xf2"
    b"\xfb \xe1\xfb\xeb \xe2\xf1\xe5 \xfd\xf2\xee "
    b"\xe2\xf0\xe5\xec\xff?\r\n\r\n5\r\n00:05:05,000"
    b" --> 00:05:06,500\r\n\xdf \xed\xe5 \xe7\xed"
    b"\xe0\xfe, \xf7\xf2\xee \xf2\xe5\xe1\xe5 \xee"
    b"\xf2\xe2\xe5\xf2\xe8\xf2\xfc.\r\n\r\n6\r\n00:0"
    b"6:06,000 --> 00:06:07,500\r\n\xdd\xf2\xee \xed"
    b"\xe5 \xec\xee\xff \xe2\xe8\xed\xe0, \xef\xee"
    b"\xe9\xec\xe8 \xed\xe0\xea\xee\xed\xe5\xf6.\r\n"
    b"\r\n7\r\n00:07:07,000 --> 00:07:08,500\r\n\xce"
    b"\xed\xe8 \xf3\xf8\xeb\xe8 \xe4\xee \xf2\xee"
    b"\xe3\xee, \xea\xe0\xea \xed\xe0\xf7\xe0\xeb"
    b"\xf1\xff \xe4\xee\xe6\xe4\xfc.\r\n\r\n"
)

# Seven cues of hand-authored Polish, cp1250. Measured as cp1252: density
# 0.0613 over the file, while its most diacritic-dense single line
# (`Zażółć gęślą jaźń.`) measures
# 0.5000 ALONE. This is a Latin-script file that must be accepted even though
# it is being read through the wrong codepage — refusing it would cost a whole
# language for a fault the gate cannot even see (its letters are mangled either
# way; only the file's SCRIPT is right).
CP1250_POLISH = (
    b"1\r\n00:01:01,000 --> 00:01:02,500\r\nNie wiem"
    b", co mam ci powiedzie\xe6.\r\n\r\n2\r\n00:02:0"
    b"2,000 --> 00:02:03,500\r\nTo nie moja wina, zr"
    b"ozum wreszcie.\r\n\r\n3\r\n00:03:03,000 --> 00"
    b":03:04,500\r\nWyszli, zanim zacz\xb9\xb3 pada"
    b"\xe6 deszcz.\r\n\r\n4\r\n00:04:04,000 --> 00:0"
    b"4:05,500\r\nGdzie by\xb3e\x9c ca\xb3y ten czas"
    b"?\r\n\r\n5\r\n00:05:05,000 --> 00:05:06,500\r"
    b"\nMusimy o tym teraz porozmawia\xe6.\r\n\r\n6"
    b"\r\n00:06:06,000 --> 00:06:07,500\r\nPowiedzia"
    b"\xb3, \xbfe przyjedzie jutro rano.\r\n\r\n7\r"
    b"\n00:07:07,000 --> 00:07:08,500\r\nZa\xbf\xf3"
    b"\xb3\xe6 g\xea\x9cl\xb9 ja\x9f\xf1.\r\n\r\n"
)
CP1250_POLISH_DENSEST_LINE = b"Za\xbf\xf3\xb3\xe6 g\xea\x9cl\xb9 ja\x9f\xf1."

# Three cues of hand-authored Turkish, cp1254 — the gate's MEASURED BLIND SPOT.
# Read as cp1252 it scores 0.1343 and sails straight through with its
# `ğ ş İ ı` mangled, because the gate detects a wrong
# SCRIPT and this is the wrong CODEPAGE within the same script.
CP1254_TURKISH = (
    b"1\r\n00:01:01,000 --> 00:01:02,500\r\nBen de "
    b"\xfeimdi \xf6\xf0rendim bunu.\r\n\r\n2\r\n00:0"
    b"2:02,000 --> 00:02:03,500\r\n\xddstanbul'a yar"
    b"\xfdn gidece\xf0iz.\r\n\r\n3\r\n00:03:03,000 -"
    b"-> 00:03:04,500\r\nNe yapaca\xf0\xfdm\xfd bilm"
    b"iyorum.\r\n\r\n"
)

# A file no codec in this ladder can read, contrived on purpose: 0x98 is
# UNDEFINED in cp1251 and 0x81 is UNDEFINED in cp1252, and both are invalid
# UTF-8 — so every rung refuses it however `SUBTITLE_ENCODING` is set. It is
# here to give the `errors="replace"` mutation somewhere to show itself on the
# owner-declared rung and on the cp1252 rung, which the language fixtures above
# cannot do (they all decode cleanly as cp1252).
UNREADABLE_IN_EVERY_RUNG = b"1\r\n00:00:01,000 --> 00:00:02,000\r\nTe\x98s\x81t\r\n"

# Every byte fixture in this module, for the U+FFFD sweep.
ALL_FIXTURES = {
    "cp1252_cafe": CP1252_CAFE,
    "cp1252_french": CP1252_FRENCH,
    "utf8_bom": UTF8_BOM,
    "utf8_bom_broken": UTF8_BOM_BROKEN,
    "utf16_le_no_bom": UTF16_LE_NO_BOM,
    "utf16_be_no_bom": UTF16_BE_NO_BOM,
    "utf16_le_bom": UTF16_LE_BOM,
    "utf16_be_bom": UTF16_BE_BOM,
    "cp1251_russian": CP1251_RUSSIAN,
    "cp1250_polish": CP1250_POLISH,
    "cp1254_turkish": CP1254_TURKISH,
    "unreadable_in_every_rung": UNREADABLE_IN_EVERY_RUNG,
    "utf8_plain": "1\r\n00:00:01,000 --> 00:00:02,000\r\nCafé\r\n".encode("utf-8"),
    "empty": b"",
}


# --- (a) the cp1252 rung ------------------------------------------------------


def test_cp1252_rung_decodes_an_accented_latin_sidecar():
    """A cp1252 sidecar decodes, and the accented character survives intact.

    Mutation that must redden: drop the cp1252 rung. Both rows here go to
    `(None, "encoding-unknown")`, which on the television is a refusal for the
    single most common non-UTF-8 sidecar there is.
    """
    text, reason = decode_subtitle(CP1252_CAFE)
    assert reason is None
    assert text is not None and "Café" in text

    text, reason = decode_subtitle(CP1252_FRENCH)
    assert reason is None
    assert text is not None
    assert "Le café est fermé ce soir, désolé." in text
    assert "On ira chez ma mère à Noël." in text


def test_utf8_bytes_decode_unchanged():
    """The ordinary case: real UTF-8 never reaches a guessing rung."""
    text, reason = decode_subtitle(ALL_FIXTURES["utf8_plain"])
    assert reason is None
    assert text == "1\r\n00:00:01,000 --> 00:00:02,000\r\nCafé\r\n"


# --- (b) the BOM rung ---------------------------------------------------------


def test_utf8_bom_is_stripped_not_decoded_as_a_character():
    """A UTF-8 BOM must not survive into the text.

    Mutation that must redden: decode this rung as `utf-8` instead of
    `utf-8-sig` (or delete the rung, leaving rung 2's plain `utf-8` to answer).
    The decode still SUCCEEDS — U+FEFF is valid UTF-8 — and the file's first
    character becomes an invisible U+FEFF, exactly where the converter and then
    a WebVTT parser look for the magic.
    """
    text, reason = decode_subtitle(UTF8_BOM)
    assert reason is None
    assert text is not None
    assert text[0] != "﻿"
    assert "﻿" not in text
    assert text.startswith("1\r\n")


@pytest.mark.parametrize("name", ["utf16_le_bom", "utf16_be_bom"])
def test_utf16_with_a_bom_decodes_through_the_bom_rung(name):
    """Both byte orders, because they are two separate entries in one table.

    Mutation that must redden: delete either entry. Without it the bytes fall
    to rung 2 (`\\xff\\xfe` is not valid UTF-8) and then to cp1252, whose decode
    is full of NULs, so the file is refused and the television shows nothing
    for a sidecar that was perfectly readable. The LE fixture cannot catch a
    deleted BE entry, or the reverse.
    """
    text, reason = decode_subtitle(ALL_FIXTURES[name])
    assert reason is None
    assert text == _ASCII_CUE


def test_a_bom_whose_body_breaks_its_own_declaration_is_refused():
    """A declared encoding that does not hold is corruption, not a hint.

    Mutation that must redden: fall through to the cp1252 rung after a failed
    BOM decode. cp1252 "succeeds" on these bytes and renders the BOM itself as
    the visible text `ï»¿`, i.e. three characters of garbage in
    front of the magic plus a mojibaked payload — served, with a 200.

    D18 does not say what happens when a BOM'd file fails to decode as what it
    declares; refusing is this module's choice, and the reason is that the only
    rung below it which can "succeed" here is the guess. See the fixture's own
    comment for why its payload has to be this long: with a short one the
    density gate catches the mutant and the test cannot see its own subject.
    """
    text, reason = decode_subtitle(UTF8_BOM_BROKEN)
    assert text is None
    assert reason == REFUSAL_ENCODING_UNKNOWN


# --- (c) the NUL conjunct -----------------------------------------------------


@pytest.mark.parametrize("name", ["utf16_le_no_bom", "utf16_be_no_bom"])
def test_bomless_utf16_is_refused_although_it_decodes_as_valid_utf8(name):
    """The measured trap the `"\\x00" not in text` conjunct exists for.

    Mutation that must redden: drop the NUL conjunct from the UTF-8 rung. These
    bytes are all < 0x80, so `bytes.decode("utf-8")` raises NOTHING and returns
    a NUL-riddled string — a successful decode of a file that is not UTF-8 at
    all. The browser then paints U+FFFD garbage and fires no error, so nothing
    downstream of here can detect it.
    """
    text, reason = decode_subtitle(ALL_FIXTURES[name])
    assert text is None
    assert reason == REFUSAL_ENCODING_UNKNOWN


# --- (d) the density gate -----------------------------------------------------


def test_cyrillic_cp1251_file_is_refused_by_the_density_gate():
    """A Russian sidecar is refused, not served as `Ïðè...`.

    Mutation that must redden: delete the density gate. Measured: cp1252
    decodes these bytes without raising (density 1.0000), so without the gate
    this returns a successful 489 bytes of nonsense and the only remaining
    "error" is the viewer reading it.
    """
    text, reason = decode_subtitle(CP1251_RUSSIAN)
    assert text is None
    assert reason == REFUSAL_ENCODING_UNKNOWN


def test_the_gate_aggregates_over_the_file_not_the_line():
    """Whole-file aggregation is what keeps a Latin-script language readable.

    The two measured numbers are asserted directly, because they are the whole
    argument for the gate's shape: this file's densest single line scores
    0.5000 on its own — above the limit — while the file scores 0.0613.

    Mutation that must redden: gate per line (refuse if any line exceeds the
    limit) → the Polish file is refused, and with it every language whose
    diacritics cluster in one line of dialogue.
    """
    whole = CP1250_POLISH.decode("cp1252")
    line = CP1250_POLISH_DENSEST_LINE.decode("cp1252")
    assert non_ascii_letter_density(line) > MAX_NON_ASCII_LETTER_DENSITY
    assert non_ascii_letter_density(whole) < MAX_NON_ASCII_LETTER_DENSITY

    text, reason = decode_subtitle(CP1250_POLISH)
    assert reason is None
    assert text is not None and "Nie wiem, co mam ci powiedzie" in text


def test_turkish_cp1254_is_accepted_and_mangled_which_is_the_gates_blind_spot():
    """A CHARACTERISATION of the limit, not an endorsement of the outcome.

    The gate detects a wrong SCRIPT, never a wrong CODEPAGE inside Latin. This
    cp1254 file scores 0.1343 read as cp1252 and is accepted with its
    `ğ ş İ ı` silently replaced by
    `ð þ Ý ý`. Pinned so that the next person to touch the
    threshold sees what it does NOT buy: lowering it far enough to catch this
    would refuse real French (0.1522) and Polish (0.0613) files.
    """
    text, reason = decode_subtitle(CP1254_TURKISH)
    assert reason is None
    assert text is not None
    # The mangling, spelled out: a Turkish `ş` arrives as `þ`.
    assert "Ben de þimdi öðrendim bunu." in text
    assert "şimdi" not in text


def test_non_ascii_letter_density_counts_letters_and_only_letters():
    """Hand-computed values, so the metric itself is pinned, not just its uses.

    Mutation that must redden: divide by `len(text)` instead of by the letter
    count. An SRT is roughly half timestamps and cue numbers, so that change
    scales every density down by a factor that depends on how chatty the file
    is — the Russian file's 1.0000 becomes ~0.55 and a threshold tuned on one
    file stops meaning anything on another.
    """
    assert non_ascii_letter_density("Café") == pytest.approx(0.25)
    # Digits, spaces and punctuation are in neither the numerator nor the
    # denominator, so the same four letters score the same inside a cue.
    assert non_ascii_letter_density(
        "7\n00:00:01,000 --> 00:00:02,000\nCafé!\n"
    ) == pytest.approx(0.25)
    assert non_ascii_letter_density("Cafe") == 0.0
    assert non_ascii_letter_density("00:00:01,000 --> 00:00:02,000") == 0.0
    assert non_ascii_letter_density("") == 0.0
    assert non_ascii_letter_density(CP1251_RUSSIAN.decode("cp1252")) == pytest.approx(
        1.0
    )


# --- (e) the owner's override -------------------------------------------------


def test_owner_declared_encoding_outranks_the_cp1252_guess(monkeypatch):
    """`SUBTITLE_ENCODING` is the owner's escape hatch and must win.

    The same bytes as the cp1252 row: `\\xe9` is `é` in cp1252 and
    `й` in cp1251. Asserting the TEXT is what discriminates — no codec
    name is reported by `decode_subtitle`, deliberately.

    Mutation that must redden: delete the owner rung, or move it below cp1252.
    The text comes back `Café` and a Cyrillic library gets mojibake with a
    setting that silently does nothing.
    """
    monkeypatch.setattr(settings, "subtitle_encoding", "cp1251")
    text, reason = decode_subtitle(CP1252_CAFE)
    assert reason is None
    assert text is not None and "Cafй" in text
    assert "Café" not in text


def test_owner_declared_encoding_does_not_outrank_a_bom_or_real_utf8(monkeypatch):
    """The override is a hint for the guessing rungs, not an override of facts.

    Mutation that must redden: put the owner rung ahead of the BOM and UTF-8
    rungs. A household that sets `SUBTITLE_ENCODING=cp1251` for its Russian
    releases would then have every correct UTF-8 sidecar mojibaked as well.
    """
    monkeypatch.setattr(settings, "subtitle_encoding", "cp1251")

    text, reason = decode_subtitle(ALL_FIXTURES["utf8_plain"])
    assert reason is None
    assert text is not None and "Café" in text

    text, reason = decode_subtitle(UTF8_BOM)
    assert reason is None
    assert text is not None and text.startswith("1\r\n")


def test_an_unknown_codec_name_in_the_setting_is_ignored_not_raised(monkeypatch):
    """A typo in `.env` must not 500 a request.

    The name reaches `bytes.decode` as data and raises `LookupError`, which is
    NOT a `UnicodeDecodeError` — so catching only the latter turns a typo into
    the error middleware's opaque 500 (it logs and returns
    `{"detail": "Internal server error"}`), with nothing on the television to
    suggest the setting is the cause.

    Mutation that must redden: catch only `UnicodeDecodeError` in `_strict`.
    """
    monkeypatch.setattr(settings, "subtitle_encoding", "not-a-real-codec")
    text, reason = decode_subtitle(CP1252_CAFE)
    assert reason is None
    assert text is not None and "Café" in text


@pytest.mark.parametrize("declared", [None, "cp1251"])
def test_a_file_no_configured_rung_can_read_is_refused(declared, monkeypatch):
    """Contrived bytes: 0x98 is undefined in cp1251, 0x81 undefined in cp1252.

    Both arms must refuse. Its real job is in the U+FFFD sweep below, where it
    is the only fixture that can show an `errors="replace"` on the
    owner-declared rung or on the cp1252 rung.
    """
    monkeypatch.setattr(settings, "subtitle_encoding", declared)
    text, reason = decode_subtitle(UNREADABLE_IN_EVERY_RUNG)
    assert text is None
    assert reason == REFUSAL_ENCODING_UNKNOWN


# --- (f) the sweep that keeps every other mutation falsifiable ----------------


@pytest.mark.parametrize("declared", [None, "cp1251"])
@pytest.mark.parametrize("name", sorted(ALL_FIXTURES))
def test_no_fixture_ever_decodes_to_a_replacement_character(
    name, declared, monkeypatch
):
    """Nothing this module returns may contain U+FFFD, under any setting.

    THIS TEST EXISTS TO KEEP THE REST OF THE FILE FALSIFIABLE. One
    `errors="replace"` on any rung makes that rung succeed on every input, so
    every other mutation in this file stops reddening: the ladder never reaches
    a lower rung, never consults the density gate, and never refuses. The sweep
    runs under both settings states so that the owner-declared rung is covered
    too, and it includes `unreadable_in_every_rung` so that a rung whose
    language fixtures all decode cleanly still has an input that can show the
    mutation.

    A refusal satisfies this assertion — refusing is the correct answer for a
    file no rung can read. What may never happen is returning text with a
    replacement character in it.
    """
    monkeypatch.setattr(settings, "subtitle_encoding", declared)
    text, _reason = decode_subtitle(ALL_FIXTURES[name])
    if text is not None:
        assert "�" not in text, f"{name}: served a replacement character"


# --- the division of labour ---------------------------------------------------


def test_empty_bytes_decode_successfully_and_say_nothing_about_content():
    """`decode_subtitle` judges ENCODING only.

    An empty sidecar is a real failure, and it is the converter's to report
    (zero cues) — the one refusal that must never be answered with
    `"WEBVTT\\n\\n"`, because a `<track>` loads that at `readyState 2` with no
    event at all. Pinned here so nobody moves the emptiness check into this
    module and leaves the converter's own refusal untested.
    """
    text, reason = decode_subtitle(b"")
    assert reason is None
    assert text == ""
