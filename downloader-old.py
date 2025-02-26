import httpx
import time
import asyncio
import libtorrent as lt
from torf import Magnet
from pathlib import Path
from loguru import logger
from pydantic import BaseModel, HttpUrl
from leakybucket import LeakyBucket
from leakybucket.persistence import InMemoryLeakyBucketStorage
from typing import Optional, List, Tuple, Literal
from bs4 import BeautifulSoup as bs

BASE_URL = 'https://en.yts-official.mx'
BROWSE_URL = f'{BASE_URL}/browse-movies'

throttler = LeakyBucket(InMemoryLeakyBucketStorage(max_rate=3, time_period=1)) 

logger.add(
    'logs/{time:YYYY-MM-DD}.log',
    level='INFO',
    backtrace=True,
    diagnose=True,
    colorize=True,
    format='<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <cyan>{level}</cyan> | {message}',
    rotation='1 day',
)

class Torrent(BaseModel):
    quality: str
    sizes: Tuple[str, str]
    url: HttpUrl
    magnet: str

class Movie(BaseModel):
    title: str
    year: int
    rating: str
    link: HttpUrl
    genre: str
    img: HttpUrl
    torrents: List[Torrent]

async def scrape_movies(soup: bs):
    async def _scrape_movie(movie: bs):
        title = movie.select_one('div.browse-movie-bottom > a.browse-movie-title').text
        year = movie.select_one('div.browse-movie-year').text
        rating = movie.select_one('h4.rating').text
        link = movie.select_one('a.browse-movie-link')['href']
        genre = movie.select_one('h4.rating').find_next('h4').text
        img = movie.select_one('img.img-responsive')['src']
        return Movie(
            title=title,
            year=year,
            rating=rating,
            link=f'{BASE_URL}{link}',
            genre=genre,
            img=f'{BASE_URL}{img}',
            torrents=(
                await fetch_available_torrents(f'{BASE_URL}{link}')
            )
        )
    return await asyncio.gather(*[
        _scrape_movie(movie) for movie in soup.select('div.browse-movie-wrap')
    ])


throttler.throttle()
async def fetch_available_torrents(movie_url: str):
    async with httpx.AsyncClient() as client:
        logger.info(f'Fetching available torrents for {movie_url}')
        response = await client.get(movie_url)
        soup = bs(response.text, 'html.parser')
        torrents = []
        for torrent in soup.select('div.modal-torrent'):
            quality = torrent.select_one('div.modal-quality').text.strip('\n')
            sizes = tuple(s.text for s in torrent.select('p.quality-size'))
            torrent_url = torrent.select_one('a.download-torrent')['href']
            magnet = torrent.select_one('a.magnet-download')['href']
            torrents.append(Torrent(
                quality=quality,
                sizes=sizes,
                url=f'{BASE_URL}{torrent_url}',
                magnet=magnet
            ))
        return torrents


throttler.throttle()
async def browse_yts(
    keyword: Optional[str] = None,
    quality: Optional[str] = 'all',
    genre: Optional[str] = 'all',
    rating: Optional[int] = 0,
    year: Optional[int] = 2024,
    order_by: Optional[str] = 'featured'
):
    params = dict(
        keyword=keyword,
        quality=quality,
        genre=genre,
        rating=rating,
        year=year,
        order_by=order_by
    )
    async with httpx.AsyncClient() as client:
        logger.info('Browsing YTS movies with the following parameters:')
        logger.info("\n\t".join([f'{k.title()}: {v}' for k, v in params.items()]))
        response = await client.get(BROWSE_URL, params=params)
        soup = bs(response.text, 'html.parser')
        movies = await scrape_movies(soup)
        return movies


async def download_torrent(movie: Movie, quality: Literal['720p', '1080p', '2160p'] = '2160p'):
    torrent = next((t for t in movie.torrents if t.quality == quality), None)
    if not torrent:
        logger.error(f'No torrent found for {quality}')
        return
    
    logger.info(f'Downloading {movie.title} {quality} torrent...')
    
    save_path = Path('yify') / movie.title
    save_path.mkdir(parents=True, exist_ok=True)
    
    torrent_path = save_path / f'{movie.title} {quality}.torrent'
    
    session = lt.session({'listen_interfaces': '0.0.0.0:6881'})
    # session.listen_on(6881, 6891)
    
    resume_file = save_path / "resume_data.resume"
    
    # if resume_file.exists():
    #     logger.info("Loading existing resume data...")
    #     with open(resume_file, "rb") as f:
    #         session.load_state(f.read())
    
    params = {
        'save_path': str(save_path),
        'storage_mode': lt.storage_mode_t.storage_mode_sparse
    }
    
    logger.info(f"Adding magnet link: {torrent.magnet}")
    handle = lt.add_magnet_uri(session, torrent.magnet, params)
    handle.set_sequential_download(True)
    
    logger.info("Downloading metadata, please wait...")
    while not handle.has_metadata():
        time.sleep(1)
        
    logger.info("Metadata acquired, starting download...")
    
    torrent_info = handle.get_torrent_info()
    logger.info(f"Downloading: {torrent_info.name()}")
    
    while not handle.is_seed():
        status = handle.status()
        state_str = [
            "queued", 
            "checking", 
            "downloading metadata", 
            "downloading", 
            "finished", 
            "seeding", 
            "allocating", 
            "checking fastresume"
        ]
        
        logger.info(f"{status.progress * 100:.2f}% complete ({state_str[status.state]}) - {status.download_rate / 1000:.2f} kB/s")
        
        # # Save resume data periodically
        # resume_data = session.save_state()
        # with open(resume_file, "wb") as f:
        #     f.write(resume_data)
        
        time.sleep(2)
    
    logger.info("Download complete!")
    logger.info(f"Saved to: {save_path}")
