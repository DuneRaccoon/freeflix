from fastapi import APIRouter, Query
from typing import Optional

from app.models import RailsResponse
from app.services import rails as rails_service

router = APIRouter()


@router.get("", response_model=RailsResponse, summary="Personalised browse rails")
async def get_rails(
    mode: str = Query("movie", pattern="^(movie|tv)$"),
    user_id: Optional[str] = Query(None),
    surface: str = Query(""),
    limit: int = Query(10, ge=1, le=20),
):
    return RailsResponse(rails=rails_service.plan_rails(
        user_id=user_id, mode=mode, limit=limit, surface=surface))
