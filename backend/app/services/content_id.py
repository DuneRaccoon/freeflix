"""Build a stable watch-identity string for progress / continue-watching."""
from typing import Optional


def build_content_id(media_type: Optional[str], tmdb_id: Optional[int],
                     season: Optional[int], episode: Optional[int]) -> Optional[str]:
    """movie:{id} for movies; tv:{id}:s{n}:e{m} for an episode; None if not identifiable."""
    if not tmdb_id:
        return None
    if media_type == "tv":
        if season is None or episode is None:
            return None
        return f"tv:{tmdb_id}:s{season}:e{episode}"
    return f"movie:{tmdb_id}"
