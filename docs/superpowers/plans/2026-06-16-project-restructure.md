# Freeflix Project Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the repo into a clean `backend/` + `frontend/` monorepo with `docker-compose.yml` as the core build/run entry point and a `Makefile` wrapper, removing the bare-metal path and committed junk.

**Architecture:** Root holds orchestration only (compose, override, Makefile, `.env`, docs). The Python/FastAPI backend moves into `backend/` (Poetry as the single dependency source). The Next.js frontend stays in `frontend/`. A base `docker-compose.yml` defines a production-shaped stack (`db` + `backend` + `frontend`); an auto-loaded `docker-compose.override.yml` adds dev bind-mounts + hot reload.

**Tech Stack:** Docker Compose v2, GNU Make, Python 3.10 / FastAPI / libtorrent / Poetry, Next.js 15 / Node, PostgreSQL 16.

**Working branch:** `chore/restructure` (already created; spec already committed there).

**Discipline:** This is a behavior-preserving restructure. Each task ends by verifying the change and committing. Use `git mv` for moves to preserve history. Do NOT change application logic except the two explicitly-specified wiring edits (`next.config.ts` proxy target; nothing else).

---

## File Structure (target)

```
freeflix/
├── docker-compose.yml           # base / production-shaped (Task 5)
├── docker-compose.override.yml  # dev overlay, auto-loaded (Task 5)
├── Makefile                     # task wrapper (Task 6)
├── .env.example                 # single env template (Task 7)
├── .gitignore                   # + .DS_Store etc. (Task 7)
├── README.md                    # rewritten (Task 8)
├── docs/
│   ├── ARCHITECTURE.md          # new (Task 8)
│   └── superpowers/…            # spec + this plan
├── backend/
│   ├── Dockerfile               # Poetry-based (Task 3)
│   ├── .dockerignore            # (Task 3)
│   ├── pyproject.toml           # moved (Task 2)
│   ├── poetry.lock              # moved (Task 2)
│   ├── serve.py                 # moved (Task 2)
│   ├── shell.py                 # moved (Task 2)
│   ├── app/                     # moved (Task 2)
│   └── tests/                   # moved (Task 2)
└── frontend/
    ├── Dockerfile               # renamed (Task 4)
    ├── .dockerignore            # (Task 4)
    ├── next.config.ts           # proxy target env-driven (Task 4)
    └── …                        # unchanged
```

---

## Task 1: Remove cruft and the bare-metal/legacy path

**Files:**
- Delete: `.DS_Store`, `ltmain.sh`, `downloader-old.py`, `yify-downloader.service`
- Delete: `scripts/full-install.sh`, `scripts/install.sh`, `scripts/one-click-install.sh`, `scripts/start-services.sh`, `scripts/stop-services.sh`, `scripts/start-docker.sh`

- [ ] **Step 1: Delete the tracked junk and legacy files**

```bash
cd /Users/benjaminherro/github/freeflix
git rm -q .DS_Store ltmain.sh downloader-old.py yify-downloader.service
git rm -q scripts/full-install.sh scripts/install.sh scripts/one-click-install.sh \
          scripts/start-services.sh scripts/stop-services.sh scripts/start-docker.sh
```

- [ ] **Step 2: Verify `scripts/` is now empty and nothing important was removed**

Run: `git status --short && ls scripts 2>/dev/null || echo "scripts/ gone"`
Expected: only deletions (`D`) staged; `scripts/` is empty or gone (git does not track empty dirs).

- [ ] **Step 3: Confirm no remaining references to the deleted files**

Run: `git grep -nE "start-docker|start-services|stop-services|one-click-install|full-install|yify-downloader\.service|downloader-old" -- . ':!docs/superpowers' || echo "no references"`
Expected: `no references` (references inside `docs/superpowers/` specs/plans are fine and excluded).

- [ ] **Step 4: Commit**

```bash
git commit -q -m "chore: remove committed junk and bare-metal install path"
```

---

## Task 2: Move the Python backend into `backend/`

