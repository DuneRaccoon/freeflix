import os
from typing import Optional
from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    class Config:
        env_file = ".env"
        env_file_encoding = 'utf-8'
    
    # API settings
    api_v1_str: str = "/api/v1"
    project_name: str = "Freeflix API"
    environment: str = "development"
    
    # YTS scraping settings
    yify_url: str = "https://en.yts-official.mx"
    yify_url_browse_url: str = "https://en.yts-official.mx/browse-movies"
    rarbg_url: str = "https://en.rarbg-official.com/{path}"
    request_rate_limit: int = 3  # requests per second
    
    # External API keys (set these in environment variables)
    omdb_api_key: Optional[str] = None
    tmdb_api_key: Optional[str] = None
    
    # Torrent settings
    base_app_path: Path = Path(__file__).parent.parent
    default_download_path: Path = Path("./downloads")
    listen_interfaces: str = "0.0.0.0:6881"
    port_range_start: int = 6881
    port_range_end: int = 6891
    max_active_downloads: int = 3
    resume_data_path: Path = base_app_path / "resume_data"
    
    # Logging settings
    log_level: str = "INFO"
    log_path: Path = base_app_path / "logs"
    
    # Database settings (for storing torrent status and schedule)
    db_path: Path = base_app_path / "freeflix.db"
    
    # Cron settings
    cron_enabled: bool = True
    
    cache_movies_for: int = 365  # 365 days
    
    # Create necessary directories on startup
    def initialize(self):
        self.default_download_path.mkdir(parents=True, exist_ok=True)
        self.resume_data_path.mkdir(parents=True, exist_ok=True)
        self.log_path.mkdir(parents=True, exist_ok=True)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)


settings = Settings()