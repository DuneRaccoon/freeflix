import httpx
import asyncio
import re
from bs4 import BeautifulSoup
from typing import Dict, Any, Optional, List, Tuple
from loguru import logger
from datetime import datetime, timezone, timedelta

from app.config import settings
from app.database.session import get_db
from app.database.models import MovieCache
from app.models import ReviewSource, Review, RelatedMovie
from app.utils.user_agent import get_random_user_agent

user_agent = get_random_user_agent()

class MovieDetailsService:
    """Service to fetch extended movie details from external sources."""
    
    # Base URLs for APIs
    OMDB_API_URL = "http://www.omdbapi.com/"
    TMDB_API_URL = "https://api.themoviedb.org/3"
    
    def __init__(self):
        self.omdb_api_key = settings.omdb_api_key
        self.tmdb_api_key = settings.tmdb_api_key
        
        # If API keys are missing, use web scraping as fallback
        self.use_api = bool(self.omdb_api_key or self.tmdb_api_key)
        
        # Rate limiter state
        self._last_request_time = datetime.now(timezone.utc)
        self._min_request_interval = 1.0  # seconds between requests
    
    async def _rate_limit(self):
        """Simple rate limiting to avoid overloading external APIs."""
        now = datetime.now(timezone.utc)
        elapsed = (now - self._last_request_time).total_seconds()
        
        if elapsed < self._min_request_interval:
            await asyncio.sleep(self._min_request_interval - elapsed)
            
        self._last_request_time = datetime.now(timezone.utc)
    
    async def get_movie_details(self, title: str, year: int) -> Dict[str, Any]:
        """Get detailed movie information from external sources."""
        # First try official APIs if available
        if self.use_api:
            try:
                if self.omdb_api_key:
                    return await self._get_from_omdb(title, year)
                elif self.tmdb_api_key:
                    return await self._get_from_tmdb(title, year)
            except Exception as e:
                logger.error(f"API error fetching movie details for {title} ({year}): {e}")
        
        # Fallback to web scraping if APIs fail or aren't available
        try:
            return await self._scrape_movie_details(title, year)
        except Exception as e:
            logger.error(f"Error scraping movie details for {title} ({year}): {e}")
            return {}  # Return empty dict if all methods fail
    
    async def _get_from_omdb(self, title: str, year: int) -> Dict[str, Any]:
        """Fetch movie details from OMDB API."""
        await self._rate_limit()
        
        async with httpx.AsyncClient(headers={'User-Agent': user_agent}) as client:
            response = await client.get(
                self.OMDB_API_URL,
                params={
                    "apikey": self.omdb_api_key,
                    "t": title,
                    "y": year,
                    "plot": "full",
                },
                timeout=10.0
            )
            
            response.raise_for_status()
            data = response.json()
            
            if data.get("Response") == "False":
                raise ValueError(f"Movie not found: {data.get('Error')}")
            
            # Transform OMDB response to our format
            result = {
                "imdb_id": data.get("imdbID"),
                "plot": data.get("Plot"),
                "runtime": data.get("Runtime"),
                "director": data.get("Director"),
                "language": data.get("Language"),
                "country": data.get("Country"),
                "awards": data.get("Awards"),
            }
            
            # Extract ratings
            ratings = {"imdb": None, "rottenTomatoes": None, "metacritic": None}
            imdb_rating = data.get("imdbRating")
            if imdb_rating and imdb_rating != "N/A":
                ratings["imdb"] = imdb_rating
                
            # Check Ratings array for other sources
            for rating in data.get("Ratings", []):
                source = rating.get("Source")
                value = rating.get("Value")
                if source == "Rotten Tomatoes":
                    ratings["rottenTomatoes"] = value
                elif source == "Metacritic":
                    ratings["metacritic"] = value
            
            result["imdb_rating"] = ratings["imdb"]
            result["rotten_tomatoes_rating"] = ratings["rottenTomatoes"]
            result["metacritic_rating"] = ratings["metacritic"]
            
            # Extract cast
            if "Actors" in data and data["Actors"] != "N/A":
                cast = [{"name": actor.strip(), "character": ""} for actor in data["Actors"].split(",")]
                result["cast"] = cast
                
            # Return formatted data
            return result
    
    async def _get_from_tmdb(self, title: str, year: int) -> Dict[str, Any]:
        """Fetch movie details from TMDB API."""
        await self._rate_limit()
        
        async with httpx.AsyncClient(headers={'User-Agent': user_agent}) as client:
            # First search for the movie
            search_response = await client.get(
                f"{self.TMDB_API_URL}/search/movie",
                params={
                    "api_key": self.tmdb_api_key,
                    "query": title,
                    "year": year,
                },
                timeout=10.0
            )
            
            search_response.raise_for_status()
            search_data = search_response.json()
            
            if not search_data.get("results"):
                raise ValueError(f"Movie not found in TMDB: {title} ({year})")
            
            # Get the first result
            movie_id = search_data["results"][0]["id"]
            
            # Fetch detailed movie info
            details_response = await client.get(
                f"{self.TMDB_API_URL}/movie/{movie_id}",
                params={
                    "api_key": self.tmdb_api_key,
                    "append_to_response": "credits,videos,reviews",
                },
                timeout=10.0
            )
            
            details_response.raise_for_status()
            data = details_response.json()
            
            # Transform TMDB response to our format
            result = {
                "imdb_id": data.get("imdb_id"),
                "plot": data.get("overview"),
                "runtime": f"{data.get('runtime')} min" if data.get('runtime') else None,
                "language": data.get("original_language"),
                "country": ", ".join([country["name"] for country in data.get("production_countries", [])]),
            }
            
            # Get poster and backdrop
            if data.get("poster_path"):
                result["poster_url"] = f"https://image.tmdb.org/t/p/w500{data['poster_path']}"
            if data.get("backdrop_path"):
                result["backdrop_url"] = f"https://image.tmdb.org/t/p/original{data['backdrop_path']}"
            
            # Get trailer
            videos = data.get("videos", {}).get("results", [])
            for video in videos:
                if video.get("type") == "Trailer" and video.get("site") == "YouTube":
                    result["trailer_url"] = f"https://www.youtube.com/watch?v={video['key']}"
                    break
            
            # Extract cast and director
            cast = []
            director = None
            
            for person in data.get("credits", {}).get("cast", [])[:10]:  # Limit to 10 cast members
                cast_member = {
                    "name": person.get("name"),
                    "character": person.get("character"),
                }
                if person.get("profile_path"):
                    cast_member["image"] = f"https://image.tmdb.org/t/p/w185{person['profile_path']}"
                cast.append(cast_member)
                
            for crew in data.get("credits", {}).get("crew", []):
                if crew.get("job") == "Director":
                    director = crew.get("name")
                    break
                    
            result["cast"] = cast
            result["director"] = director
            
            # Extract reviews
            reviews = []
            for review in data.get("reviews", {}).get("results", [])[:5]:  # Limit to 5 reviews
                reviews.append({
                    "source": "TMDB",
                    "author": review.get("author"),
                    "content": review.get("content"),
                    "url": review.get("url"),
                })
            
            result["reviews"] = reviews
            
            return result
    
    async def _scrape_movie_details(self, title: str, year: int) -> Dict[str, Any]:
        """Scrape movie details from IMDB and Rotten Tomatoes as a fallback."""
        # This is a simplified scraping implementation - in a real app, you'd want more robust parsing
        result = {}
        
        # First scrape IMDB
        imdb_data, rt_data = await asyncio.gather(
            self._scrape_from_imdb(title, year),
            self._scrape_from_rotten_tomatoes(title, year)
        )
        
        result.update(imdb_data)
        result.update(rt_data)
            
        return result
    
    async def _scrape_from_imdb(self, title: str, year: int) -> Dict[str, Any]:
        """Scrape movie details from IMDB."""
        await self._rate_limit()
        
        # Create a search query for IMDB
        search_query = f"{title.replace(' ', '+')}+{year}"
        
        async with httpx.AsyncClient(headers={'User-Agent': user_agent}) as client:
            # Search for the movie
            search_response = await client.get(
                f"https://www.imdb.com/find/?q={search_query}",
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=10.0
            )
            
            search_response.raise_for_status()
            search_html = search_response.text
            
            # Parse the search results to find the movie page URL
            search_soup = BeautifulSoup(search_html, 'html.parser')
            
            # Look for search results
            results = search_soup.select('.ipc-metadata-list .find-result-item')
            if not results:
                logger.warning(f"No IMDB results found for {title} ({year})")
                return {}
                
            # Get the first result URL
            first_result = results[0]
            movie_link = first_result.select_one('a')
            if not movie_link:
                return {}
                
            movie_url = f"https://www.imdb.com{movie_link['href']}"
            
            # Get the movie page
            await self._rate_limit()
            movie_response = await client.get(
                movie_url,
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=10.0
            )
            
            movie_response.raise_for_status()
            
            # Parse the movie page
            movie_soup = BeautifulSoup(movie_response.content, 'html.parser')
            
            # Extract data
            result = {}
            
            # Get IMDB ID from URL
            imdb_id_match = re.search(r'/title/(tt\d+)/', movie_url)
            if imdb_id_match:
                result["imdb_id"] = imdb_id_match.group(1)
            
            # Try to get rating
            rating_elem = movie_soup.select_one('span[data-testid="rating"]')
            if rating_elem:
                rating_text = rating_elem.text.strip()
                result["imdb_rating"] = rating_text
            
            # Try to get plot
            plot_elem = movie_soup.select_one('p[data-testid="plot"]')
            if plot_elem:
                result["plot"] = plot_elem.text.strip()
            
            # Try to get director
            director_section = movie_soup.find(string=re.compile("Director"))
            if director_section:
                director_parent = director_section.parent.parent
                director_link = director_parent.select_one('a')
                if director_link:
                    result["director"] = director_link.text.strip()
            
            # Try to get cast
            cast = []
            cast_section = movie_soup.select('.ipc-sub-grid [data-testid="title-cast-item"]')
            for section in cast_section:
                actor = section.select_one('[data-testid="title-cast-item__actor"]')
                character = section.select_one('[data-testid="cast-item-characters-link"]')
                img = section.select_one('.ipc-image')
                if actor and character:
                    cast.append({
                        "name": actor.text.strip(),
                        "character": character.text.strip(),
                        "image": img['src'] if img else None,
                    })
            
            if cast:
                result["cast"] = cast
                
            return result
    
    async def _scrape_from_rotten_tomatoes(self, title: str, year: int) -> Dict[str, Any]:
        """Scrape movie details from Rotten Tomatoes."""
        await self._rate_limit()
        
        # Create a search query for RT
        # search_query = f"{title.replace(' ', '+')}+{year}"
        search_query = f"{title.replace(' ', '+')}"
        
        async with httpx.AsyncClient(headers={'User-Agent': user_agent}) as client:
            # Search for the movie
            search_response = await client.get(
                f"https://www.rottentomatoes.com/search?search={search_query}",
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=10.0
            )
            
            search_response.raise_for_status()

            # Parse the search results to find the movie page URL
            search_soup = BeautifulSoup(search_response.content, 'html.parser')
            
            # Look for movie results
            movie_results = search_soup.select_one('search-page-result[type="movie"]')
            if not movie_results:
                logger.warning(f"No Rotten Tomatoes results found for {title} ({year})")
                return {}
            
            movies = movie_results.select('search-page-media-row')
            if not movies:
                logger.warning(f"No Rotten Tomatoes movies found for {title} ({year})")
                return {}
            
            # Get the first movie result URL
            for movie in movies:
                movie_link = movie.select_one('a')
                if movie_link:
                    movie_url = movie_link['href']
                    break
            else:
                return {}
            
            # Get the movie page
            await self._rate_limit()
            movie_response = await client.get(
                movie_url,
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=10.0
            )
            
            movie_response.raise_for_status()
            
            # Parse the movie page
            movie_soup = BeautifulSoup(movie_response.content, 'html.parser')
            
            # Extract data
            result = {}
            
            # Try to get rating
            score_card = movie_soup.select_one('media-scorecard')
            if score_card:
                criticsScore = score_card.select_one('[slot="criticsScore"]') # Rotten Tomatoes critics rating
                criticsReviews = score_card.select_one('[slot="criticsReviews"]') # Number of critics reviews
                audienceScore = score_card.select_one('[slot="audienceScore"]') # RT audience reviews
                audienceReviews = score_card.select_one('[slot="audienceReviews"]') # Number audience reviews
                
                if criticsScore and isinstance(criticsScore.text, str):
                    result["rotten_tomatoes_rating"] = criticsScore.text.strip()
                if criticsReviews:
                    try:
                        criticsReviews = (
                            str(criticsReviews.text)
                            .lower()
                            .replace(',', '')
                            .replace('+', '')
                            .replace('reviews', '')
                            .replace('ratings', '')
                            .strip()
                        )
                        result["rotten_tomatoes_total_review_count"] = int(criticsReviews)
                    except:
                        pass
                if audienceScore and isinstance(audienceScore.text, str):
                    result["rotten_tomatoes_audience_rating"] = audienceScore.text.strip()
                if audienceReviews:
                    try:
                        audienceReviews = (
                            str(audienceReviews.text)
                            .lower()
                            .replace(',', '')
                            .replace('+', '')
                            .replace('reviews', '')
                            .replace('ratings', '')
                            .strip()
                        )
                        result["rotten_tomatoes_audience_review_count"] = int(audienceReviews)
                    except:
                        pass
            
            reviews = []
            
            # Try to get critic reviews
            try:
                critic_review_elements = movie_soup.select('media-review-card-critic')
                for review_elem in critic_review_elements[:5]:  # Limit to 5 reviews
                    quote = review_elem.select_one('rt-text[slot="content"]')
                    author = review_elem.select_one('rt-link[slot="displayName"]')
                    url = review_elem.select_one('rt-link[slot="editorialUrl"]')
                    createDate = review_elem.select_one('rt-text[slot="createDate"]')
                    score = review_elem.select_one('rt-text[slot="originalScore"]')
                    if score and isinstance(score.text, str):
                        score = score.text.strip()
                    if createDate:
                        try:
                            createDate = datetime.strptime(createDate.text.strip(), "%b %d, %Y")
                        except:
                            createDate = None
                    if quote and author and url:
                        reviews.append(Review(
                            source=ReviewSource.ROTTEN_TOMATOES_CRITIC,
                            author=author.text.strip(),
                            content=quote.text.strip(),
                            rating=score,
                            url=url['href'],
                            date=createDate
                        ))
            except Exception as e:
                logger.error(f"Error parsing Rotten Tomatoes reviews: {e}")
            
            # Try to get audience reviews
            try:
                audience_reviews_elements = movie_soup.select('media-review-card-audience')
                for review_elem in audience_reviews_elements[:5]:  # Limit to 5 reviews
                    quote = review_elem.select_one('rt-text[slot="content"]')
                    author = review_elem.select_one('rt-link[slot="displayName"]')
                    url = review_elem.select_one('rt-link[slot="editorialUrl"]')
                    createDate = review_elem.select_one('rt-text[slot="createDate"]')
                    score = review_elem.select_one('rt-text[slot="originalScore"]')
                    if score and isinstance(score.text, str):
                        score = score.text.strip()
                    if createDate:
                        try:
                            createDate = datetime.strptime(createDate.text.strip(), "%m/%d/%y")
                        except:
                            createDate = None
                    if quote and author:
                        reviews.append(Review(
                            source=ReviewSource.ROTTEN_TOMATOES_AUDIENCE,
                            author=author.text.strip(),
                            content=quote.text.strip(),
                            rating=score,
                            url=url['href'] if url else None,
                            date=createDate
                        ))
            except Exception as e:
                logger.error(f"Error parsing Rotten Tomatoes reviews: {e}")

            if reviews:
                result["reviews"] = reviews
                
            # find related movies
            related_movies = []
            related_movie_elements = movie_soup.select('tile-poster-card')
            for related_movie_elem in related_movie_elements:
                link = related_movie_elem.select_one('rt-link[slot="primaryImage"]')
                img = related_movie_elem.select_one('rt-img')
                title = related_movie_elem.select_one('rt-link[slot="title"]')
                critic_score = related_movie_elem.select_one('rt-text[slot="criticsScore"]')
                if critic_score:
                    try:
                        critic_score = int(critic_score.text.strip().replace('%', ''))
                    except:
                        critic_score = None
                        
                audience_score = related_movie_elem.select_one('rt-text[slot="audienceScore"]')
                if audience_score:
                    try:
                        audience_score = int(audience_score.text.strip().replace('%', ''))
                    except:
                        audience_score = None
                        
                if link and title:
                    related_movies.append(RelatedMovie(
                        title=title.text.strip(),
                        url=f"https://www.rottentomatoes.com{link['href']}",
                        image=img['src'] if img else None,
                        critic_score=critic_score,
                        audience_score=audience_score
                    ))
                    
            if related_movies:
                result["related_movies"] = related_movies
                
            movie_info_json = {}
            for category_wrap in movie_soup.select('div.category-wrap'):
                try:
                    key_elem = category_wrap.select_one('rt-text.key')
                    if key_elem:
                        key = '_'.join(key_elem.text.strip().lower().split(' '))
                        value_elem = category_wrap.select_one('dd[data-qa="item-value-group"]')
                        if value_elem:
                            value = value_elem.text.strip()
                            movie_info_json[key] = value
                except:
                    pass
                
            if movie_info_json:
                result['movie_info_json'] = movie_info_json
                
                if movie_info_json.get('runtime'):
                    result['runtime'] = movie_info_json['runtime']
                
                if movie_info_json.get('original_language'):
                    result['language'] = movie_info_json['original_language']
                    
            return result


# Create a singleton instance
movie_details_service = MovieDetailsService()