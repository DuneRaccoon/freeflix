#!/bin/bash

# YIFY Downloader Installer Script
# This script installs both the backend and frontend components of YIFY Downloader
# Designed for Linux systems, with special attention to Raspberry Pi

# Color codes for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Print banner
echo -e "${BLUE}=================================================================${NC}"
echo -e "${GREEN}             YIFY Downloader - Installation Script             ${NC}"
echo -e "${BLUE}=================================================================${NC}"
echo -e "${YELLOW}This script will install both the backend and frontend components${NC}"
echo -e "${YELLOW}of YIFY Downloader on your Linux system.${NC}"
echo -e "${BLUE}=================================================================${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Please run this script as root (use sudo)${NC}"
  exit 1
fi

# Detect architecture and OS
echo -e "${CYAN}Detecting system information...${NC}"
ARCH=$(uname -m)
IS_RASPBERRY_PI=false

# Check for Raspberry Pi
if [[ -f /proc/device-tree/model ]]; then
  MODEL=$(tr -d '\0' < /proc/device-tree/model)
  if [[ "$MODEL" == *"Raspberry Pi"* ]]; then
    IS_RASPBERRY_PI=true
    echo -e "${GREEN}Detected Raspberry Pi: $MODEL${NC}"
  fi
fi

if [[ "$IS_RASPBERRY_PI" != true ]]; then
  echo -e "${GREEN}Detected architecture: $ARCH${NC}"
fi

# Ask for installation directory
read -p "Installation directory [/opt/freeflix]: " INSTALL_DIR
INSTALL_DIR=${INSTALL_DIR:-/opt/freeflix}

# Ask for download directory
read -p "Download directory for movies [${INSTALL_DIR}/downloads]: " DOWNLOAD_DIR
DOWNLOAD_DIR=${DOWNLOAD_DIR:-${INSTALL_DIR}/downloads}

# Ask for port numbers
read -p "Backend port number [8000]: " BACKEND_PORT
BACKEND_PORT=${BACKEND_PORT:-8000}

read -p "Frontend port number [3000]: " FRONTEND_PORT
FRONTEND_PORT=${FRONTEND_PORT:-3000}

# Ask if user wants to set up systemd services
read -p "Set up systemd services? (y/n) [y]: " SETUP_SYSTEMD
SETUP_SYSTEMD=${SETUP_SYSTEMD:-y}

# Ask if user wants to use libtorrent custom install (recommended for Raspberry Pi)
if [[ "$IS_RASPBERRY_PI" == true ]]; then
  read -p "Use custom libtorrent installation (recommended for Raspberry Pi)? (y/n) [y]: " USE_CUSTOM_LIBTORRENT
  USE_CUSTOM_LIBTORRENT=${USE_CUSTOM_LIBTORRENT:-y}
else
  USE_CUSTOM_LIBTORRENT="n"
fi

# Confirm installation
echo ""
echo -e "${PURPLE}Installation Summary:${NC}"
echo -e "Installation directory: ${CYAN}$INSTALL_DIR${NC}"
echo -e "Download directory: ${CYAN}$DOWNLOAD_DIR${NC}"
echo -e "Backend port: ${CYAN}$BACKEND_PORT${NC}"
echo -e "Frontend port: ${CYAN}$FRONTEND_PORT${NC}"
echo -e "Set up systemd services: ${CYAN}$SETUP_SYSTEMD${NC}"
if [[ "$IS_RASPBERRY_PI" == true ]]; then
  echo -e "Use custom libtorrent installation: ${CYAN}$USE_CUSTOM_LIBTORRENT${NC}"
fi
echo ""
read -p "Continue with installation? (y/n) [y]: " CONFIRM
CONFIRM=${CONFIRM:-y}

if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo -e "${RED}Installation aborted.${NC}"
  exit 1
fi

# Create installation directories
echo -e "\n${CYAN}Creating installation directories...${NC}"
mkdir -p $INSTALL_DIR
mkdir -p $DOWNLOAD_DIR
mkdir -p $INSTALL_DIR/logs
mkdir -p $INSTALL_DIR/data
mkdir -p $INSTALL_DIR/resume_data
mkdir -p $INSTALL_DIR/backend
mkdir -p $INSTALL_DIR/frontend

# Install system dependencies
echo -e "\n${CYAN}Installing system dependencies...${NC}"
apt-get update
apt-get install -y python3 python3-pip python3-venv git curl wget build-essential python3-dev

