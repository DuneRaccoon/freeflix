"""Parse a season/episode number out of a torrent file name."""
import re
from typing import Optional, Tuple

# S01E02 / s1e2 ; then 1x02 style
_SXXEYY = re.compile(r"[Ss](\d{1,2})[\s._-]?[Ee](\d{1,3})")
_XNOTATION = re.compile(r"(?<!\d)(\d{1,2})[xX](\d{1,3})(?!\d)")


def parse_episode(name: str) -> Optional[Tuple[int, int]]:
    """Return (season, episode) parsed from a filename, or None if not found."""
    if not name:
        return None
    m = _SXXEYY.search(name)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = _XNOTATION.search(name)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None
