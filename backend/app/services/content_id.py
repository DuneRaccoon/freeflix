"""Build a stable watch-identity string for progress / continue-watching."""
from typing import Optional

from app.providers.episodes import parse_episode


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


def resolve_content_id(
    *,
    media_type: Optional[str],
    tmdb_id: Optional[int],
    season: Optional[int],
    episode: Optional[int],
    file_name: Optional[str],
    file_index: Optional[int],
    precomputed: Optional[dict],
) -> Optional[str]:
    """Resolve a content_id with a full fallback chain so progress is never orphaned.

    Order:
      1. stored season/episode on the torrent (build_content_id);
      2. precomputed[str(file_index)] season/episode (cached at metadata time);
      3. parse_episode(file_name);
      4. deterministic fallback for unidentifiable TV files: tv:{tmdb_id}:s0:e{file_index}.
    Movies: always build_content_id (returns None only when tmdb_id is missing).
    """
    if not tmdb_id:
        return None

    # Movies never need episode resolution.
    if media_type != "tv":
        return build_content_id(media_type, tmdb_id, None, None)

    # 1) Stored season/episode.
    if season is not None and episode is not None:
        return build_content_id("tv", tmdb_id, season, episode)

    # 2) Precomputed per-file mapping.
    if precomputed and file_index is not None:
        entry = precomputed.get(str(file_index))
        if entry and entry.get("season") is not None and entry.get("episode") is not None:
            return build_content_id("tv", tmdb_id, entry["season"], entry["episode"])

    # 3) Filename parse.
    if file_name:
        parsed = parse_episode(file_name)
        if parsed:
            return build_content_id("tv", tmdb_id, parsed[0], parsed[1])

    # 4) Deterministic fallback so a misnamed file is still keyed (never None).
    if file_index is not None:
        return f"tv:{tmdb_id}:s0:e{file_index}"

    return None
