"""Pure helpers for parsing release metadata out of a torrent title."""
import re
from typing import Optional, Dict, Any

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


def parse_quality(title: str) -> Optional[str]:
    """Return '2160p'|'1080p'|'720p'|'480p' parsed from the title, else None."""
    for bucket, pattern in _QUALITY_PATTERNS:
        if pattern.search(title or ""):
            return bucket
    return None


def parse_release_info(title: str) -> Dict[str, Any]:
    """Return a dict of best-effort release metadata for display."""
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
