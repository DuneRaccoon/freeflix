"""SRT/VTT -> WebVTT conversion. Pure, synchronous, no I/O, no cache.

WHY THIS IS A CONVERTER AND NOT A PASS-THROUGH, and why it REFUSES rather than
emits. Stage 9's plan D19 records nine distinct malformed-WebVTT shapes that a
Chromium `<track>` loads **silently**: `readyState 2`, `load` fired, `error`
NOT fired, and **zero cues**. The failure is per-cue, so a file can be
three-quarters good and lose the rest with no event anywhere. Two consequences
shape every line below:

1. **A naive converter turns a loud failure into a quiet one.** Raw ASS, an
   empty file and a header-less file all fire a real `error` event. Wrap any of
   them in ``WEBVTT\\n\\n`` and they become successful loads with no cues and no
   event at all. So zero cues is a REFUSAL here, funnelled through exactly one
   return statement, and the television is told a reason it can print.
2. **The emitter is the acceptance criterion.** Nothing in this repository can
   execute a WebVTT parser (jsdom 25.0.1 has no `TextTrack`/`VTTCue`, and the
   backend image has no browser binary), so the output grammar is pinned by
   property assertions in `backend/tests/test_subtitle_vtt.py` that were
   transcribed by hand from browser measurements. They are the only instrument
   there is. If one was transcribed wrong, nothing here will say so.

The emitted grammar is deliberately the STRICT one, leaning on none of the
leniencies measured in Chromium 155 on macOS (no blank line after the magic, no
spaces around the arrow, one-digit hours, CR-only endings, an absent hours
field). The television is Chromium 120 on webOS 25 and those five are exactly
the parts most likely to differ. So: ``WEBVTT``, a blank line, LF endings
throughout, and ``HH:MM:SS.mmm --> HH:MM:SS.mmm`` with exactly one space on
each side of the arrow, HH at least two digits, MM and SS exactly two digits in
0-59, the fraction exactly three digits.

THE TWO CARRIES, which are two separate measured facts and not one.
``00:00:75,000`` and ``00:75:01,000`` are *separately* measured silent zeros, so
`_normalise_timestamp` folds seconds>=60 into minutes AND minutes>=60 into
hours as two explicit steps. They are written as two steps on purpose: a
total-milliseconds implementation does both carries implicitly, which reads
fine and leaves no line a mutation can delete, i.e. no way to show either carry
is load-bearing. One fixture cannot discriminate both; the test file carries one
per carry.

PAYLOAD HANDLING, each clause with its measurement:

* ``{...}`` is stripped BEFORE escaping. ``{\\an8}Top line`` renders the braces
  literally in Blink, and escaping first would leave ``&lt;`` inside a brace run
  that then gets removed.
* ``&`` is escaped UNCONDITIONALLY. ``A &notreal; B`` renders as ``A ¬real; B``
  through a legacy semicolon-less entity, so there is no safe "only escape a
  bare ampersand" rule. The cost, stated because it is real and visible: a
  `.vtt` sidecar that already contains ``&amp;`` is re-escaped and shows the
  literal text ``&amp;`` on screen. That is the deliberate trade - `.vtt` is
  revalidated through this same path and never passed through (D17), and
  under-escaping corrupts text that nobody can see is corrupted.
* ``<`` is escaped EXCEPT where it opens or closes a tag a WebVTT parser knows.
  A blanket `html.escape()` puts the literal text ``<i>`` on screen for the
  whole film.
* ``-->`` inside a payload line is escaped to ``--&gt;``. This is a DATA-LOSS
  guard, not hygiene: measured, a payload line containing ``-->`` yields a cue
  whose `text` is the empty string, so the cue still exists and a cue-count
  check still passes while the line is gone from the picture.
* A cue whose payload is empty after all of that (``{\\an8}`` on its own) is
  dropped, and so is a cue with ``end <= start``. Blink keeps the latter as
  invisible dead weight; only the converter can remove them.

``<font ...>`` IS PASSED THROUGH, and that is a decision this module had to make
because the plan's D19 states two rules that only agree one way. D19 says to
escape ``<`` except for ``i b u ruby rt v lang c``, and separately says "do NOT
strip ``<font ...>`` (Blink drops the tag, keeps the text)". Escaping it is not
stripping it, so the letter of the first rule is satisfiable - but it puts the
literal text ``<font color="#ffffff">`` on screen, which is strictly worse than
either alternative. Blink can only drop a tag that arrives AS a tag, so `font`
joins the pass-through set. `backend/tests/test_subtitle_vtt.py` pins that
behaviourally, since "does not strip" is otherwise a `Does not` line with no
test.

WHAT IS NOT DONE HERE, each because an alternative was measured and lost:

* No ffmpeg, and no ASS/SSA conversion. ``.ass``/``.ssa`` are refused by format
  (plan D17): their ``H:MM:SS.cc`` timestamps under an SRT regex are a measured
  silent zero-cue shape, a correct reader needs a ``Format:``-line-driven field
  order, a styling-dropped typesetting file degrades to stacked overlapping
  junk, and no ``.ass`` file exists anywhere in this repository to test a
  grammar written from recall. The refusal is driven by
  ``settings.subtitle_convertible_extensions`` rather than by a literal set here,
  so moving ``.ass`` into that setting reddens this module's own refusal row -
  which is what makes `test_subtitle_config.py`'s subset assertion say something.
* No ``line:`` cue setting, and no cue settings of ANY kind. ``::cue`` cannot
  move a cue (Blink retains ``bottom``/``transform``/``padding`` in `cssText`
  and ignores them at used-value time), so a cue setting would be the only
  lever - and it would couple backend output to a television stylesheet with no
  runtime meeting point. The scrim fade (D16) is the stage's answer instead.
* Nothing is stripped from the timing line's tail. DVD-rip cue-setting junk
  (``X1:100 X2:200 ...``) is measured harmless, so there is no code here hunting
  for it; the timing line is re-emitted from the parsed fields, which is why it
  does not survive. Real `.vtt` cue settings do not survive either, for the same
  reason.
* No caching, no `get_mime_type`, no `VIDEO_MIME_TYPES`. The route hard-codes
  ``text/vtt; charset=utf-8`` (D10) because the container's own mime table maps
  ``.srt -> text/plain`` and ``.ass -> audio/aac``.

INPUT LENIENCY is deliberately wider than output strictness: both ``,`` and
``.`` are accepted as the fraction separator, the hours field may be absent (a
`.vtt` may be ``MM:SS.mmm``), and the fraction may be one to three digits. What
is NOT accepted is a cue with no blank line before the next one - the trailing
numeric identifier of the following cue would be absorbed as payload. Real SRT
and VTT both separate cues with a blank line; this is recorded rather than
handled because handling it needs a lookahead branch no fixture here would
exercise honestly.
"""
from __future__ import annotations

