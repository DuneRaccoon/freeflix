#!/bin/bash
#
# YIFY Torrent Downloader Service Installation Script
# This script automates the installation of the YIFY Torrent Downloader Service on Raspberry Pi
#

# Set text colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default configuration
INSTALL_DIR="/opt/freeflix"
DOWNLOAD_DIR="/mnt/media/downloads/movies"
SERVICE_USER="$USER"
SERVICE_GROUP="$USER"
PORT="8000"
MAX_ACTIVE_DOWNLOADS="2"
LOG_LEVEL="INFO"

# Banner
echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║              YIFY Torrent Downloader Installer             ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check if script is run as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}This script must be run as root or with sudo privileges${NC}"
  exit 1
fi

# Print section header
print_section() {
  echo -e "\n${BLUE}▶ $1${NC}"
}

# Print success message
print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

# Print warning message
print_warning() {
  echo -e "${YELLOW}⚠ $1${NC}"
}

# Print error message
print_error() {
  echo -e "${RED}✗ $1${NC}"
}

# Ask for configuration
configure() {
  print_section "Configuration"
  
  # Installation directory
  read -p "Installation directory [$INSTALL_DIR]: " input
  INSTALL_DIR=${input:-$INSTALL_DIR}
  
  # Download directory
  read -p "Download directory [$DOWNLOAD_DIR]: " input
  DOWNLOAD_DIR=${input:-$DOWNLOAD_DIR}
  
  # Service user
  read -p "User to run service as [$SERVICE_USER]: " input
  SERVICE_USER=${input:-$SERVICE_USER}
  
  # Service group
  read -p "Group to run service as [$SERVICE_GROUP]: " input
  SERVICE_GROUP=${input:-$SERVICE_GROUP}
  
  # Port
  read -p "API port [$PORT]: " input
  PORT=${input:-$PORT}
  
  # Max active downloads
  read -p "Maximum concurrent downloads [$MAX_ACTIVE_DOWNLOADS]: " input
  MAX_ACTIVE_DOWNLOADS=${input:-$MAX_ACTIVE_DOWNLOADS}
  
  # Log level
  read -p "Log level (DEBUG, INFO, WARNING, ERROR) [$LOG_LEVEL]: " input
  LOG_LEVEL=${input:-$LOG_LEVEL}
  
  echo -e "\nConfiguration summary:"
  echo "  Installation directory: $INSTALL_DIR"
  echo "  Download directory: $DOWNLOAD_DIR"
  echo "  Service user: $SERVICE_USER"
  echo "  Service group: $SERVICE_GROUP"
  echo "  API port: $PORT"
  echo "  Max downloads: $MAX_ACTIVE_DOWNLOADS"
  echo "  Log level: $LOG_LEVEL"
  
  read -p "Continue with installation? [Y/n]: " confirm
  confirm=${confirm:-Y}
  
  if [[ $confirm != [Yy]* ]]; then
    print_warning "Installation cancelled"
    exit 0
  fi
}

# Check and install dependencies
install_dependencies() {
  print_section "Installing dependencies"
  
  apt update
  
  # Check if packages are already installed
  PACKAGES="python3-pip python3-venv git libtorrent-rasterbar-dev"
  
  for pkg in $PACKAGES; do
    if dpkg -l | grep -q $pkg; then
      print_success "$pkg already installed"
    else
      echo "Installing $pkg..."
      apt install -y $pkg
      if [ $? -eq 0 ]; then
        print_success "$pkg installed"
      else
        print_error "Failed to install $pkg"
        read -p "Continue anyway? [y/N]: " cont
        cont=${cont:-N}
        if [[ $cont != [Yy]* ]]; then
          print_error "Installation aborted"
          exit 1
        fi
      fi
    fi
  done
}

# Create directory structure
create_directories() {
  print_section "Setting up directories"
  
  # Create installation directory
  if [ ! -d "$INSTALL_DIR" ]; then
    mkdir -p "$INSTALL_DIR"
    print_success "Created $INSTALL_DIR"
  else
    print_warning "$INSTALL_DIR already exists"
  fi
  
  # Create download directory
  if [ ! -d "$DOWNLOAD_DIR" ]; then
    mkdir -p "$DOWNLOAD_DIR"
    print_success "Created $DOWNLOAD_DIR"
  else
    print_warning "$DOWNLOAD_DIR already exists"
  fi
  
  # Create log directory
  mkdir -p "$INSTALL_DIR/logs"
  print_success "Created log directory"
  
  # Create data directory for the database
  mkdir -p "$INSTALL_DIR/data"
  print_success "Created data directory"
  
  # Create resume data directory
  mkdir -p "$INSTALL_DIR/resume_data"
  print_success "Created resume data directory"
  
  # Set proper permissions
  chown -R $SERVICE_USER:$SERVICE_GROUP "$INSTALL_DIR"
  chown -R $SERVICE_USER:$SERVICE_GROUP "$DOWNLOAD_DIR"
  print_success "Set directory permissions"
}

