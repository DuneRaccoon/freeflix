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

| Path            | Responsibility                                        |
| --------------- | ----------------------------------------------------- |
| `api/`          | FastAPI routers (movies, torrents, auth, instance, …)  |
| `services/`     | Business logic (incl. `auth`, `accounts`, `mailer`)   |
| `dependencies/` | Reusable `Depends` — the session / owner / profile gate |
| `scrapers/`     | YTS / RARBG scraping                                  |
| `torrent/`      | libtorrent session + download manager                 |
| `database/`     | SQLAlchemy models, session, helpers                   |
| `cron/`         | APScheduler jobs                                      |
| `config.py`     | Pydantic settings (env-driven)                        |

## Identity & access

The instance is **claimed** by one owner and is **invite-only** after that. There are
two entrances and they are disjoint: the **owner signs in with a password**, **members
sign in with an emailed magic link**. Neither role can use the other's. A link would make
mailbox access alone enough to hold the account that can invite, revoke, remove and
transfer — so the owner never gets one.

### Two levels: account and profile

| Level | Table | Holds |
| --- | --- | --- |
| **Account** | `accounts` | email, `role` (`owner`/`member`), `status`, `password_hash` (owners only), login history |
| **Profile** | `users` | a "Who's watching?" identity: display name, avatar, passcode, maturity restriction |

One account owns one or more profiles (`users.account_id`). The split matters
because watch progress, watchlist and per-profile locking hang off the *profile*
(`user_settings`, `user_streaming_progress`, `user_watchlist` all FK `users.id`),
while membership and email hang off the *account*.

Downloads record the account that started them in `torrents.account_id`
(`torrents.user_id` is a profile FK and stays NULL, as does `schedules.user_id`).
A member sees and manages only their own account's downloads; the owner sees all
of them; and a NULL `account_id` (rows from before the column existed, and
schedule-cron downloads) counts as the owner's. The rule lives in
`services/torrent_scope.py` and covers `GET /torrents/list`, `POST /torrents/batch`,
`DELETE /torrents/{id}`, pause/stop on `POST /torrents/action/{id}` and
`GET /activity/count`; a download the caller cannot see answers the same 404 as one
that does not exist. Play, status, resume and every streaming route are
deliberately unscoped, so a member pressing Play on a film the owner already holds
still plays it. Deleting a download with its files removes its whole `save_path`
(leftovers included) when no other row shares that directory; when another row
does share it, only the torrent's own `save_path/<content name>` and its
`.<v1hex>.parts` file go (never a name a sibling also claims), and `save_path`
itself is removed only if that leaves it empty. If its own content cannot be
identified, nothing is deleted and a WARNING is logged
(`TorrentManager._plan_content_delete` / `_owned_paths` / `_delete_content`).

The `users` table keeps its name: five FK constraints point at `users.id` and
there is no migration tool to rename it. Only the API and UI call it a profile.

Supporting tables, all in `database/models/accounts.py`: `instance` (a singleton
row holding `claimed_at` and the hashed claim code), `invites`, `auth_tokens`
(magic links, single-use) and `auth_sessions` (cookie sessions, sliding).

### First-run claim

While `instance.claimed_at` is NULL the startup event mints a one-time claim code
each boot, logs it as a banner and writes it to `logs/claim_code.txt` in the
persisted `logs` volume (so it survives `make build`; restarting regenerates it).
`POST /api/v1/claim` takes the code, an email **and the password the owner is
choosing**, mails a verification link, and the verify step sets `claimed_at`, clears the
code and opens a session. The password is stored at claim time but is only effective once
the link proves the address, so a second submission (a typo) replaces the pair together.
A weak password is rejected *before* the claim code is checked, so it never spends one of
the ten wrong-code attempts that actually protect the code. Afterwards the endpoint
returns `409` forever.

On first boot against an existing database, `services/accounts.py` migrates every
pre-auth profile: the oldest becomes the owner's account, the rest become members,
all `pending_email`. Nothing is deleted, and plaintext passcodes are hashed in
place.

### Invite and sign-in

```
owner /members ──POST /instance/invites──▶ invites row ──email──▶ /invite?token=…
                                                                    │
                                          POST /auth/invite/accept ◀─┘
                                          → account active, first profile, session

member  /signin ──POST /auth/request-link──▶ auth_tokens row ──email──▶ /auth/verify?token=…
                                                                          │
                                                    POST /auth/verify ◀───┘  → session

owner   /signin/owner ──POST /auth/password-signin { email, password }──▶ session
        forgot? ──POST /auth/request-password-reset──▶ email ──▶ /auth/reset-password?token=…
                                       POST /auth/reset-password { token, NEW password } ──▶ session
```

`request-link` mints nothing for an owner address and `/auth/verify` refuses a `login`
token belonging to an owner — enforced at both mint and consumption, because a token
minted before an ownership transfer is what a single check misses. A `password_reset`
token is **not** a session on its own: `/auth/verify` rejects that purpose outright and
`/auth/reset-password` is its only consumer, so the emailed link is worthless unless a new
password is chosen with it. A reset also revokes every other session of that account. A
`passcode_reset` token is not a session either: `/auth/verify` refuses it too, and
`POST /auth/reset-passcode` is its only consumer. It clears the one profile code it names
and sets no cookie.

