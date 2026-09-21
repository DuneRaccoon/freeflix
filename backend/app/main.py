import os
import sys
import asyncio
import uvicorn
from fastapi import FastAPI, Depends, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger
from typing import Optional
import platform
import time

from app.config import settings
from app.api import (
    activity, auth, avatars, instance, movies, rails, schedules, streaming, torrents,
    tv, users, watchlist,
)
from app.dependencies.auth import (
    SilentUnauthorized, require_session, require_session_silent,
)
from app.torrent.manager import torrent_manager
from app.cron.jobs import schedule_manager
from app.database.session import init_db, close_thread_sessions, get_db
from app.middleware import error_handling_middleware
from app.services import accounts as accounts_service

# Initialize directories and settings
settings.initialize()

# Configure logging
logger.remove()  # Remove default handler
logger.add(
    sys.stdout,
    level=settings.log_level,
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <cyan>{level}</cyan> | <blue>{file}:{line}</blue> | {message}",
)
logger.add(
    settings.log_path / "{time:YYYY-MM-DD}.log",
    level=settings.log_level,
    rotation="1 day",
    retention="7 days",
    compression="zip",
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <cyan>{level}</cyan> | {message}",
)

# Check if running on Raspberry Pi
m = platform.machine().lower()
is_raspberry_pi = ("arm" in m) or ("aarch" in m)
if is_raspberry_pi:
    logger.info("Running on Raspberry Pi platform")
    # Optimize for Raspberry Pi
    os.environ["MALLOC_MMAP_THRESHOLD_"] = "16384"  # Optimize memory allocation
    # Restrict number of parallel downloads
    max_active_downloads = min(settings.max_active_downloads, 2)
else:
    max_active_downloads = settings.max_active_downloads

logger.info(f"Maximum active downloads set to {max_active_downloads}")

# Create FastAPI app
app = FastAPI(
    title=settings.project_name,
    description="API for downloading and managing YTS torrents",
    version="1.0.0",
)

# Add CORS middleware. An explicit origin list is mandatory, not tidiness: browsers
# reject `Access-Control-Allow-Origin: *` together with credentials, so the wildcard
# would silently stop the session cookie from ever being sent cross-origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Every /api/v1 router below is gated here rather than endpoint-by-endpoint, so a new
# route added to any of them is private by default. GET / and GET /health are @app.get
# decorators, not router routes, so they stay public automatically.
GATED = [Depends(require_session)]

# Streaming is gated with the SILENT variant because three of its routes feed a raw
# <video src>, which hands any 401 body straight to the decoder and surfaces it as a
# mysterious playback failure instead of a sign-in prompt. The router-level dependency
# runs before the endpoint's own, so gating this router with the loud variant would
# make the per-endpoint require_session_silent unreachable.
STREAM_GATED = [Depends(require_session_silent)]

# Include routers
app.include_router(
    movies.router,
    prefix=f"{settings.api_v1_str}/movies",
    tags=["Movies"],
    dependencies=GATED,
)
app.include_router(
    torrents.router,
    prefix=f"{settings.api_v1_str}/torrents",
    tags=["Torrents"],
    dependencies=GATED,
)
app.include_router(
    schedules.router,
    prefix=f"{settings.api_v1_str}/schedules",
    tags=["Schedules"],
    dependencies=GATED,
)
app.include_router(
    streaming.router,
    prefix=f"{settings.api_v1_str}/streaming",
    tags=["Streaming"],
    dependencies=STREAM_GATED,
)
app.include_router(
    users.router,
    prefix=f"{settings.api_v1_str}/users",
    tags=["Users"],
    dependencies=GATED,
)
app.include_router(
    tv.router,
    prefix=f"{settings.api_v1_str}/tv",
    tags=["TV"],
    dependencies=GATED,
)
app.include_router(
    watchlist.router,
    prefix=f"{settings.api_v1_str}/watchlist",
    tags=["Watchlist"],
    dependencies=GATED,
)
app.include_router(
    activity.router,
    prefix=f"{settings.api_v1_str}/activity",
    tags=["Activity"],
    dependencies=GATED,
)
app.include_router(
    rails.router,
    prefix=f"{settings.api_v1_str}/rails",
    tags=["Rails"],
    dependencies=GATED,
)
app.include_router(
    avatars.router,
    prefix=f"{settings.api_v1_str}/avatars",
    tags=["Avatars"],
    dependencies=GATED,
)
app.include_router(
    avatars.assets_router,
    prefix=f"{settings.api_v1_str}/assets",
    tags=["Avatars"],
    dependencies=GATED,
)

# Public: this is how an anonymous browser becomes authenticated. The two
# session-bearing routes (/me, /signout) declare Depends(require_session) themselves.
app.include_router(
    auth.router,
    prefix=f"{settings.api_v1_str}/auth",
    tags=["Auth"],
)
# Mixed: GET /status is public, everything else declares Depends(require_owner).
app.include_router(
    instance.router,
    prefix=f"{settings.api_v1_str}/instance",
    tags=["Instance"],
)
# Mounted bare so the path is POST /api/v1/claim — the first-run claim is not an
# "instance setting", it is what creates the instance's owner.
app.include_router(
    instance.claim_router,
    prefix=settings.api_v1_str,
    tags=["Instance"],
)


# Use our custom error handling middleware instead
app.middleware("http")(error_handling_middleware)


