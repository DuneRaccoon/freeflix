from fastapi import APIRouter, HTTPException, Query, Body, Path, BackgroundTasks, Depends
from typing import Annotated, List, Literal, Optional, Dict, Any, Set
from pathlib import Path as PathLib
from sqlalchemy.orm import Session
from loguru import logger

import asyncio
import shutil
import uuid as _uuid
from dataclasses import dataclass
from typing import Optional as _Optional, Tuple as _Tuple

from app.models import (
    DiskUsageResponse, TorrentRequest, TorrentStatus, TorrentAction,
    TorrentBatchAction, TorrentBatchResponse, TorrentBatchResult,
    TorrentCandidate,
)
from app.torrent.states import ACTIVE_DOWNLOAD_STATES, RESUMABLE_STATES
from app.services import movies as movie_service
from app.services import tv as tv_service
from app.services.torrents_select import rank_candidates
from app.services.capability import apply_profile
from app.providers import catalog
from app.torrent.manager import torrent_manager
from app.config import settings
from app.database.session import get_db
from app.database.models import Torrent as DbTorrent
from app.dependencies.auth import AuthContext, require_session
from app.services.torrent_scope import scope_query, visible_to
# By name, not as a module: tests patch torrents_api.find_reusable and torrents_api.utcnow.
from app.services.torrent_reuse import covers_title, find_reusable, pack_contains, pack_file_index
from app.services.torrent_touch import touch_torrent, utcnow
from app.services.vacuum import fill_vacuum
from app.services.watch_share import watched_by_map
from sqlalchemy import func
# By this name: cron/jobs.py imports _human_size from here.
from app.torrent.storage import human_size as _human_size


#: The profile ids a device may send. Spelled out rather than derived from
#: services.capability.PROFILES at import time: a Literal needs literal members, and a
#: typo here is caught by the endpoint tests, which assert both the accepted id and a 422
#: for a garbage one. Mirrors models.TorrentRequest.client -- change both together.
_ClientProfile = Literal['lg-webos22-floor']


def _device_refusal(candidates: List[TorrentCandidate]) -> str:
    """The 404 detail when a capability profile refused every candidate.

    **Both strings contain "no torrents"**, because the television's error mapping keys on
    exactly that substring (``_data/title.ts``'s ``reasonFor``: a 404 whose detail matches
    ``/no torrents/i`` becomes "No sources found for this title yet.", and anything else
    becomes "The box doesn't recognise this title." -- a lie about a title that exists).
    So a 404 copy edit here is a viewer-visible change on the TV; keep the substring.

    **The precedence, and the one open question in it.** The 4K copy is claimed only when
    every refusal is ``withheld`` -- a 2160p release the viewer could unlock by pressing 4K.
    Any other label, ``incapable`` above all, falls to the weaker sentence, which is true
    whatever mix of labels is present. That matches ``capability.REJECT_PRECEDENCE``
    ("incapable", "withheld") and the comment beside it, which names this copy rule.
    The stage-8 plan states the same conditions and then, in the same sentence, says the 4K
    copy "wins a mixed case" -- the opposite. Shipped as written here, with the safer claim
    on the mixed set; flipping it is this one predicate plus the name of its test.
    """
    verdicts = {c.device_verdict for c in candidates}
    if verdicts == {"withheld"}:
        return (
            "Only 4K sources exist for this title "
            "— no torrents this television can play in HD"
        )
    return "No torrents this television can play"


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


def _visible_ids(db, ctx: AuthContext) -> Set[str]:
    """The ids of the downloads ``ctx`` may manage. Call only for a member: the owner
    sees everything and must not pay for (or depend on) this read."""
    with db as session:
        return {r.id for r in scope_query(session.query(DbTorrent.id), ctx)}


def _require_visible(db, torrent_id: str, ctx: AuthContext, detail: str) -> None:
    """404 with the route's own not-found ``detail`` unless ``ctx`` may manage the row,
    so "not yours" and "does not exist" answer byte-identically. The owner returns at
    once, without a read."""
    if ctx.is_owner:
        return
    with db as session:
        row = (
            session.query(DbTorrent.id, DbTorrent.account_id)
            .filter(DbTorrent.id == torrent_id)
            .first()
        )
    # Raised outside the block: get_db() logs anything escaping it at ERROR level.
    if row is None or not visible_to(row, ctx):
        raise HTTPException(status_code=404, detail=detail)


