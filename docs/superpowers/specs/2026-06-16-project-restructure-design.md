# Freeflix Project Restructure — Design

**Date:** 2026-06-16
**Status:** Approved (design), pending spec review
**Type:** Behavior-preserving restructure (no application-logic changes)

## Problem

The repository is disorganized and lacks a clear build/dev flow:

- **Root is a dumping ground.** The Python backend (`app/`, `serve.py`, `shell.py`)
  lives at the repo root, intermixed with `frontend/`, orchestration files, install
  scripts, and junk.
- **Committed junk:** `.DS_Store`, `ltmain.sh` (a stray symlink to libtool's
  `build-aux`), `downloader-old.py` (legacy, superseded).
- **Two dependency systems:** `pyproject.toml` + `poetry.lock` *and* a
  hand-maintained `requirements.txt`; they can drift, and the Dockerfile only uses
  `requirements.txt`.
- **Two competing deployment paradigms:** Docker (compose + two Dockerfiles) *and* a
  bare-metal Raspberry Pi / systemd path (`yify-downloader.service`, `scripts/*.sh`).
- **`docker-compose.yml` is half-wired:** the frontend service is commented out,
  there is an unused `download-data` volume, and env vars are duplicated between
  services.
- **No Makefile**, no documented dev flow. README has copy-paste artifacts
  ("CopyEdit") and points at scripts that have moved.

The frontend (`frontend/src/...`) is already reasonably organized; the chaos is
concentrated at the root and in the build/deploy layer.

## Goals

1. Make **`docker-compose.yml` the single core build/run entry point**.
2. Add a **Makefile** as a friendly wrapper to make common tasks easy.
3. Restructure the repo head-to-toe into a clean monorepo: `backend/` + `frontend/`
   with the root holding only orchestration.
4. Remove the bare-metal/legacy deployment path and committed junk.
5. Standardize Python dependencies on **Poetry** as the single source of truth.

**Non-goals:** No application-logic changes. Pre-existing quirks (e.g. the
`DOWNLOAD_PATH` vs `DEFAULT_DOWNLOAD_PATH` env-name mismatch) are preserved and
recorded as follow-ups, not fixed here.

## Decisions (confirmed with user)

| Decision | Choice |
| --- | --- |
| Backend layout | **Move the Python backend into `backend/`**; root holds only orchestration. |
| Bare-metal / systemd path | **Remove it** (delete Pi install scripts, `.service`, `downloader-old.py`, `ltmain.sh`, `.DS_Store`). Docker is the single supported path. |
| Python dependency tooling | **Poetry as single source of truth.** Docker installs via Poetry; drop `requirements.txt`. |
| Dev flow | **Two-file Compose pattern**: base `docker-compose.yml` (production-shaped) + auto-loaded `docker-compose.override.yml` (dev: bind mounts + hot reload). |

## Target structure

```
freeflix/
├── docker-compose.yml           # THE entry point: db + backend + frontend
├── docker-compose.override.yml  # dev overlay (auto-loaded): bind mounts + hot reload
├── Makefile                     # friendly wrapper over compose + common tasks
├── .env.example                 # single env template at root
├── .gitignore                   # + .DS_Store, .env, downloads/, etc.
├── .dockerignore
├── README.md                    # rewritten: quickstart is `make up`
├── docs/
│   ├── ARCHITECTURE.md          # short map of how it all fits together
│   └── superpowers/specs/…      # this design doc
├── backend/
│   ├── Dockerfile               # was Dockerfile.backend (Poetry-based)
│   ├── .dockerignore
│   ├── pyproject.toml           # source of truth (poetry.lock beside it)
│   ├── poetry.lock
│   ├── serve.py                 # entry point
│   ├── shell.py                 # dev IPython shell
│   ├── app/                     # unchanged internals (api/, services/, …)
│   └── tests/                   # moved from root tests/
└── frontend/
    ├── Dockerfile               # was Dockerfile.frontend
    ├── .dockerignore
    ├── package.json / src/ …    # mostly unchanged (light config tidy)
    └── …
```

### Files deleted

- `.DS_Store`
- `ltmain.sh`
- `downloader-old.py`
- `requirements.txt`
- `yify-downloader.service`
- `scripts/full-install.sh`, `scripts/install.sh`, `scripts/one-click-install.sh`,
  `scripts/start-services.sh`, `scripts/stop-services.sh`
- `scripts/start-docker.sh` (superseded by the Makefile; `scripts/` removed if empty)

### Files moved

- `app/` → `backend/app/`
- `serve.py` → `backend/serve.py`
- `shell.py` → `backend/shell.py`
- `pyproject.toml`, `poetry.lock` → `backend/`
- `tests/` → `backend/tests/`
- `Dockerfile.backend` → `backend/Dockerfile`
- `frontend/Dockerfile.frontend` → `frontend/Dockerfile`

