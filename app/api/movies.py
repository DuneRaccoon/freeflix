import datetime
from fastapi import APIRouter, HTTPException, Query, Depends, Path
from typing import List, Optional, Annotated
from pydantic import HttpUrl
from sqlalchemy.orm import Session
import uuid

from app.models import Movie, SearchParams
from app.scrapers.yts import browse_yts, search_movie, get_movie_by_url
from app.database.models import MovieCache
from app.database.session import get_db
from app.services.movies import movie_details_service
from app.config import settings
from app.models import (
    DetailedMovie, 
    MovieRating, 
    CastMember, 
    MovieCredits, 
    MovieMedia, 
    Review, 
    Torrent,
    RelatedMovie
)
from loguru import logger

router = APIRouter()


@router.get("/search", response_model=List[Movie], summary="Search movies by title")
async def search_movies(title: str = Query(..., description="Movie title to search for")):
    """
    Search for movies by title.
    
    Returns a list of movies matching the search query.
    
    ###Search for a movie
    ```bash
    curl -X GET "http://localhost:8000/api/v1/movies/search?title=matrix"
    ```
    """
    movies = await search_movie(title)
    return movies


@router.post("/browse", response_model=List[Movie], summary="Browse movies with filters")
async def browse_movies(params: SearchParams, db: Annotated[Session, Depends(get_db)]):
    """
    Browse movies with various filters.
    
    - **keyword**: Search term
    - **quality**: Filter by quality (all, 720p, 1080p, 2160p)
    - **genre**: Filter by genre
    - **rating**: Minimum IMDB rating
    - **year**: Filter by year
    - **order_by**: Sort order (featured, date, seeds, peers, etc.)
    - **page**: Page number
    """
    movies = await browse_yts(params)
    # for movie in movies:
    #     movie_orm = MovieCache(
    #         title=movie.title,
    #         year=movie.year,
    #         rating=movie.rating,
    #         link=str(movie.link),
    #         genre=movie.genre,
    #         img=str(movie.img),
    #         description=movie.description,
    #         torrents_json=[{k: str(v) for k,v in t.model_dump().items()} for t in movie.torrents],
    #         expires_at=datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1)
    #     )
    #     movie_orm.save(db)
    return movies


@router.get("/movie", response_model=Movie, summary="Get movie details by URL")
async def get_movie(url: HttpUrl):
    """
    Get detailed information about a specific movie by its URL.
    """
    movie = await get_movie_by_url(str(url))
    if not movie:
        raise HTTPException(status_code=404, detail="Movie not found")
    return movie


@router.get("/latest", response_model=List[Movie], summary="Get latest movies")
async def get_latest(
    limit: int = Query(10, ge=1, le=50, description="Number of movies to return"),
    quality: Optional[str] = Query(None, description="Filter by quality")
):
    """
    Get the latest movies added to YTS.
    
    - **limit**: Number of movies to return (default: 10, max: 50)
    - **quality**: Optional filter by quality (720p, 1080p, 2160p)
    """
    params = SearchParams(
        order_by="latest",
        quality=quality or "all"
    )
    
    movies = await browse_yts(params)
    return movies[:limit]


@router.get("/top", response_model=List[Movie], summary="Get top rated movies")
async def get_top_rated(
    limit: int = Query(10, ge=1, le=50, description="Number of movies to return"),
    quality: Optional[str] = Query(None, description="Filter by quality"),
    genre: Optional[str] = Query(None, description="Filter by genre"),
    year: Optional[int] = Query(None, description="Filter by year")
):
    """
    Get top rated movies.
    
    - **limit**: Number of movies to return (default: 10, max: 50)
    - **quality**: Optional filter by quality (720p, 1080p, 2160p)
    - **genre**: Optional filter by genre
    - **year**: Optional filter by year
    """
    params = SearchParams(
        order_by="rating",
        quality=quality or "all",
        genre=genre or "all",
        year=year
    )
    
    movies = await browse_yts(params)
    return movies[:limit]

