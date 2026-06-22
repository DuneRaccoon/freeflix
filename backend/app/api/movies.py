from fastapi import APIRouter, HTTPException, Query, Path
from typing import List, Optional

from app.models import CatalogPage, MovieDetail, TorrentHit
from app.services import movies as movie_service

router = APIRouter()

_API_PATTERN = r"^(popular|top_rated|now_playing|upcoming|discover|best_(2020|2021|2022|2023|2024|2025))$"


@router.get("", response_model=CatalogPage, summary="Browse movies")
async def browse_movies(
    api: str = Query("popular", pattern=_API_PATTERN),
    sort: str = Query("popularity.desc"),
    genre: int = Query(0, ge=0),              # legacy alias -> genres
    genres: Optional[str] = Query(None),
    year: int = Query(0, ge=0),
    provider: Optional[str] = Query(None),
    origin: Optional[str] = Query(None),
    company: Optional[str] = Query(None),
    collection: Optional[str] = Query(None),
    lang: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
):
    if not genres and genre:
        genres = str(genre)
    return await movie_service.browse(
        api=api, sort=sort, page=page, genres=genres, year=year,
        provider=provider, origin=origin, company=company, collection=collection, lang=lang,
    )


@router.get("/search", response_model=CatalogPage, summary="Search movies")
async def search_movies(q: str = Query(..., min_length=1), page: int = Query(1, ge=1)):
    return await movie_service.search(q=q, page=page)


@router.get("/{tmdb_id}", response_model=MovieDetail, summary="Movie detail")
async def movie_detail(tmdb_id: int = Path(..., ge=1)):
    detail = await movie_service.detail(tmdb_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Movie not found")
    return detail


@router.get("/{tmdb_id}/torrents", response_model=List[TorrentHit], summary="Movie torrents")
async def movie_torrents(tmdb_id: int = Path(..., ge=1)):
    return await movie_service.get_torrents(tmdb_id)
