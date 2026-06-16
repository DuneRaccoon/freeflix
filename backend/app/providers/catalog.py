"""Client + normalizers for the new TMDB-shaped JSON catalog API."""
import httpx
from typing import List, Optional, Dict, Any
from loguru import logger

from app.config import settings
from app.models import CatalogItem, TorrentHit, CatalogPage
from app.providers.quality import parse_quality
from app.utils.user_agent import get_random_user_agent

_IMG_BASE = "https://image.tmdb.org/t/p"

# Combined TMDB movie + TV genre id -> name map (for resolving genre_ids on items).
TMDB_GENRES: Dict[int, str] = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
    99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
    27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance",
    878: "Science Fiction", 10770: "TV Movie", 53: "Thriller", 10752: "War",
    37: "Western", 10759: "Action & Adventure", 10762: "Kids", 10763: "News",
    10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk",
    10768: "War & Politics",
}

def image_url(path: Optional[str], size: str) -> Optional[str]:
    if not path:
        return None
    return f"{_IMG_BASE}/{size}{path}"


def genre_names(ids: List[int]) -> List[str]:
    return [TMDB_GENRES[i] for i in (ids or []) if i in TMDB_GENRES]


def _year_from(raw: Dict[str, Any]) -> Optional[int]:
    date = raw.get("release_date") or raw.get("first_air_date") or ""
    return int(date[:4]) if date[:4].isdigit() else None


def normalize_item(raw: Dict[str, Any]) -> CatalogItem:
    return CatalogItem(
        tmdb_id=raw["id"],
        title=raw.get("title") or raw.get("name") or "",
        year=_year_from(raw),
        overview=raw.get("overview"),
        poster_url=image_url(raw.get("poster_path"), "w500"),
        backdrop_url=image_url(raw.get("backdrop_path"), "w1280"),
        genre_ids=raw.get("genre_ids") or [],
        genres=genre_names(raw.get("genre_ids") or []),
        vote_average=raw.get("vote_average") or 0.0,
        vote_count=raw.get("vote_count") or 0,
        popularity=raw.get("popularity") or 0.0,
        original_language=raw.get("original_language"),
    )


def normalize_hit(raw: Dict[str, Any]) -> TorrentHit:
    title = raw.get("title") or ""
    return TorrentHit(
        title=title,
        seeds=raw.get("seeds") or 0,
        peers=raw.get("peers") or 0,
        bytes=raw.get("bytes") or 0,
        magnet=raw.get("magnetUrl") or "",
        hash=raw.get("hash") or "",
        source=raw.get("source"),
        quality=parse_quality(title),
    )


async def _get(params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    # NOTE: no client-side rate limiting (low-volume personal use). If the upstream
    # starts 429-ing, add an async limiter here rather than a blocking one.
    headers = {"User-Agent": get_random_user_agent()}
    async with httpx.AsyncClient(headers=headers) as client:
        try:
            resp = await client.get(settings.yify_url_browse_url, params=params, timeout=20.0)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.error(f"Catalog API error for params={params}: {e}")
            return None


async def browse(api: str = "popular", sort: str = "popularity.desc",
                 genre: int = 0, year: int = 0, page: int = 1) -> CatalogPage:
    params = {"api": api, "mode": "movie", "page": page, "sort": sort}
    if genre:
        params["genre"] = genre
    if year:
        params["year"] = year
    data = await _get(params) or {}
    return CatalogPage(
        page=data.get("page", page),
        results=[normalize_item(r) for r in data.get("results", []) if r.get("id")],
        total_pages=data.get("total_pages", 0),
        total_results=data.get("total_results", 0),
    )


async def search(q: str, page: int = 1) -> CatalogPage:
    data = await _get({"api": "search", "mode": "movie", "q": q, "page": page}) or {}
    return CatalogPage(
        page=data.get("page", page),
        results=[normalize_item(r) for r in data.get("results", []) if r.get("id")],
        total_pages=data.get("total_pages", 0),
        total_results=data.get("total_results", 0),
    )


async def torrents(name: str) -> List[TorrentHit]:
    data = await _get({"api": "torrents", "name": name}) or {}
    return [normalize_hit(h) for h in data.get("hits", [])]
