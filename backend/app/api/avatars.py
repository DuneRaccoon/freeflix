"""Tier-2 avatars: cache a TMDB still and serve it back.

The client sends a TMDB PATH FRAGMENT, never a URL. This module builds the
image.tmdb.org URL itself, which is what keeps AssetManager's fetcher from
being aimed at an arbitrary host.
"""
import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, field_validator

from app.assets.manager import get_asset_manager
from app.providers.catalog import image_url

router = APIRouter()

# TMDB image paths are a 20-40 char base-62 stem plus an extension.
_TMDB_PATH_RE = re.compile(r"/[A-Za-z0-9]{20,40}\.(jpg|png)")
_ASSET_NAME_RE = re.compile(r"[a-zA-Z0-9_]{1,80}\.(jpg|png)")


class FromTmdbRequest(BaseModel):
    path: str

    @field_validator("path")
    @classmethod
    def _tmdb_path_only(cls, v: str) -> str:
        if not _TMDB_PATH_RE.fullmatch(v):
            raise ValueError("not a TMDB image path")
        return v


class FromTmdbResponse(BaseModel):
    id: str


@router.post("/from-tmdb", response_model=FromTmdbResponse)
async def cache_tmdb_still(payload: FromTmdbRequest) -> FromTmdbResponse:
    """Download a TMDB still once and mint the `cached:` id that names it."""
    url = image_url(payload.path, "w342")
    if not url:
        raise HTTPException(status_code=422, detail="Could not build an image URL")

    manager = get_asset_manager()
    ok, result = await manager.download_asset(url, asset_type="avatar")
    if not ok:
        raise HTTPException(status_code=502, detail="Could not fetch that image")

    stem = manager.get_local_path(url, "avatar").stem
    return FromTmdbResponse(id=f"cached:{stem}")


assets_router = APIRouter()


@assets_router.get("/avatars/{name}")
async def serve_avatar(name: str) -> Response:
    if not _ASSET_NAME_RE.fullmatch(name):
        raise HTTPException(status_code=404, detail="Not found")
    try:
        content, content_type = get_asset_manager().serve_asset(f"avatars/{name}")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Not found")
    return Response(content=content, media_type=content_type,
                    headers={"Cache-Control": "public, max-age=31536000, immutable"})
