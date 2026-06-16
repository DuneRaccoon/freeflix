"""Choose the best torrent hit for a requested quality bucket."""
from typing import List, Optional
from app.models import TorrentHit

_ORDER = ["2160p", "1080p", "720p", "480p"]


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
