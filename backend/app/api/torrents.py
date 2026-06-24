from fastapi import APIRouter, HTTPException, Query, Body, Path, BackgroundTasks, Depends
from typing import List, Optional, Dict, Any
from pathlib import Path as PathLib
from sqlalchemy.orm import Session

import uuid as _uuid
from dataclasses import dataclass
from typing import Optional as _Optional, Tuple as _Tuple

from app.models import (
    TorrentRequest, TorrentStatus, TorrentAction,
    TorrentBatchAction, TorrentBatchResponse, TorrentBatchResult,
    TorrentCandidate,
)
from app.torrent.states import ACTIVE_DOWNLOAD_STATES, RESUMABLE_STATES
from app.services import movies as movie_service
from app.services import tv as tv_service
from app.services.torrents_select import select_best, available_qualities, rank_candidates
from app.providers import catalog
from app.torrent.manager import torrent_manager
from app.config import settings
from app.database.session import get_db


def _human_size(num: int) -> str:
    size = float(num or 0)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024 or unit == "TB":
            return f"{size:.1f} {unit}"
        size /= 1024


@dataclass
class _DlMovie:
    title: str
    year: _Optional[int]
    genre: str
    tmdb_id: _Optional[int] = None
    media_type: str = "movie"
    season: _Optional[int] = None
    episode: _Optional[int] = None


@dataclass
class _DlTorrent:
    id: str
    quality: str
    magnet: str
    url: str
    sizes: _Tuple[str, str]

router = APIRouter()


@router.post("/download", response_model=TorrentStatus, summary="Download a movie")
async def download_movie(request: TorrentRequest, background_tasks: BackgroundTasks):
    """Start downloading a movie by TMDB id at the requested quality bucket."""
    try:
        if request.media_type == "tv":
            if request.season is None:
                raise HTTPException(status_code=422, detail="season is required for TV downloads")
            show = await tv_service.resolve_show_name(request.tmdb_id)
            if not show:
                raise HTTPException(status_code=404, detail="Show not found")
            if request.episode is not None:
                name = f"{show} S{request.season:02d}E{request.episode:02d}"
            else:
                name = f"{show} S{request.season:02d}"
            label, year = name, None
        else:
            title, year = await movie_service.resolve_title_year(request.tmdb_id)
            if not title:
                raise HTTPException(status_code=404, detail="Movie not found")
            name = f"{title} {year}".strip() if year else title
            label = title

        chosen_magnet: str
        chosen_quality: str
        chosen_bytes: int = 0

        if request.magnet:
            # Explicit magnet from the picker: use verbatim, trust the requested bucket.
            chosen_magnet = request.magnet
            chosen_quality = request.quality
        else:
            hits = await catalog.torrents(name)
            candidates = rank_candidates(
                hits, request.quality,
                min_seeds=settings.min_seeds, healthy_seeds=settings.healthy_seeds,
            )
            if not candidates:
                raise HTTPException(status_code=404, detail="No torrents found")
            chosen = None
            if request.source_id:
                chosen = next(
                    (c for c in candidates if c.source_id == request.source_id), None
                )
            if chosen is None:
                # No explicit pick (or it was stale) -> ranked top pick (best healthy
                # downgrade). No hard 422: the user always gets the best available.
                chosen = candidates[0]
            chosen_magnet = chosen.magnet
            chosen_quality = chosen.quality or request.quality
            chosen_bytes = chosen.bytes

        dl_movie = _DlMovie(
            title=label, year=year, genre="",
            tmdb_id=request.tmdb_id, media_type=request.media_type,
            season=request.season, episode=request.episode,
        )
        dl_torrent = _DlTorrent(
            id=str(_uuid.uuid4()),
            quality=chosen_quality,
            magnet=chosen_magnet,
            url=chosen_magnet,
            sizes=(_human_size(chosen_bytes), ""),
        )
        save_path = PathLib(request.save_path) if request.save_path else None
        torrent_id = await torrent_manager.add_torrent(dl_movie, dl_torrent, save_path)

        status = torrent_manager.get_torrent_status(torrent_id)
        if not status:
            raise HTTPException(status_code=500, detail="Failed to get torrent status")
        status.chosen_quality = chosen_quality
        return status
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sources", response_model=List[TorrentCandidate], summary="Ranked torrent sources")
async def get_sources(
    tmdb_id: int = Query(..., description="TMDB id of the title"),
    quality: str = Query("1080p", description="Preferred quality bucket"),
    media_type: str = Query("movie", description="'movie' or 'tv'"),
    season: Optional[int] = Query(None, ge=0),
    episode: Optional[int] = Query(None, ge=1),
):
    """Ranked, health-classified candidate sources for a title (consumed by the picker)."""
    try:
        if media_type == "tv":
            if season is None:
                raise HTTPException(status_code=422, detail="season is required for TV sources")
            if episode is not None:
                return await tv_service.episode_candidates(tmdb_id, season, episode, quality)
            return await tv_service.season_candidates(tmdb_id, season, quality)
        return await movie_service.get_candidates(tmdb_id, quality)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status/{torrent_id}", response_model=TorrentStatus, summary="Get torrent status")
