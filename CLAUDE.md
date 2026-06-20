# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Freeflix is a self-hosted movie/TV streaming service: it picks torrents for a title, downloads them with libtorrent, and streams the files (even while still downloading). Monorepo, run entirely through Docker Compose:

- **`backend/`** — FastAPI + libtorrent (Python 3.10, Poetry, SQLAlchemy **1.4**).
- **`frontend/`** — Next.js 15 (App Router, React 19, Tailwind v4, TypeScript).
- **db** — PostgreSQL 16.

`docs/ARCHITECTURE.md` has the service diagram and directory responsibility table — read it before large changes. This file covers commands and the patterns that aren't obvious from any single file.

## Commands

Docker Compose is the entry point; the `Makefile` wraps it. `make up` auto-loads `docker-compose.override.yml` (dev: source bind-mounts + hot reload); `make prod` uses only `docker-compose.yml`.

| Command | Purpose |
| --- | --- |
| `make up` | Build + run full stack, hot reload (`d=1` to detach) |
| `make down` | Stop and remove containers |
| `make logs s=backend` | Tail logs for one service |
| `make sh` / `make sh s=frontend` | Shell into a container |
| `make db` | `psql` into Postgres |
| `make test` | Backend test suite in a one-off container |
| `make build` | Rebuild images |
| `make install` | Local (non-docker) `poetry install` + `npm install` |

**Service URLs (compose):** backend `http://localhost:8000` (Swagger at `/docs`), Postgres `localhost:5434`, frontend **`http://localhost:3001`** (compose maps host `3001`→container `3000`; the README's "3000" is stale).

**Backend tests** run via `docker compose run --rm backend python -m pytest` (`make test`). Run a single test:
```bash
docker compose run --rm backend python -m pytest tests/test_content_id.py::test_name -v
```
⚠️ **Tests are baked into the image, not bind-mounted.** The dev override only mounts `backend/app` and `serve.py` — *not* `backend/tests`. A new or edited test file won't appear in the container until you `make build`, or mount it explicitly: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_x.py`. (Container workdir is `/opt/freeflix`; app lives at `/opt/freeflix/app`, tests at `/opt/freeflix/tests`.)

**Frontend** (from `frontend/`, or `make sh s=frontend`): `npm run dev` (turbopack), `npm run build`, `npx tsc --noEmit` to typecheck. There is no working lint setup yet (`next lint` exists but no ESLint config).

## Architecture notes (the non-obvious parts)

**Two separate "models" layers — don't conflate them.**
- `backend/app/models.py` — **Pydantic** API request/response schemas (`CatalogItem`, `ShowDetail`, `StreamingProgress*`, etc.).
- `backend/app/database/models/` — **SQLAlchemy ORM** tables (`catalog`, `streaming`, `torrents`, `users`).

**Catalog data comes from a TMDB-shaped JSON API, not scraping.** The live data path is `providers/` (`catalog.py`, `tmdb.py`, `episodes.py`, `quality.py`) — an HTTP client plus normalizers that turn raw TMDB-shaped JSON into the Pydantic models. `services/` holds business logic on top (`movies.py`, `tv.py`, `torrents_select.py`, `content_id.py`). The old `scrapers/` and the `yify_url`/`rarbg_url` settings are legacy; prefer `providers`/`services`.

**`content_id` is the watch-identity join key.** `services/content_id.py` builds `movie:{tmdb_id}` or `tv:{tmdb_id}:s{season}:e{episode}`. This string is stored in `UserStreamingProgress.movie_id` and is how progress + continue-watching are keyed (one row per movie, one per episode). The frontend mirrors this: `PatchedVideoPlayer.tsx` uses `effectiveMovieId = contentId ?? movieId`, and `ContinueWatchingSection.tsx` re-parses the string to group episodes under one show card. Change the format in one place → update all three.

**Streaming + season packs.** `torrent/manager.py` owns a singleton libtorrent session (`torrent_manager`), started in the FastAPI `startup` event. Files stream directly from in-progress torrents. A TV season pack is one torrent with many video files; the episode is selected by **`file_index`**, which is carried through the streaming URL (`?file=N`), the progress record, and the resume links.

**DB session dependency is intentionally unusual.** `get_db()` in `database/session.py` is decorated `@contextmanager`, so FastAPI does **not** treat it as a yield-dependency — it injects the context-manager *object*. Endpoints therefore correctly do `with db as session:` (same pattern as the CRUD mixins). Do **not** "fix" this into a plain `yield` dependency; it would double-manage the session.

**No migration framework (no Alembic) — by design.** `init_db()` runs `create_all()` (new tables only) then `sync_columns()`, an idempotent additive pass that `ALTER TABLE ... ADD COLUMN`s any model column missing from an existing table. The Postgres volume persists across rebuilds, so `create_all` alone would silently skip new columns → 500s. **To add a column, just add it to the ORM model (nullable);** it's auto-added on next startup. `sync_columns` only *adds* — it never drops, renames, retypes, or backfills.

**Frontend ↔ backend wiring.** The browser never calls the backend directly. `next.config.ts` `rewrites()` proxy `/api/*` to `BACKEND_INTERNAL_URL` (`http://backend:8000` in compose) so requests are same-origin; `/api/palette*` stays on the Next.js side. Client code goes through `services/api-client.ts` (axios) + per-domain service modules (`movies.ts`, `tv.ts`, `streaming.ts`, …). Cross-cutting state lives in React contexts: `UserContext` (active profile — the app is multi-profile, no real auth), `ProgressContext`, `ThemeContext`.

## Conventions

- **Commits:** Conventional Commits (`feat:`, `refactor:`, `fix:`).
- **SQLAlchemy 1.4** style (not 2.0) — query/session API differs from 2.0 docs.
- The backend caps active downloads to 2 on ARM (Raspberry Pi) via a check in `main.py`.
