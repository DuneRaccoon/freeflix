from fastapi import APIRouter, HTTPException, Query, Body, Path, BackgroundTasks, Depends
from typing import List, Optional, Dict, Any
from pathlib import Path as PathLib
from sqlalchemy.orm import Session

import uuid as _uuid
from dataclasses import dataclass
from typing import Optional as _Optional, Tuple as _Tuple

from app.models import TorrentRequest, TorrentStatus, TorrentAction
from app.services import movies as movie_service
from app.services.torrents_select import select_best, available_qualities
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
        title, year = await movie_service._resolve_title_year(request.tmdb_id)
        if not title:
            raise HTTPException(status_code=404, detail="Movie not found")

        name = f"{title} {year}".strip() if year else title
        hits = await catalog.torrents(name)
        best = select_best(hits, request.quality)
        if best is None:
            avail = available_qualities(hits)
            raise HTTPException(
                status_code=422,
                detail=f"No {request.quality} release found. Available: {avail or 'none'}",
            )

        dl_movie = _DlMovie(title=title, year=year, genre="")
        dl_torrent = _DlTorrent(
            id=str(_uuid.uuid4()),
            quality=request.quality,
            magnet=best.magnet,
            url=best.magnet,
            sizes=(_human_size(best.bytes), ""),
        )
        save_path = PathLib(request.save_path) if request.save_path else None
        torrent_id = await torrent_manager.add_torrent(dl_movie, dl_torrent, save_path)

        status = torrent_manager.get_torrent_status(torrent_id)
        if not status:
            raise HTTPException(status_code=500, detail="Failed to get torrent status")
        return status
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
    """
    Perform an action on a torrent.
    
    - **action**: The action to perform (pause, resume, stop, remove)
    """
    if action.action == "pause":
        success = torrent_manager.pause_torrent(torrent_id)
    elif action.action == "resume":
        success = torrent_manager.resume_torrent(torrent_id)
    elif action.action == "stop":
        success = torrent_manager.stop_torrent(torrent_id)
    elif action.action == "remove":
        success = torrent_manager.remove_torrent(torrent_id)
    else:
        raise HTTPException(status_code=400, detail=f"Invalid action: {action.action}")
    
    if not success:
        raise HTTPException(status_code=404, detail="Torrent not found or action failed")
    
    return {"success": True, "action": action.action, "torrent_id": torrent_id}


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