from fastapi import APIRouter, HTTPException, Path, Query, Request, Response
from fastapi.responses import StreamingResponse
from typing import Optional
from pathlib import Path as PathLib
import datetime
import os
import stat
import mimetypes
import asyncio
from loguru import logger
from fastapi import APIRouter, HTTPException, Path, Depends
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.dependencies.auth import require_profile, require_session_silent
from app.database.models import UserStreamingProgress, Torrent, MovieCache, User
from app.models import StreamingProgressCreate, StreamingProgressUpdate, StreamingProgressResponse

from app.torrent.manager import torrent_manager
from app.providers.episodes import parse_episode
from app.services.content_id import build_content_id, resolve_content_id
from app.services.progress_upsert import upsert_progress
from app.models import VideoFile

router = APIRouter()

# Mapping of video file extensions to MIME types. This must cover every extension
# in settings.video_extensions: anything left to mimetypes.guess_type() depends on
# the container's Python 3.10 table and can degrade to application/octet-stream,
# which most media stacks refuse. test_video_mime_types.py enforces the coverage.
VIDEO_MIME_TYPES = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/x-m4v',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.ogv': 'video/ogg',
    '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv',
    '.ts': 'video/mp2t',
    '.m2ts': 'video/mp2t',
    '.mts': 'video/mp2t',
    '.vob': 'video/mpeg',
    '.mpg': 'video/mpeg',
    '.mpeg': 'video/mpeg',
    '.3gp': 'video/3gpp',
}

def get_mime_type(file_path: str) -> str:
    """Get the MIME type based on file extension."""
    ext = os.path.splitext(file_path)[1].lower()
    return VIDEO_MIME_TYPES.get(ext, mimetypes.guess_type(file_path)[0] or 'application/octet-stream')

# Sentinel returned by parse_range_header for an unsatisfiable range
# (start >= file_size, or a zero-length suffix). The endpoint maps this to HTTP 416.
RANGE_NOT_SATISFIABLE = (-1, -1)

# Sentinel for a syntactically invalid range, or one we do not implement
# (multipart). RFC 7233 §3.1 requires such a header to be IGNORED, so the
# endpoint serves 200 with the full body rather than 416 — a 416 invites a
# client to give up instead of retrying with a single range.
RANGE_MALFORMED = (-2, -2)

# Sentinel for "the file exists but has no bytes yet" — a torrent whose metadata
# has arrived but whose file libtorrent has not allocated. This is NOT a range
# problem: a plain GET carrying no Range header at all used to land here and be
# answered 416, a status only meaningful in reply to a Range request and one that
# tells <video> to give up permanently. The endpoint maps it to 503 + Retry-After,
# which is what it actually is: come back in a moment.
RANGE_FILE_NOT_READY = (-3, -3)


