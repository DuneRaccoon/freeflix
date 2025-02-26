import os
from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # API settings
    API_V1_STR: str = "/api/v1"
    PROJECT_NAME: str = "YIFY Torrent Downloader"
    
    # YTS scraping settings
    BASE_URL: str = "https://en.yts-official.mx"
    BROWSE_URL: str = "https://en.yts-official.mx/browse-movies"
    REQUEST_RATE_LIMIT: int = 3  # requests per second
    
    # Torrent settings
    DEFAULT_DOWNLOAD_PATH: Path = Path(os.environ.get("DOWNLOAD_PATH", "/opt/yify_downloader/downloads"))
    LISTEN_INTERFACES: str = "0.0.0.0:6881"
    PORT_RANGE_START: int = 6881
    PORT_RANGE_END: int = 6891
    MAX_ACTIVE_DOWNLOADS: int = 3
    RESUME_DATA_PATH: Path = Path("/opt/yify_downloader/resume_data")
    
    # Logging settings
    LOG_LEVEL: str = "INFO"
    LOG_PATH: Path = Path("/opt/yify_downloader/logs")
    
    # Database settings (for storing torrent status and schedule)
    DB_PATH: Path = Path("/opt/yify_downloader/data/torrents.db")
    
    # Cron settings
    CRON_ENABLED: bool = True
    
    # Create necessary directories on startup
    def initialize(self):
        self.DEFAULT_DOWNLOAD_PATH.mkdir(parents=True, exist_ok=True)
        self.RESUME_DATA_PATH.mkdir(parents=True, exist_ok=True)
        self.LOG_PATH.mkdir(parents=True, exist_ok=True)
        self.DB_PATH.parent.mkdir(parents=True, exist_ok=True)


settings = Settings()