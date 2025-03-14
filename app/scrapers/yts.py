import httpx
import asyncio
import uuid
import datetime
from bs4 import BeautifulSoup as bs
from loguru import logger
from typing import List, Dict, Any, Optional
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
async def fetch_available_torrents(movie_url: str) -> List[Torrent]:
    """Fetch available torrents for a specific movie URL"""
    async with httpx.AsyncClient(headers={'User-Agent': user_agent}) as client:
        try:
            logger.info(f'Fetching available torrents for {movie_url}')
            response = await client.get(movie_url, timeout=10.0)
            response.raise_for_status()
            soup = bs(response.text, 'html.parser')
            torrents = []
            
            for torrent in soup.select('div.modal-torrent'):
                quality = torrent.select_one('div.modal-quality').text.strip('\n')
                sizes = tuple(s.text for s in torrent.select('p.quality-size'))
                torrent_url = torrent.select_one('a.download-torrent')['href']
                magnet = torrent.select_one('a.magnet-download')['href']
                
                # Generate a unique ID for the torrent
                torrent_id = str(uuid.uuid4())
                
                torrents.append(Torrent(
                    id=torrent_id,
                    quality=quality,
                    sizes=sizes,
                    url=f'{settings.yify_url}{torrent_url}',
                    magnet=magnet
                ))
            return torrents
        except httpx.RequestError as e:
            logger.error(f"Request error for {movie_url}: {e}")
            return []
        except Exception as e:
            logger.error(f"Error fetching torrents for {movie_url}: {e}")
            return []


async def scrape_movies(soup: bs) -> List[Movie]:
    """Extract movie information from the soup object"""
    async def _scrape_movie(movie: bs, soup: bs) -> Movie:
        try:
            title = movie.select_one('div.browse-movie-bottom > a.browse-movie-title').text
            year = int(movie.select_one('div.browse-movie-year').text)
            rating = movie.select_one('h4.rating').text
            link = movie.select_one('a.browse-movie-link')['href']
            genre = movie.select_one('h4.rating').find_next('h4').text
            img = movie.select_one('img.img-responsive')['src']
            description = soup.select_one('#synopsis')
            
            return Movie(
                title=title,
                year=year,
                rating=rating,
                link=f'{settings.yify_url}{link}',
                genre=genre,
                img=f'{settings.yify_url}{img}',
                description=description.text if description else None,
                torrents=(
                    await fetch_available_torrents(f'{settings.yify_url}{link}')
                )
            )
        except Exception as e:
            logger.error(f"Error scraping movie: {e}")
            return None
    
    results = await asyncio.gather(*[
        _scrape_movie(movie, soup) for movie in soup.select('div.browse-movie-wrap')
    ])
    
    # Filter out None values (failed scrapes)
    return [movie for movie in results if movie is not None]

throttler.throttle()
async def browse_yts(params: SearchParams) -> List[Movie]:
    """Browse YTS movies with the given parameters"""
    
    # # Convert params to dict for httpx
    # query_params = {
    #     k: v for k, v in params.model_dump().items() 
    #     if v is not None and k != 'page'
    # }
    
    query_params = {
        k: v for k, v in params.model_dump(
            exclude=['page'],
            exclude_none=True
        ).items()
    }
    
    # Add page param if it exists
    if params.page:
        query_params['page'] = params.page
    
    async with httpx.AsyncClient(headers={'User-Agent': user_agent}) as client:
        try:
            response = await client.get(
                settings.yify_url_browse_url, 
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
            
            movies = await scrape_movies(soup)
            return movies[:params.limit] if params.limit else movies
            
        except httpx.RequestError as e:
            logger.error(f"Request error: {e}")
            return []
        except Exception as e:
            logger.error(f"Error browsing YTS: {e}")
            return []


async def search_movie(title: str) -> List[Movie]:
    """Search for a movie by title"""
    params = SearchParams(keyword=title)
    return await browse_yts(params)

throttler.throttle()
async def get_movie_by_url(url: str) -> Optional[Movie]:
    """Fetch a specific movie by its URL"""
    async with httpx.AsyncClient(headers={'User-Agent': user_agent}) as client:
        try:
            logger.info(f'Fetching movie details for {url}')
            response = await client.get(url, timeout=10.0)
            response.raise_for_status()
            
            soup = bs(response.text, 'html.parser')
            
            # Extract movie details
            title = soup.select_one('#movie-info h1').text
            year = int(soup.select_one('#movie-info h2').text)
            genre = ", ".join(soup.select_one('#movie-info h2 ~ h2').text.split(' / '))
            rating = soup.find(attrs={'itemprop': "ratingValue"}).text
            img = soup.select_one('#movie-poster img')['src']
            
            torrents = []
            for torrent in soup.select('div.modal-torrent'):
                quality = torrent.select_one('div.modal-quality').text.strip('\n')
                sizes = tuple(s.text for s in torrent.select('p.quality-size'))
                torrent_url = torrent.select_one('a.download-torrent')['href']
                magnet = torrent.select_one('a.magnet-download')['href']
                
                # Generate a unique ID for the torrent
                torrent_id = str(uuid.uuid4())
                
                torrents.append(Torrent(
                    id=torrent_id,
                    quality=quality,
                    sizes=sizes,
                    url=f'{settings.yify_url}{torrent_url}',
                    magnet=magnet
                ))
            
            return Movie(
                title=title,
                year=year,
                rating=rating,
                link=url,
                genre=genre,
                img=f'{settings.yify_url}{img}',
                torrents=torrents
            )
            
        except httpx.RequestError as e:
            logger.error(f"Request error for {url}", exc_info=e)
            return None
        except Exception as e:
            logger.error(f"Error getting movie details for {url}", exc_info=e)
            return None