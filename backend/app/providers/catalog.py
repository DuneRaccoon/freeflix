"""Client + normalizers for the new TMDB-shaped JSON catalog API."""
import httpx
from typing import List, Optional, Dict, Any
from loguru import logger

from app.config import settings
from app.models import (
    CatalogItem, TorrentHit, CatalogPage, ShowDetail, SeasonSummary, SeasonDetail, Episode,
)
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


def normalize_item(raw: Dict[str, Any], media_type: str = "movie") -> CatalogItem:
    return CatalogItem(
        tmdb_id=raw["id"],
        media_type="tv" if media_type == "tv" else "movie",
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


def _merge_genre(existing: Optional[str], genre_id: int) -> str:
    """Append genre_id to a comma-separated genres string, de-duplicated, order-preserving."""
    ids = [p for p in (existing or "").split(",") if p.strip()]
    gid = str(genre_id)
    if gid not in ids:
        ids.append(gid)
    return ",".join(ids)


async def browse(api: str = "popular", sort: str = "popularity.desc", page: int = 1,
                 mode: str = "movie", *, genres: Optional[str] = None, year: int = 0,
                 provider: Optional[str] = None, origin: Optional[str] = None,
                 company: Optional[str] = None, collection: Optional[str] = None,
                 lang: Optional[str] = None) -> CatalogPage:
    params: Dict[str, Any] = {"mode": mode, "page": page, "sort": sort}
    disc: Dict[str, Any] = {}
    eff_genres, eff_lang = genres, lang
    if origin == "anime":                       # anime = genres:16 + lang:ja, not an origin
        eff_genres = _merge_genre(eff_genres, 16)
        eff_lang = eff_lang or "ja"
    elif origin:
        disc["origin"] = origin
    if eff_genres:
        disc["genres"] = eff_genres
    if eff_lang:
        disc["lang"] = eff_lang
    if provider:
        disc["network" if mode == "tv" else "provider"] = provider
    if company:
        disc["company"] = company
    if collection:
        disc["id"] = collection
    if year:
        disc["year"] = year
    if disc:
        # Collection (franchise) lookups use the dedicated `api=collection` mode;
        # every other filter uses `api=discover`. Both carry the genre=0/year=0
        # placeholders that mirror the proven-working URL shape.
        params.update({"api": "collection" if collection else "discover", "genre": 0, "year": 0})
        params.update(disc)                                        # real values win over placeholders
    else:
        params["api"] = api
    data = await _get(params) or {}
    return CatalogPage(
        page=data.get("page", page),
        results=[normalize_item(r, media_type=mode) for r in data.get("results", []) if r.get("id")],
        total_pages=data.get("total_pages", 0),
        total_results=data.get("total_results", 0),
    )


async def search(q: str, page: int = 1, mode: str = "movie") -> CatalogPage:
    data = await _get({"api": "search", "mode": mode, "q": q, "page": page}) or {}
    return CatalogPage(
        page=data.get("page", page),
        results=[normalize_item(r, media_type=mode) for r in data.get("results", []) if r.get("id")],
        total_pages=data.get("total_pages", 0),
        total_results=data.get("total_results", 0),
    )


async def torrents(name: str) -> List[TorrentHit]:
    data = await _get({"api": "torrents", "name": name}) or {}
    return [normalize_hit(h) for h in data.get("hits", [])]


async def tv_details(tmdb_id: int) -> Optional[Dict[str, Any]]:
    return await _get({"api": "tv_details", "mode": "tv", "id": tmdb_id})


async def season_details(tmdb_id: int, season: int) -> Optional[Dict[str, Any]]:
    return await _get({"api": "season_details", "mode": "tv", "id": tmdb_id, "season": season})


def normalize_season_summary(s: Dict[str, Any]) -> SeasonSummary:
    return SeasonSummary(
        season_number=s.get("season_number", 0),
        name=s.get("name") or "",
        episode_count=s.get("episode_count") or 0,
        overview=s.get("overview"),
        poster_url=image_url(s.get("poster_path"), "w300"),
        air_date=s.get("air_date"),
    )


def normalize_show(raw: Dict[str, Any]) -> ShowDetail:
    genres = [g["name"] for g in raw.get("genres", []) if g.get("name")] or genre_names(raw.get("genre_ids") or [])
    return ShowDetail(
        tmdb_id=raw["id"],
        name=raw.get("name") or raw.get("title") or "",
        year=_year_from(raw),
        overview=raw.get("overview"),
        poster_url=image_url(raw.get("poster_path"), "w500"),
        backdrop_url=image_url(raw.get("backdrop_path"), "w1280"),
        genres=genres,
        status=raw.get("status"),
        first_air_date=raw.get("first_air_date"),
        last_air_date=raw.get("last_air_date"),
        number_of_seasons=raw.get("number_of_seasons") or 0,
        vote_average=raw.get("vote_average") or 0.0,
        vote_count=raw.get("vote_count") or 0,
        seasons=[normalize_season_summary(s) for s in raw.get("seasons", [])],
    )


def normalize_episode(e: Dict[str, Any]) -> Episode:
    return Episode(
        episode_number=e.get("episode_number", 0),
        name=e.get("name") or "",
        overview=e.get("overview"),
        runtime=e.get("runtime"),
        still_url=image_url(e.get("still_path"), "w300"),
        air_date=e.get("air_date"),
        vote_average=e.get("vote_average") or 0.0,
    )


def normalize_season(raw: Dict[str, Any]) -> SeasonDetail:
    return SeasonDetail(
        season_number=raw.get("season_number", 0),
        name=raw.get("name") or "",
        overview=raw.get("overview"),
        episodes=[normalize_episode(e) for e in raw.get("episodes", [])],
    )