**Files:**
- Move: `app/` → `backend/app/`, `serve.py` → `backend/serve.py`, `shell.py` → `backend/shell.py`, `pyproject.toml` → `backend/pyproject.toml`, `poetry.lock` → `backend/poetry.lock`, `tests/` → `backend/tests/`
- Move: `Dockerfile.backend` → `backend/Dockerfile` (content rewritten in Task 3)

- [ ] **Step 1: Create `backend/` and move the backend files with history preserved**

```bash
cd /Users/benjaminherro/github/freeflix
mkdir -p backend
git mv app backend/app
git mv serve.py backend/serve.py
git mv shell.py backend/shell.py
git mv pyproject.toml backend/pyproject.toml
git mv poetry.lock backend/poetry.lock
git mv tests backend/tests
git mv Dockerfile.backend backend/Dockerfile
```

- [ ] **Step 2: Verify the move and that the Python package is intact**

Run: `ls backend && echo "---" && ls backend/app | head && echo "---" && git status --short | head -40`
Expected: `backend/` contains `app/ serve.py shell.py pyproject.toml poetry.lock tests/ Dockerfile`; `backend/app/` contains `main.py config.py api/ …`; git shows renames (`R`).

- [ ] **Step 3: Verify the backend imports still resolve from the new location**

Run: `cd backend && python -c "import ast,glob,sys; [ast.parse(open(f).read(), f) for f in glob.glob('app/**/*.py', recursive=True)]; print('all backend modules parse OK')" ; cd ..`
Expected: `all backend modules parse OK` (syntax/parse check; full import needs deps which live in Docker — that is verified in Task 9).

- [ ] **Step 4: Confirm no root-level references assume the old backend location**

Run: `git grep -nE "COPY app/|COPY serve\.py|context: \.$" -- docker-compose.yml backend/Dockerfile 2>/dev/null || echo "none yet (rewritten in Tasks 3 & 5)"`
Expected: matches only inside `backend/Dockerfile` (old content, rewritten next) and/or `docker-compose.yml` (rewritten in Task 5). This is informational.

- [ ] **Step 5: Commit**

```bash
git commit -q -m "refactor: move Python backend into backend/"
```

---

## Task 3: Rewrite the backend Dockerfile for Poetry + add `.dockerignore`

**Files:**
- Modify: `backend/Dockerfile` (replace entire contents)
- Create: `backend/.dockerignore`

- [ ] **Step 1: Replace `backend/Dockerfile` with the Poetry-based build**

Write `backend/Dockerfile`:

```dockerfile
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

# Runtime directories
RUN mkdir -p downloads resume_data logs

EXPOSE 8000

CMD ["python", "serve.py"]
```

- [ ] **Step 2: Create `backend/.dockerignore`**

Write `backend/.dockerignore`:

```gitignore
# VCS / caches
.git
__pycache__/
*.py[cod]
.pytest_cache/
.mypy_cache/
.ruff_cache/
.coverage
htmlcov/

# Local runtime data (provided via volumes at runtime)
downloads/
resume_data/
logs/
*.db
*.db-journal

# Env / editor
.env
.venv/
venv/
.DS_Store
```

- [ ] **Step 3: Verify the Dockerfile is syntactically parseable by Compose later (smoke check now)**

Run: `grep -E "^(FROM|RUN|COPY|CMD|WORKDIR|ENV|EXPOSE)" backend/Dockerfile | head`
Expected: shows the directives in order, ending with `CMD`. (The real build runs in Task 9.)

- [ ] **Step 4: Contingency note (read before Task 9 build)**

If `poetry install` fails on `libtorrent` (no PyPI wheel for the platform), the fallback is to rely on the apt-installed `python3-libtorrent` instead: remove the `libtorrent` line from `backend/pyproject.toml` + regenerate the lock (`cd backend && poetry lock --no-update`), keep the apt package, and re-build. Apply this ONLY if the build actually fails on libtorrent; do not pre-emptively change pyproject.

- [ ] **Step 5: Delete the now-redundant `requirements.txt` and commit**

