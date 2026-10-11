"""Pure helpers for parsing release metadata out of a torrent title.

At selection time the release title is all there is. ``normalize_hit``
(``providers/catalog.py:59-70``) keeps seven upstream keys — title, seeds, peers, bytes,
magnetUrl, hash, source — and the upstream ``api=torrents`` response carries no file list,
while libtorrent's file list only exists *after* the torrent has been added, i.e. after the
decision has already been made. So every capability rule in
``services/capability.py`` bottoms out in a regex over a scene name, and the precision of
:func:`parse_release_facts` *is* the accuracy of the capability profile.

Two separate parsers live here on purpose:

* :func:`parse_quality` is the **selector's bucket** and is deliberately frozen. Its
  ``2160p|4k|uhd`` alternative is tried before ``1080p``, so ``...1080p.UHD...`` buckets as
  ``2160p``. That is wrong, and fixing it would move releases between buckets for every
  desktop user (the ``SourcePicker`` pill, the downgrade walk, a cron schedule's
  exact-bucket filter). The misplacement is therefore *contained* rather than fixed:
  capability rules key on :attr:`ReleaseFacts.resolution`, which has its own
  explicit-token precedence. See ``test_quality.py`` for the characterisation test and the
  named follow-up.
* :func:`parse_release_facts` is the capability input, and every field below is shaped by a
  measured defect in the house style rather than by copying it.
"""
import re
from dataclasses import dataclass
from typing import Optional, Dict, Any, Tuple

_QUALITY_PATTERNS = [
    ("2160p", re.compile(r"\b(2160p|4k|uhd)\b", re.IGNORECASE)),
    ("1080p", re.compile(r"\b1080p\b", re.IGNORECASE)),
    ("720p", re.compile(r"\b720p\b", re.IGNORECASE)),
    ("480p", re.compile(r"\b480p\b", re.IGNORECASE)),
]

_CODEC = re.compile(r"\b(x265|h\.?265|hevc|x264|h\.?264|av1|xvid)\b", re.IGNORECASE)
_SOURCE = re.compile(
    r"\b(bluray|blu-ray|bdrip|brrip|web-?dl|webrip|web|hdrip|hdtv|dvdrip|remux|cam)\b",
    re.IGNORECASE,
)
_HDR = re.compile(r"\b(hdr|hdr10|dolby\s*vision|\bdv\b)\b", re.IGNORECASE)


# --------------------------------------------------------------------------------------
# Release facts: the capability profile's only input
# --------------------------------------------------------------------------------------
#
# Why these patterns do not look like the four above. ``\b`` is the wrong boundary for a
# scene name, because a scene name glues a token to a channel count with no separator at
# all. Measured, not assumed:
#
#   ``\bdd\b``  misses ``DD5.1``   but matches ``DD+5.1``  -- so the house style fails in
#                                                             exactly the common case and
#                                                             looks fine in the rare one
#   ``\bddp\b`` misses ``DDP5.1``  (the AMZN/NTb standard)
#   ``\baac\b`` misses ``AAC2.0``
#   ``\bdts\b`` misses ``DTSHD.MA``
#
# So each token pattern takes ``[-. _]?`` separators, a left boundary of
# ``(?<![a-z0-9])`` and a right boundary of ``(?![a-z])`` — digit-tolerant on the right,
# which is the whole point.

