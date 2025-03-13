import os
import sys
import asyncio
import uvicorn
from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger
from typing import Optional
import platform

from app.config import settings
from app.api import movies, torrents, schedules, streaming, users
from app.torrent.manager import torrent_manager
from app.cron.jobs import schedule_manager
from app.database.session import init_db

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
is_raspberry_pi = "arm" in platform.machine().lower()
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

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(
    movies.router,
    prefix=f"{settings.api_v1_str}/movies",
    tags=["Movies"],
)
app.include_router(
    torrents.router,
    prefix=f"{settings.api_v1_str}/torrents",
    tags=["Torrents"],
)
app.include_router(
    schedules.router,
    prefix=f"{settings.api_v1_str}/schedules",
    tags=["Schedules"],
)
app.include_router(
    streaming.router,
    prefix=f"{settings.api_v1_str}/streaming",
    tags=["Streaming"],
)
app.include_router(
    users.router,
    prefix=f"{settings.api_v1_str}/users",
    tags=["Users"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log all incoming requests"""
    logger.info(f"{request.method} {request.url.path}")
    try:
        response = await call_next(request)
        return response
    except Exception as e:
        logger.error(f"Request error: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error"},
        )


@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    logger.info("Starting up YIFY Torrent Downloader...")
    
    # Initialize database
    init_db()
    logger.info("Database initialized")
    
    # Start torrent manager update task
    await torrent_manager.start_update_task()
    
    # Start scheduler if enabled
    if settings.cron_enabled:
        await schedule_manager.start_scheduler()
        logger.info("Scheduler enabled and started")
    else:
        logger.info("Scheduler is disabled")


@app.on_event("shutdown")
async def shutdown_event():
    """Gracefully shutdown services"""
    logger.info("Shutting down YIFY Torrent Downloader...")
    
    # Shutdown scheduler
    if settings.cron_enabled:
        await schedule_manager.shutdown()
    
    # Shutdown torrent manager
    await torrent_manager.shutdown()


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
        reload=False,
        workers=1,
    )