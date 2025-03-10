from fastapi import APIRouter, HTTPException, Path, Query, Request, Response
from fastapi.responses import StreamingResponse
from typing import Optional
from pathlib import Path as PathLib
import os
import stat
import mimetypes
import asyncio
from loguru import logger

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