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

| Command        | What it does                                         |
| -------------- | ---------------------------------------------------- |
| `make up`      | Build + start the full stack in dev (hot reload)     |
| `make prod`    | Build + start the production stack (no dev override) |
| `make down`    | Stop and remove containers                           |
| `make logs`    | Tail logs (`make logs s=backend` for one service)    |
| `make sh`      | Shell into backend (`make sh s=frontend`)            |
| `make db`      | Open `psql` in the database                          |
| `make test`    | Run backend tests in-container                       |
| `make clean`   | Stop, remove volumes, prune images                   |
| `make install` | Local (non-docker) Poetry + npm install              |

Run `make` with no target for the full list.

## Development

`make up` loads `docker-compose.override.yml`, which bind-mounts `backend/app`
and `frontend/` into the containers for hot reload. `make prod` runs only
`docker-compose.yml` (the production-shaped stack).

## Project layout

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## License

MIT
