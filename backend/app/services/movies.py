"""Movie orchestration: catalog browse/search + TMDB-enriched detail, with caching."""
from typing import Optional
from loguru import logger

from app.models import CatalogPage, MovieDetail, CatalogItem, TorrentCandidate
from app.providers import catalog, tmdb
from app.services.torrents_select import available_qualities, rank_candidates
from app.config import settings
from app.database.session import get_db
from app.database.models.catalog import CatalogItemCache


def _cache_page(page: CatalogPage) -> None:
    """Upsert every item from a browse/search page into the cache."""
    try:
        with get_db() as db:
            for item in page.results:
                CatalogItemCache.upsert_list_item(
                    db, tmdb_id=item.tmdb_id, media_type="movie",
                    title=item.title, year=item.year, overview=item.overview,
                    poster_url=item.poster_url, backdrop_url=item.backdrop_url,
                    genre_ids=item.genre_ids, genres=item.genres,
                    vote_average=item.vote_average, vote_count=item.vote_count,
                    popularity=item.popularity, original_language=item.original_language,
                )
    except Exception as e:
        logger.error(f"Failed to cache catalog page: {e}")


async def browse(api: str, sort: str, page: int, *, genres=None, year=0, provider=None,
                 origin=None, company=None, collection=None, lang=None) -> CatalogPage:
    result = await catalog.browse(
        api=api, sort=sort, page=page, mode="movie", genres=genres, year=year,
        provider=provider, origin=origin, company=company, collection=collection, lang=lang,
    )
    _cache_page(result)
    return result


async def search(q: str, page: int) -> CatalogPage:
    result = await catalog.search(q=q, page=page)
    _cache_page(result)
    return result


def _cached_item(tmdb_id: int) -> Optional[CatalogItem]:
    with get_db() as db:
        row = CatalogItemCache.get_one(db, "movie", tmdb_id)
        if not row:
            return None
        return CatalogItem(
            tmdb_id=row.tmdb_id, title=row.title, year=row.year, overview=row.overview,
            poster_url=row.poster_url, backdrop_url=row.backdrop_url,
            genre_ids=row.genre_ids or [], genres=row.genres or [],
            vote_average=row.vote_average or 0.0, vote_count=row.vote_count or 0,
            popularity=row.popularity or 0.0, original_language=row.original_language,
        )


async def detail(tmdb_id: int) -> Optional[MovieDetail]:
    """Rich detail via TMDB-by-id, falling back to the cached list item."""
    enriched = await tmdb.movie_details(tmdb_id)
    base = enriched
    if base is None:
        cached = _cached_item(tmdb_id)
        if cached is None:
            return None
        base = MovieDetail(**cached.model_dump())

    name = f"{base.title} {base.year}".strip() if base.year else base.title
    hits = await catalog.torrents(name)
    base.available_qualities = available_qualities(hits)

    # Upsert the base item first so even a never-browsed id (e.g. a direct deep
    # link enriched via TMDB) gets cached, avoiding a re-fetch on the next load.
    try:
        with get_db() as db:
            row = CatalogItemCache.upsert_list_item(
                db, tmdb_id=base.tmdb_id, media_type="movie",
                title=base.title, year=base.year, overview=base.overview,
                poster_url=base.poster_url, backdrop_url=base.backdrop_url,
                genre_ids=base.genre_ids, genres=base.genres,
                vote_average=base.vote_average, vote_count=base.vote_count,
                popularity=base.popularity, original_language=base.original_language,
            )
            row.set_detail(db, base.model_dump())
            row.set_torrents(db, [h.model_dump() for h in hits])
    except Exception as e:
        logger.error(f"Failed to persist movie detail {tmdb_id}: {e}")
    return base


async def get_torrents(tmdb_id: int):
    """Return parsed torrent hits for a movie (by cached title/year or TMDB fallback)."""
    title, year = await resolve_title_year(tmdb_id)
    if not title:
        return []
    name = f"{title} {year}".strip() if year else title
    return await catalog.torrents(name)


async def get_candidates(tmdb_id: int, quality: str):
    """Ranked, health-classified TorrentCandidates for a movie at the requested quality."""
    hits = await get_torrents(tmdb_id)
    return rank_candidates(
        hits, quality,
        min_seeds=settings.min_seeds, healthy_seeds=settings.healthy_seeds,
    )


async def resolve_title_year(tmdb_id: int):
    cached = _cached_item(tmdb_id)
    if cached:
        return cached.title, cached.year
    enriched = await tmdb.movie_details(tmdb_id)
    if enriched:
        return enriched.title, enriched.year
    return None, None