# For Node.js
echo -e "\n${CYAN}Setting up Node.js...${NC}"
if ! command -v node &> /dev/null; then
  if [[ "$IS_RASPBERRY_PI" == true ]]; then
    # Node.js 18.x for Raspberry Pi
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
  else
    # Node.js 20.x for other systems
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi
fi

# Install libtorrent dependencies
if [[ "$USE_CUSTOM_LIBTORRENT" == "y" || "$USE_CUSTOM_LIBTORRENT" == "Y" ]]; then
  echo -e "\n${CYAN}Installing libtorrent dependencies...${NC}"
  apt-get install -y libboost-all-dev libssl-dev
fi

# Create a Python virtual environment
echo -e "\n${CYAN}Setting up Python virtual environment...${NC}"
python3 -m venv $INSTALL_DIR/backend/venv
source $INSTALL_DIR/backend/venv/bin/activate

# Install Python dependencies
echo -e "\n${CYAN}Installing Python dependencies...${NC}"
pip3 install --upgrade pip wheel setuptools

# Install libtorrent
if [[ "$USE_CUSTOM_LIBTORRENT" == "y" || "$USE_CUSTOM_LIBTORRENT" == "Y" ]]; then
  echo -e "\n${CYAN}Building libtorrent from source (this may take a while)...${NC}"
  cd /tmp
  wget https://github.com/arvidn/libtorrent/releases/download/v2.0.9/libtorrent-rasterbar-2.0.9.tar.gz
  tar -xzf libtorrent-rasterbar-2.0.9.tar.gz
  cd libtorrent-rasterbar-2.0.9
  
  # Build libtorrent
  mkdir build
  cd build
  cmake -DCMAKE_BUILD_TYPE=Release -DPYTHON_BINDINGS=ON -DPYTHON_EXECUTABLE=$(which python3) ..
  make -j$(nproc)
  make install
  ldconfig
  
  # Install Python bindings
  cd ..
  cd bindings/python
  python3 setup.py build
  python3 setup.py install
else
  # Install from pip
  pip3 install libtorrent
fi

# Clone the repository
echo -e "\n${CYAN}Cloning the repository...${NC}"
cd /tmp
git clone https://github.com/yourusername/yify-downloader.git
# Note: Replace with the actual GitHub repository URL if available

# Copy backend files
echo -e "\n${CYAN}Setting up backend...${NC}"
cp -r /tmp/yify-downloader/app $INSTALL_DIR/backend/
cp -r /tmp/yify-downloader/downloader.py $INSTALL_DIR/backend/
cp -r /tmp/yify-downloader/requirements.txt $INSTALL_DIR/backend/

# Create backend app files if they don't exist (in case the repository doesn't contain them)
# Creating minimal app structure
if [ ! -d "$INSTALL_DIR/backend/app" ]; then
  echo -e "${YELLOW}Creating backend app structure...${NC}"
  mkdir -p $INSTALL_DIR/backend/app
  mkdir -p $INSTALL_DIR/backend/app/api
  mkdir -p $INSTALL_DIR/backend/app/database
  mkdir -p $INSTALL_DIR/backend/app/scrapers
  mkdir -p $INSTALL_DIR/backend/app/torrent
  mkdir -p $INSTALL_DIR/backend/app/cron
  
  # Create __init__.py files
  touch $INSTALL_DIR/backend/app/__init__.py
  touch $INSTALL_DIR/backend/app/api/__init__.py
  touch $INSTALL_DIR/backend/app/database/__init__.py
  touch $INSTALL_DIR/backend/app/scrapers/__init__.py
  touch $INSTALL_DIR/backend/app/torrent/__init__.py
  touch $INSTALL_DIR/backend/app/cron/__init__.py
fi

# Create a requirements.txt file if it doesn't exist
if [ ! -f "$INSTALL_DIR/backend/requirements.txt" ]; then
  echo -e "${YELLOW}Creating requirements.txt...${NC}"
  cat > $INSTALL_DIR/backend/requirements.txt << EOF
fastapi==0.104.1
uvicorn[standard]==0.23.2
pydantic==2.4.2
pydantic-settings==2.0.3
httpx==0.25.0
beautifulsoup4==4.12.2
torf==4.2.4
leaky-bucket-py==0.1.3
croniter==1.4.1
APScheduler==3.10.4
loguru==0.7.2
python-multipart==0.0.6
sqlalchemy==1.4.31
EOF
fi

