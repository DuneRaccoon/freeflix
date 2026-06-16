import os
import hashlib
import asyncio
import httpx
from urllib.parse import urlparse
from pathlib import Path
from loguru import logger
from typing import Optional, Tuple, Literal, Dict, Any
import time
import mimetypes
import re

from app.config import settings

# Define asset types
AssetType = Literal['poster', 'backdrop', 'avatar', 'other']

class AssetManager:
    """
    Manages downloaded assets like images for movies and users.
    Provides caching and local serving of remote assets.
    """
    
    def __init__(self):
        """Initialize the asset manager with required directories"""
        # Asset base path (create a dedicated assets directory)
        self.base_path = settings.base_app_path / 'assets'
        self.cache_path = self.base_path / 'cache'
        
        # Asset type subdirectories
        self.asset_paths = {
            'poster': self.cache_path / 'posters',
            'backdrop': self.cache_path / 'backdrops',
            'avatar': self.cache_path / 'avatars',
            'other': self.cache_path / 'other'
        }
        
        # Rate limiting state
        self._last_request_time = 0
        self._min_request_interval = 0.5  # seconds between requests
        
        # Initialize directories
        self._init_directories()
        
        # Cache dict for in-memory caching of path mappings
        self._url_cache: Dict[str, str] = {}
        
        logger.info(f"Asset manager initialized with base path: {self.base_path}")
    
    def _init_directories(self):
        """Create required directory structure if it doesn't exist"""
        self.base_path.mkdir(parents=True, exist_ok=True)
        self.cache_path.mkdir(exist_ok=True)
        
        for path in self.asset_paths.values():
            path.mkdir(exist_ok=True)
    
    def _get_asset_type(self, url: str) -> AssetType:
        """
        Determine the asset type based on the URL or path.
        
        Args:
            url: The URL or path of the asset
            
        Returns:
            The determined asset type
        """
        url_lower = url.lower()
        
        # Check if URL contains type indicators
        if any(kw in url_lower for kw in ['poster', 'cover']):
            return 'poster'
        elif any(kw in url_lower for kw in ['backdrop', 'background']):
            return 'backdrop'
        elif any(kw in url_lower for kw in ['avatar', 'profile']):
            return 'avatar'
        
        # Default to poster for YTS images
        if 'yts' in url_lower and ('img' in url_lower or 'image' in url_lower):
            return 'poster'
        
        # Default to other
        return 'other'
    
    def _url_to_filename(self, url: str) -> str:
        """
        Generate a unique filename for a URL.
        
        Args:
            url: The URL to generate a filename for
            
        Returns:
            A unique filename based on the URL
        """
        # Extract extension from URL
        parsed_url = urlparse(url)
        path = parsed_url.path
        
        # Get the original extension
        _, ext = os.path.splitext(path)
        if not ext or len(ext) < 2:
            # Default to .jpg for images without extension
            ext = '.jpg'
        
        # Create a hash of the URL for uniqueness
        url_hash = hashlib.md5(url.encode('utf-8')).hexdigest()
        
        # Create a filename that includes part of original filename for readability
        original_filename = os.path.basename(path)
        # Remove non-alphanumeric characters
        original_filename = re.sub(r'[^a-zA-Z0-9]', '', original_filename)
        # Limit length of original filename part
        if original_filename:
            original_filename = original_filename[:20]
            return f"{original_filename}_{url_hash[:10]}{ext}"
        else:
            return f"{url_hash}{ext}"
    
    def get_local_path(self, url: str, asset_type: Optional[AssetType] = None) -> Path:
        """
        Get the local path for an asset.
        
        Args:
            url: The URL of the asset
            asset_type: Optional asset type override
            
        Returns:
            The local path where the asset should be stored
        """
        if not asset_type:
            asset_type = self._get_asset_type(url)
        
        filename = self._url_to_filename(url)
        return self.asset_paths[asset_type] / filename
    
    def is_cached(self, url: str) -> bool:
        """
        Check if an asset is already cached.
        
        Args:
            url: The URL of the asset
            
        Returns:
            True if the asset is cached, False otherwise
        """
        local_path = self.get_local_path(url)
        return local_path.exists() and local_path.stat().st_size > 0
    
    async def download_asset(self, url: str, asset_type: Optional[AssetType] = None) -> Tuple[bool, str]:
        """
        Download an asset and cache it locally.
        
        Args:
            url: The URL of the asset to download
            asset_type: Optional asset type override
            
        Returns:
            Tuple of (success, local_path_or_error_message)
        """
        # Simple rate limiting
        current_time = time.time()
        time_since_last_request = current_time - self._last_request_time
        if time_since_last_request < self._min_request_interval:
            await asyncio.sleep(self._min_request_interval - time_since_last_request)
        
        self._last_request_time = time.time()
        
        # Determine asset type if not provided
        if not asset_type:
            asset_type = self._get_asset_type(url)
        
        # Get local path
        local_path = self.get_local_path(url, asset_type)
        
        # If already cached, return success
        if local_path.exists() and local_path.stat().st_size > 0:
            return True, str(local_path)
        
        # Download the asset
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url, timeout=10.0, follow_redirects=True)
                response.raise_for_status()
                
                # Write to file
                with open(local_path, 'wb') as f:
                    f.write(response.content)
                
                logger.info(f"Downloaded asset from {url} to {local_path}")
                return True, str(local_path)
        except Exception as e:
            logger.error(f"Error downloading asset from {url}: {e}")
            return False, str(e)
    
    def get_cached_url(self, original_url: str, asset_type: Optional[AssetType] = None) -> str:
        """
        Get a URL for the cached asset if it exists, otherwise return the original URL.
        
        Args:
            original_url: The original URL of the asset
            asset_type: Optional asset type override
            
        Returns:
            Local API URL if cached, otherwise the original URL
        """
        # Skip for data URIs
        if original_url.startswith('data:'):
            return original_url
            
        # Check in-memory cache first
        if original_url in self._url_cache:
            return self._url_cache[original_url]
        
        # Get local path
        local_path = self.get_local_path(original_url, asset_type)
        
        # If cached, return local API URL
        if local_path.exists() and local_path.stat().st_size > 0:
            # Get relative path from cache directory
            rel_path = local_path.relative_to(self.cache_path)
            
            # Construct API URL
            api_url = f"/api/v1/assets/{rel_path}"
            
            # Cache the result
            self._url_cache[original_url] = api_url
            
            return api_url
        
        # Not cached, return original URL
        return original_url
    
    async def get_or_download_asset(self, url: str, asset_type: Optional[AssetType] = None) -> str:
        """
        Get a cached asset or download it if not cached.
        
        Args:
            url: The URL of the asset
            asset_type: Optional asset type override
            
        Returns:
            Local API URL if successful, otherwise original URL
        """
        # Skip for data URIs
        if url.startswith('data:'):
            return url
            
        # Check if already cached
        if self.is_cached(url):
            return self.get_cached_url(url, asset_type)
        
        # Not cached, download it
        success, _ = await self.download_asset(url, asset_type)
        if success:
            return self.get_cached_url(url, asset_type)
        
        # Failed to download, return original URL
        return url

    def get_content_type(self, path: str) -> str:
        """
        Get the content type for a file.
        
        Args:
            path: The path to the file
            
        Returns:
            The content type of the file
        """
        content_type, _ = mimetypes.guess_type(path)
        if not content_type:
            # Default to octet-stream
            content_type = 'application/octet-stream'
        return content_type

    def serve_asset(self, path: str) -> Tuple[bytes, str]:
        """
        Read asset content and determine its MIME type.
        
        Args:
            path: The path to the asset relative to cache directory
            
        Returns:
            Tuple of (content_bytes, content_type)
        """
        # Construct absolute path
        abs_path = self.cache_path / path
        
        # Read file content
        try:
            with open(abs_path, 'rb') as f:
                content = f.read()
            
            # Determine content type
            content_type = self.get_content_type(str(abs_path))
            
            return content, content_type
        except Exception as e:
            logger.error(f"Error serving asset {abs_path}: {e}")
            raise


# Create singleton instance
asset_manager = AssetManager()
