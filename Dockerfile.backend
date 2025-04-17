FROM python:3.10-slim

WORKDIR /opt/freeflix

# Install system dependencies including libtorrent requirements
RUN apt-get update && apt-get install -y \
    build-essential \
    pkg-config \
    libboost-all-dev \
    libssl-dev \
    libgeoip-dev \
    libtorrent-rasterbar-dev \
    python3-libtorrent \
    git \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements file and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install psycopg2 for PostgreSQL support
RUN pip install --no-cache-dir psycopg2-binary

# Copy the application code
COPY app/ ./app/
COPY serve.py .
COPY pyproject.toml .

# Create necessary directories
RUN mkdir -p downloads resume_data logs

# Expose the port
EXPOSE 8000

# Command to run the application
CMD ["python", "serve.py"]