#: One lock per (tmdb_id, media_type, season, episode, quality), created on first use.
#: The app is one process on one event loop, so an asyncio.Lock is enough.
_DOWNLOAD_LOCKS: Dict[tuple, asyncio.Lock] = {}


def _download_lock(key: tuple) -> asyncio.Lock:
    """The lock serialising find -> search -> add for one title at one quality, so two
    presses racing (the TV's threshold prefetch and the end-prompt Play, or two devices)
    start one download: the second waits, then finds the row the first one added."""
    lock = _DOWNLOAD_LOCKS.get(key)
    if lock is None:
        lock = _DOWNLOAD_LOCKS[key] = asyncio.Lock()
    return lock


def _reuse(db, request: TorrentRequest) -> Optional[TorrentStatus]:
    """The status of an existing download covering ``request``, or None.

    A reuse is "anyone playing it" (spec 4.2), so it stamps ``last_touched_at``: a
    download reused just before the vacuum runs must not be due before the player's
    first progress write. The row keeps its ``account_id`` -- a NULL one stays the
    owner's, never adopted by whoever pressed Play.
    """
    with db as session:
        row = find_reusable(
            session, tmdb_id=request.tmdb_id, media_type=request.media_type,
            season=request.season, episode=request.episode, quality=request.quality,
        )
        if row is None:
            return None
        touch_torrent(session, row.id, utcnow())
        torrent_id, state, quality = row.id, row.state, row.quality
        file_index = pack_file_index(row, request.season, request.episode)
    # Out of the block (get_db commits on exit) before any torrent_manager call.
    if state in RESUMABLE_STATES and not torrent_manager.resume_torrent(torrent_id):
        logger.warning(f"Reuse: could not resume {torrent_id}; returning it as it is")
    status = torrent_manager.get_torrent_status(torrent_id)
    if not status:
        raise HTTPException(status_code=500, detail="Failed to get torrent status")
    status.chosen_quality = quality
    status.file_index = file_index
    return status


@router.post("/download", response_model=TorrentStatus, summary="Download a movie")
async def download_movie(
    request: TorrentRequest,
    background_tasks: BackgroundTasks,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_session),
):
    """Start downloading a title by TMDB id at the requested quality bucket.

    Without an explicit ``magnet``, an existing download of the same title at the same
    quality is returned (and resumed if paused) instead of starting another; see
    ``services/torrent_reuse.py``. An explicit magnet always adds.
    """
    try:
        if request.media_type == "tv" and request.season is None:
            raise HTTPException(status_code=422, detail="season is required for TV downloads")
        if request.magnet:
            return await _start_download(request, ctx)
        key = (request.tmdb_id, request.media_type, request.season, request.episode,
               request.quality)
        async with _download_lock(key):
            # Find, search and add all under the lock: a second identical request waiting
            # on it then finds the row this one added.
            reused = _reuse(db, request)
            if reused is not None:
                return reused
            return await _start_download(request, ctx)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def _start_download(request: TorrentRequest, ctx: AuthContext) -> TorrentStatus:
    """Resolve the title, pick a source and add a new download. No reuse here."""
    if request.media_type == "tv":
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
        # BYPASS 1, deliberate and pinned (tests/test_download_select.py's
        # test_download_explicit_magnet_used_verbatim): an explicit magnet from a
        # picker never reaches rank_candidates, so no capability profile is applied
        # to it either. The viewer chose this exact release off a list that already
        # showed them its device marks; honouring it is the point. Unreachable from
        # the television, which sends no magnet.
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
        # The device profile annotates and re-orders; it never filters. `client` is
        # None for every browser, and that path returns this very list object.
        candidates = apply_profile(
            candidates, request.client,
            allow_2160p=(request.quality == '2160p'),
        )
        chosen = None
        if request.source_id:
            # BYPASS 2, deliberate: an explicit source_id is honoured even when the
            # profile refused it, for the same reason as bypass 1. Unreachable today
            # -- both web pickers send `magnet` AND `source_id`, so bypass 1 fires
            # first, and the television sends neither.
            chosen = next(
                (c for c in candidates if c.source_id == request.source_id), None
            )
        if chosen is None:
            # No explicit pick (or it was stale) -> ranked top pick (best healthy
            # downgrade), skipping anything this device cannot or must not play.
            # No hard 422: the user always gets the best available. device_verdict is
            # truthy iff refused and None when accepted OR when no profile ran, so
            # with client=None this is candidates[0] exactly as before.
            chosen = next((c for c in candidates if not c.device_verdict), None)
        if chosen is None:
            # Candidates existed and the profile refused all of them. A distinct 404
            # from "No torrents found", which still means what it always did.
            raise HTTPException(
                status_code=404, detail=_device_refusal(candidates)
            )
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
    # Not scoped: anyone may start a download; the row records who did. With auth
    # off this is "dev-owner", which no member can match -- it reads as the owner's.
    torrent_id = await torrent_manager.add_torrent(
        dl_movie, dl_torrent, save_path, account_id=ctx.account_id
    )

    status = torrent_manager.get_torrent_status(torrent_id)
    if not status:
        raise HTTPException(status_code=500, detail="Failed to get torrent status")
    status.chosen_quality = chosen_quality
    return status


