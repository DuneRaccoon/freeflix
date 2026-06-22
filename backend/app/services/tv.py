"""TV orchestration: browse/search + show/season detail, with show caching."""
from typing import Optional
from loguru import logger

from app.models import CatalogPage, ShowDetail, SeasonDetail
from app.providers import catalog
from app.database.session import get_db
from app.database.models.catalog import CatalogItemCache


def _cache_page(page: CatalogPage) -> None:
    try:
        with get_db() as db:
            for item in page.results:
                CatalogItemCache.upsert_list_item(
                    db, tmdb_id=item.tmdb_id, media_type="tv",
                    title=item.title, year=item.year, overview=item.overview,
                    poster_url=item.poster_url, backdrop_url=item.backdrop_url,
                    genre_ids=item.genre_ids, genres=item.genres,
                    vote_average=item.vote_average, vote_count=item.vote_count,
                    popularity=item.popularity, original_language=item.original_language,
                )
    except Exception as e:
        logger.error(f"Failed to cache tv page: {e}")


async def browse(api: str, sort: str, page: int, *, genres=None, year=0, provider=None,
                 origin=None, lang=None) -> CatalogPage:
    result = await catalog.browse(
        api=api, sort=sort, page=page, mode="tv", genres=genres, year=year,
        provider=provider, origin=origin, lang=lang,
    )
    _cache_page(result)
    return result


async def search(q: str, page: int) -> CatalogPage:
    result = await catalog.search(q=q, page=page, mode="tv")
    _cache_page(result)
    return result


async def show_detail(tmdb_id: int) -> Optional[ShowDetail]:
    raw = await catalog.tv_details(tmdb_id)
    if not raw or not raw.get("id"):
        return None
    show = catalog.normalize_show(raw)
    try:
        with get_db() as db:
            CatalogItemCache.upsert_list_item(
                db, tmdb_id=show.tmdb_id, media_type="tv",
                title=show.name, year=show.year, overview=show.overview,
                poster_url=show.poster_url, backdrop_url=show.backdrop_url,
                genre_ids=[], genres=show.genres, vote_average=show.vote_average,
                vote_count=show.vote_count, popularity=0.0, original_language=None,
            )
    except Exception as e:
        logger.error(f"Failed to cache show {tmdb_id}: {e}")
    return show


async def season_detail(tmdb_id: int, season: int) -> Optional[SeasonDetail]:
    raw = await catalog.season_details(tmdb_id, season)
    if not raw or "episodes" not in raw:
        return None
    return catalog.normalize_season(raw)


async def resolve_show_name(tmdb_id: int) -> Optional[str]:
    with get_db() as db:
        row = CatalogItemCache.get_one(db, "tv", tmdb_id)
        if row:
            return row.title
    raw = await catalog.tv_details(tmdb_id)
    if raw and raw.get("name"):
        return raw["name"]
    return None


async def episode_torrents(tmdb_id: int, season: int, episode: int):
    show = await resolve_show_name(tmdb_id)
    if not show:
        return []
    return await catalog.torrents(f"{show} S{season:02d}E{episode:02d}")


async def season_torrents(tmdb_id: int, season: int):
    show = await resolve_show_name(tmdb_id)
    if not show:
        return []
    return await catalog.torrents(f"{show} S{season:02d}")
