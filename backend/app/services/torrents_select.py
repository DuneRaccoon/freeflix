"""Rank torrent hits for a requested quality bucket, with swarm-health classification."""
import hashlib
import re
from typing import List, Optional
from app.models import TorrentHit, TorrentCandidate

_ORDER = ["2160p", "1080p", "720p", "480p"]

_BTIH_RE = re.compile(r"btih:([0-9a-zA-Z]+)", re.IGNORECASE)
_EPISODE_RE = re.compile(r"\bS\d{1,2}E\d{1,3}\b", re.IGNORECASE)
_SEASON_RE = re.compile(r"\b(S\d{1,2}\b|Season\s*\d{1,3}|Complete)\b", re.IGNORECASE)


def _source_id(hit: TorrentHit) -> str:
    """Stable id for a hit: infohash if known, else a sha1 of the magnet."""
    if hit.hash:
        return hit.hash.lower()
    m = _BTIH_RE.search(hit.magnet or "")
    if m:
        return m.group(1).lower()
    return hashlib.sha1((hit.magnet or "").encode()).hexdigest()


def _is_season_pack(title: str) -> bool:
    """True when the title looks like a season pack / complete set (no single SxxExx)."""
    t = title or ""
    if _EPISODE_RE.search(t):
        return False
    return bool(_SEASON_RE.search(t))


def classify_health(seeds: int, *, min_seeds: int, healthy_seeds: int) -> str:
    """Map a seeder count to "dead" | "low" | "healthy" against config thresholds."""
    if seeds < min_seeds:
        return "dead"
    if seeds < healthy_seeds:
        return "low"
    return "healthy"


def select_best(hits: List[TorrentHit], quality: str) -> Optional[TorrentHit]:
    """Highest-seeded hit whose parsed quality == `quality` (ties -> larger bytes)."""
    matching = [h for h in hits if h.quality == quality]
    if not matching:
        return None
    return max(matching, key=lambda h: (h.seeds, h.bytes))


def available_qualities(hits: List[TorrentHit]) -> List[str]:
    """Distinct buckets present among hits, ordered 2160p -> 480p."""
    present = {h.quality for h in hits if h.quality}
    return [q for q in _ORDER if q in present]