Every way a password sign-in can fail — unknown address, a member's address, an owner with
no password yet, a wrong password, a throttled attempt — returns **one identical 401**,
verified against a dummy hash so the timing matches too. A 429 would be the same
disclosure in a different costume: on a box that is on the public internet by definition,
any difference names the owner.

Transferring ownership swaps the credential with the role. The outgoing owner's
`password_hash` is cleared and they drop to magic link; the incoming owner is mailed a
set-your-password link. Both sessions keep working — `require_session` re-reads the role
per request, so there is no stale privilege, and a handover should not read as a lockout.
An owner with no password yet (transferred, or claimed before passwords existed) uses
`request-password-reset` as the *first*-password path.

The session is an `HttpOnly`, `SameSite=Lax`, `Path=/` cookie (`ff_session`)
whose sha256 is stored in `auth_sessions`. `Path` must stay `/`: `next.config.ts`
also exposes the backend under `/_backend/*`. No `Domain` is ever set — one makes
the browser reject the cookie coming back through the Next proxy.

Tokens never appear in a URL *path*. The emailed link points at a Next.js page and
the token rides in the query string; the page POSTs it in a JSON body.
`middleware/error_handler.py` logs `request.url.path` to a 7-day-retained file,
and query strings are not logged.

### Where the gate lives

**In FastAPI**, applied per-router in `main.py`
(`dependencies=[Depends(require_session)]`), with `require_owner` and
`require_profile` layered on top of specific routes. A Next.js middleware guard
would be worthless here: `/_backend/:path*` is a same-origin alias for the entire
backend, and the backend publishes `8000:8000` directly to the host — either
spelling walks straight past anything Next enforces.

`GET /` and `GET /health` are `@app.get` routes, not router routes, so they stay
public. `settings.auth_enabled=false` turns `require_session` into a synthetic
owner — development only.

### Profile lock

The session row's `unlocked_profiles` holds at most the active profile.
`POST /users/{id}/select` writes it: `[id]` after a correct code for a locked
profile, `[]` for an unlocked one, and a code is required on every pick.
`POST /users/deselect` clears it when the UI returns to "Who's watching?".
`resolve_profile` returns 423 for any locked profile that is not in the list.
`/unlock` survives one release as an alias.

A forgotten code has two ways back, one per entrance. The owner re-enters the
account password at `POST /users/{id}/passcode/reset`. A member asks
`POST /users/{id}/passcode/reset-link` (members only, always `{ok: true}`, 3 per
15 min per account) to email a `/auth/reset-passcode?token=…` link; that frontend
page POSTs the token to `POST /auth/reset-passcode`, which clears that one
profile's code. Only the newest link per account works.

Clients pick a profile only through `POST /users/{id}/select`: the web
`ProfileGate` and the TV picker. A profile whose list row has `require_passcode`
opens the numpad on every pick, with no codeless call first; an open one is
selected without a code, and a 403/423 to that means the list is stale, so the
client re-reads it. Web boot and `useTvProfile.restore` never select. A 423 at
web boot opens the picker with that profile's numpad, and a web tab whose
profile is relocked mid-session (a pick elsewhere on the same session) drops to
the picker the same way, keeping its stored profile; on the TV, `LockedRedirect`
sends the viewer to the picker. Switch profile calls `POST /users/deselect`: web
`UserContext.logout`, and the TV picker on mount. "Forgot code?": the owner
re-enters the account password on the web; a member gets the emailed
`/auth/reset-passcode?token=…` link, which clears the code only on a button
press. The TV only tells the owner to use the web. Codes are set, changed and
removed only in web Settings → Profile lock.

### Mail

```
FastAPI services/mailer.py
   │  POST {FRONTEND_INTERNAL_URL}/api/internal/mail
   │  x-internal-mail-secret: <INTERNAL_MAIL_SECRET>
   ▼
Next  src/app/api/internal/mail/route.ts   (Node runtime)
   ├─ render(<Template/>) from src/emails/*.tsx   (React Email)
   └─ resend.emails.send(...)
```

React Email is a React library, so the templates live on the frontend and the
backend — which owns the tokens — hands over a template id, a recipient and
props. With `INTERNAL_MAIL_SECRET` or `RESEND_API_KEY` unset, nothing is
delivered and the action URL is logged at WARNING instead, which keeps a
mail-less self-hosted instance usable. A send failure never fails the request.

## Volumes

- `postgres-data` — database storage.
- `resume-data`, `logs` — backend torrent resume data and logs. `logs` also
  holds `claim_code.txt` while the instance is unclaimed.
- `assets` — cached TMDB stills used as tier-2 avatars.
- `./downloads` (bind mount) — downloaded media on the host. **Autovacuum** (owner setting in Settings → Storage & playback, off by default) deletes downloads untouched for N days once a day at 04:00 *container-local* time (UTC unless `TZ` is set): `services/vacuum.py`, its own asyncio task started from the `startup` event, independent of `CRON_ENABLED`.

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