# Install backend requirements
cd $INSTALL_DIR/backend
pip3 install -r requirements.txt

# Create downloader.py if it doesn't exist
if [ ! -f "$INSTALL_DIR/backend/downloader.py" ]; then
  cat > $INSTALL_DIR/backend/downloader.py << EOF
#!/usr/bin/env python
"""
YIFY Torrent Downloader Service
A FastAPI application for controlling YTS torrent downloads
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
os.environ.setdefault("DOWNLOAD_PATH", "${DOWNLOAD_DIR}")

def main():
    """Run the FastAPI application with Uvicorn"""
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=${BACKEND_PORT},
        reload=False,  # Disable reload in production
        workers=1,     # Use a single worker for consistency with torrents
    )

if __name__ == "__main__":
    main()
EOF

  # Make it executable
  chmod +x $INSTALL_DIR/backend/downloader.py
fi

# Create minimal config.py if it doesn't exist
if [ ! -f "$INSTALL_DIR/backend/app/config.py" ]; then
  echo -e "${YELLOW}Creating config.py...${NC}"
  cat > $INSTALL_DIR/backend/app/config.py << EOF
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
    REQUEST_RATE_LIMIT: int = 3  # requests per second
    
    # Torrent settings
    DEFAULT_DOWNLOAD_PATH: Path = Path(os.environ.get("DOWNLOAD_PATH", "${DOWNLOAD_DIR}"))
    LISTEN_INTERFACES: str = "0.0.0.0:6881"
    PORT_RANGE_START: int = 6881
    PORT_RANGE_END: int = 6891
    MAX_ACTIVE_DOWNLOADS: int = 3
    RESUME_DATA_PATH: Path = Path("${INSTALL_DIR}/resume_data")
    
    # Logging settings
    LOG_LEVEL: str = "INFO"
    LOG_PATH: Path = Path("${INSTALL_DIR}/logs")
    
    # Database settings
    DB_PATH: Path = Path("${INSTALL_DIR}/data/torrents.db")
    
    # Cron settings
    CRON_ENABLED: bool = True
    
    # Create necessary directories on startup
    def initialize(self):
        self.DEFAULT_DOWNLOAD_PATH.mkdir(parents=True, exist_ok=True)
        self.RESUME_DATA_PATH.mkdir(parents=True, exist_ok=True)
        self.LOG_PATH.mkdir(parents=True, exist_ok=True)
        self.DB_PATH.parent.mkdir(parents=True, exist_ok=True)

settings = Settings()
EOF
fi

# Create a minimal main.py if it doesn't exist
if [ ! -f "$INSTALL_DIR/backend/app/main.py" ]; then
  echo -e "${YELLOW}Creating main.py...${NC}"
  cat > $INSTALL_DIR/backend/app/main.py << EOF
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings

# Initialize directories and settings
settings.initialize()

# Create FastAPI app
app = FastAPI(
    title=settings.PROJECT_NAME,
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

@app.get("/", tags=["Status"])
async def root():
    """Root endpoint for health check"""
    return {
        "status": "running",
        "service": settings.PROJECT_NAME
    }

@app.get("/health", tags=["Status"])
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=${BACKEND_PORT},
        reload=False,
        workers=1,
    )
EOF
fi

# Set up frontend
echo -e "\n${CYAN}Setting up frontend...${NC}"
cd $INSTALL_DIR/frontend

# Initialize Node.js project
npm init -y

# Install Next.js dependencies
npm install next@13 react react-dom

# Update package.json scripts
node -e "
const pkg = require('./package.json');
pkg.scripts = {
  ...pkg.scripts,
  'dev': 'next dev -p ${FRONTEND_PORT}',
  'build': 'next build',
  'start': 'next start -p ${FRONTEND_PORT}'
};
require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2));
"

# Create basic Next.js app structure
mkdir -p pages
mkdir -p public
mkdir -p styles

# Create basic pages
cat > pages/index.js << EOF
import React from 'react';

export default function Home() {
  return (
    <div style={{ padding: '2rem' }}>
      <h1>YIFY Downloader</h1>
      <p>Welcome to YIFY Downloader - a tool for downloading YTS torrents</p>
      <p>Backend status: <span id="status">Checking...</span></p>
      
      <script dangerouslySetInnerHTML={{
        __html: \`
          fetch('http://localhost:${BACKEND_PORT}/health')
            .then(res => res.json())
            .then(data => {
              document.getElementById('status').textContent = data.status === 'healthy' ? 'Connected' : 'Error';
              document.getElementById('status').style.color = data.status === 'healthy' ? 'green' : 'red';
            })
            .catch(err => {
              document.getElementById('status').textContent = 'Not connected';
              document.getElementById('status').style.color = 'red';
            });
        \`
      }} />
    </div>
  );
}
EOF

# Create next.config.js for API proxy
cat > next.config.js << EOF
module.exports = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:${BACKEND_PORT}/api/:path*'
      }
    ];
  }
};
EOF

# Build the frontend
npm run build

# Create systemd service for backend
if [[ "$SETUP_SYSTEMD" == "y" || "$SETUP_SYSTEMD" == "Y" ]]; then
  echo -e "\n${CYAN}Creating systemd services...${NC}"
  
  # Backend service
  cat > /etc/systemd/system/yify-backend.service << EOF
[Unit]
Description=YIFY Downloader Backend Service
After=network.target

[Service]
User=root
Group=root
WorkingDirectory=${INSTALL_DIR}/backend
ExecStart=${INSTALL_DIR}/backend/venv/bin/python ${INSTALL_DIR}/backend/downloader.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1
Environment=DOWNLOAD_PATH=${DOWNLOAD_DIR}

[Install]
WantedBy=multi-user.target
EOF

  # Frontend service
  cat > /etc/systemd/system/yify-frontend.service << EOF
[Unit]
Description=YIFY Downloader Frontend Service
After=network.target

[Service]
User=root
Group=root
WorkingDirectory=${INSTALL_DIR}/frontend
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
Environment=PORT=${FRONTEND_PORT}

[Install]
WantedBy=multi-user.target
EOF

  # Enable and start services
  systemctl daemon-reload
  systemctl enable yify-backend.service
  systemctl enable yify-frontend.service
  systemctl start yify-backend.service
  systemctl start yify-frontend.service
  
  # Check service status
  echo -e "\n${CYAN}Checking service status...${NC}"
  systemctl status yify-backend.service --no-pager
  systemctl status yify-frontend.service --no-pager
fi

# Set correct permissions
echo -e "\n${CYAN}Setting file permissions...${NC}"
chown -R root:root $INSTALL_DIR
chmod -R 755 $INSTALL_DIR
chmod -R 777 $DOWNLOAD_DIR  # This directory needs to be writable by the service

# Clean up
echo -e "\n${CYAN}Cleaning up...${NC}"
rm -rf /tmp/yify-downloader

# Print success message
echo -e "\n${GREEN}Installation completed successfully!${NC}"
echo -e "${BLUE}=================================================================${NC}"
echo -e "${YELLOW}Backend service: ${GREEN}http://localhost:${BACKEND_PORT}${NC}"
echo -e "${YELLOW}Frontend service: ${GREEN}http://localhost:${FRONTEND_PORT}${NC}"
echo -e ""
echo -e "${YELLOW}Installation directory: ${CYAN}$INSTALL_DIR${NC}"
echo -e "${YELLOW}Download directory: ${CYAN}$DOWNLOAD_DIR${NC}"
echo -e ""

if [[ "$SETUP_SYSTEMD" == "y" || "$SETUP_SYSTEMD" == "Y" ]]; then
  echo -e "${YELLOW}Services:${NC}"
  echo -e "  Backend: ${CYAN}systemctl [start|stop|restart] yify-backend.service${NC}"
  echo -e "  Frontend: ${CYAN}systemctl [start|stop|restart] yify-frontend.service${NC}"
else
  echo -e "${YELLOW}To start the backend manually:${NC}"
  echo -e "${CYAN}source ${INSTALL_DIR}/backend/venv/bin/activate${NC}"
  echo -e "${CYAN}python ${INSTALL_DIR}/backend/downloader.py${NC}"
  echo -e ""
  echo -e "${YELLOW}To start the frontend manually:${NC}"
  echo -e "${CYAN}cd ${INSTALL_DIR}/frontend${NC}"
  echo -e "${CYAN}npm start${NC}"
fi
echo -e "${BLUE}=================================================================${NC}"