# Create application structure and copy files
setup_application() {
  print_section "Setting up application"
  
  # Create application structure
  mkdir -p "$INSTALL_DIR/app"
  mkdir -p "$INSTALL_DIR/app/api"
  mkdir -p "$INSTALL_DIR/app/cron"
  mkdir -p "$INSTALL_DIR/app/scrapers"
  mkdir -p "$INSTALL_DIR/app/torrent"
  
  # Create the app/__init__.py file
  touch "$INSTALL_DIR/app/__init__.py"
  
  # Create the api/__init__.py file
  cat > "$INSTALL_DIR/app/api/__init__.py" <<EOL
# API module initialization
EOL

  # Create the scrapers/__init__.py file
  cat > "$INSTALL_DIR/app/scrapers/__init__.py" <<EOL
# Scrapers module initialization
EOL

  # Create the cron/__init__.py file
  cat > "$INSTALL_DIR/app/cron/__init__.py" <<EOL
# Cron module initialization
EOL

  # Create the torrent/__init__.py file
  cat > "$INSTALL_DIR/app/torrent/__init__.py" <<EOL
# Torrent module initialization
EOL

  # Detect script directory
  SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
  
  # Copy files
  echo "Copying application files..."
  
  # Copy Python files
  for file in $(find "$SCRIPT_DIR" -name "*.py" -type f); do
    filename=$(basename "$file")
    if [ "$filename" = "downloader.py" ]; then
      cp "$file" "$INSTALL_DIR/"
    else
      module_path=$(echo "$file" | sed -e "s|$SCRIPT_DIR/||")
      if [[ $module_path == app/* ]]; then
        target_dir=$(dirname "$INSTALL_DIR/$module_path")
        mkdir -p "$target_dir"
        cp "$file" "$target_dir/"
      fi
    fi
  done
  
  # Create requirements.txt
  cat > "$INSTALL_DIR/requirements.txt" <<EOL
# FastAPI and server
fastapi==0.104.1
uvicorn[standard]==0.23.2
pydantic==2.4.2
pydantic-settings==2.0.3

# HTTP and parsing
httpx==0.25.0
beautifulsoup4==4.12.2
torf==4.2.4

# Rate limiting
leakybucket==0.2.7

# Scheduling
croniter==1.4.1
APScheduler==3.10.4

# Logging
loguru==0.7.2

# Libtorrent
python-libtorrent==1.2.8

# Utilities
python-multipart==0.0.6
EOL

  # Make downloader.py executable
  chmod +x "$INSTALL_DIR/downloader.py"
  
  print_success "Application files set up"
}

# Set up Python virtual environment
setup_virtual_env() {
  print_section "Setting up Python virtual environment"
  
  # Create and activate virtual environment
  if [ ! -d "$INSTALL_DIR/venv" ]; then
    su - $SERVICE_USER -c "cd $INSTALL_DIR && python3 -m venv venv"
    print_success "Created virtual environment"
  else
    print_warning "Virtual environment already exists"
  fi
  
  # Install requirements
  su - $SERVICE_USER -c "cd $INSTALL_DIR && venv/bin/pip install --upgrade pip"
  su - $SERVICE_USER -c "cd $INSTALL_DIR && venv/bin/pip install -r requirements.txt"
  
  if [ $? -eq 0 ]; then
    print_success "Installed Python requirements"
  else
    print_error "Failed to install Python requirements"
    read -p "Continue anyway? [y/N]: " cont
    cont=${cont:-N}
    if [[ $cont != [Yy]* ]]; then
      print_error "Installation aborted"
      exit 1
    fi
  fi
}

# Create and configure systemd service
setup_service() {
  print_section "Setting up systemd service"
  
  # Create service file
  cat > /etc/systemd/system/yify-downloader.service <<EOL
[Unit]
Description=YIFY Torrent Downloader Service
After=network.target

[Service]
User=$SERVICE_USER
Group=$SERVICE_GROUP
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/venv/bin/python $INSTALL_DIR/downloader.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1
Environment=DOWNLOAD_PATH=$DOWNLOAD_DIR
Environment=API_PORT=$PORT
Environment=MAX_ACTIVE_DOWNLOADS=$MAX_ACTIVE_DOWNLOADS
Environment=LOG_LEVEL=$LOG_LEVEL

# Basic security measures
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOL
  
  # Enable and start service
  systemctl daemon-reload
  systemctl enable yify-downloader.service
  
  print_success "Service configured"
}

# Start the service
start_service() {
  print_section "Starting service"
  
  systemctl start yify-downloader.service
  sleep 2
  
  if systemctl is-active --quiet yify-downloader.service; then
    print_success "Service started successfully"
  else
    print_error "Service failed to start"
    echo "Check logs with: journalctl -u yify-downloader.service -f"
  fi
}

# Print installation summary
print_summary() {
  IP_ADDRESS=$(hostname -I | awk '{print $1}')
  
  echo -e "\n${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║           YIFY Torrent Downloader Installation Complete     ║${NC}"
  echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "API URL: ${BLUE}http://$IP_ADDRESS:$PORT${NC}"
  echo -e "API Documentation: ${BLUE}http://$IP_ADDRESS:$PORT/docs${NC}"
  echo ""
  echo "Installation Directory: $INSTALL_DIR"
  echo "Download Directory: $DOWNLOAD_DIR"
  echo ""
  echo "Useful commands:"
  echo "  Check service status: sudo systemctl status yify-downloader.service"
  echo "  View logs: sudo journalctl -u yify-downloader.service -f"
  echo "  Restart service: sudo systemctl restart yify-downloader.service"
  echo ""
  echo -e "${YELLOW}Note: If you encounter any issues, check the logs for detailed information.${NC}"
}

# Check for external storage
check_storage() {
  print_section "Checking storage"
  
  # Check if the download directory is on an external drive
  DF_OUTPUT=$(df -h "$DOWNLOAD_DIR" | grep -v "Filesystem")
  DEVICE=$(echo "$DF_OUTPUT" | awk '{print $1}')
  SIZE=$(echo "$DF_OUTPUT" | awk '{print $2}')
  USED=$(echo "$DF_OUTPUT" | awk '{print $3}')
  AVAIL=$(echo "$DF_OUTPUT" | awk '{print $4}')
  
  echo "Storage for downloads:"
  echo "  Device: $DEVICE"
  echo "  Size: $SIZE"
  echo "  Used: $USED"
  echo "  Available: $AVAIL"
  
  # Check if there's enough space (at least 5GB)
  AVAIL_KB=$(df -k "$DOWNLOAD_DIR" | grep -v "Filesystem" | awk '{print $4}')
  if [ "$AVAIL_KB" -lt 5000000 ]; then
    print_warning "Less than 5GB available space. This might not be enough for movie downloads."
    read -p "Continue anyway? [y/N]: " cont
    cont=${cont:-N}
    if [[ $cont != [Yy]* ]]; then
      print_error "Installation aborted"
      exit 1
    fi
  else
    print_success "Sufficient storage available"
  fi
}

# Check Raspberry Pi model
check_raspberry_pi() {
  print_section "Checking hardware"
  
  if grep -q "Raspberry Pi" /proc/device-tree/model 2>/dev/null; then
    MODEL=$(tr -d '\0' < /proc/device-tree/model)
    echo "Detected: $MODEL"
    
    # Check if it's a Raspberry Pi 5
    if [[ "$MODEL" == *"Raspberry Pi 5"* ]]; then
      print_success "Running on Raspberry Pi 5"
    else
      print_warning "Not running on Raspberry Pi 5. Performance may be limited."
      read -p "Continue anyway? [y/N]: " cont
      cont=${cont:-N}
      if [[ $cont != [Yy]* ]]; then
        print_error "Installation aborted"
        exit 1
      fi
    fi
  else
    print_warning "Not running on a Raspberry Pi. Some optimizations may not apply."
    read -p "Continue anyway? [y/N]: " cont
    cont=${cont:-N}
    if [[ $cont != [Yy]* ]]; then
      print_error "Installation aborted"
      exit 1
    fi
  fi
  
  # Check RAM
  TOTAL_RAM=$(free -m | awk '/^Mem:/{print $2}')
  echo "Total RAM: ${TOTAL_RAM}MB"
  
  if [ "$TOTAL_RAM" -lt 2000 ]; then
    print_warning "Less than 2GB RAM detected. Performance may be limited."
    # Adjust MAX_ACTIVE_DOWNLOADS based on RAM
    MAX_ACTIVE_DOWNLOADS=1
    echo "Limiting to $MAX_ACTIVE_DOWNLOADS concurrent download due to limited RAM"
  elif [ "$TOTAL_RAM" -lt 4000 ]; then
    print_warning "Less than 4GB RAM detected. Limiting concurrent downloads."
    MAX_ACTIVE_DOWNLOADS=2
  else
    print_success "Sufficient RAM available"
  fi
}

# Main installation flow
main() {
  configure
  check_raspberry_pi
  check_storage
  install_dependencies
  create_directories
  setup_application
  setup_virtual_env
  setup_service
  start_service
  print_summary
}

# Run the installation
main