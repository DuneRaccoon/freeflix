import os
import libtorrent as lt
from typing import Optional, Union
from pathlib import Path
from pydantic import (
    HttpUrl,
    PostgresDsn, 
    ValidationInfo, 
    field_validator
)
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8"
    }
    
    # API settings
    api_v1_str: str = "/api/v1"
    project_name: str = "Freeflix API"
    environment: str = "development"
    
    # YTS scraping settings
    yify_url: str = "https://yts.lu/"
    yify_url_browse_url: str = "https://en.yts.lu/browse-movies"
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
    
    postgres_user: Optional[str] = None
    postgres_password: Optional[str] = None
    postgres_host: Optional[str] = None
    postgres_port: Optional[Union[str, int]] = None
    postgres_db: Optional[str] = None
    postgres_dsn: Optional[PostgresDsn] = None
    
    # mail_connection_config: ConnectionConfig
    
    sentry_dsn: Optional[HttpUrl] = None
    
    @field_validator('postgres_dsn', mode='after')
    def assemble_postgres_dsn(cls, v, info: ValidationInfo):
        if v is None:
            try:
                port = info.data.get('postgres_port')
                print(info)
                return PostgresDsn.build(
                    scheme="postgresql",  # Use standard postgresql scheme without asyncpg
                    username=info.data.get('postgres_user'),
                    password=info.data.get('postgres_password'),
                    host=info.data.get('postgres_host'),
                    port=int(port) if port else None,
                    path=info.data.get('postgres_db') or ''
                )
            except Exception as e:
                print(f"Error building PostgreSQL DSN: {e}")
                return v
        return v
    
    # Cron settings
    cron_enabled: bool = True

    cache_movies_for: int = 365  # 365 days

    # Torrent selection: swarm-health thresholds (seeders).
    # dead   = seeds < min_seeds
    # low    = seeds < healthy_seeds
    # healthy = seeds >= healthy_seeds
    min_seeds: int = 1
    healthy_seeds: int = 5

    # --- Content guard (heuristic malware / fake-torrent block) ---
    # Master kill switch. When False, NO validation, blocking, or non-video skip
    # happens — behavior is identical to before the guard existed.
    content_guard_enabled: bool = True
    # Extensions (lowercased, leading dot) that hard-block a torrent if any file matches.
    blocked_extensions: set[str] = {
        ".exe", ".scr", ".com", ".bat", ".cmd", ".msi", ".apk", ".jar", ".vbs",
        ".vbe", ".js", ".wsf", ".ps1", ".lnk", ".dll", ".sys", ".reg", ".hta",
        ".cpl", ".gadget", ".sh", ".run", ".deb", ".rpm", ".pkg", ".dmg", ".iso", ".bin",
    }
    # Extensions counted as playable video (a torrent with none of these is blocked).
    video_extensions: set[str] = {
        ".mp4", ".mkv", ".avi", ".mov", ".webm", ".ogv", ".wmv", ".flv", ".m4v",
        ".mpg", ".mpeg", ".ts", ".m2ts", ".vob", ".3gp", ".mts",
    }
    # Enables the optional structural fake-torrent heuristic (rule 3). Default off
    # to minimize false positives.
    fake_torrent_heuristics: bool = False

    # When False (default), torrents are always active — never queue-paused by
    # libtorrent's auto-manager — so streaming readiness is never broken by a
    # background pause. The active-download cap is then not enforced as a queue,
    # matching pre-W5 behavior. Set True to re-enable the auto-managed download
    # queue (requires streaming to handle the paused→downloading transition first).
    lt_auto_managed_queue: bool = False

    # libtorrent session tuning (WS5). Profiles are arch-selected at runtime by
    # lt_settings(); unknown keys are filtered against the running build so a
    # version drift never raises. ARM (Raspberry Pi) gets conservative limits.
    lt_connections_limit_arm: int = 80
    lt_connections_limit_x86: int = 300
    lt_per_torrent_connections_arm: int = 40
    lt_per_torrent_connections_x86: int = 120
    lt_peer_connect_timeout: int = 8     # seconds to wait for a peer handshake
    lt_request_timeout: int = 10         # seconds before re-requesting a block
    lt_piece_timeout: int = 20           # seconds before timing out a piece request
    lt_aio_threads_arm: int = 2
    lt_aio_threads_x86: int = 8
    lt_send_buffer_watermark: int = 1048576   # 1 MiB
    lt_recv_buffer_watermark: int = 1048576   # 1 MiB

    def effective_max_active_downloads(self) -> int:
        """Configured concurrent-download ceiling, capped to 2 on ARM (Raspberry Pi)."""
        if self._is_arm():
            return min(self.max_active_downloads, 2)
        return self.max_active_downloads

    def _is_arm(self) -> bool:
        import platform
        return "arm" in platform.machine().lower() or "aarch" in platform.machine().lower()

    def lt_per_torrent_connections(self) -> int:
        """Per-torrent connection cap for the current arch. Applied via
        handle.set_max_connections() in the manager — NOT a settings_pack key
        (libtorrent 2.x has no per-torrent connections key in settings_pack)."""
        return (self.lt_per_torrent_connections_arm if self._is_arm()
                else self.lt_per_torrent_connections_x86)

    def _profile_settings(self, *, is_arm: bool) -> dict:
        """The full INTENDED settings dict for a profile, before unknown-key
        filtering. Pure/deterministic so it is unit-testable per arch."""
        cap = self.effective_max_active_downloads()
        return {
            "connections_limit": (self.lt_connections_limit_arm if is_arm
                                  else self.lt_connections_limit_x86),
            "active_downloads": cap,
            "active_limit": max(cap * 2, cap + 4),
            "peer_connect_timeout": self.lt_peer_connect_timeout,
            "request_timeout": self.lt_request_timeout,
            "piece_timeout": self.lt_piece_timeout,
            "prioritize_partial_pieces": True,
            "strict_end_game_mode": True,
            "suggest_mode": getattr(getattr(lt, "suggest_mode_t", None),
                                    "suggest_read_cache", 1),
            "send_buffer_watermark": self.lt_send_buffer_watermark,
            "recv_buffer_watermark": self.lt_recv_buffer_watermark,
            "aio_threads": (self.lt_aio_threads_arm if is_arm
                            else self.lt_aio_threads_x86),
        }

    def _assemble_lt_settings(self, intended: dict) -> dict:
        """Drop any key not present in the running libtorrent build (version-safe)."""
        valid = set(lt.default_settings().keys())
        return {k: v for k, v in intended.items() if k in valid}

    def lt_settings(self) -> dict:
        """Arch-profiled libtorrent settings_pack, filtered to keys valid in the
        running build. Safe to pass straight to session.apply_settings()."""
        return self._assemble_lt_settings(self._profile_settings(is_arm=self._is_arm()))

    # Create necessary directories on startup
    def initialize(self):
        self.default_download_path.mkdir(parents=True, exist_ok=True)
        self.resume_data_path.mkdir(parents=True, exist_ok=True)
        self.log_path.mkdir(parents=True, exist_ok=True)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)


settings = Settings()