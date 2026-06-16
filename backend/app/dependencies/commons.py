from uuid import UUID
from typing import Annotated, Union
from datetime import datetime
from typing import Optional, Literal
from fastapi import (
    Depends,
    Query,
)
from app.models import (
    OrderByLiteral,
    GenreLiteral,
    QualityLiteral,
    RatingLiteral,
    YearLiteral
)


async def search_params(
    keyword: Annotated[
        Optional[str],
        Query(..., description="Search keyword")
    ] = None,
    quality: Annotated[
        Optional[QualityLiteral],
        Query(..., description="Filter by quality")
    ] = None,
    genre: Annotated[
        Optional[GenreLiteral],
        Query(..., description="Filter by genre")
    ] = None,
    rating: Annotated[
        Optional[RatingLiteral],
        Query(..., description="Filter by rating")
    ] = None,
    year: Annotated[
        Optional[YearLiteral],
        Query(..., description="Filter by year")
    ] = None,
    order_by: Annotated[
        Optional[OrderByLiteral],
        Query(..., description="Order by field")
    ] = None,
    page: Annotated[
        Optional[int],
        Query(1, gt=0, description="Page number")
    ] = 1
):
    return dict(
        keyword=keyword,
        quality=quality,
        genre=genre,
        rating=rating,
        year=year,
        order_by=order_by,
        page=page
    )
    
SearchDependencies = Annotated[dict, Depends(search_params)]