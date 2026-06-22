from fastapi import APIRouter, HTTPException, Query, Path
from typing import List, Optional

from app.models import CatalogPage, ShowDetail, SeasonDetail, TorrentHit
from app.services import tv as tv_service

router = APIRouter()

_API_PATTERN = r"^(popular|top_rated|on_the_air|airing_today|discover|best_(2020|2021|2022|2023|2024|2025))$"


@router.get("", response_model=CatalogPage, summary="Browse TV shows")
async def browse_tv(
    api: str = Query("popular", pattern=_API_PATTERN),
    sort: str = Query("popularity.desc"),
    genre: int = Query(0, ge=0),              # legacy alias -> genres
    genres: Optional[str] = Query(None),
    year: int = Query(0, ge=0),
    provider: Optional[str] = Query(None),
    origin: Optional[str] = Query(None),
    lang: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
):
    if not genres and genre:
        genres = str(genre)
    return await tv_service.browse(
        api=api, sort=sort, page=page, genres=genres, year=year,
        provider=provider, origin=origin, lang=lang,
    )


@router.get("/search", response_model=CatalogPage, summary="Search TV shows")
async def search_tv(q: str = Query(..., min_length=1), page: int = Query(1, ge=1)):
    return await tv_service.search(q=q, page=page)


@router.get("/{tmdb_id}", response_model=ShowDetail, summary="Show detail")
async def show_detail(tmdb_id: int = Path(..., ge=1)):
    show = await tv_service.show_detail(tmdb_id)
    if show is None:
        raise HTTPException(status_code=404, detail="Show not found")
    return show


@router.get("/{tmdb_id}/season/{season}", response_model=SeasonDetail, summary="Season episodes")
async def season_detail(tmdb_id: int = Path(..., ge=1), season: int = Path(..., ge=0)):
    s = await tv_service.season_detail(tmdb_id, season)
    if s is None:
        raise HTTPException(status_code=404, detail="Season not found")
    return s


@router.get("/{tmdb_id}/season/{season}/episode/{episode}/torrents",
            response_model=List[TorrentHit], summary="Episode torrents")
async def episode_torrents(tmdb_id: int = Path(..., ge=1), season: int = Path(..., ge=0),
                           episode: int = Path(..., ge=1)):
    return await tv_service.episode_torrents(tmdb_id, season, episode)


@router.get("/{tmdb_id}/season/{season}/torrents",
            response_model=List[TorrentHit], summary="Season-pack torrents")
async def season_torrents(tmdb_id: int = Path(..., ge=1), season: int = Path(..., ge=0)):
    return await tv_service.season_torrents(tmdb_id, season)