# Non-overlapping, most-specific-first. ORDER IS LOAD-BEARING in two different ways:
#
#   1. Two tokens that start at the same character: ``DD+``/``DDP`` must be read as E-AC3
#      before ``DD`` can read its first two characters as AC3, and ``DTS-HD`` before
#      ``DTS`` — exactly as ``web-?dl|webrip|web`` is ordered in ``_SOURCE`` above.
#   2. A token that *contains* another: ``ac3`` matches **inside** ``E-AC3``, because the
#      hyphen supplies its left boundary. ``\b`` does not save you here and neither does
#      the right boundary.
#
# Both are enforced by scanning in list order and refusing to re-read characters a
# more-specific token has already claimed (:func:`_scan_tokens`). A plain
# ``a|b|c`` alternation would *not* enforce (2): Python's engine tries every alternative
# at the leftmost position before advancing, so ``ac3|e-ac3`` and ``e-ac3|ac3`` both
# return ``E-AC3`` and the ordering is untestable. Measured, see
# ``test_release_facts.py``.
#
# ``atmos`` is recorded as a flag beside its carrier and is never a codec of its own: it
# rides on E-AC3 (streaming) or TrueHD (disc), and §3.2 of the TV design spec permits one
# of those at 4K and forbids the other. A rule that vetoed the word ``atmos`` would
# therefore reject a perfectly legal ``DDP5.1.Atmos`` 4K release.
_AUDIO_PATTERNS: Tuple[Tuple[str, Any], ...] = (
    ("eac3", re.compile(r"(?<![a-z0-9])(?:e[-. _]?ac[-. _]?3|ddp|dd[-. _]?plus|dd\+)(?![a-z])", re.IGNORECASE)),
    ("dtshd", re.compile(r"(?<![a-z0-9])dts[-. _]?hd(?:[-. _]?ma)?(?![a-z])", re.IGNORECASE)),
    ("truehd", re.compile(r"(?<![a-z0-9])true[-. _]?hd(?![a-z])", re.IGNORECASE)),
    ("atmos", re.compile(r"(?<![a-z0-9])atmos(?![a-z])", re.IGNORECASE)),
    # Plain DTS also absorbs DTS-X / DTS:X. They are one family for every rule that reads
    # this set (§3.2 lumps DTS, DTS-HD, DTS:X and TrueHD at 2160p), and a separate token
    # with no rule behind it would be a member nothing tests.
    ("dts", re.compile(r"(?<![a-z0-9])dts(?![a-z])", re.IGNORECASE)),
    ("ac3", re.compile(r"(?<![a-z0-9])(?:ac[-. _]?3|dd)(?![a-z])", re.IGNORECASE)),
    ("aac", re.compile(r"(?<![a-z0-9])aac(?![a-z])", re.IGNORECASE)),
    ("flac", re.compile(r"(?<![a-z0-9])flac(?![a-z])", re.IGNORECASE)),
    ("mp3", re.compile(r"(?<![a-z0-9])mp3(?![a-z])", re.IGNORECASE)),
    ("opus", re.compile(r"(?<![a-z0-9])opus(?![a-z])", re.IGNORECASE)),
)

#: Every audio token :func:`parse_release_facts` can emit. Read this rather than
#: hard-coding spellings: ``services/capability.py`` and the corpus in
#: ``tests/data/releases.tsv`` both key on it.
AUDIO_TOKENS = frozenset(token for token, _ in _AUDIO_PATTERNS)

#: Every container :attr:`ReleaseFacts.container_guess` can emit. One member, by design —
#: see :data:`_CONTAINER_PROXY`.
CONTAINER_TOKENS = frozenset({"avi"})

#: Every value :attr:`ReleaseFacts.video_family` can emit, besides ``None``.
VIDEO_FAMILIES = frozenset({"h264", "hevc", "av1", "xvid"})

#: Every value :attr:`ReleaseFacts.dynamic_range` can emit, besides ``None``.
DYNAMIC_RANGES = frozenset({"dv", "hdr10", "hlg"})

#: Every value :attr:`ReleaseFacts.bit_depth` can emit, besides ``None``.
BIT_DEPTHS = frozenset({8, 10, 12})

# First match in list order wins — precedence, not leftmost position. ``avc`` and ``hi10p``
# are here because both parse as ``None`` through ``_CODEC`` today, and an AVC remux is the
# single most *preferable* class in the profile (§7.2): a release the television plays
# best is currently a release it knows nothing about.
_VIDEO_FAMILY_PATTERNS: Tuple[Tuple[str, Any], ...] = (
    ("hevc", re.compile(r"(?<![a-z0-9])(?:x[-. _]?265|h[-. _]?265|hevc)(?![a-z])", re.IGNORECASE)),
    ("av1", re.compile(r"(?<![a-z0-9])av1(?![a-z])", re.IGNORECASE)),
    ("h264", re.compile(r"(?<![a-z0-9])(?:x[-. _]?264|h[-. _]?264|avc1?|hi[-. _]?10[-. _]?p?)(?![a-z])", re.IGNORECASE)),
    ("xvid", re.compile(r"(?<![a-z0-9])(?:xvid|divx)(?![a-z])", re.IGNORECASE)),
)

# 8, 10 and 12 only, and ``(?<!\d)`` on the left: a naive ``(\d+)\s*bit`` reads ``24`` out
# of ``Concert.2020.FLAC.24bit.48kHz`` — a string already in ``test_quality.py``, sitting
# under a comment defending ``parse_quality`` against exactly this family of token.
_BIT_DEPTH = re.compile(r"(?<!\d)(8|10|12)[-. _]?bits?(?![a-z])", re.IGNORECASE)
# Hi10P is H.264 High 10: a bit depth written as a profile name, with no "bit" anywhere.
_HI10 = re.compile(r"(?<![a-z0-9])hi[-. _]?10[-. _]?p?(?![a-z])", re.IGNORECASE)

