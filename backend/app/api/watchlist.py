# app/api/watchlist.py
from fastapi import APIRouter, HTTPException, Depends
from typing import List, Annotated
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.database.models import User
from app.database.models.watchlist import UserWatchlist
from app.models import WatchlistItemCreate, WatchlistItemResponse

router = APIRouter()


@router.post("/{user_id}/add", response_model=WatchlistItemResponse, status_code=201)
async def add_to_watchlist(
    user_id: str,
    item: WatchlistItemCreate,
    db: Annotated[Session, Depends(get_db)],
):
    """Add a content item to a user's watchlist. Returns 409 if already saved."""
    with db as session:
        user = session.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        existing = UserWatchlist.find(session, user_id, item.content_id)
        if existing:
            raise HTTPException(
                status_code=409,
                detail="Item already in watchlist",
            )

        entry = UserWatchlist(
            user_id=user_id,
            content_id=item.content_id,
            tmdb_id=item.tmdb_id,
            media_type=item.media_type,
            title=item.title,
        )
        session.add(entry)
        session.commit()
        session.refresh(entry)
        return WatchlistItemResponse.model_validate(entry)


@router.delete("/{user_id}/{content_id}", status_code=200)
async def remove_from_watchlist(
    user_id: str,
    content_id: str,
    db: Annotated[Session, Depends(get_db)],
):
    """Remove a content item from a user's watchlist."""
    with db as session:
        entry = UserWatchlist.find(session, user_id, content_id)
        if not entry:
            raise HTTPException(status_code=404, detail="Item not in watchlist")

        session.delete(entry)
        session.commit()
        return {"message": "Removed from watchlist"}


@router.get("/{user_id}", response_model=List[WatchlistItemResponse])
async def get_watchlist(
    user_id: str,
    db: Annotated[Session, Depends(get_db)],
):
    """Return all watchlist entries for a user, newest first."""
    with db as session:
        user = session.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        entries = UserWatchlist.get_for_user(session, user_id)
        return [WatchlistItemResponse.model_validate(e) for e in entries]
