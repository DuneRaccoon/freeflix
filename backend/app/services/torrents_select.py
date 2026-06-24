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


def _effective_bytes(byts: int) -> int:
    """Sort key for the bytes tiebreak: a 0-byte release must not outrank a real one."""
    return byts if byts > 0 else -1


def _to_candidate(hit: TorrentHit, health: str) -> TorrentCandidate:
    return TorrentCandidate(
        source_id=_source_id(hit),
        magnet=hit.magnet,
        quality=hit.quality or "",
        seeds=hit.seeds,
        peers=hit.peers,
        bytes=hit.bytes,
        health=health,
        is_season_pack=_is_season_pack(hit.title),
        release_title=hit.title,
    )


def rank_candidates(
    hits: List[TorrentHit], quality: str, *, min_seeds: int, healthy_seeds: int
) -> List[TorrentCandidate]:
    """Ordered candidate list: exact-quality healthy first (seeds desc, bytes desc),
    then a downgrade walk down _ORDER appending healthy lower-quality releases, then
    low-health (same order), then dead last (kept only so a caller always has options).
    bytes==0 never outranks a real release at equal seeds."""
    # Quality buckets, exact-first then the downgrade walk (2160p->480p excluding exact).
    bucket_order: List[str] = []
    if quality:
        bucket_order.append(quality)
    bucket_order += [q for q in _ORDER if q != quality]
    bucket_order.append("")  # releases whose quality didn't parse

    def _bucket_index(q: str) -> int:
        try:
            return bucket_order.index(q)
        except ValueError:
            return len(bucket_order)

    health_rank = {"healthy": 0, "low": 1, "dead": 2}

    scored = []
    for h in hits:
        health = classify_health(h.seeds, min_seeds=min_seeds, healthy_seeds=healthy_seeds)
        scored.append((h, health))

    # Sort key: health tier, then bucket position, then seeds desc, then effective bytes desc.
    scored.sort(
        key=lambda hh: (
            health_rank[hh[1]],
            _bucket_index(hh[0].quality or ""),
            -hh[0].seeds,
            -_effective_bytes(hh[0].bytes),
        )
    )
    return [_to_candidate(h, health) for (h, health) in scored]


def select_best(hits: List[TorrentHit], quality: str) -> Optional[TorrentHit]:
    """Highest-seeded EXACT-quality hit (ties -> larger bytes, 0-byte never wins).

    Thin shim over rank_candidates so the bytes tiebreak is shared; returns the
    original TorrentHit (unchanged return type) for existing callers (cron/jobs.py).
    """
    from app.config import settings

    matching = [h for h in hits if h.quality == quality]
    if not matching:
        return None
    ranked = rank_candidates(
        matching, quality,
        min_seeds=settings.min_seeds, healthy_seeds=settings.healthy_seeds,
    )
    top_id = ranked[0].source_id
    by_id = {_source_id(h): h for h in matching}
    return by_id.get(top_id, matching[0])


def available_qualities(hits: List[TorrentHit]) -> List[str]:
    """Distinct buckets present among hits, ordered 2160p -> 480p."""
    present = {h.quality for h in hits if h.quality}
    return [q for q in _ORDER if q in present]