Poetry is now the single source of truth, so the root `requirements.txt` (no longer
referenced by the Dockerfile) is removed here.

```bash
git rm -q requirements.txt
git add backend/Dockerfile backend/.dockerignore
git commit -q -m "build: Poetry-based backend Dockerfile + dockerignore; drop requirements.txt"
```

---

## Task 4: Frontend — rename Dockerfile, add `.dockerignore`, env-drive the API proxy, drop dead config

**Files:**
- Move: `frontend/Dockerfile.frontend` → `frontend/Dockerfile`
- Create: `frontend/.dockerignore`
- Modify: `frontend/next.config.ts` (env-driven rewrite destination)
- Delete: `frontend/tailwind-config.js`

- [ ] **Step 1: Rename the frontend Dockerfile and delete the dead Tailwind config**

```bash
cd /Users/benjaminherro/github/freeflix
git mv frontend/Dockerfile.frontend frontend/Dockerfile
git rm -q frontend/tailwind-config.js
```

- [ ] **Step 2: Create `frontend/.dockerignore`**

Write `frontend/.dockerignore`:

```gitignore
node_modules
.next
.git
npm-debug.log*
.env
.env.local
.DS_Store
Dockerfile
.dockerignore
```

- [ ] **Step 3: Make the API proxy destination env-driven in `next.config.ts`**

In `frontend/next.config.ts`, replace the `async rewrites()` block. Change FROM:

```ts
  async rewrites() {
    return [
      // Keep internal Next API routes (like /api/palette) on the frontend
      { source: '/api/palette', destination: '/api/palette' },
      { source: '/api/palette/:path*', destination: '/api/palette/:path*' },
      // Proxy other API routes to backend
      {
        source: '/api/:path*',
        destination: 'http://localhost:8000/api/:path*',
      },
    ];
  },
```

TO:

```ts
  async rewrites() {
    // In Docker the backend is reachable at http://backend:8000; locally it
    // defaults to http://localhost:8000. Set BACKEND_INTERNAL_URL to override.
    const backendUrl = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:8000';
    return [
      // Keep internal Next API routes (like /api/palette) on the frontend
      { source: '/api/palette', destination: '/api/palette' },
      { source: '/api/palette/:path*', destination: '/api/palette/:path*' },
      // Proxy other API routes to backend
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
```

- [ ] **Step 4: Verify the edit and that the hardcoded localhost is gone from the rewrite**

Run: `grep -n "BACKEND_INTERNAL_URL\|localhost:8000" frontend/next.config.ts`
Expected: shows the new `const backendUrl = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:8000'` line and the `${backendUrl}` usage; no remaining hardcoded `destination: 'http://localhost:8000/...'`.

- [ ] **Step 5: Commit**

```bash
git add frontend/Dockerfile frontend/.dockerignore frontend/next.config.ts
git commit -q -m "build: frontend Dockerfile rename, dockerignore, env-driven API proxy; drop dead tailwind config"
```

---

## Task 5: Write `docker-compose.yml` (base) and `docker-compose.override.yml` (dev)

**Files:**
- Modify: `docker-compose.yml` (replace entire contents)
- Create: `docker-compose.override.yml`

- [ ] **Step 1: Replace `docker-compose.yml` with the wired base stack**

Write `docker-compose.yml`:

```yaml
services:
  db:
    container_name: freeflix-db
    image: postgres:16-alpine
    restart: always
    env_file: .env
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
      POSTGRES_DB: ${POSTGRES_DB:-freeflix}
    ports:
      - "5434:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-freeflix}"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - freeflix-network

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    restart: unless-stopped
    env_file: .env
    environment:
      ENVIRONMENT: production
      POSTGRES_HOST: db
      POSTGRES_PORT: 5432
      DOWNLOAD_PATH: /opt/freeflix/downloads
    ports:
      - "8000:8000"
    volumes:
      - ./downloads:/opt/freeflix/downloads
      - resume-data:/opt/freeflix/resume_data
      - logs:/opt/freeflix/logs
    depends_on:
      db:
        condition: service_healthy
    networks:
      - freeflix-network

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    restart: unless-stopped
    environment:
      NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-http://localhost:8000/api/v1}
      BACKEND_INTERNAL_URL: http://backend:8000
    ports:
      - "3000:3000"
    depends_on:
      - backend
    networks:
      - freeflix-network

networks:
  freeflix-network:
    driver: bridge

volumes:
  postgres-data:
  resume-data:
  logs:
```