def parse_range_header(range_header: Optional[str], file_size: int) -> tuple:
    """Parse a Range header into (start, end) inclusive byte positions.

    Returns RANGE_NOT_SATISFIABLE when the range cannot be satisfied (HTTP 416),
    RANGE_MALFORMED when the header is syntactically invalid, uses a range
    unit other than "bytes", or asks for something we do not implement
    (RFC 7233 §3.1: ignore it and serve the whole body), and RANGE_FILE_NOT_READY
    when the file has no bytes yet (HTTP 503, retryable). end past EOF is
    clamped; an out-of-bounds start is a client error.
    """
    if file_size <= 0:
        # Checked FIRST, before the header is even looked at: a zero-length file
        # is not a range failure, and a request with no Range header must not be
        # answered with a range status at all.
        return RANGE_FILE_NOT_READY

    if not range_header:
        return 0, file_size - 1

    if not range_header.startswith('bytes='):
        # Unsupported range unit (e.g. "items=0-5"). This is NOT "no header at
        # all" — RFC 7233 §3.1 requires a server that doesn't support the given
        # unit to IGNORE the header, so the endpoint must serve 200 with no
        # Content-Range, not silently honor it as if it said "bytes=0-".
        return RANGE_MALFORMED

    spec = range_header[len('bytes='):].strip()

    # A multipart range ("0-99,200-299") is legal HTTP we do not implement.
    # Answering it with a single-part 206 would be a lie, so ignore the header.
    if ',' in spec:
        return RANGE_MALFORMED

    if '-' not in spec:
        return RANGE_MALFORMED

    first, _, last = spec.partition('-')
    first, last = first.strip(), last.strip()

    try:
        if not first:
            # SUFFIX range: "bytes=-N" is the LAST N bytes, not the first N.
            # Media pipelines use this to find a container index at EOF, so
            # treating the empty first field as start=0 serves the wrong bytes
            # under a 206 that claims otherwise.
            if not last:
                return RANGE_MALFORMED          # "bytes=-" means nothing
            n = int(last)
            if n < 0:
                return RANGE_MALFORMED          # "bytes=--5": syntax error, not a valid suffix length
            if n == 0:
                return RANGE_NOT_SATISFIABLE    # "the last 0 bytes": well-formed but unsatisfiable
            return max(0, file_size - n), file_size - 1

        start = int(first)
        end = int(last) if last else file_size - 1
    except ValueError:
        return RANGE_MALFORMED

    # Defensive guard, not reachable today: partition('-') means a non-empty
    # `first` can never itself contain a '-', so int(first) can never be
    # negative. Kept in case that invariant ever changes.
    if start < 0:
        return RANGE_MALFORMED
    if start >= file_size:
        return RANGE_NOT_SATISFIABLE
    # Checked after the out-of-bounds start: an open-ended range ("bytes=5000-")
    # defaults end to file_size - 1, which is < start whenever start is past EOF.
    # Checking end < start first would misreport that as malformed instead of
    # unsatisfiable and break test_start_beyond_filesize_is_unsatisfiable.
    if end < start:
        return RANGE_MALFORMED

    return start, min(end, file_size - 1)


def _lookup_video_file(torrent_id: str, file_index: Optional[int]) -> Optional[Dict[str, Any]]:
    """The live session first, then the completed-on-disk fallback.

    A finished download is the television's main content, and until this fallback
    existed it was unplayable: find_loadable_on_startup never re-adds a finished
    or seeding torrent after a restart and _refresh_active_torrents evicts
    'finished' mid-session, so get_video_file_info answers None and both video
    routes 404ed on a title whose every byte was sitting on disk. stream_file_range
    already handled the no-live-torrent case; only resolution was in the way.

    ORDER IS THE SEAM. The live lookup runs first and its answer always wins, so
    the fallback is reachable only when the session knows nothing — it is not a
    second opinion about a loaded torrent, and it never becomes the general path.
    get_completed_video_file_info carries the four gates (terminal state,
    progress >= 100, the on-disk size matching the metadata, and the content
    guard); everything it refuses keeps the 404 the caller already raised.
    """
    video_info = torrent_manager.get_video_file_info(torrent_id, file_index)
    if video_info:
        return video_info
    return torrent_manager.get_completed_video_file_info(torrent_id, file_index)


def _resolve_video_file(torrent_id: str, file_index: Optional[int]) -> tuple:
    """Resolve a torrent's video file for streaming, or raise the 404 both routes share.

    An EXPLICIT file_index must resolve to that exact file — never silently fall
    back to the largest — so an invalid index is distinguished from "metadata not
    ready yet". Shared by head_video and stream_video so the two can never drift.

    Stops before os.path.getsize on purpose: stream_video runs getsize inside a
    try/except that turns a read failure into an empty-bodied 503, while
    head_video calls it with no such wrapper. Pulling getsize in here would move
    it outside that try and change stream_video's error semantics for an
    unreadable file.
    """
    video_info = _lookup_video_file(torrent_id, file_index)
    if not video_info:
        if file_index is not None:
            raise HTTPException(
                status_code=404,
                detail=f"Video file index {file_index} not found in this torrent",
            )
        raise HTTPException(
            status_code=404,
            detail="Video file not found or not ready for streaming",
        )

    file_path = video_info["path"]
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Video file not found on disk")

    return video_info, file_path