import re
from typing import List, NamedTuple, Optional, Tuple

from app.config import settings


class ConvertResult(NamedTuple):
    """The whole answer: a body, how many cues are in it, or why there is none.

    Exactly one of `text` and `reason` is set. `cue_count` is 0 whenever
    `reason` is set, and >= 1 whenever `text` is - there is no third state,
    because "200 and a body starting with WEBVTT" is precisely the shape a
    `<track>` cannot distinguish from a working file.
    """

    text: Optional[str]
    cue_count: int
    reason: Optional[str]


# A normalised timestamp: (hours, minutes, seconds, milliseconds), already
# carried, so formatting is a plain f-string and the carries live in one place.
_Timestamp = Tuple[int, int, int, int]


class _Cue(NamedTuple):
    start: _Timestamp
    end: _Timestamp
    lines: List[str]


_FRACTION_DIGITS = 3

# Input side. Hours optional (a `.vtt` may be MM:SS.mmm), minutes and seconds
# one or two digits, the fraction one to three, and either separator.
_TIMESTAMP_PATTERN = r"(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})"
_TIMING_LINE = re.compile(
    r"^\s*" + _TIMESTAMP_PATTERN + r"\s*-->\s*" + _TIMESTAMP_PATTERN + r"\s*(.*)$"
)

_BRACE_RUN = re.compile(r"\{[^}]*\}")

# The tags a WebVTT parser knows, plus `font` (see the module docstring). The
# word boundary is what keeps `<it>` and `<video>` escaped: the name must end
# where the tag's name ends.
_KNOWN_TAG = re.compile(r"<(?:/?)(?:ruby|rt|lang|font|i|b|u|v|c)\b", re.IGNORECASE)


def _normalise_format(fmt: str) -> str:
    """``srt`` / ``.SRT`` / ``.srt`` all mean ``.srt``.

    The lister reports a format without the dot and the plan's own examples pass
    one with it, so both spellings are accepted rather than left as a trap for
    whichever caller guesses wrong.
    """
    return "." + (fmt or "").strip().lower().lstrip(".")


def _normalise_timestamp(
    hours: Optional[str], minutes: str, seconds: str, fraction: str
) -> _Timestamp:
    """Parse one timestamp and apply BOTH carries, as two separate steps."""
    h = int(hours) if hours is not None else 0
    m = int(minutes)
    s = int(seconds)
    # A short fraction is a decimal fraction of a second, not a count of
    # milliseconds: `,5` is 500 ms and the ASS-style `,25` is 250 ms.
    ms = int(fraction.ljust(_FRACTION_DIGITS, "0"))

    # SECONDS CARRY. `00:00:75,000` is a measured silent zero-cue file: WebVTT
    # requires SS in 0-59 and Blink drops the whole cue without an event.
    m += s // 60
    s = s % 60

    # MINUTES CARRY, measured SEPARATELY. `00:75:01,000` is its own silent zero,
    # and the seconds carry above cannot rescue it - which is why these are two
    # steps and the test file carries one fixture for each.
    h += m // 60
    m = m % 60

    return (h, m, s, ms)