@router.get("/details", response_model=DetailedMovie, summary="Get detailed movie information")
async def get_movie_details(
    movie_id: Optional[str] = Query(None, description="ID or URL of the movie"),
    title: Optional[str] = Query(None, description="Title of the movie"),
    db: Session = Depends(get_db)
):
    """
    Get detailed information about a movie, including data from external sources like IMDB and Rotten Tomatoes.
    
    This endpoint returns enhanced movie information with cast, reviews, and additional metadata.
    The data is cached in the database to improve performance and reduce external API calls.
    """
    try:
        if movie_id is None and title is None:
            raise HTTPException(status_code=400, detail="Missing movie ID or title")
        
        with db as session:
            is_url = False
            
            if movie_id:
                # Check if movie_id is a URL or an ID
                is_url = movie_id.startswith('http')
                
                # Try to get from cache first
                movie_cache = None
                if is_url:
                    movie_cache = MovieCache.get_with_extended_data(session, movie_id)
                else:
                    movie_cache = session.query(MovieCache).filter(MovieCache.id == movie_id).first()   
            else:
                # Search for the movie by title
                movie_cache = session.query(MovieCache).filter(MovieCache.title == title).first()
                    
            # If not in cache or external data not fetched, get basic movie info first
            if not movie_cache:
                if is_url:
                    # It's a URL, get the movie from YTS
                    basic_movie = await get_movie_by_url(movie_id)
                    if not basic_movie:
                        raise HTTPException(status_code=404, detail="Movie not found")
                        
                    # Store in cache
                    now = datetime.datetime.now(datetime.timezone.utc)
                    expires = now + datetime.timedelta(days=settings.cache_movies_for)
                    
                    movie_cache = MovieCache(
                        id=str(uuid.uuid4()),
                        title=basic_movie.title,
                        year=basic_movie.year,
                        link=str(basic_movie.link),
                        rating=basic_movie.rating,
                        genre=basic_movie.genre,
                        img=str(basic_movie.img),
                        description=basic_movie.description,
                        torrents_json=[t.model_dump(mode='json') for t in basic_movie.torrents],
                        fetched_at=now,
                        expires_at=expires
                    )
                    session.add(movie_cache)
                    session.commit()
                    session.refresh(movie_cache)
                else:
                    raise HTTPException(status_code=404, detail="Movie not found in cache")
            
            # Check if we need to fetch extended data
            extended_data_fresh = (
                movie_cache.extended_data_fetched_at is not None and
                # (datetime.datetime.now(datetime.timezone.utc) - movie_cache.extended_data_fetched_at) < datetime.timedelta(days=settings.cache_movies_for)
                (datetime.datetime.now() - movie_cache.extended_data_fetched_at) < datetime.timedelta(days=settings.cache_movies_for)
            )
            
            if not extended_data_fresh:
                # Fetch extended data from external sources
                try:
                    extended_data = await movie_details_service.get_movie_details(
                        movie_cache.title, 
                        movie_cache.year
                    )
                except Exception as e:
                    logger.error(f"Failed to fetch extended movie data: {e}")
                    logger.exception("Error Details:")
                    extended_data = None
                    
                # Update the cache with extended data
                if extended_data:
                    MovieCache.update_extended_data(session, movie_cache.id, extended_data)
                    
                    # Refresh our movie_cache object
                    movie_cache = session.query(MovieCache).filter(MovieCache.id == movie_cache.id).first()
            
            # Convert to response model
            detailed_movie = DetailedMovie(
                id=movie_cache.id,
                title=movie_cache.title,
                year=movie_cache.year,
                rating=movie_cache.rating,
                link=movie_cache.link,
                genre=movie_cache.genre,
                img=movie_cache.img,
                description=movie_cache.description or movie_cache.plot,
                plot=movie_cache.plot,
                runtime=movie_cache.runtime,
                language=movie_cache.language,
                country=movie_cache.country,
                imdb_id=movie_cache.imdb_id,
                awards=movie_cache.awards,
                movie_info_json=movie_cache.movie_info_json,
                
                # Nested structures
                torrents=[Torrent(**t) for t in movie_cache.torrents_json],
                ratings=MovieRating(
                    imdb=movie_cache.imdb_rating,
                    imdbVotes=movie_cache.imdb_votes,
                    rottenTomatoes=movie_cache.rotten_tomatoes_rating,
                    rottenTomatoesCount=movie_cache.rotten_tomatoes_total_review_count,
                    rottenTomatoesAudience=movie_cache.rotten_tomatoes_audience_rating,
                    rottenTomatoesAudienceCount=movie_cache.rotten_tomatoes_audience_review_count,
                    metacritic=movie_cache.metacritic_rating,
                    metacriticCount=movie_cache.metacritic_votes
                ),
                credits=MovieCredits(
                    director=movie_cache.director,
                    cast=[CastMember(**member) for member in (movie_cache.cast or [])]
                ),
                media=MovieMedia(
                    poster=movie_cache.poster_url or movie_cache.img,
                    backdrop=movie_cache.backdrop_url,
                    trailer=movie_cache.trailer_url
                ),
                reviews=[Review(**review) for review in (movie_cache.reviews or [])],
                related_movies=[RelatedMovie(**related) for related in (movie_cache.related_movies or [])]
            )
            
            return detailed_movie
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting detailed movie information: {e}")
        logger.exception("Error Details:")
        raise HTTPException(status_code=500, detail="Failed to fetch movie details")