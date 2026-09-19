from fastapi import APIRouter, Depends, Query
from typing import Optional

from app.dependencies.auth import require_optional_profile
from app.models import RailsResponse
from app.services import rails as rails_service

router = APIRouter()


@router.get("", response_model=RailsResponse, summary="Personalised browse rails")
async def get_rails(
    mode: str = Query("movie", pattern="^(movie|tv)$"),
    # Validated against the session: the id is caller-supplied, and the rails it
    # produces are derived from that profile's watch history and watchlist.
    user_id: Optional[str] = Depends(require_optional_profile),
    surface: str = Query(""),
    limit: int = Query(10, ge=1, le=20),
    random_slots: int = Query(2, ge=0, le=5),
):
    return RailsResponse(rails=rails_service.plan_rails(
        user_id=user_id, mode=mode, limit=limit, surface=surface, random_slots=random_slots))
