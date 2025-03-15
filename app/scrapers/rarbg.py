import httpx
import asyncio
import uuid
from bs4 import BeautifulSoup as bs
from loguru import logger
from typing import List, Dict, Any, Optional, Literal
from leakybucket import LeakyBucket
from leakybucket.persistence import InMemoryLeakyBucketStorage

from app.models import Movie, Torrent, SearchParams
from app.config import settings
from app.utils.user_agent import get_random_user_agent

# Initialize rate limiter
throttler = LeakyBucket(InMemoryLeakyBucketStorage(
    max_rate=settings.request_rate_limit, 
    time_period=1
))

user_agent = get_random_user_agent()

throttler.throttle()
async def browse_rarbg(path: Literal['movies', 'series'], params: SearchParams) -> List[Movie]:
    """Browse RARBG movies with the given parameters"""
    
    if not path in ['movies', 'series']:
        raise ValueError("Invalid path. Must be 'movies' or 'series'")
    
    # Convert params to dict for httpx
    query_params = {
        k: v for k, v in params.model_dump().items() 
        if v is not None and k != 'page'
    }
    
    # Add page param if it exists
    if params.page:
        query_params['page'] = params.page
    
    async with httpx.AsyncClient(headers={'User-Agent': user_agent}) as client:
        try:
            logger.info(f'Browsing RARBG {path} with parameters:')
            logger.info(f"{query_params}")
            
            response = await client.get(
                settings.rarbg_url.format(path=path), 
                params=query_params, 
                timeout=15.0
            )
            response.raise_for_status()
            
            soup = bs(response.text, 'html.parser')
            
            # Check if we have results
            no_results = soup.select_one('div.browse-no-results')
            if no_results:
                logger.info("No movies found with the given criteria")
                return []
            
            # movies = await scrape_movies(soup)
            # return movies
            
        except httpx.RequestError as e:
            logger.error(f"Request error: {e}")
            return []
        except Exception as e:
            logger.error(f"Error browsing YTS: {e}")
            return []

