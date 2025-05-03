from fastapi import APIRouter, HTTPException, Path, Query, Request, Response
from fastapi.responses import StreamingResponse
from typing import Optional
from pathlib import Path as PathLib
import os
import stat
import mimetypes
import asyncio
from loguru import logger
from fastapi import APIRouter, HTTPException, Path, Depends
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.database.models import UserStreamingProgress, Torrent, MovieCache, User
from app.models import StreamingProgressCreate, StreamingProgressUpdate, StreamingProgressResponse

from app.torrent.manager import torrent_manager

router = APIRouter()

# Mapping of common video file extensions to MIME types
VIDEO_MIME_TYPES = {
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.ogv': 'video/ogg',
    '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv'
}

def get_mime_type(file_path: str) -> str:
    """Get the MIME type based on file extension."""
    ext = os.path.splitext(file_path)[1].lower()
    return VIDEO_MIME_TYPES.get(ext, mimetypes.guess_type(file_path)[0] or 'application/octet-stream')

def parse_range_header(range_header: str, file_size: int) -> tuple:
    """Parse Range header and return start and end positions."""
    if not range_header or not range_header.startswith('bytes='):
        return 0, file_size - 1
    
    ranges = range_header.replace('bytes=', '').split('-')
    start = int(ranges[0]) if ranges[0] else 0
    end = int(ranges[1]) if len(ranges) > 1 and ranges[1] else file_size - 1
    
    # Ensure values are within bounds
    start = max(0, min(start, file_size - 1))
    end = max(start, min(end, file_size - 1))
    
    return start, end