@router.get("/sources", response_model=List[TorrentCandidate], summary="Ranked torrent sources")
async def get_sources(
    tmdb_id: int = Query(..., description="TMDB id of the title"),
    quality: str = Query("1080p", description="Preferred quality bucket"),
    media_type: str = Query("movie", description="'movie' or 'tv'"),
    season: Optional[int] = Query(None, ge=0),
    episode: Optional[int] = Query(None, ge=1),
    client: Optional[_ClientProfile] = Query(
        None, description="Capability profile id of the calling device (stage 8)"),
):
    """Ranked, health-classified candidate sources for a title (consumed by the picker).

    `client` annotates and re-orders for one device and **filters nothing**: the list is
    advisory, and the web's alternatives modal and in-player switcher are both guarded on
    a non-empty list, so dropping rows would make the web play a refused release with no
    warning rather than offer a better one. Refusing is /download's job. A Literal, not a
    bare str like `quality` beside it: an unvalidated name would reach apply_profile and
    raise ValueError, which the error middleware renders as an opaque 500.
    """
    try:
        if media_type == "tv":
            if season is None:
                raise HTTPException(status_code=422, detail="season is required for TV sources")
            if episode is not None:
                candidates = await tv_service.episode_candidates(tmdb_id, season, episode, quality)
            else:
                candidates = await tv_service.season_candidates(tmdb_id, season, quality)
        else:
            candidates = await movie_service.get_candidates(tmdb_id, quality)
        return apply_profile(candidates, client, allow_2160p=(quality == '2160p'))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/for-title", response_model=List[TorrentStatus],
            summary="Downloads covering a title")
async def for_title(
    db: Annotated[Session, Depends(get_db)],
    tmdb_id: int = Query(..., description="TMDB id of the title"),
    media_type: Literal['movie', 'tv'] = Query(..., description="'movie' or 'tv'"),
    season: Optional[int] = Query(None),
    episode: Optional[int] = Query(None),
):
    """Every download that covers the title, in any state (the TV ranks states itself).

    Unscoped, like Play: a member may play a film the owner already holds. Kept by the
    same ``covers_title`` and ``pack_contains`` as POST /download's reuse, so a pack this
    lists as holding an episode is one the server would reuse for it.
    """
    with db as session:
        rows = (
            session.query(DbTorrent)
            .filter(DbTorrent.tmdb_id == tmdb_id, DbTorrent.media_type == media_type)
            .all()
        )
        ids = [
            r.id for r in rows
            if covers_title(r, tmdb_id=tmdb_id, media_type=media_type,
                            season=season, episode=episode)
            and pack_contains(r, season, episode)
        ]
    statuses = (torrent_manager.get_torrent_status(tid) for tid in ids)
    return [s for s in statuses if s is not None]


@router.get("/status/{torrent_id}", response_model=TorrentStatus, summary="Get torrent status")
async def get_torrent_status(torrent_id: str = Path(..., description="ID of the torrent")):
    """
    Get the current status of a torrent download.
    """
    status = torrent_manager.get_torrent_status(torrent_id)
    if not status:
        raise HTTPException(status_code=404, detail="Torrent not found")

    fill_vacuum([status], utcnow(), manager=torrent_manager)
    return status


