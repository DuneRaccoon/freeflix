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

## On the television

The TV surface is the `/bigscreen` route group, served by the same Next app as
everything else. The "app" on the set is a five-file webOS shell in
[`webos/`](webos/) that reads the box's address once, checks it answers, and
hands off — after which the set is on a normal http origin, so cookies, the
`/api/*` proxy and fullscreen video all behave.

**You do not need the app.** Open `http://<box-ip>:3001/bigscreen` in the TV's
own browser and everything works, including the D-pad. The app exists so the set
has a launcher tile and a Back key that closes it. That fallback is the answer
whenever the app is gone — and it will be gone periodically; see below.

### Installing it

```bash
npm install -g @webos-tools/cli     # NOT @webosose/ares-cli, which is deprecated
ares-setup-device --add myTV -i "host=<tv-ip>" -i "port=9922" -i "username=prisoner"
```

| Command           | What it does                                                   |
| ----------------- | -------------------------------------------------------------- |
| `make tv-serve`   | Host the shell from this machine and launch it (no packaging)  |
| `make tv-package` | Build the IPK — only to pin a build                            |
| `make tv-install` | Install the built IPK on the set                               |
| `make tv-launch`  | Launch the installed app                                       |
| `make tv-inspect` | Open remote devtools against the running app                   |

`make tv-serve` is the inner loop: it serves `webos/` from here, so a change
needs no repackaging and no reinstall. Override the device alias with
`make tv-install TV=livingroom`.

**Give the box a DHCP reservation.** The address is entered once on the set with
the remote and kept in the app's `localStorage`; it is never baked into the IPK,
so a changed address costs five D-pad presses rather than a repackage. But a box
whose address moves on its own is a box the television loses while you are out.

### The app will disappear, and that is LG's design

Developer Mode is a session, not a setting. When it lapses, **every app
installed under it is uninstalled** — this is documented LG behaviour, not a
bug, and nothing in this repository can prevent it.

- The session runs about **1000 hours** (~41 days); the Dev Mode app on the set
  shows the remaining time as "999h" when fresh. The widely-quoted "50 hours" is
  a 2022 figure and is stale.
- It also ends after the set **reboots ten times while off the network**.
- Signing the same LG developer account into **another TV revokes the first**.

To renew: open the Developer Mode app on the set and extend the session before
it lapses, then `make tv-install` again if the app has already gone. Rooting is
not a realistic alternative on this hardware — RootMyTV never worked on sets
that shipped with webOS 22, and webOS 5+ firmware is described by the
faultmanager-autoroot authors as "almost all patched".

While the app is gone, the browser URL above is the whole fallback.

## Project layout

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## License

MIT
