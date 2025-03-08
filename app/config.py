import os
from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # API settings
    API_V1_STR: str = "/api/v1"
    PROJECT_NAME: str = "YIFY Torrent Downloader"
    
    # YTS scraping settings
    YIFY_URL: str = "https://en.yts-official.mx"
    YIFY_URL_BROWSE_URL: str = "https://en.yts-official.mx/browse-movies"
    RARBG_URL: str = "https://en.rarbg-official.com/{path}"
    REQUEST_RATE_LIMIT: int = 3  # requests per second
    
    # External API keys (set these in environment variables)
    OMDB_API_KEY: str = os.environ.get("OMDB_API_KEY", "")
    TMDB_API_KEY: str = os.environ.get("TMDB_API_KEY", "")
    
    # Torrent settings
    BASE_APP_BATH: Path = Path(__file__).parent.parent
    DEFAULT_DOWNLOAD_PATH: Path = Path(os.environ.get("DOWNLOAD_PATH", "/opt/yify_downloader/downloads"))
    LISTEN_INTERFACES: str = "0.0.0.0:6881"
    PORT_RANGE_START: int = 6881
    PORT_RANGE_END: int = 6891
    MAX_ACTIVE_DOWNLOADS: int = 3
    RESUME_DATA_PATH: Path = BASE_APP_BATH / "resume_data"
    
    # Logging settings
    LOG_LEVEL: str = "INFO"
    if os.environ.get("LOG_PATH"):
        LOG_PATH: Path = Path(os.environ.get("LOG_PATH"))
    else:
        LOG_PATH: Path = BASE_APP_BATH / "logs"
    
    # Database settings (for storing torrent status and schedule)
    DB_PATH: Path = BASE_APP_BATH / "torrents.db"
    
    # Cron settings
    CRON_ENABLED: bool = True
    
    CACHE_MOVIES_FOR: int = 365  # 365 days
    
    # Create necessary directories on startup
    def initialize(self):
        self.DEFAULT_DOWNLOAD_PATH.mkdir(parents=True, exist_ok=True)
        self.RESUME_DATA_PATH.mkdir(parents=True, exist_ok=True)
        self.LOG_PATH.mkdir(parents=True, exist_ok=True)
        self.DB_PATH.parent.mkdir(parents=True, exist_ok=True)


settings = Settings()