@router.get("/list", response_model=List[TorrentStatus], summary="List all torrents")
async def list_torrents(
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_session),
    state: Optional[str] = Query(None, description="Filter by state (e.g., downloading, paused)")
):
    """
    List the caller's torrent downloads (every download, for the owner), optionally
    filtered by state.
    """
    visible = None if ctx.is_owner else _visible_ids(db, ctx)
    all_torrents = torrent_manager.get_all_torrents()
    if visible is not None:
        all_torrents = [t for t in all_torrents if t.id in visible]

    if ctx.is_owner and all_torrents:
        # Owner only: who watched what is viewing history. Members keep watched_by=None.
        ids = [t.id for t in all_torrents]
        with db as session:
            rows = session.query(DbTorrent).filter(DbTorrent.id.in_(ids)).all()
            wb = watched_by_map(session, rows)
        for s in all_torrents:
            s.watched_by = wb.get(s.id, [])

    if state:
        all_torrents = [t for t in all_torrents if t.state == state]

    # Outside the `with db` block: fill_vacuum opens its own get_db().
    fill_vacuum(all_torrents, utcnow(), manager=torrent_manager)
    return all_torrents


@router.get("/disk", response_model=DiskUsageResponse, summary="Disk usage of the downloads volume")
async def disk_usage(
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_session),
):
    """Shown to everyone, deliberately not scoped: the disk is shared, so its totals are
    not personal."""
    with db as session:
        used = session.query(func.coalesce(func.sum(DbTorrent.size_bytes), 0)).scalar()
    try:
        usage = shutil.disk_usage(settings.default_download_path)
    except OSError:
        raise HTTPException(status_code=503, detail="Disk usage unavailable")
    return DiskUsageResponse(
        used_by_downloads_bytes=int(used or 0),
        free_bytes=usage.free,
        total_bytes=usage.total,
    )


@router.post("/action/{torrent_id}", response_model=Dict[str, Any], summary="Perform action on torrent")
async def torrent_action(
    action: TorrentAction,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_session),
    torrent_id: str = Path(..., description="ID of the torrent")
):
    """Pause or resume a torrent. ('stop' is a legacy alias of pause; use DELETE to remove.)

    Pause/stop are scoped to the caller's downloads. Resume is deliberately NOT: the TV
    resumes a paused download when Play is pressed, and Play must work for everyone.
    """
    if action.action in ("pause", "stop"):
        _require_visible(db, torrent_id, ctx, "Torrent not found or action failed")
        success = torrent_manager.pause_torrent(torrent_id)
    elif action.action == "resume":
        success = torrent_manager.resume_torrent(torrent_id)
    else:  # pragma: no cover - guarded by the Literal
        raise HTTPException(status_code=400, detail=f"Unsupported action '{action.action}'")

    if not success:
        raise HTTPException(status_code=404, detail="Torrent not found or action failed")

    return {"success": True, "action": action.action, "torrent_id": torrent_id}


@router.post("/{torrent_id}/prioritize", response_model=Dict[str, Any],
             summary="Prioritize a torrent's video for streaming")
async def prioritize_for_streaming(
    torrent_id: str = Path(..., description="ID of the torrent"),
    payload: Dict[str, Any] = Body(default={}),
):
    """Deadline the streamed file's initial pieces and force-start the torrent out
    of the download queue, so playback can begin as soon as possible. The streaming
    page calls this on open. Idempotent and best-effort — it never fails the stream
    (returns success even if the torrent isn't streamable yet)."""
    status = torrent_manager.get_torrent_status(torrent_id)
    if not status:
        raise HTTPException(status_code=404, detail="Torrent not found")
    try:
        torrent_manager.prioritize_video_files(torrent_id)
        torrent_manager.force_start_for_stream(torrent_id)
    except Exception:
        pass  # best-effort: prioritization must never block/fail the stream start
    return {"success": True, "torrent_id": torrent_id}


@router.post("/batch", response_model=TorrentBatchResponse, summary="Batch torrent action")
async def batch_action(
    payload: TorrentBatchAction,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_session),
):
    """Apply an action to every torrent of the caller's (every torrent, for the owner)
    matching the action's target set."""
    visible = None if ctx.is_owner else _visible_ids(db, ctx)
    all_t = torrent_manager.get_all_torrents()
    if visible is not None:
        all_t = [t for t in all_t if t.id in visible]
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
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_session),
    torrent_id: str = Path(..., description="ID of the torrent"),
    delete_files: bool = Query(False, description="Whether to delete downloaded files")
):
    """
    Delete one of the caller's torrents (any, for the owner) and optionally its files.
    """
    _require_visible(db, torrent_id, ctx, "Torrent not found or deletion failed")
    success = torrent_manager.remove_torrent(torrent_id, delete_files)
    
    if not success:
        raise HTTPException(status_code=404, detail="Torrent not found or deletion failed")
    
    return {"success": True, "torrent_id": torrent_id, "files_deleted": delete_files}