def stream_file_generator(file_path: str, start: int, end: int, chunk_size: int = 1024*1024):
    """Generator to stream file content in chunks."""
    with open(file_path, 'rb') as f:
        f.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = f.read(min(chunk_size, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk

@router.get("/{torrent_id}/video", summary="Stream video from a torrent")
async def stream_video(
    request: Request,
    torrent_id: str = Path(..., description="ID of the torrent"),
    quality: Optional[str] = Query(None, description="Desired quality if multiple options available")
):
    """
    Stream a video file from a downloading or completed torrent.
    
    Supports HTTP Range requests for seeking.
    
    - **torrent_id**: ID of the torrent
    - **quality**: Optional quality selector if multiple versions exist
    """
    # Get video file info from torrent manager
    video_info = torrent_manager.get_video_file_info(torrent_id)
    if not video_info:
        raise HTTPException(status_code=404, detail="Video file not found or not ready for streaming")
    
    # Ensure the file exists
    file_path = video_info["path"]
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Video file not found on disk")
    
    # Check if the file is accessible
    try:
        # Get file size
        file_size = os.path.getsize(file_path)
        
        # Prioritize the file for streaming if it's still downloading
        torrent_status = torrent_manager.get_torrent_status(torrent_id)
        if torrent_status and torrent_status.progress < 100:
            torrent_manager.prioritize_video_files(torrent_id)
            
        # Parse range header if present
        range_header = request.headers.get("Range")
        start, end = parse_range_header(range_header, file_size)
        
        # Chunk size for streaming (1MB)
        chunk_size = 1024 * 1024
        
        # Get the content length
        content_length = end - start + 1
        
        # Get the MIME type
        content_type = get_mime_type(file_path)
        
        # Create response headers
        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(content_length),
            "Content-Type": content_type,
        }
        
        # Return streaming response with appropriate status code
        status_code = 206 if range_header else 200
        
        return StreamingResponse(
            stream_file_generator(file_path, start, end, chunk_size),
            status_code=status_code,
            headers=headers
        )
    except Exception as e:
        logger.error(f"Error streaming video for torrent {torrent_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error streaming video: {str(e)}")

@router.get("/{torrent_id}/info", summary="Get video streaming information")
async def get_video_info(
    torrent_id: str = Path(..., description="ID of the torrent")
):
    """
    Get information about the video file being streamed.
    
    Returns details like progress, total size, and file path.
    
    - **torrent_id**: ID of the torrent
    """
    # Get torrent status
    torrent_status = torrent_manager.get_torrent_status(torrent_id)
    if not torrent_status:
        raise HTTPException(status_code=404, detail="Torrent not found")
    
    # Get video file info
    video_info = torrent_manager.get_video_file_info(torrent_id)
    if not video_info:
        raise HTTPException(status_code=404, detail="Video file not found or not ready for streaming")
    
    # Get file progress information
    file_progress = torrent_manager.get_file_progress(torrent_id)
    
    # Get file MIME type
    mime_type = get_mime_type(video_info["path"])
    
    # Return combined information
    return {
        "torrent_id": torrent_id,
        "movie_title": torrent_status.movie_title,
        "quality": torrent_status.quality,
        "progress": torrent_status.progress,
        "video_file": {
            "name": video_info["name"],
            "size": video_info["size"],
            "downloaded": video_info["downloaded"],
            "progress": video_info["progress"],
            "mime_type": mime_type,
            "stream_url": f"/api/v1/streaming/{torrent_id}/video"
        },
        "total_progress": torrent_status.progress,
        "state": torrent_status.state
    }

@router.post("/progress/{user_id}", response_model=StreamingProgressResponse)
async def create_streaming_progress(
    user_id: str,
    progress: StreamingProgressCreate,
    db: Session = Depends(get_db)
):
    """
    Save a user's streaming progress for a movie.
    
    - **user_id**: ID of the user
    - **progress**: Streaming progress data
    """
    with db as session:
        # Verify user exists
        user = session.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Verify torrent exists
        torrent = session.query(Torrent).filter(Torrent.id == progress.torrent_id).first()
        if not torrent:
            raise HTTPException(status_code=404, detail="Torrent not found")
        
        # Check if progress already exists for this user and torrent
        existing_progress = UserStreamingProgress.get_by_torrent_and_user(
            session, progress.torrent_id, user_id
        )
        
        if existing_progress:
            # Update existing progress
            existing_progress.current_time = progress.current_time
            existing_progress.duration = progress.duration
            existing_progress.percentage = progress.percentage
            existing_progress.completed = progress.completed
            existing_progress.last_watched_at = session.func.now()
            
            session.commit()
            session.refresh(existing_progress)
            return StreamingProgressCreate(**existing_progress.to_dict())
        else:
            # Create new progress entry
            new_progress = UserStreamingProgress(
                user_id=user_id,
                torrent_id=progress.torrent_id,
                movie_id=progress.movie_id,
                current_time=progress.current_time,
                duration=progress.duration,
                percentage=progress.percentage,
                completed=progress.completed
            )
            
            session.add(new_progress)
            session.commit()
            session.refresh(new_progress)
            return StreamingProgressCreate(**new_progress.to_dict())

@router.put("/progress/{user_id}/{progress_id}", response_model=StreamingProgressResponse)
async def update_streaming_progress(
    user_id: str,
    progress_id: str,
    progress_update: StreamingProgressUpdate,
    db: Session = Depends(get_db)
):
    """
    Update a user's streaming progress.
    
    - **user_id**: ID of the user
    - **progress_id**: ID of the progress entry to update
    - **progress_update**: Updated streaming progress data
    """
    with db as session:
        # Verify user exists
        user = session.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Get progress entry
        progress_entry = session.query(UserStreamingProgress).filter(
            UserStreamingProgress.id == progress_id,
            UserStreamingProgress.user_id == user_id
        ).first()
        
        if not progress_entry:
            raise HTTPException(status_code=404, detail="Streaming progress not found")
        
        # Update progress
        progress_entry.current_time = progress_update.current_time
        progress_entry.duration = progress_update.duration
        progress_entry.percentage = progress_update.percentage
        progress_entry.completed = progress_update.completed
        progress_entry.last_watched_at = session.func.now()
        
        session.commit()
        session.refresh(progress_entry)
        return StreamingProgressUpdate(**progress_entry.to_dict())

@router.get("/progress/{user_id}/{torrent_id}", response_model=Optional[StreamingProgressResponse])
async def get_streaming_progress(
    user_id: str,
    torrent_id: str,
    db: Session = Depends(get_db)
):
    """
    Get a user's streaming progress for a specific torrent.
    
    - **user_id**: ID of the user
    - **torrent_id**: ID of the torrent
    """
    with db as session:
        # Verify user exists
        user = session.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Get progress
        progress = UserStreamingProgress.get_by_torrent_and_user(session, torrent_id, user_id)
        if not progress:
            return None
        
        return StreamingProgressResponse(**progress.to_dict())

@router.get("/progress/{user_id}/movie/{movie_id}", response_model=Optional[StreamingProgressResponse])
async def get_streaming_progress_by_movie(
    user_id: str,
    movie_id: str,
    db: Session = Depends(get_db)
):
    """
    Get a user's streaming progress for a specific movie.
    
    - **user_id**: ID of the user
    - **movie_id**: ID of the movie
    """
    with db as session:
        # Verify user exists
        user = session.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Get progress
        progress = UserStreamingProgress.get_by_movie_and_user(session, movie_id, user_id)
        if not progress:
            return None
        
        return StreamingProgressResponse(**progress.to_dict())

@router.get("/progress/{user_id}", response_model=List[StreamingProgressResponse])
async def get_recent_streaming_progress(
    user_id: str,
    limit: int = 10,
    db: Session = Depends(get_db)
):
    """
    Get a user's recent streaming progress entries.
    
    - **user_id**: ID of the user
    - **limit**: Maximum number of entries to return (default: 10)
    """
    with db as session:
        # Verify user exists
        user = session.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Get recent progress entries
        progress_entries = UserStreamingProgress.get_recent_for_user(session, user_id, limit)
        # Fix: Handle the list of entries correctly
        return [StreamingProgressResponse(**entry.to_dict()) for entry in progress_entries]

@router.delete("/progress/{user_id}/{progress_id}")
async def delete_streaming_progress(
    user_id: str,
    progress_id: str,
    db: Session = Depends(get_db)
):
    """
    Delete a user's streaming progress entry.
    
    - **user_id**: ID of the user
    - **progress_id**: ID of the progress entry to delete
    """
    with db as session:
        # Verify user exists
        user = session.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Get progress entry
        progress_entry = session.query(UserStreamingProgress).filter(
            UserStreamingProgress.id == progress_id,
            UserStreamingProgress.user_id == user_id
        ).first()
        
        if not progress_entry:
            raise HTTPException(status_code=404, detail="Streaming progress not found")
        
        # Delete progress entry
        session.delete(progress_entry)
        session.commit()
        
        return {"message": "Streaming progress deleted successfully"}