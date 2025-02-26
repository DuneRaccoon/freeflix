#!/bin/bash

# Start both backend and frontend services
cd /opt/yify_downloader/yify-scraper

# Start backend
systemctl start yify-downloader.service

# Start frontend
if [ -d "/opt/yify_downloader/yify-scraper/frontend" ]; then
  cd frontend
  nohup npm start > ../logs/frontend.log 2>&1 &
  echo "Frontend started on port 3000"
fi

echo "Services started. Backend API available at http://localhost:8000"
if [ -d "/opt/yify_downloader/yify-scraper/frontend" ]; then
  echo "Frontend UI available at http://localhost:3000"
fi
