"""Client + normalizer for the real TMDB API (movie detail-by-id)."""
import httpx
from typing import Optional, Dict, Any, List
from loguru import logger

from app.config import settings
from app.models import MovieDetail, CastMember
from app.providers.catalog import image_url

_BASE = "https://api.themoviedb.org/3"
_CAST_LIMIT = 15


def normalize_movie_detail(raw: Dict[str, Any]) -> MovieDetail:
    date = raw.get("release_date") or ""
    genres: List[str] = [g["name"] for g in raw.get("genres", []) if g.get("name")]
    credits = raw.get("credits") or {}
    director = next(
        (c["name"] for c in credits.get("crew", []) if c.get("job") == "Director"), None)
    cast = [
        CastMember(
            name=c.get("name", ""),
            character=c.get("character"),
            image=image_url(c.get("profile_path"), "w185"),
        )
        for c in credits.get("cast", [])[:_CAST_LIMIT]
    ]
    return MovieDetail(
        tmdb_id=raw["id"],
        title=raw.get("title") or raw.get("name") or "",
        year=int(date[:4]) if date[:4].isdigit() else None,
        overview=raw.get("overview"),
        poster_url=image_url(raw.get("poster_path"), "w500"),
        backdrop_url=image_url(raw.get("backdrop_path"), "w1280"),
        genres=genres,
        vote_average=raw.get("vote_average") or 0.0,
        vote_count=raw.get("vote_count") or 0,
        popularity=raw.get("popularity") or 0.0,
        original_language=raw.get("original_language"),
        runtime=raw.get("runtime"),
        imdb_id=raw.get("imdb_id"),
        tagline=raw.get("tagline"),
        cast=cast,
        director=director,
    )


async def movie_details(tmdb_id: int) -> Optional[MovieDetail]:
    """Fetch full movie detail + credits by TMDB id. None if no key or on error."""
    if not settings.tmdb_api_key:
        logger.warning("TMDB_API_KEY not set; skipping rich movie detail")
        return None
    params = {"api_key": settings.tmdb_api_key, "append_to_response": "credits"}
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(f"{_BASE}/movie/{tmdb_id}", params=params, timeout=15.0)
            resp.raise_for_status()
            return normalize_movie_detail(resp.json())
        except Exception as e:
            logger.error(f"TMDB detail error for id={tmdb_id}: {e}")
            return None