async def get_torrent_status(torrent_id: str = Path(..., description="ID of the torrent")):
    """
    Get the current status of a torrent download.
    """
    status = torrent_manager.get_torrent_status(torrent_id)
    if not status:
        raise HTTPException(status_code=404, detail="Torrent not found")
    
    return status


@router.get("/list", response_model=List[TorrentStatus], summary="List all torrents")
async def list_torrents(
    state: Optional[str] = Query(None, description="Filter by state (e.g., downloading, paused)")
):
    """
    List all torrent downloads with optional filtering by state.
    """
    all_torrents = torrent_manager.get_all_torrents()
    
    if state:
        filtered_torrents = [t for t in all_torrents if t.state == state]
        return filtered_torrents
    
    return all_torrents


@router.post("/action/{torrent_id}", response_model=Dict[str, Any], summary="Perform action on torrent")
async def torrent_action(
    action: TorrentAction,
    torrent_id: str = Path(..., description="ID of the torrent")
):
    """Pause or resume a torrent. ('stop' is a legacy alias of pause; use DELETE to remove.)"""
    if action.action in ("pause", "stop"):
        success = torrent_manager.pause_torrent(torrent_id)
    elif action.action == "resume":
        success = torrent_manager.resume_torrent(torrent_id)
    else:  # pragma: no cover - guarded by the Literal
        raise HTTPException(status_code=400, detail=f"Unsupported action '{action.action}'")

    if not success:
        raise HTTPException(status_code=404, detail="Torrent not found or action failed")

    return {"success": True, "action": action.action, "torrent_id": torrent_id}


@router.post("/batch", response_model=TorrentBatchResponse, summary="Batch torrent action")
async def batch_action(payload: TorrentBatchAction):
    """Apply an action to every torrent matching the action's target set."""
    all_t = torrent_manager.get_all_torrents()
    results: List[TorrentBatchResult] = []

    def _run(ids, fn):
        for tid in ids:
            results.append(TorrentBatchResult(id=tid, success=bool(fn(tid))))

    if payload.action == "pause":
        _run([t.id for t in all_t if t.state.value in ACTIVE_DOWNLOAD_STATES],
             torrent_manager.pause_torrent)
    elif payload.action == "resume":
        _run([t.id for t in all_t if t.state.value in RESUMABLE_STATES],
             torrent_manager.resume_torrent)
    elif payload.action == "clear_completed":
        _run([t.id for t in all_t if t.state.value in ("finished", "seeding")],
             lambda tid: torrent_manager.remove_torrent(tid, delete_files=False))
    elif payload.action == "retry":
        _run([t.id for t in all_t if t.state.value == "error"],
             torrent_manager.resume_torrent)

    succeeded = sum(1 for r in results if r.success)
    return TorrentBatchResponse(
        action=payload.action, succeeded=succeeded,
        failed=len(results) - succeeded, results=results,
    )


@router.delete("/{torrent_id}", response_model=Dict[str, Any], summary="Delete a torrent")
async def delete_torrent(
    torrent_id: str = Path(..., description="ID of the torrent"),
    delete_files: bool = Query(False, description="Whether to delete downloaded files")
):
    """
    Delete a torrent and optionally delete downloaded files.
    """
    success = torrent_manager.remove_torrent(torrent_id, delete_files)
    
    if not success:
        raise HTTPException(status_code=404, detail="Torrent not found or deletion failed")
    
    return {"success": True, "torrent_id": torrent_id, "files_deleted": delete_files}