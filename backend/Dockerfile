FROM python:3.10-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    POETRY_VERSION=1.8.3 \
    POETRY_VIRTUALENVS_CREATE=false \
    POETRY_NO_INTERACTION=1

WORKDIR /opt/freeflix

# System dependencies (libtorrent + native build toolchain)
RUN apt-get update && apt-get install -y --no-install-recommends \
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

# Install Poetry
RUN pip install "poetry==${POETRY_VERSION}"

# Install Python dependencies first (better layer caching).
# --no-root: do not install the project package itself (we copy app/ below).
# --only main: this project keeps all deps in the main group.
COPY pyproject.toml poetry.lock ./
RUN poetry install --no-root --only main

# Application code + tests (tests are copied so `make test` works in-container)
COPY app/ ./app/
COPY serve.py ./
COPY tests/ ./tests/
COPY shell.py ./shell.py
COPY serve.py ./serve.py

# Runtime directories
RUN mkdir -p downloads resume_data logs

EXPOSE 8000

CMD ["python", "serve.py"]
