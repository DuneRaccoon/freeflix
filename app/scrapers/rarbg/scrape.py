import httpx
import asyncio
import random
import time
import uuid
from bs4 import BeautifulSoup as bs
from loguru import logger
from typing import List, Dict, Any, Optional, Literal
from leakybucket import LeakyBucket
from leakybucket.persistence import InMemoryLeakyBucketStorage
from playwright.async_api import async_playwright, Browser, Page, TimeoutError
from app.models import Movie, Torrent, SearchParams
from app.config import settings
from app.utils.user_agent import get_random_user_agent

from .cloudfare import CloudflareBypass

throttler = LeakyBucket(
    InMemoryLeakyBucketStorage(
        max_rate=1,  # Reduced to 1 request per time period
        time_period=5  # Increased to 5 seconds between requests
    )
)

# Dictionary to store cookies for session persistence
cookies_store = {}

async def browse_rarbg(path: Literal['movies', 'series'], params: SearchParams) -> List[Movie]:
    """Browse RARBG movies with the given parameters using advanced anti-detection techniques"""
    
    if path not in ['movies', 'series']:
        raise ValueError("Invalid path. Must be 'movies' or 'series'")
    
    # Convert params to dict for request
    query_params = {
        k: v for k, v in params.model_dump().items() 
        if v is not None and k != 'page'
    }
    
    # Add page param if it exists
    if params.page:
        query_params['page'] = params.page
    
    logger.info(f'Attempting to browse RARBG {path} with parameters: {query_params}')
    
    # Try three different approaches in sequence if needed
    return await try_playwright_approach(path, query_params) or await try_advanced_httpx(path, query_params) or []

async def try_advanced_httpx(path: Literal['movies', 'series'], query_params: Dict[str, Any]) -> List[Movie]:
    """Try using advanced HTTPX configuration with proper headers and cookies"""
    
    throttler.throttle()  # Apply rate limiting
    
    # Add random delay to mimic human behavior
    await asyncio.sleep(random.uniform(2, 5))
    
    # Create sophisticated browser-like headers
    user_agent = get_random_user_agent()
    target_url = settings.rarbg_url.format(path=path)
    
    headers = {
        'User-Agent': user_agent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.google.com/',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Cache-Control': 'max-age=0',
    }
    
    # Use cookies if we have them
    cookies = cookies_store.get(target_url)
    
    async with httpx.AsyncClient(headers=headers, cookies=cookies, follow_redirects=True) as client:
        try:
            # First visit the homepage to get any cookies
            if not cookies:
                logger.info("First visiting homepage to establish session")
                home_response = await client.get(
                    settings.rarbg_url.format(path=""),
                    timeout=20.0
                )
                
                if home_response.status_code == 200:
                    # Store cookies for future requests
                    cookies_store[target_url] = dict(home_response.cookies)
                
                # Add delay to seem more human-like
                await asyncio.sleep(random.uniform(3, 6))
            
            # Now make the actual request
            logger.info(f"Making request to {target_url}")
            response = await client.get(
                target_url,
                params=query_params, 
                timeout=20.0,
            )
            
            if response.status_code == 403:
                logger.warning("Received 403 Forbidden. Server is blocking our request.")
                return []
                
            response.raise_for_status()
            
            # Parse and process the response
            return await process_rarbg_response(response.text)
            
        except httpx.RequestError as e:
            logger.error(f"Request error: {e}")
            return []
        except Exception as e:
            logger.error(f"Error browsing RARBG: {e}")
            return []

async def try_playwright_approach(path: Literal['movies', 'series'], query_params: Dict[str, Any]) -> List[Movie]:
    """Use Playwright to control a real browser and bypass advanced detection"""
    
    logger.info("Attempting to use Playwright for browser automation")
    
    try:
        # Build the URL with query parameters
        base_url = settings.rarbg_url.format(path=path)
        query_string = "&".join([f"{k}={v}" for k, v in query_params.items()])
        url = f"{base_url}?{query_string}" if query_string else base_url
        
        logger.info(f"Attempting to browse RARBG with URL: {url}")

        cf_bypass = CloudflareBypass()

        try:
            # Attempt to solve the Cloudflare challenge
            if await cf_bypass.solve_cloudflare_challenge(url):
                # Get the page content after bypassing Cloudflare
                content = await cf_bypass.get_page_content()
                
                # Process the content
                movies = await process_rarbg_response(content)
                return movies
            else:
                logger.error("Failed to bypass Cloudflare protection")
                return []
        finally:
            # Make sure to clean up resources
            await cf_bypass.cleanup()
        
    except Exception as e:
        logger.error(f"Playwright error: {e}")
        return []

async def process_rarbg_response(html_content: str) -> List[Movie]:
    """Process the HTML response and extract movie information"""
    
    soup = bs(html_content, 'html.parser')
    
    # Check if we were blocked (look for specific signs)
    if "Access Denied" in html_content or "403 Forbidden" in html_content:
        logger.warning("Access denied or 403 page detected in response")
        return []
        
    # Check if we have results
    no_results = soup.select_one('div.browse-no-results')
    if no_results:
        logger.info("No movies found with the given criteria")
        return []
    
    # Process results
    movies = []
    # Implement RARBG-specific parsing logic here
    # This would depend on RARBG's HTML structure
    
    # Example pattern (customize based on actual site structure):
    movie_elements = soup.select('div.torrent-list-item') or soup.select('tr.list-item')
    
    for element in movie_elements:
        try:
            # Extract movie info based on RARBG's HTML structure
            # These selectors need to be adjusted based on actual HTML
            title_element = element.select_one('a.movie-title')
            link_element = element.select_one('a.torrent-link')
            
            if title_element and link_element:
                # Build movie object
                movie = Movie(
                    title=title_element.text.strip(),
                    year=extract_year(title_element.text),
                    rating="N/A",  # May need separate lookup
                    link=link_element['href'],
                    genre="N/A",  # May need separate lookup
                    img="N/A",    # May need separate lookup
                    torrents=[
                        Torrent(
                            id=str(uuid.uuid4()),
                            quality=extract_quality(title_element.text),
                            sizes=("N/A", "N/A"),  # Extract from page
                            url=link_element['href'],
                            magnet=extract_magnet(element)
                        )
                    ]
                )
                movies.append(movie)
        except Exception as e:
            logger.error(f"Error parsing movie element: {e}")
            continue
    
    logger.info(f"Successfully extracted {len(movies)} movies")
    return movies

def extract_year(title_text: str) -> int:
    """Extract year from title text using regex"""
    import re
    year_match = re.search(r'\((\d{4})\)', title_text)
    return int(year_match.group(1)) if year_match else 2023

def extract_quality(title_text: str) -> str:
    """Extract quality from title text"""
    if '2160p' in title_text or '4K' in title_text:
        return '2160p'
    elif '1080p' in title_text:
        return '1080p'
    elif '720p' in title_text:
        return '720p'
    else:
        return 'unknown'

def extract_magnet(element) -> str:
    """Extract magnet link from element"""
    magnet_link = element.select_one('a[href^="magnet:"]')
    return magnet_link['href'] if magnet_link else "magnet:?xt=urn:btih:DUMMY"