- [ ] **Step 2: Create `docker-compose.override.yml` (dev overlay, auto-loaded)**

Write `docker-compose.override.yml`:

```yaml
# Auto-loaded by `docker compose` in development.
# Adds source bind-mounts + hot reload on top of the base stack.
# `make prod` bypasses this file (docker compose -f docker-compose.yml ...).
services:
  backend:
    environment:
      ENVIRONMENT: development   # serve.py runs uvicorn with reload=True
    volumes:
      - ./backend/app:/opt/freeflix/app
      - ./backend/serve.py:/opt/freeflix/serve.py

  frontend:
    command: npm run dev
    environment:
      NODE_ENV: development
    volumes:
      - ./frontend:/app
      - /app/node_modules
      - /app/.next
```

- [ ] **Step 3: Validate the merged Compose config (base + override)**

Run: `docker compose config >/dev/null && echo "compose (dev) OK"`
Expected: `compose (dev) OK` (no YAML/schema errors). If `.env` does not yet exist, create it first: `cp .env.example .env` — note Task 7 finalizes `.env.example`; if this runs before Task 7, a temporary `.env` is fine.

- [ ] **Step 4: Validate the production-only config (base file alone)**

Run: `docker compose -f docker-compose.yml config >/dev/null && echo "compose (prod) OK"`
Expected: `compose (prod) OK`, and the `frontend` service has NO `command: npm run dev` and NO source bind-mounts (those live only in the override).

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml docker-compose.override.yml
git commit -q -m "build: wire docker-compose base stack + dev override (frontend enabled)"
```

---

## Task 6: Write the `Makefile`

**Files:**
- Create: `Makefile`

- [ ] **Step 1: Write `Makefile`**

Write `Makefile` (note: recipe lines MUST be tab-indented, not spaces):

```makefile
# Freeflix — Makefile
# Docker Compose is the core entry point; these targets wrap common tasks.

COMPOSE      := docker compose
PROD_COMPOSE := docker compose -f docker-compose.yml
s ?=
d ?=

.DEFAULT_GOAL := help
.PHONY: help up prod down build logs ps restart sh db test lint clean install

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

up: ## Start the full stack in dev mode, hot reload (d=1 for detached)
	$(COMPOSE) up $(if $(d),-d,)

prod: ## Build + start the production stack (no dev override)
	$(PROD_COMPOSE) up --build -d

down: ## Stop and remove containers
	$(COMPOSE) down

build: ## Rebuild all images
	$(COMPOSE) build

logs: ## Tail logs (s=backend for one service)
	$(COMPOSE) logs -f $(s)

ps: ## Show service status
	$(COMPOSE) ps

restart: ## Restart services (s=backend for one service)
	$(COMPOSE) restart $(s)

sh: ## Shell into a service (default backend; s=frontend)
	$(COMPOSE) exec $(or $(s),backend) sh

db: ## Open psql in the database
	$(COMPOSE) exec db psql -U $${POSTGRES_USER:-postgres} -d $${POSTGRES_DB:-freeflix}

test: ## Run backend tests in-container
	$(COMPOSE) run --rm backend python -m pytest

lint: ## Lint the frontend
	$(COMPOSE) run --rm frontend npm run lint

clean: ## Stop, remove volumes/orphans, prune images, delete stray .DS_Store
	$(COMPOSE) down -v --remove-orphans
	-find . -name '.DS_Store' -delete
	-docker image prune -f

install: ## Local (non-docker) dependency install
	cd backend && poetry install
	cd frontend && npm install
