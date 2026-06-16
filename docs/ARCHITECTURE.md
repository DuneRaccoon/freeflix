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
  SQLite when no Postgres host/user is configured.
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
| `database/`    | SQLAlchemy models, session, helpers         |
| `cron/`        | APScheduler jobs                            |
| `config.py`    | Pydantic settings (env-driven)              |

## Volumes

- `postgres-data` — database storage.
- `resume-data`, `logs` — backend torrent resume data and logs.
- `./downloads` (bind mount) — downloaded media on the host.

## Known follow-ups

- `DOWNLOAD_PATH` (compose/`serve.py`) vs `DEFAULT_DOWNLOAD_PATH` (`config.py`)
  are different env names; the configured path currently works only by
  coincidence (both resolve to `/opt/freeflix/downloads`). Reconcile the names.
- Backend `Dockerfile` apt-installs `python3-libtorrent` while Poetry also
  installs the `libtorrent` wheel — the apt package is now redundant and could
  be dropped once the wheel install is confirmed on all target architectures.
- `frontend/Dockerfile` pins `node:19-alpine` (EOL, odd release); move to an
  LTS (`node:20`/`node:22`).
- Frontend has no ESLint configured, so there is no `make lint` target yet.
- No DB migration tool (e.g. Alembic) yet; schema is created on startup.
