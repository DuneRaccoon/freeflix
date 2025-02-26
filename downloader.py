#!/usr/bin/env python
"""
YIFY Torrent Downloader Service
A FastAPI application for controlling YTS torrent downloads

This script serves as the entry point for the systemd service.
"""

import os
import sys
import uvicorn
from pathlib import Path

# Add the application directory to the Python path
app_path = Path(__file__).resolve().parent
if str(app_path) not in sys.path:
    sys.path.append(str(app_path))

# Set environment variables if needed
os.environ.setdefault("DOWNLOAD_PATH", str(Path(app_path) / "downloads"))


def main():
    """Run the FastAPI application with Uvicorn"""
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,  # Disable reload in production
        workers=1,     # Use a single worker for consistency with torrents
    )


if __name__ == "__main__":
    main()