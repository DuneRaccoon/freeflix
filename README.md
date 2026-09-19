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

- Frontend: http://localhost:3001
- Backend API: http://localhost:8000 (docs at `/docs`)
- Postgres: localhost:5434

Stop with `make down`.

## First run

A fresh instance is **unclaimed** — nobody can sign in until someone claims it,
and after that it is invite-only. Sign-in is passwordless (emailed magic link).

```bash
make up
make logs s=backend      # look for the boxed CLAIM CODE banner
```

The same code is written to `claim_code.txt` in the backend's `logs` volume. It
is regenerated on every boot while the instance is unclaimed, so a lost code just
means restarting the container.

1. Open http://localhost:3001/claim and enter the claim code plus your email.
2. Follow the verification link you are sent. You are now the owner, signed in.
3. Invite everyone else from http://localhost:3001/members. Each invitee sets up
   their own profiles; existing profiles are preserved and mapped to accounts.

**No email provider?** Leave `INTERNAL_MAIL_SECRET` and `RESEND_API_KEY` unset in
`.env`. Nothing is delivered; the backend logs every verification and invite URL
at `WARNING` level instead, so `make logs s=backend` is all you need. To send real
mail, set both (see the "Instance claim / auth" and "Mail (Resend)" sections of
`.env.example`) — and set `COOKIE_SECURE=true` only once you are behind HTTPS.

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
