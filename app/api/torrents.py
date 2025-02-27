from fastapi import APIRouter, HTTPException, Query, Body, Path, BackgroundTasks
from typing import List, Optional, Dict, Any
from pathlib import Path as PathLib

from app.models import TorrentRequest, TorrentStatus, TorrentAction
from app.scrapers.yts import search_movie, get_movie_by_url
from app.torrent.manager import torrent_manager
from app.config import settings

router = APIRouter()


@router.post("/download/movie", response_model=TorrentStatus, summary="Download a movie")
async def download_movie(request: TorrentRequest, background_tasks: BackgroundTasks):
    """
    Start downloading a movie.
    
    - **movie_id**: URL or ID of the movie
    - **quality**: Desired quality (720p, 1080p, 2160p)
    - **save_path**: Optional custom save path
    
    ###Download a Movie
    ```bash
    curl -X POST "http://localhost:8000/api/v1/torrents/download/movie" \
     -H "Content-Type: application/json" \
     -d '{"movie_id": "https://en.yts-official.mx/movies/the-matrix-1999", "quality": "1080p"}'
     ```
    """
    try:
        # Get movie details
        movie = await get_movie_by_url(request.movie_id)
        if not movie:
            raise HTTPException(status_code=404, detail="Movie not found")
        
        # Find the torrent with the requested quality
        matching_torrents = [t for t in movie.torrents if t.quality == request.quality]
        
        if not matching_torrents:
            raise HTTPException(
                status_code=400, 
                detail=f"No {request.quality} torrent available for this movie"
            )
        
        torrent = matching_torrents[0]
        
        # Create save path
        save_path = PathLib(request.save_path) if request.save_path else None
        
        # Start the download
        torrent_id = await torrent_manager.add_torrent(movie, torrent, save_path)
        
        # Get initial status
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