@router.head(
    "/{torrent_id}/video",
    summary="Metadata-only probe for a video stream",
    # Before this route existed, HEAD /{torrent_id}/video was a bare 405: FastAPI's
    # APIRoute.__init__ never calls super().__init__() and sets
    # `self.methods = {method.upper() for method in methods}` directly, so
    # Starlette's Route.__init__ — and with it its `self.methods.add("HEAD")` —
    # never runs. (Verified against the pinned fastapi 0.104.1 / starlette 0.27.0;
    # an earlier draft of the spec wrongly claimed a HEAD probe ran the full GET
    # handler and could block 300s.) A TV media pipeline that probes with HEAD
    # before GET got a refusal instead of the size and type it asked for.
    #
    # Registered ABOVE the GET route anyway: Starlette matches in registration
    # order, so if FastAPI's method handling ever changes to auto-add HEAD, this
    # route still wins and a probe can never fall into the GET handler's
    # prioritize_video_files + force_start_for_stream (a DB write) and piece-gated
    # generator. Deliberate defensive ordering, not a workaround for today.
    dependencies=[Depends(require_session_silent)],
)
async def head_video(
    torrent_id: str = Path(..., description="ID of the torrent"),
    quality: Optional[str] = Query(None, description="Accepted for parity with GET; unused"),
    file_index: Optional[int] = Query(None, description="Index of the file to probe (season packs)"),
):
    """Answer a HEAD probe from metadata alone: no prioritisation, no piece waiting."""
    video_info, file_path = _resolve_video_file(torrent_id, file_index)

    file_size = os.path.getsize(file_path)
    return Response(
        status_code=200,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Type": get_mime_type(file_path),
        },
    )

