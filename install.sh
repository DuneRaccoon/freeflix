#!/bin/bash

# Define variables
REPO_URL="https://github.com/YOUR_GITHUB_REPO.git"
INSTALL_DIR="/opt/yify_downloader"
SERVICE_FILE="yify_downloader.service"
PYTHON_SCRIPT="downloader.py"

# Ensure script is run as root
if [ "$(id -u)" -ne 0 ]; then
    echo "This script must be run as root. Use sudo ./install.sh"
    exit 1
fi

echo "Updating system and installing dependencies..."
apt update && apt install -y python3 python3-pip python3-venv git libtorrent-rasterbar-dev curl

# Install Poetry if not already installed
if ! command -v poetry &> /dev/null; then
    echo "Installing Poetry..."
    curl -sSL https://install.python-poetry.org | python3 -
    export PATH="$HOME/.local/bin:$PATH"
fi

# Clone or update the repository
if [ -d "$INSTALL_DIR" ]; then
    echo "Updating existing installation..."
    cd "$INSTALL_DIR" && git pull
else
    echo "Cloning repository..."
    git clone "$REPO_URL" "$INSTALL_DIR"
fi

# Navigate to installation directory
cd "$INSTALL_DIR"

# Ensure Poetry uses a virtual environment inside the project
poetry config virtualenvs.in-project true

# Install dependencies using Poetry
echo "Installing Python dependencies via Poetry..."
poetry install --no-root

# Ensure the Python script is executable
chmod +x "$INSTALL_DIR/$PYTHON_SCRIPT"

# Move systemd service file to correct location
echo "Setting up systemd service..."
cp "$SERVICE_FILE" /etc/systemd/system/

# Get the path to Poetry’s virtual environment
VENV_PATH=$(poetry env info --path)

# Update systemd service file with the correct paths
sed -i "s|ExecStart=.*|ExecStart=$VENV_PATH/bin/python $INSTALL_DIR/$PYTHON_SCRIPT|" /etc/systemd/system/$SERVICE_FILE
sed -i "s|WorkingDirectory=.*|WorkingDirectory=$INSTALL_DIR|" /etc/systemd/system/$SERVICE_FILE
sed -i "s|User=.*|User=$(logname)|" /etc/systemd/system/$SERVICE_FILE
sed -i "s|Group=.*|Group=$(logname)|" /etc/systemd/system/$SERVICE_FILE

# Reload systemd and enable service
echo "Enabling and starting the YIFY downloader service..."
systemctl daemon-reload
systemctl enable "$SERVICE_FILE"
systemctl start "$SERVICE_FILE"

echo "Installation complete!"
systemctl status "$SERVICE_FILE"
