"""Sidecar subtitles: the list the television reads, and the one POST that mutates.

Two routes here (task 9 adds the third, the WebVTT body, to this same module):

    GET  /{torrent_id}/subtitles?file_index=N   the envelope + the rows
    POST /{torrent_id}/subtitles/{index}/fetch  admit the sidecar's pieces

**Why the POST exists at all, and why it is a POST.** A `<track>` element can
issue a GET and nothing else, so making admission a POST puts the mutation
STRUCTURALLY out of reach of the thing that reads subtitles — a better guarantee
than a source-text pin, which a `getattr`-assembled name walks past (plan D2). A
GET that re-deadlined pieces would also hijack libtorrent's deadline queue for
every poll of this list.

**Why the list carries `coverage` rather than answering `200 []` or a 404.**
`/files` already answers `200 []` with three meanings and this repo's own suite
records that it "means 'not ready, or evicted' and never 'this pack has no
episodes'" (`tests/test_finished_torrent_streamable.py:226-230`) — RECORDED, NOT
FIXED. A fourth bare empty list inherits a meaning the suite has already declared
unusable, and a 404 is worse: the television's single status->copy map renders 404
as "The box doesn't recognise this title." (`(bigscreen)/_data/title.ts:488`) and
409/429/503 as "The box is busy with other downloads." — both false sentences
about a release that simply ships no `.srt`, which §7.5's own acknowledged gap
says is the COMMON outcome. So 404 happens for exactly two reasons (D6): the
torrent has no row at all, or the row is content-guard blocked.

**The 401 is bodiless and inherited, not invented.** This router is included
under the existing `{api_v1_str}/streaming` prefix with the existing
`STREAM_GATED` dependency (`main.py:91`), so the silent variant applies here for
free. That is also why the list carries `ready`: a bodiless 401 is
indistinguishable from a malformed file to a `<track>`, so the television must
never learn readiness by mounting one (D11).

**No HEAD.** FastAPI never auto-adds HEAD to a GET route (pinned by
`tests/test_streaming_head.py:119-127`), so `HEAD /subtitles` is a 405 — said out
loud because `(bigscreen)/_player/classify.ts` is HEAD-only and someone will try
it, and because `classifyStatus` maps every 2xx to `{kind: 'decode'}`, a sentence
about a video decoder.

Route ordering is a non-issue: both paths require a literal `subtitles` second
segment, so neither can shadow `/{torrent_id}/files` or `/{torrent_id}/video`.
"""
import os
from pathlib import PurePosixPath
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Path, Query, Response
from fastapi.responses import JSONResponse
from loguru import logger

from app.config import settings
from app.models import SubtitleList, SubtitleTrack
from app.providers.episodes import parse_episode
from app.subtitles import sidecars
from app.subtitles import naming
from app.torrent.content_guard import is_video_file
from app.torrent.manager import (
    SIDECAR_REFUSAL_NO_SUCH_SIDECAR,
    torrent_manager,
)

router = APIRouter()

# The WebVTT route's path (task 9 serves it from this same module). Built from the
# torrent's OWN libtorrent file index and never from the row's position in this
# list: a filtered position renumbers, and `manager.py` already forbids deriving a
# torrent's file order from its filenames in either direction (D9, measured —
# `lt.create_torrent` interleaved pad files so a 3-file tree became `num_files()
# == 6` with the sidecar at index 4, while the same tree built `v1_only` came out
# with 0 pads).
_VTT_URL = "{api}/streaming/{tid}/subtitles/{index}"


def _require_torrent(torrent_id: str):
    """The only two 404s on these routes (D6).

    `get_torrent_status` resolves from the DB (`manager.py:1015-1021`), so it
    answers for an EVICTED torrent too — which is the whole point: an evicted
    torrent gets `coverage: "unknown"` and a true sentence on the television,
    not a 404 that says the box does not recognise the title.

    A content-guard block is the other 404, and it is not cosmetic: a blocked
    torrent's files were deleted by `_block_torrent` (`manager.py:1567`) and
    there is no unblock path, so every row it could ever list is a row about
    bytes that are gone.
    """
    status = torrent_manager.get_torrent_status(torrent_id)
    if not status:
        raise HTTPException(status_code=404, detail="Torrent not found")
    if getattr(status, "block_reason", None):
        raise HTTPException(status_code=404, detail="Torrent not found")
    return status