```

- [ ] **Step 2: Verify recipe lines are tab-indented (Make requires tabs)**

Run: `grep -nP '^\t' Makefile | head` and `grep -nP '^    [a-z]' Makefile || echo "no space-indented recipes"`
Expected: the first command lists tab-indented recipe lines; the second prints `no space-indented recipes`.

- [ ] **Step 3: Verify `make help` renders the target list**

Run: `make help`
Expected: a formatted list of targets (`up`, `prod`, `down`, `build`, `logs`, `ps`, `restart`, `sh`, `db`, `test`, `lint`, `clean`, `install`) with their descriptions.

- [ ] **Step 4: Dry-run the core targets to confirm the commands expand correctly**

Run: `make -n up && echo "---" && make -n prod && echo "---" && make -n logs s=backend`
Expected: `up` → `docker compose up`; `prod` → `docker compose -f docker-compose.yml up --build -d`; `logs s=backend` → `docker compose logs -f backend`.

- [ ] **Step 5: Commit**

```bash
git add Makefile
git commit -q -m "build: add Makefile wrapping docker compose tasks"
```

---

## Task 7: Update `.gitignore`, rewrite `.env.example`

**Files:**
- Modify: `.gitignore` (add `.DS_Store`; ensure runtime dirs ignored)
- Modify: `.env.example` (single compose-oriented template)

- [ ] **Step 1: Add `.DS_Store` and runtime dirs to `.gitignore`**

Append to the end of `.gitignore`:

```gitignore
# macOS
.DS_Store

# Freeflix runtime data (provided via Docker volumes / created at runtime)
/downloads/
/resume_data/
/logs/
docker-compose.override.local.yml
```

(Existing entries already cover `.env`, `node_modules`, `.next`, `*.db`, `logs`; the explicit lines above are the additive, self-documenting set. Duplicates are harmless.)

- [ ] **Step 2: Replace `.env.example` with the consolidated template**

Write `.env.example`:

```dotenv
# ─── API ──────────────────────────────────────────────────────
API_V1_STR=/api/v1
PROJECT_NAME=Freeflix API
ENVIRONMENT=development

# ─── Scraping ─────────────────────────────────────────────────
YIFY_URL=https://en.yts-official.mx
YIFY_URL_BROWSE_URL=https://en.yts-official.mx/browse-movies
RARBG_URL=https://en.rarbg-official.com/{path}
REQUEST_RATE_LIMIT=3

# ─── External API keys ────────────────────────────────────────
OMDB_API_KEY=your_omdb_api_key_here
TMDB_API_KEY=your_tmdb_api_key_here

# ─── Torrent ──────────────────────────────────────────────────
DEFAULT_DOWNLOAD_PATH=./downloads
LISTEN_INTERFACES=0.0.0.0:6881
PORT_RANGE_START=6881
PORT_RANGE_END=6891
MAX_ACTIVE_DOWNLOADS=3

# ─── Logging ──────────────────────────────────────────────────
LOG_LEVEL=INFO

# ─── Database ─────────────────────────────────────────────────
# Used by docker compose for both the `db` container and the backend.
# POSTGRES_HOST / POSTGRES_PORT are injected by compose (host=db, port=5432).
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=freeflix
# For a local (non-docker) run the backend falls back to SQLite at:
DB_PATH=./freeflix.db

# ─── Monitoring (optional) ────────────────────────────────────
#SENTRY_DSN=https://your_sentry_dsn

# ─── Cron ─────────────────────────────────────────────────────
CRON_ENABLED=true
CACHE_MOVIES_FOR=365

# ─── Frontend ─────────────────────────────────────────────────
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
```

- [ ] **Step 3: Verify `.env.example` covers every var the compose files reference**

Run: `for v in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB NEXT_PUBLIC_API_URL; do grep -q "^$v=" .env.example && echo "$v ok" || echo "$v MISSING"; done`
Expected: all four print `ok`.

- [ ] **Step 4: Confirm a working `.env` exists for compose (create from example if missing)**

Run: `[ -f .env ] || cp .env.example .env; docker compose config >/dev/null && echo "compose resolves with .env"`
Expected: `compose resolves with .env`. (`.env` is gitignored and not committed.)

- [ ] **Step 5: Commit**

```bash
git add .gitignore .env.example
git commit -q -m "chore: ignore .DS_Store/runtime dirs; consolidate .env.example for compose"
```

---

## Task 8: Rewrite `README.md` and add `docs/ARCHITECTURE.md`

**Files:**
- Modify: `README.md` (full rewrite)
- Create: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Replace `README.md`**

Write `README.md`:

```markdown
# Freeflix