@router.get(
    "/{torrent_id}/video",
    summary="Stream video from a torrent",
    # A raw <video src> cannot carry a header, so the session cookie is the only gate
    # available here — and the 401 must have an EMPTY body. Any JSON or HTML reaches
    # the decoder as corrupt media, and PatchedVideoPlayer classifies a network error
    # during an active download as recoverable, so an expired session would present as
    # a mysterious playback failure that never prompts anyone to sign in.
    dependencies=[Depends(require_session_silent)],
)
async def stream_video(
    request: Request,
    torrent_id: str = Path(..., description="ID of the torrent"),
    quality: Optional[str] = Query(None, description="Desired quality if multiple options available"),
    file_index: Optional[int] = Query(None, description="Index of the file to stream (season packs)"),
):
    """
    Stream a video file from a downloading or completed torrent.

    Supports HTTP Range requests for seeking.

    - **torrent_id**: ID of the torrent
    - **quality**: Optional quality selector if multiple versions exist
    """
    # Resolve the video file. An EXPLICIT file_index must resolve to that exact
    # file — never silently fall back to the largest. Distinguish an invalid
    # index from "metadata not ready yet".
    video_info, file_path = _resolve_video_file(torrent_id, file_index)

    # Check if the file is accessible
    try:
        # Get file size
        file_size = os.path.getsize(file_path)
        
        # Prioritize the file for streaming if it's still downloading, and pin it
        # out of the auto-managed queue so the active stream is never paused (WS5).
        torrent_status = torrent_manager.get_torrent_status(torrent_id)
        if torrent_status and torrent_status.progress < 100:
            torrent_manager.prioritize_video_files(torrent_id, file_index=video_info["index"])
            torrent_manager.force_start_for_stream(torrent_id)
            
        # Parse range header if present.
        range_header = request.headers.get("Range")
        parsed = parse_range_header(range_header, file_size)
        if parsed is RANGE_FILE_NOT_READY:
            # The file is not allocated yet (metadata arrived, zero bytes on disk).
            # Retryable, and empty-bodied: 416 here would tell <video> to stop for
            # good over a condition that clears itself in seconds.
            return Response(
                status_code=503,
                headers={"Retry-After": "2", "Accept-Ranges": "bytes"},
            )
        if parsed is RANGE_NOT_SATISFIABLE:
            # RFC 7233 §4.4 — unsatisfiable range: 416 + the resource size.
            return Response(
                status_code=416,
                headers={"Content-Range": f"bytes */{file_size}"},
            )
        if parsed is RANGE_MALFORMED:
            # RFC 7233 §3.1 — ignore an invalid range and serve the whole body.
            # Clearing range_header is what makes the status 200 below, and what
            # keeps Content-Range out of the response.
            range_header = None
            start, end = 0, file_size - 1
        else:
            start, end = parsed
        
        # Chunk size for streaming (1MB)
        chunk_size = 1024 * 1024
        
        # Get the content length
        content_length = end - start + 1
        
        # Get the MIME type
        content_type = get_mime_type(file_path)
        
        # Create response headers
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(content_length),
            "Content-Type": content_type,
        }
        if range_header:
            headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
        
        # Return streaming response with appropriate status code
        status_code = 206 if range_header else 200

        # Wait for the FIRST chunk here, not inside the generator: after
        # StreamingResponse starts, the status code is spent and a failure can only
        # truncate below the Content-Length above. A seek into a not-yet-downloaded
        # region is then a retryable 503 rather than a silent stall.
        if not await torrent_manager.wait_for_first_chunk(
            torrent_id, video_info["index"], start, min(chunk_size, content_length)
        ):
            return Response(
                status_code=503,
                headers={"Retry-After": "2", "Accept-Ranges": "bytes"},
            )

        # Piece-aware generator: waits for each chunk's pieces to be downloaded
        # before serving, so the player never receives undownloaded (zero) bytes
        # that would trigger a decode error.
        return StreamingResponse(
            torrent_manager.stream_file_range(
                torrent_id, video_info["index"], file_path, start, end, chunk_size
            ),
            status_code=status_code,
            headers=headers
        )
    except Exception as e:
        # NEVER a JSON body here. This is the same argument as the empty 401 above:
        # whatever we return is fed straight to a decoder by a raw <video src>, and
        # a JSON error document reaching it presents as corrupt media rather than
        # as an error. 503 rather than 500 because most causes at this point are
        # transient (a handle going invalid, a file momentarily unreadable while
        # libtorrent moves it), so the client should come back rather than give up.
        logger.error(f"Error streaming video for torrent {torrent_id}: {e}")
        return Response(status_code=503, headers={"Retry-After": "2"})

@router.get(
    "/{torrent_id}/info",
    summary="Get video streaming information",
    dependencies=[Depends(require_session_silent)],
)
async def get_video_info(
    torrent_id: str = Path(..., description="ID of the torrent"),
    file_index: Optional[int] = Query(None, description="Index of the file (season packs)"),
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

    # Get video file info. Same two-step lookup the byte routes use, so a finished
    # download that /video can now play does not 404 here and strand a player that
    # polls /info while waiting to start. /info keeps raising its OWN 404s, with
    # no index-specific detail: "Torrent not found" above is still the only
    # terminal answer, and this one still means "not ready, or evicted".
    video_info = _lookup_video_file(torrent_id, file_index)
    if not video_info:
        raise HTTPException(status_code=404, detail="Video file not found or not ready for streaming")
    
    # Get file progress information
    file_progress = torrent_manager.get_file_progress(torrent_id)
    
    # Get file MIME type
    mime_type = get_mime_type(video_info["path"])

    # Resolve the watch identity (content_id) for progress / continue-watching.
    # Full fallback chain (stored S/E -> precomputed map -> filename parse ->
    # deterministic file_index) so progress is never orphaned under None.
    content_id = None
    season = episode = None
    file_idx = file_index if file_index is not None else video_info.get("index")
    with get_db() as db:
        row = db.query(Torrent).filter(Torrent.id == torrent_id).first()
        if row:
            season, episode = row.season, row.episode
            # Surface the precomputed/parsed S/E in the response for season packs.
            if row.media_type == "tv" and episode is None:
                pre = (row.precomputed_episodes or {}).get(str(file_idx))
                if pre:
                    season, episode = pre.get("season"), pre.get("episode")
                else:
                    ep = parse_episode(video_info["name"])
                    if ep:
                        season, episode = ep
            content_id = resolve_content_id(
                media_type=row.media_type,
                tmdb_id=row.tmdb_id,
                season=row.season,
                episode=row.episode,
                file_name=video_info["name"],
                file_index=file_idx,
                precomputed=row.precomputed_episodes,
            )

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
            "stream_url": (
                f"/api/v1/streaming/{torrent_id}/video"
                + (f"?file_index={file_index}" if file_index is not None else "")
            ),
        },
        "content_id": content_id,
        "season": season,
        "episode": episode,
        "file_index": file_index if file_index is not None else video_info.get("index"),
        "total_progress": torrent_status.progress,
        "state": torrent_status.state
    }