def _live_video_files(torrent_id: str) -> List[Dict[str, Any]]:
    """The torrent's video files with their TORRENT-RELATIVE paths.

    Read straight off the live metadata rather than through
    `TorrentManager.get_video_files`, and the reason is the pairing ladder's own
    contract: that function builds `path` as `save_path / fi.path`
    (`manager.py:1186`) and `naming._entry_rel_path` RAISES on an absolute path
    on purpose — handing it one would silently prepend the save path's segments,
    so `/downloads` becomes the "torrent root" and D20's root exclusion (which
    exists because a range-named root overrides a correct later segment) would
    exclude the wrong segment. That failure produces a confident wrong pairing
    with no error anywhere. Relativising the absolutes back is not an option
    either: the DB's `save_path` is RELATIVE on this deployment while the
    handle's is absolute, so the arithmetic depends on the container's working
    directory.

    The video predicate is `content_guard.is_video_file` — the same function
    `TorrentManager._is_video_file` wraps (`manager.py:1124-1127`) and the same
    `settings.video_extensions` it reads, so there is one policy and not two.
    Pad files are excluded incidentally rather than by their flag: a pad is named
    `.pad/<size>` and carries no video extension, which is also why
    `get_video_files` has never checked the flag.

    Empty for an evicted torrent, for a magnet whose metadata has not arrived,
    and for any libtorrent error. Pairing then answers `none` for every sidecar,
    which is honest: with no video list there is nothing to pair against.
    """
    entry = torrent_manager.active_torrents.get(torrent_id)
    if entry is None:
        return []
    handle = entry[0]
    try:
        if not handle.has_metadata():
            return []
        ti = handle.get_torrent_info()
        num_files = int(ti.num_files())
        rows: List[Dict[str, Any]] = []
        for i in range(num_files):
            rel = str(ti.file_at(i).path).replace("\\", "/")
            if not is_video_file(rel, settings.video_extensions):
                continue
            rows.append({
                "index": i,
                "rel_path": rel,
                "name": PurePosixPath(rel).name,
            })
        return rows
    except Exception as e:
        logger.warning(
            f"Could not read the video file list for {torrent_id} ({e}); every "
            f"sidecar will be reported unpaired"
        )
        return []


def _describe(row: Dict[str, Any], videos: List[Dict[str, Any]],
              torrent_id: str) -> Dict[str, Any]:
    """One lister row plus its pairing, its language and its URL.

    `season`/`episode` describe the PAIRED VIDEO, parsed from that video's own
    basename exactly as `/files` does (`api/streaming.py:493`). They are a
    convenience for the television's copy; `video_index` is the join key, and the
    two cannot disagree because both come from the same paired file.
    """
    rel_path = row["rel_path"]
    video_index, pair_source = naming.pair(rel_path, videos)
    video = next((v for v in videos if v["index"] == video_index), None)
    video_stem = os.path.splitext(video["name"])[0] if video else ""
    lang, language_label, flags = naming.guess_language(rel_path, video_stem)
    season = episode = None
    if video is not None:
        parsed = parse_episode(video["name"])
        if parsed:
            season, episode = parsed
    return {
        "index": row["index"],
        "rel_path": rel_path,
        "video_index": video_index,
        "pair_source": pair_source,
        "season": season,
        "episode": episode,
        "lang": lang,
        "label": naming.track_label(language_label, pair_source),
        "flags": list(flags),
        "format": row["format"],
        "size": row["size"],
        "ready": bool(row["ready"]),
        "convertible": bool(row["convertible"]),
        "reason": row["reason"],
        "url": _VTT_URL.format(
            api=settings.api_v1_str, tid=torrent_id, index=row["index"]),
    }