Freeflix is a self-hosted streaming service that scrapes, downloads, and streams
movie torrents, with scheduled/automatic downloads. It is a monorepo:

- **`backend/`** — FastAPI + libtorrent service (Python 3.10, Poetry).
- **`frontend/`** — Next.js 15 web app.
- **PostgreSQL** — metadata and state.

Docker Compose is the single entry point; the `Makefile` wraps the common tasks.

## Prerequisites

- Docker + Docker Compose v2
- `make`

## Quickstart

```bash
cp .env.example .env     # then edit keys (OMDB/TMDB) as needed
make up                  # build + run the full stack with hot reload
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000 (docs at `/docs`)
- Postgres: localhost:5434

Stop with `make down`.

## Common tasks

| Command       | What it does                                         |
| ------------- | ---------------------------------------------------- |
| `make up`     | Build + start the full stack in dev (hot reload)     |
| `make prod`   | Build + start the production stack (no dev override) |
| `make down`   | Stop and remove containers                           |
| `make logs`   | Tail logs (`make logs s=backend` for one service)    |
| `make sh`     | Shell into backend (`make sh s=frontend`)            |
| `make db`     | Open `psql` in the database                          |
| `make test`   | Run backend tests in-container                       |
| `make clean`  | Stop, remove volumes, prune images                   |
| `make install`| Local (non-docker) Poetry + npm install              |

Run `make` with no target for the full list.

## Development

`make up` loads `docker-compose.override.yml`, which bind-mounts `backend/app`
and `frontend/` into the containers for hot reload. `make prod` runs only
`docker-compose.yml` (the production-shaped stack).

## Project layout

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## License

MIT
```

- [ ] **Step 2: Create `docs/ARCHITECTURE.md`**

Write `docs/ARCHITECTURE.md`:

```markdown
# Architecture

## Overview

Freeflix is a Docker Compose monorepo with three services on one bridge network
(`freeflix-network`):

```
┌────────────┐      /api/* proxy      ┌────────────┐      SQL      ┌──────────┐
│  frontend  │ ─────────────────────▶ │  backend   │ ───────────▶ │   db     │
│ Next.js 15 │   (BACKEND_INTERNAL_   │  FastAPI   │   asyncpg /   │ Postgres │
│  :3000     │    URL=backend:8000)   │  :8000     │   psycopg2    │  16 :5432│
└────────────┘                        └────────────┘              └──────────┘
                                       libtorrent + APScheduler
```

## Services

- **frontend** (`frontend/`) — Next.js app. Server-side rewrites proxy `/api/*`
  to the backend; the target is `BACKEND_INTERNAL_URL` (defaults to
  `http://localhost:8000` for local runs, `http://backend:8000` in compose).
- **backend** (`backend/`) — FastAPI app (`app.main:app`, launched by
  `serve.py`). Owns torrent download/streaming via libtorrent, scraping (YTS),
  and scheduled jobs (APScheduler). Persists state to Postgres; falls back to
  SQLite when no Postgres host is configured.
- **db** — PostgreSQL 16. Host port `5434` → container `5432`.

## Build & run

- `docker-compose.yml` — base, production-shaped stack.
- `docker-compose.override.yml` — auto-loaded dev overlay (source bind-mounts +
  hot reload).
- `Makefile` — task wrapper over Compose. `make up` = dev, `make prod` = prod.

## Backend internals (`backend/app/`)

| Path           | Responsibility                              |
| -------------- | ------------------------------------------- |
| `api/`         | FastAPI routers (movies, torrents, …)       |
| `services/`    | Business logic                              |
| `scrapers/`    | YTS / RARBG scraping                        |
| `torrent/`     | libtorrent session + download manager       |
| `database/`    | SQLAlchemy models, session, migrations glue |
| `cron/`        | APScheduler jobs                            |
| `config.py`    | Pydantic settings (env-driven)              |

## Volumes

- `postgres-data` — database storage.
- `resume-data`, `logs` — backend torrent resume data and logs.
- `./downloads` (bind mount) — downloaded media on the host.

## Known follow-ups

- `DOWNLOAD_PATH` (compose/`serve.py`) vs `DEFAULT_DOWNLOAD_PATH` (`config.py`)
  are different env names; reconcile so the configured download path is honored.
- No DB migration tool (e.g. Alembic) yet; schema is created on startup.
```

- [ ] **Step 3: Verify the docs render and link correctly**

Run: `grep -n "make up" README.md && test -f docs/ARCHITECTURE.md && echo "ARCHITECTURE.md present"`
Expected: shows the `make up` quickstart line and `ARCHITECTURE.md present`.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/ARCHITECTURE.md
git commit -q -m "docs: rewrite README around compose/make; add ARCHITECTURE.md"
```

---

## Task 9: End-to-end verification

**Files:** none (verification only; commit only if a fix is needed).

- [ ] **Step 1: Final tree sanity check**

Run: `ls -1 && echo "--- backend ---" && ls -1 backend && echo "--- frontend ---" && ls -1 frontend | head`
Expected: root shows `docker-compose.yml docker-compose.override.yml Makefile README.md .env.example backend frontend docs downloads` (plus dotfiles); root has NO `app/`, `serve.py`, `pyproject.toml`, `Dockerfile.backend`, `scripts/`, `ltmain.sh`, `downloader-old.py`, `yify-downloader.service`.

- [ ] **Step 2: Validate both Compose configurations resolve**

Run: `docker compose config >/dev/null && docker compose -f docker-compose.yml config >/dev/null && echo "both compose configs OK"`
Expected: `both compose configs OK`.

- [ ] **Step 3: Attempt to build the images (environment-dependent)**

Run: `docker compose build 2>&1 | tail -30`
Expected: ideally both images build. The backend build needs network + apt + native libtorrent and may take several minutes or be unavailable in a sandbox. If it fails ONLY on `libtorrent`, apply the Task 3 Step 4 contingency. Record the exact outcome (built / failed-where) — do not claim success without seeing it.

- [ ] **Step 4: If build succeeded, smoke-test the stack**

Run: `docker compose up -d && sleep 20 && curl -sf http://localhost:8000/health && echo && docker compose ps && docker compose down`
Expected: `/health` returns JSON with `"status": "healthy"`; `db`, `backend`, `frontend` all show as running/healthy. If the build in Step 3 could not run here, explicitly state that this step was skipped and why.

- [ ] **Step 5: Confirm the working tree is clean and review the branch**

Run: `git status --short && echo "---" && git log --oneline master..HEAD`
Expected: clean tree (no uncommitted changes); the log shows the Task 1–8 commits on `chore/restructure`.

---

## Self-review notes (author)

- **Spec coverage:** backend→`backend/` (T2), remove bare-metal + junk (T1), Poetry as source of truth incl. dropping `requirements.txt` (T3), two-file compose with `up`/`prod` (T5), Makefile (T6), `.dockerignore`/`.gitignore`/`.env.example` (T3/T4/T7), README + ARCHITECTURE (T8), verification incl. libtorrent risk (T9). All spec sections map to a task.
- **`requirements.txt`:** Lives at the repo root and is intentionally NOT moved in Task 2; it is deleted in Task 3 Step 5 as part of the Poetry switch.
- **Type/name consistency:** `BACKEND_INTERNAL_URL` used identically in `next.config.ts` (T4), `docker-compose.yml` (T5), and `ARCHITECTURE.md` (T8). Service names `backend`/`frontend`/`db` consistent across compose, Makefile, README. `DOWNLOAD_PATH` left as-is (recorded as a follow-up, per spec non-goals).