## Component design

### 1. `docker-compose.yml` (base — production-shaped)

- **`db`** — `postgres:16-alpine`, named volume `postgres-data`, healthcheck via
  `pg_isready`, on `freeflix-network`.
- **`backend`** — builds from `./backend`, exposes `8000`, `depends_on` db
  (`condition: service_healthy`), volumes for `downloads`, `resume_data`, `logs`,
  config via `env_file: .env` (no duplicated inline env blocks). Frontend-facing API.
- **`frontend`** — **uncommented and wired**, builds from `./frontend`, exposes
  `3000`, `depends_on` backend, `NEXT_PUBLIC_API_URL` from env.
- Single `freeflix-network` (bridge). Remove the unused `download-data` volume.

### 2. `docker-compose.override.yml` (dev overlay, auto-loaded)

- **`backend`** — bind-mount `./backend` into the container, command override to run
  `uvicorn app.main:app --reload`, so code edits hot-reload.
- **`frontend`** — bind-mount `./frontend`, run `npm run dev`, with a named volume for
  `node_modules` so the host dir doesn't clobber the container's installed modules.
- `make up` therefore = live-reload dev; `make prod` = base file only (production stack).

### 3. `Makefile`

Default target is `help`. Planned targets:

```
make            # help (default)
make up         # build + start full stack in dev (hot reload)
make prod       # start production stack (base compose only, no override)
make down       # stop & remove containers
make logs       # tail all logs   (make logs s=backend for one service)
make ps         # status
make build      # rebuild images
make sh         # shell into backend   (make sh s=frontend)
make db         # psql into the database
make test       # run backend tests in-container
make lint       # frontend lint
make clean      # down -v + prune dangling + remove stray .DS_Store
make install    # local (non-docker) poetry + npm install
```

Implementation notes: use `docker compose` (v2). `prod` runs
`docker compose -f docker-compose.yml ...` to bypass the override. `s=` is an optional
service selector variable. Targets are `.PHONY`.

### 4. `backend/Dockerfile` (Poetry-based)

- Keep system deps via apt (build tools, boost, ssl, libtorrent, git).
- Install Poetry, `poetry config virtualenvs.create false`, then
  `poetry install --no-root --only main` from `pyproject.toml` + `poetry.lock`.
- Copy `app/` + `serve.py`; create runtime dirs; `CMD ["python", "serve.py"]`.
- Build context becomes `./backend`, so copy paths are repo-relative to `backend/`.

### 5. `.dockerignore`, `.gitignore`, `.env.example`

- Add `.dockerignore` in `backend/` and `frontend/` to keep build contexts lean
  (ignore `node_modules`, `.next`, `__pycache__`, `downloads`, `logs`, `.env`, etc.).
- Update `.gitignore` so `.DS_Store`, `.env`, `downloads/`, `logs/`, `resume_data/`
  are ignored.
- Keep one root `.env.example` as the env template.

### 6. Docs

- Rewrite `README.md`: project intro + **`make up` quickstart**, prerequisites
  (Docker), and a pointer to the Makefile targets.
- Add `docs/ARCHITECTURE.md`: one-page map (backend FastAPI + libtorrent, frontend
  Next.js, Postgres; how compose wires them; ports).

## Path / behavior risks (to verify, not redesign)

- **`base_app_path = Path(__file__).parent.parent`** in `app/config.py`: after the
  move, this resolves to `backend/` locally (more correct) and stays `/opt/freeflix`
  in the container (WORKDIR unchanged). No code change needed; verify dirs still
  resolve.
- **`libtorrent`** appears as both an apt package (`python3-libtorrent`) and a Poetry
  dependency. Verify the image builds; reconcile (prefer the working source) if they
  conflict. This is the single highest-risk step.
- **`DOWNLOAD_PATH` vs `DEFAULT_DOWNLOAD_PATH`**: pre-existing env-name mismatch
  between compose and `config.py`. Preserve as-is; record as a follow-up.

## Verification plan

- `docker compose config` validates and resolves (base + override).
- `make` / `make help` prints targets; dry-run key targets (`make -n ...`).
- Confirm moved Python imports still resolve (`app.*` package intact under `backend/`).
- Attempt `docker compose build`. The backend image needs network + apt + native
  builds, so this step is environment-dependent; report exactly what passes vs. what
  could not be verified here.
- `git status` review: ensure deletions/moves are clean and nothing important is lost.

## Follow-ups (out of scope here)

- Fix the `DOWNLOAD_PATH` / `DEFAULT_DOWNLOAD_PATH` env-name mismatch.
- Consider Alembic migrations (none today).
- Consider a multi-stage backend build to shrink the image.