def _deduped(described: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """One entry per language per paired video per CONVERTIBILITY CLASS.

    `naming.dedupe_by_language` collapses a language across whatever list it is
    handed (D21), so the grouping is the whole substance of this function and
    both halves of the key are load-bearing:

    * **`video_index`.** Deduping a four-episode pack in one pass would keep ONE
      English sidecar for the pack and silently discard the other three episodes'
      — and the television could not recover from that, because the entry it needs
      for the episode on screen would simply not be in the list.
    * **`convertible`.** Dedup's tie-break is `(forced, len(path), path)`, which
      knows nothing about format. `Subs/E02.en.ass` and `Subs/E02.en.srt` are the
      same length and `.ass` sorts first, so one pass would supersede the
      SERVABLE track with one stage 9 refuses to convert (D17) and the viewer
      would lose English entirely. The two classes are different kinds of row —
      an offer, and a statement that the release ships a format this box does not
      read — so they are deduped apart and never against each other.

    Unpaired rows (`video_index is None`) form their own group and are deduped
    within it: three English sidecars nobody could pair are still one offer.
    """
    groups: Dict[Any, List[Dict[str, Any]]] = {}
    for entry in described:
        groups.setdefault(
            (entry["video_index"], bool(entry["convertible"])), []).append(entry)
    kept: List[Dict[str, Any]] = []
    for group in groups.values():
        kept.extend(naming.dedupe_by_language(group))
    return sorted(kept, key=lambda e: e["index"])


def _track(entry: Dict[str, Any]) -> SubtitleTrack:
    """The wire row. `rel_path` stays server-side.

    Built field by field rather than with `**entry`, because `SubtitleTrack`
    forbids extras (see its docstring): `rel_path` is an internal join key and
    the path of a file inside someone else's torrent is not something a list
    endpoint needs to hand out.
    """
    return SubtitleTrack(
        index=entry["index"],
        video_index=entry["video_index"],
        pair_source=entry["pair_source"],
        season=entry["season"],
        episode=entry["episode"],
        lang=entry["lang"],
        label=entry["label"],
        flags=entry["flags"],
        format=entry["format"],
        size=entry["size"],
        ready=entry["ready"],
        convertible=entry["convertible"],
        reason=entry["reason"],
        url=entry["url"],
    )


@router.get(
    "/{torrent_id}/subtitles",
    response_model=SubtitleList,
    summary="List a torrent's sidecar subtitle files",
)
async def list_subtitles(
    response: Response,
    torrent_id: str = Path(..., description="ID of the torrent"),
    file_index: Optional[int] = Query(
        None, description="Only sidecars paired to this video file index"),
):
    """The subtitle list. A READ: nothing here admits, flushes or retracts.

    `HEAD` is a 405 — FastAPI never auto-adds it to a GET route, and
    `classify.ts` is HEAD-only, so this is said in the docstring the next person
    reads rather than discovered on the set.

    `Cache-Control: no-store`, because `ready` flips underneath this URL while a
    download runs: a cached answer is the one thing the television must never
    believe.
    """
    status = _require_torrent(torrent_id)
    response.headers["Cache-Control"] = "no-store"

    coverage, rows = torrent_manager.list_sidecars(torrent_id)
    videos = _live_video_files(torrent_id)

    # The filter is VALIDATED, never silently ignored: a file_index naming a
    # non-video file or an index the torrent does not have is a client bug, and
    # answering it with the unfiltered list would caption whatever episode
    # happens to sort first. Validated ONLY where there is live metadata to
    # validate against — for an evicted torrent (`coverage: "unknown"`) there is
    # no file list at all (D5), and 404ing the television's own
    # `?file_index=` there would replace `Subtitles - unavailable` with "The box
    # doesn't recognise this title."
    if file_index is not None and coverage != sidecars.COVERAGE_UNKNOWN:
        if not any(v["index"] == file_index for v in videos):
            raise HTTPException(
                status_code=404,
                detail=f"File index {file_index} is not a video file in this torrent",
            )

    described = [_describe(row, videos, torrent_id) for row in rows]
    if file_index is not None:
        described = [e for e in described if e["video_index"] == file_index]
    entries = _deduped(described)

    return SubtitleList(
        torrent_id=torrent_id,
        state=str(getattr(status.state, "value", status.state)),
        coverage=coverage,
        # The live session is the ONLY source stage 9 has, so `source` is the
        # session or nothing. A `"resume"` arm needs the stage-7 `save_info_dict`
        # repair first: every blob this application has ever written carries no
        # `info` dict, so `read_resume_data(...).ti` is None (D5).
        source=(None if coverage == sidecars.COVERAGE_UNKNOWN
                else sidecars.SOURCE_SESSION),
        paired_to=file_index,
        subtitles=[_track(e) for e in entries],
    )


def _budget_ms() -> int:
    """The admission's budget, read defensively (an unreadable setting is 0)."""
    try:
        return int(settings.subtitle_admit_budget_ms)
    except (TypeError, ValueError):  # pragma: no cover - defensive
        return 0


@router.post(
    "/{torrent_id}/subtitles/{index}/fetch",
    status_code=202,
    summary="Admit one sidecar subtitle's pieces",
)
async def fetch_subtitle(
    torrent_id: str = Path(..., description="ID of the torrent"),
    index: int = Path(..., description="The torrent's own file index"),
):
    """Admit one sidecar's pieces and RETURN IMMEDIATELY.

    The only mutating route in stage 9 (D2). It starts task 7's driver — admit,
    wait for the span, flush, retract on the right exit — and does not wait for
    it: a POST that waited would hold a request open for up to
    `subtitle_admit_budget_ms` (45 s by default). The television learns the
    outcome by POLLING THE LIST, never from this response.

    `202 {admitted, budget_ms}` on success, and **`admitted: 0` is a success**.
    It is the gate-4 no-op C1 measured: the sidecar shares a piece with a wanted
    video file, so its bytes are already on their way and there was nothing to
    raise. Answering 409 there would have the television refuse a subtitle that
    is already coming.

    `409 {reason}` for a refused gate, naming the gate. `404` when the torrent
    has no row, when it is content-guard blocked, or when `index` is not one the
    LIST produced — resolution goes through the lister and nowhere else (D9), so
    an oversized sidecar, one whose extension is not configured, and one whose
    path escapes the save path are all unfetchable for the same reason they are
    unlistable, with no second policy to drift.
    """
    _require_torrent(torrent_id)

    _coverage, rows = torrent_manager.list_sidecars(torrent_id)
    if not any(r["index"] == index for r in rows):
        raise HTTPException(
            status_code=404,
            detail=f"Subtitle index {index} is not in this torrent",
        )

    budget_ms = _budget_ms()
    result = torrent_manager.start_sidecar_fetch(torrent_id, index, budget_ms)
    if result.refusal is not None:
        if result.refusal == SIDECAR_REFUSAL_NO_SUCH_SIDECAR:
            # Raced: the list resolved it and the session lost it in between.
            raise HTTPException(
                status_code=404,
                detail=f"Subtitle index {index} is not in this torrent",
            )
        return JSONResponse(status_code=409, content={"reason": result.refusal})
    return {"admitted": result.admitted, "budget_ms": budget_ms}
