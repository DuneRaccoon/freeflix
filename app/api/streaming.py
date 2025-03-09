from fastapi import APIRouter, HTTPException, Path, Request, Response
from fastapi.responses import StreamingResponse
from pathlib import Path as FilePath
from typing import Optional
import os
import stat
import mimetypes
from loguru import logger
import asyncio

from app.torrent.manager import torrent_manager
from app.database.session import get_db
from app.database.models import Torrent

router = APIRouter()

# Helper function to get MIME type
def get_mimetype(file_path: str) -> str:
    """Get MIME type for a file."""
    mime_type, _ = mimetypes.guess_type(file_path)
    if not mime_type:
        # Default to mp4 for video files if unable to determine
        if any(file_path.endswith(ext) for ext in ['.mp4', '.mkv', '.avi', '.mov']):
            return 'video/mp4'
        return 'application/octet-stream'
    return mime_type

# Helper function to get file size
def get_file_size(file_path: str) -> int:
    """Get file size."""
    try:
        return os.path.getsize(file_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        logger.error(f"Error getting file size: {e}")
        raise HTTPException(status_code=500, detail="Error getting file size")

# Helper function to parse range header
def parse_range_header(range_header: str, file_size: int):
    """Parse HTTP Range header."""
    try:
        h = range_header.replace('bytes=', '')
        start, end = h.split('-')
        start = int(start) if start else 0
        end = int(end) if end else file_size - 1
        
        # Validate range
        if start > end or start < 0 or end >= file_size:
            return 0, file_size - 1
            
        return start, end
    except ValueError:
        return 0, file_size - 1

# Helper function to get largest file from torrent
def get_main_video_file(torrent_id: str) -> Optional[str]:
    """Get the main video file path from a torrent."""
    with get_db() as db:
        torrent = db.query(Torrent).filter(Torrent.id == torrent_id).first()
        if not torrent:
            return None
        
        save_path = FilePath(torrent.save_path)
        
        # Check if the directory exists
        if not save_path.exists() or not save_path.is_dir():
            return None
            
        # Find largest video file in the directory
        video_extensions = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v']
        video_files = []
        
        for root, _, files in os.walk(save_path):
            for file in files:
                if any(file.lower().endswith(ext) for ext in video_extensions):
                    file_path = os.path.join(root, file)
                    try:
                        size = os.path.getsize(file_path)
                        video_files.append((file_path, size))
                    except (FileNotFoundError, PermissionError):
                        continue
        
        if not video_files:
            return None
            
        # Return the largest video file
        return max(video_files, key=lambda x: x[1])[0]

async def file_iterator(file_path: str, start: int, end: int, chunk_size=1024*1024):
    """Async file iterator that yields file chunks."""
    with open(file_path, 'rb') as f:
        f.seek(start)
        position = start
        while position <= end:
            read_size = min(chunk_size, end - position + 1)
            data = f.read(read_size)
            if not data:
                break
            position += len(data)
            yield data
            # Small delay to prevent blocking
            await asyncio.sleep(0.01)

@router.get("/{torrent_id}", summary="Stream video from a torrent")
async def stream_video(request: Request, torrent_id: str = Path(..., description="ID of the torrent")):
    """
    Stream video content from a partially downloaded torrent.
    
    Supports HTTP Range requests for seeking in the video.
    """
    # Get the torrent status
    status = torrent_manager.get_torrent_status(torrent_id)
    if not status:
        raise HTTPException(status_code=404, detail="Torrent not found")
        
    # Check if download has started
    if status.progress <= 0:
        raise HTTPException(status_code=409, detail="Download has not started yet")
    
    # Get the video file path
    file_path = get_main_video_file(torrent_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="Video file not found")
    
    file_size = get_file_size(file_path)
    mime_type = get_mimetype(file_path)
    
    # Handle range request
    start = 0
    end = file_size - 1
    status_code = 200
    
    range_header = request.headers.get('range')
    if range_header:
        start, end = parse_range_header(range_header, file_size)
        status_code = 206  # Partial Content
    
    # Calculate Content-Length
    content_length = end - start + 1
    
    # Create response headers
    headers = {
        'Content-Type': mime_type,
        'Content-Length': str(content_length),
        'Accept-Ranges': 'bytes',
    }
    
    if range_header:
        headers['Content-Range'] = f'bytes {start}-{end}/{file_size}'
    
    # Log streaming request
    logger.info(f"Streaming torrent {torrent_id} - {file_path} - Range: {start}-{end}/{file_size}")
    
    # Return streaming response
    return StreamingResponse(
        file_iterator(file_path, start, end),
        status_code=status_code,
        headers=headers
    )

@router.get("/{torrent_id}/info", summary="Get streaming info for a torrent")
async def get_streaming_info(torrent_id: str = Path(..., description="ID of the torrent")):
    """
    Get information needed for streaming a torrent.
    
    Returns:
    - status: Torrent status information
    - file_info: Information about the video file
    """
    # Get the torrent status
    status = torrent_manager.get_torrent_status(torrent_id)
    if not status:
        raise HTTPException(status_code=404, detail="Torrent not found")
    
    # Get the video file path
    file_path = get_main_video_file(torrent_id)
    if not file_path:
        return {
            "status": status.model_dump(),
            "file_info": None,
            "stream_ready": False,
            "message": "Video file not found yet"
        }
    
    try:
        file_size = get_file_size(file_path)
        mime_type = get_mimetype(file_path)
        filename = os.path.basename(file_path)
        
        file_info = {
            "path": file_path,
            "size": file_size,
            "mime_type": mime_type,
            "filename": filename
        }
        
        stream_ready = status.progress > 5.0  # At least 5% downloaded to start streaming
        
        return {
            "status": status.model_dump(),
            "file_info": file_info,
            "stream_ready": stream_ready,
            "stream_url": f"/api/v1/streams/{torrent_id}"
        }
    except Exception as e:
        logger.error(f"Error getting streaming info: {e}")
        return {
            "status": status.model_dump(),
            "file_info": None,
            "stream_ready": False,
            "message": str(e)
        }