# Written from scratch rather than split off ``_HDR``, which is lossy rather than absent:
# it *does* match a bare ``DV`` token, and misses exactly ``DoVi``, ``HLG`` and dotted
# ``Dolby.Vision`` (``\s*`` does not match ``.``, and a scene name is dotted).
# ``dv`` is last in its own alternation and keeps a letter-intolerant right boundary, which
# is what stops ``DVDRip`` and ``DVD`` from being read as Dolby Vision.
_DYNAMIC_RANGE_PATTERNS: Tuple[Tuple[str, Any], ...] = (
    ("dv", re.compile(
        r"(?<![a-z0-9])(?:dovi|dolby[-. _]?vision|dv[-. _]?p?8|profile[-. _]?8|dv)(?![a-z])",
        re.IGNORECASE,
    )),
    # ``(?![a-z])`` is what keeps ``HDRip`` — a source, already in ``_SOURCE`` — out of here.
    ("hdr10", re.compile(r"(?<![a-z0-9])hdr(?:10)?(?:\+|plus)?(?![a-z])", re.IGNORECASE)),
    ("hlg", re.compile(r"(?<![a-z0-9])hlg(?![a-z])", re.IGNORECASE)),
)

# A **codec proxy**, not a container read. The real container is not knowable at selection
# time (no file list before the torrent is added, and a season pack's name is a directory
# name), so this fires only on a positively identified XviD/DivX token, which in practice
# means AVI. ``container_guess is None`` therefore means "not known", never "not AVI", and
# every rule that reads it must leave ``None`` free.
#
# ``ts`` is NOT a container token here: ``Movie.2020.TS.XviD-GRP`` is a telesync, and
# reading it as an MPEG-TS container would be a confident wrong answer about the one thing
# this field admits it is guessing at.
_CONTAINER_PROXY = re.compile(r"(?<![a-z0-9])(?:xvid|divx)(?![a-z])", re.IGNORECASE)

# Its own search, never a read of ``parse_release_info()['source']``: ``re.search`` is
# leftmost-match, so ``Movie.2016.2160p.UHD.BluRay.REMUX.HEVC...`` parses
# ``source='BluRay'`` and a remux-by-source test would be quietly false.
_REMUX = re.compile(r"(?<![a-z0-9])remux(?![a-z])", re.IGNORECASE)

# An explicit ``NNNNp`` token wins over the ``4k|uhd`` marketing proxy, which is the one
# behaviour ``_QUALITY_PATTERNS`` gets backwards. ``480i`` is deliberately not a
# resolution: interlaced content is not what the bucket or the profile means.
_RESOLUTION_TOKEN = re.compile(r"(?<!\d)(2160|1080|720|480)p(?![a-z])", re.IGNORECASE)
_RESOLUTION_PROXY = re.compile(r"(?<![a-z0-9])(?:4k|uhd)(?![a-z])", re.IGNORECASE)


@dataclass(frozen=True)
class ReleaseFacts:
    """What a release *name* claims, which is not the same as what the file contains.

    A title names tracks, not the track that will play, and a film's own title is parsed
    as metadata too (``Web.of.Lies.S01...`` already parses ``source='WEB-DL'`` through
    :func:`parse_release_info`). Treat every field as a claim.

    Fields default to "unknown" so a caller can build a partial fixture, and the whole
    thing is frozen and hashable so a profile can cache a verdict against it.
    """

    #: Audio tokens named anywhere in the title — a **set**, because a title routinely
    #: names two tracks (``REMUX.HEVC.DTS-HD.MA.TrueHD.7.1.Atmos``). Members are drawn
    #: from :data:`AUDIO_TOKENS`; ``atmos`` is a flag beside its carrier, not a codec.
    audio: frozenset = frozenset()
    #: ``'h264' | 'hevc' | 'av1' | 'xvid' | None`` — see :data:`VIDEO_FAMILIES`.
    video_family: Optional[str] = None
    #: ``8 | 10 | 12 | None``. Co-required with a video codec token: a bit depth with no
    #: codec beside it is far more likely to be an audio sample depth.
    bit_depth: Optional[int] = None
    #: ``'dv' | 'hdr10' | 'hlg' | None`` — see :data:`DYNAMIC_RANGES`.
    dynamic_range: Optional[str] = None
    #: A codec proxy for the container, never a container read — see
    #: :data:`_CONTAINER_PROXY`. ``None`` means "not known".
    container_guess: Optional[str] = None
    #: Its own token search, not ``source == 'REMUX'`` — see :data:`_REMUX`.
    remux: bool = False
    #: ``2160 | 1080 | 720 | 480 | None``, with explicit-token precedence over ``4k|uhd``.
    resolution: Optional[int] = None
    #: **Always None in stage 8, and deliberately so.** Bytes ÷ runtime is the only
    #: available estimate and no runtime reaches the selector: ``rank_candidates`` takes
    #: ``List[TorrentHit]`` (bytes, no duration), ``CatalogItemCache`` has no runtime
    #: column so the cache-hit path cannot supply one, ``set_detail`` is skipped when
    #: ``with_qualities=False`` (the mode the television's own detail load uses) and
    #: ``services/tv.py`` never calls it at all. On top of that a season pack's bytes
    #: cover N episodes against one episode's runtime, ``bytes == 0`` is a real value, and
    #: minutes-read-as-seconds is a 60x error in the rejecting direction. The field exists
    #: so rule R10 can be real code with a real predicate and an absent input; see the
    #: ``no-input`` row in ``services/capability.py`` and reading 25 in the stage 8
    #: readings sheet. Do not invent one here.
    bitrate_mbps: Optional[float] = None


