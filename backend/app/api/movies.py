from fastapi import APIRouter, HTTPException, Query, Path
from typing import List

from app.models import CatalogPage, MovieDetail, TorrentHit
from app.services import movies as movie_service

router = APIRouter()


@router.get("", response_model=CatalogPage, summary="Browse movies")
async def browse_movies(
    api: str = Query("popular", pattern="^(popular|top_rated)$"),
    sort: str = Query("popularity.desc"),
    genre: int = Query(0, ge=0),
    year: int = Query(0, ge=0),
    page: int = Query(1, ge=1),
):
    return await movie_service.browse(api=api, sort=sort, genre=genre, year=year, page=page)


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