# The streaming byte routes are loaded by a raw <video src>, which hands every byte to
# the decoder: a JSON error page arrives as corrupt media, and PatchedVideoPlayer treats
# a network error during an active download as recoverable — so an expired session would
# look like a random playback fault and never prompt anyone to sign in.
@app.exception_handler(SilentUnauthorized)
async def bare_401(request: Request, exc: SilentUnauthorized):
    """A 401 with no body, for the routes a <video> element loads directly."""
    return Response(status_code=401)


@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    logger.info("Starting up YIFY Torrent Downloader...")
    
    try:
        # Initialize database
        init_db()
        logger.info("Database initialized")

        # Accounts bootstrap: the users -> accounts backfill, plus the claim code for an
        # unclaimed instance. It CANNOT move into init_db(): that runs at import time
        # (app/cron/jobs.py builds a ScheduleManager at module scope, whose __init__
        # calls it) BEFORE settings.initialize() has created the log directory the claim
        # code file is written into.
        try:
            with get_db() as db:
                report = accounts_service.bootstrap(db)
            logger.info(
                "Accounts bootstrap: "
                f"{report.accounts_created} account(s) created, "
                f"{report.settings_created} settings row(s) healed, "
                f"{report.passcodes_hashed} passcode(s) hashed, "
                f"owner={report.owner_profile_name or report.owner_account_id or 'unset'}"
            )
            for problem in report.problems:
                logger.error(f"Accounts bootstrap problem: {problem}")
        except Exception as bootstrap_error:
            # A failed bootstrap leaves the instance unclaimable, which is fatal for a
            # fresh deploy but must not take down an already-claimed one.
            logger.critical(f"Accounts bootstrap failed: {bootstrap_error}")
            logger.exception("Accounts bootstrap error:")
        
        # Start torrent manager update task
        try:
            await torrent_manager.start_update_task()
            logger.info("Torrent manager started successfully")
        except Exception as torrent_error:
            logger.critical(f"Failed to start torrent manager: {torrent_error}")
            logger.exception("Torrent manager startup error:")
            # Continue with other services - we might still be able to function
        
        # Start scheduler if enabled
        if settings.cron_enabled:
            try:
                await schedule_manager.start_scheduler()
                logger.info("Scheduler enabled and started")
            except Exception as scheduler_error:
                logger.critical(f"Failed to start scheduler: {scheduler_error}")
                logger.exception("Scheduler startup error:")
                # Continue - the application can still function without the scheduler
        else:
            logger.info("Scheduler is disabled")
            
        logger.info("Initialization complete - service ready to accept requests")
    except Exception as e:
        logger.critical(f"Startup failed: {e}")
        logger.exception("Detailed error information:")
        # In a production environment, consider gracefully shutting down the app
        # if critical initialization fails


@app.on_event("shutdown")
async def shutdown_event():
    """Gracefully shutdown services"""
    logger.info("Shutting down YIFY Torrent Downloader...")
    
    # Create a list to track services that failed to shut down
    failed_services = []
    
    # First shut down the scheduler (if enabled)
    if settings.cron_enabled:
        try:
            logger.info("Shutting down scheduler...")
            await asyncio.wait_for(schedule_manager.shutdown(), timeout=5.0)
            logger.info("Scheduler shut down successfully")
        except asyncio.TimeoutError:
            logger.warning("Scheduler shutdown timed out")
            failed_services.append("scheduler")
        except Exception as e:
            logger.error(f"Error shutting down scheduler: {e}")
            logger.exception("Scheduler shutdown error details:")
            failed_services.append("scheduler")
    
    # Then shut down the torrent manager
    try:
        logger.info("Shutting down torrent manager...")
        await asyncio.wait_for(torrent_manager.shutdown(), timeout=10.0)
        logger.info("Torrent manager shut down successfully")
    except asyncio.TimeoutError:
        logger.warning("Torrent manager shutdown timed out")
        failed_services.append("torrent manager")
    except Exception as e:
        logger.error(f"Error shutting down torrent manager: {e}")
        logger.exception("Torrent manager shutdown error details:")
        failed_services.append("torrent manager")
    
    # Final cleanup for database - do this even if other services failed
    try:
        logger.info("Closing remaining database sessions...")
        from app.database.session import close_thread_sessions
        close_thread_sessions()
        logger.info("Database sessions closed")
    except Exception as db_error:
        logger.error(f"Error closing database sessions: {db_error}")
        failed_services.append("database")
    
    if failed_services:
        logger.warning(f"The following services may not have shut down properly: {', '.join(failed_services)}")
    else:
        logger.info("All services shut down successfully")
    
    logger.info("Shutdown complete")

async def graceful_shutdown(coro, service_name):
    """Helper to gracefully handle shutdown of a service"""
    try:
        await coro
        logger.info(f"Successfully shut down {service_name}")
    except Exception as e:
        logger.error(f"Error shutting down {service_name}: {e}")
        # Don't re-raise, we want to continue shutting down other services


@app.get("/", tags=["Status"])
async def root():
    """Root endpoint for health check"""
    return {
        "status": "running",
        "service": settings.project_name,
        "platform": platform.system(),
        "hardware": platform.machine(),
    }


@app.get("/health", tags=["Status"])
async def health_check():
    """Health check endpoint"""
    try:
        active_torrents = len(torrent_manager.active_torrents)
        return {
            "status": "healthy",
            "active_torrents": active_torrents,
            "scheduler_enabled": settings.cron_enabled,
        }
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Health check failed")


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.environment == "development",
        workers=1,
    )