def _scan_tokens(title: str, patterns: Tuple[Tuple[str, Any], ...]) -> frozenset:
    """Collect every token in ``patterns`` that matches, most-specific-first.

    Characters already read by an earlier (more specific) pattern are not offered to a
    later one, which is what makes ``eac3`` before ``ac3`` mean something: without it,
    ``E-AC3`` yields both.
    """
    found = set()
    claimed = []
    for token, pattern in patterns:
        for match in pattern.finditer(title):
            start, end = match.span()
            if any(start < c_end and c_start < end for c_start, c_end in claimed):
                continue
            claimed.append((start, end))
            found.add(token)
    return frozenset(found)


def _first_match(title: str, patterns: Tuple[Tuple[str, Any], ...]) -> Optional[str]:
    """Return the label of the first pattern in list order that matches, else None."""
    for label, pattern in patterns:
        if pattern.search(title):
            return label
    return None


def parse_release_facts(title: str) -> ReleaseFacts:
    """Parse every capability-relevant claim out of a release title.

    This is the only input the capability profile has. Unknown is always representable
    and must always be free: a title that names no audio, no codec and no container
    parses to an empty audio set and ``None`` everywhere, and no rule may penalise that.
    """
    text = title or ""

    video_family = _first_match(text, _VIDEO_FAMILY_PATTERNS)

    bit_depth = None
    if video_family is not None:
        # Co-required with a codec token, on purpose. ``Movie.2019.1080p.BluRay.10Bit...``
        # names no codec, and reporting 10 there would be a guess dressed as a reading.
        depth = _BIT_DEPTH.search(text)
        if depth:
            bit_depth = int(depth.group(1))
        elif _HI10.search(text):
            bit_depth = 10

    explicit = _RESOLUTION_TOKEN.search(text)
    if explicit:
        resolution = int(explicit.group(1))
    elif _RESOLUTION_PROXY.search(text):
        resolution = 2160
    else:
        resolution = None

    return ReleaseFacts(
        audio=_scan_tokens(text, _AUDIO_PATTERNS),
        video_family=video_family,
        bit_depth=bit_depth,
        dynamic_range=_first_match(text, _DYNAMIC_RANGE_PATTERNS),
        container_guess="avi" if _CONTAINER_PROXY.search(text) else None,
        remux=bool(_REMUX.search(text)),
        resolution=resolution,
        bitrate_mbps=None,
    )


def parse_quality(title: str) -> Optional[str]:
    """Return '2160p'|'1080p'|'720p'|'480p' parsed from the title, else None."""
    for bucket, pattern in _QUALITY_PATTERNS:
        if pattern.search(title or ""):
            return bucket
    return None


def parse_release_info(title: str) -> Dict[str, Any]:
    """Return a dict of best-effort release metadata for display.

    Four keys, unchanged. It has no production callers (``parse_quality`` has exactly one,
    ``providers/catalog.py:69``), so the capability work went into
    :func:`parse_release_facts` beside it rather than into widening this.
    """
    codec = _CODEC.search(title or "")
    source = _SOURCE.search(title or "")
    return {
        "quality": parse_quality(title),
        "codec": codec.group(0).lower() if codec else None,
        "source": _normalize_source(source.group(0)) if source else None,
        "hdr": bool(_HDR.search(title or "")),
    }


def _normalize_source(raw: str) -> str:
    s = raw.lower().replace("-", "")
    mapping = {
        "bluray": "BluRay", "bdrip": "BDRip", "brrip": "BRRip", "hdrip": "HDRip",
        "webdl": "WEB-DL", "web": "WEB-DL", "webrip": "WEBRip", "hdtv": "HDTV",
        "dvdrip": "DVDRip", "remux": "REMUX", "cam": "CAM",
    }
    return mapping.get(s, raw.title())