def _to_milliseconds(ts: _Timestamp) -> int:
    return ((ts[0] * 60 + ts[1]) * 60 + ts[2]) * 1000 + ts[3]


def _format_timestamp(ts: _Timestamp) -> str:
    """The strict output form. The `.` is not negotiable: a comma is SRT's."""
    return f"{ts[0]:02d}:{ts[1]:02d}:{ts[2]:02d}.{ts[3]:03d}"


def _escape_angle(line: str) -> str:
    """Escape every ``<`` that does not open or close a tag a parser knows."""
    out: List[str] = []
    cursor = 0
    while True:
        found = line.find("<", cursor)
        if found < 0:
            out.append(line[cursor:])
            return "".join(out)
        out.append(line[cursor:found])
        out.append("<" if _KNOWN_TAG.match(line, found) else "&lt;")
        cursor = found + 1


def _render_payload(raw_lines: List[str]) -> List[str]:
    """Brace strip, then escape, in that order. Empty lines disappear."""
    rendered: List[str] = []
    for raw in raw_lines:
        line = _BRACE_RUN.sub("", raw)
        line = line.replace("&", "&amp;")
        # After the `&` pass, so the `&gt;` introduced here is not re-escaped.
        line = line.replace("-->", "--&gt;")
        line = _escape_angle(line)
        line = line.strip()
        if not line:
            continue
        rendered.append(line)
    return rendered


def _parse_cues(text: str) -> List[_Cue]:
    """Every timing line in the input, with the lines that follow it.

    Deliberately not a block parser: it scans for timing lines and ignores
    everything it does not understand, so a `.vtt`'s ``WEBVTT`` header, SRT's
    numeric identifiers, stray BOM-less junk and an ASS header all fall out
    without a branch of their own. An ASS body therefore yields zero cues, which
    is the refusal `to_webvtt` reports.
    """
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    cues: List[_Cue] = []
    index = 0
    total = len(lines)
    while index < total:
        match = _TIMING_LINE.match(lines[index])
        if match is None:
            index += 1
            continue
        start = _normalise_timestamp(*match.group(1, 2, 3, 4))
        end = _normalise_timestamp(*match.group(5, 6, 7, 8))
        # match.group(9) is whatever trailed the timings - cue settings, DVD-rip
        # X1/X2 junk. Nothing strips it; it simply is not re-emitted.
        index += 1
        payload: List[str] = []
        while index < total:
            raw = lines[index]
            if not raw.strip():
                index += 1
                break
            if _TIMING_LINE.match(raw):
                break
            payload.append(raw)
            index += 1
        cues.append(_Cue(start, end, payload))
    return cues


def _pre_parse_refusal(text: str) -> Optional[str]:
    """The reasons that are knowable without parsing, each distinct.

    The size is measured on the UTF-8 encoding of the DECODED text, i.e. on what
    would actually be served, not on the source file - the lister already
    refuses an oversized file by its on-disk size, and this is the second line
    of defence on a body that reached here anyway.
    """
    if len(text.encode("utf-8")) > settings.subtitle_max_bytes:
        return "too-large"
    if text == "":
        return "empty"
    if not text.strip():
        return "blank"
    return None


def to_webvtt(text: str, fmt: str) -> ConvertResult:
    """Convert a decoded sidecar body to strict WebVTT, or refuse with a reason.

    Reasons: ``unsupported-format`` (by extension), ``too-large``, ``empty``,
    ``blank``, ``no-cues``. Every one of them is a 415 or a 503 at the route
    rather than a body, because a body is what a `<track>` cannot read.
    """
    if _normalise_format(fmt) not in settings.subtitle_convertible_extensions:
        return ConvertResult(None, 0, "unsupported-format")

    refusal = _pre_parse_refusal(text)
    # An oversized body is not parsed. The refusal still leaves through the one
    # zero-cue exit below, which is what makes "return a bare header instead of
    # refusing" a single-line mutation that reddens every refusal row at once.
    parsed = [] if refusal else _parse_cues(text)

    kept: List[_Cue] = []
    for cue in parsed:
        lines = _render_payload(cue.lines)
        if not lines:
            continue
        if _to_milliseconds(cue.end) <= _to_milliseconds(cue.start):
            continue
        kept.append(_Cue(cue.start, cue.end, lines))

    # THE ONE ZERO-CUE EXIT. Replacing this with a bare `WEBVTT\n\n` body is the
    # most important mutation in the stage: measured, an empty or header-less
    # file fires a real `error` event, while `WEBVTT\n` loads at readyState 2
    # with no cues and NO EVENT AT ALL. Wrapping converts a loud failure into an
    # unobservable one.
    if not kept:
        return ConvertResult(None, 0, refusal or "no-cues")

    blocks = [
        "\n".join(
            [f"{_format_timestamp(cue.start)} --> {_format_timestamp(cue.end)}"]
            + cue.lines
        )
        for cue in kept
    ]
    return ConvertResult("WEBVTT\n\n" + "\n\n".join(blocks) + "\n", len(kept), None)