@router.get(
    "/{torrent_id}/files",
    response_model=List[VideoFile],
    summary="List streamable video files",
    dependencies=[Depends(require_session_silent)],
)
async def list_video_files(torrent_id: str = Path(..., description="ID of the torrent")):
    """List the video files in a torrent, labeled with parsed season/episode (season packs)."""
    if not torrent_manager.get_torrent_status(torrent_id):
        raise HTTPException(status_code=404, detail="Torrent not found")
    files = torrent_manager.get_video_files(torrent_id)
    result: List[VideoFile] = []
    for f in files:
        ep = parse_episode(f["name"])
        result.append(VideoFile(
            index=f["index"], name=f["name"], size=f["size"],
            downloaded=f["downloaded"], progress=f["progress"],
            mime_type=get_mime_type(f["name"]),
            stream_url=f"/api/v1/streaming/{torrent_id}/video?file_index={f['index']}",
            season=ep[0] if ep else None,
            episode=ep[1] if ep else None,
        ))
    result.sort(key=lambda r: (
        r.season if r.season is not None else 999,
        r.episode if r.episode is not None else r.index,
    ))
    return result

@router.post(
    "/progress/{user_id}",
    response_model=StreamingProgressResponse,
    dependencies=[Depends(require_profile)],
)
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
        
        # Atomic upsert keyed by (user_id, movie_id): one row per movie/episode, even
        # for a season pack whose many episodes share a single torrent_id. Relies on
        # the unique index uq_user_movie_progress created by sync_indexes().
        row = upsert_progress(
            session,
            user_id=user_id,
            movie_id=progress.movie_id,
            torrent_id=progress.torrent_id,
            current_time=progress.current_time,
            duration=progress.duration,
            percentage=progress.percentage,
            completed=progress.completed,
            file_index=progress.file_index,
            title=progress.title,
            content_id=progress.movie_id,
        )
        session.commit()
        session.refresh(row)
        return StreamingProgressResponse(**row.to_dict())

@router.put(
    "/progress/{user_id}/{progress_id}",
    response_model=StreamingProgressResponse,
    dependencies=[Depends(require_profile)],
)
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
        progress_entry.last_watched_at = datetime.datetime.now()
        
        session.commit()
        session.refresh(progress_entry)
        return StreamingProgressResponse(**progress_entry.to_dict())

@router.get(
    "/progress/{user_id}/{torrent_id}",
    response_model=Optional[StreamingProgressResponse],
    dependencies=[Depends(require_profile)],
)
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

@router.get(
    "/progress/{user_id}/movie/{movie_id}",
    response_model=Optional[StreamingProgressResponse],
    dependencies=[Depends(require_profile)],
)
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

@router.get(
    "/progress/{user_id}",
    response_model=List[StreamingProgressResponse],
    dependencies=[Depends(require_profile)],
)
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

@router.delete(
    "/progress/{user_id}/{progress_id}",
    dependencies=[Depends(require_profile)],
)
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