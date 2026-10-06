# TV Device Pairing (Stage 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the TV obtain a session by showing a short code that someone approves from a phone, so nobody ever types a password on a D-pad.

**Architecture:** An RFC 8628-shaped device authorization grant. The TV calls `start`, gets a long secret `device_code` plus a short human `user_code`, and polls. A signed-in phone opens `/link`, compares the code, and approves. The TV's next poll receives `Set-Cookie: ff_session=…`. Because the TV loads the app from the Next.js origin, the ordinary same-origin cookie works unchanged — there is no bearer-token path and no CORS work. Device sessions slide on use; browser sessions keep today's absolute expiry.

**Tech Stack:** FastAPI + SQLAlchemy **1.4** (no Alembic), pytest; Next.js 15 App Router / React 19 / TypeScript, vitest. TV surface is hand-authored CSS at `frontend/public/bigscreen.css`.

**Spec:** `docs/superpowers/specs/2026-09-22-webos-tv-app-design.md` — §6 is this stage. Read §4 (non-negotiable constraints) and §6 before starting.

## Global Constraints

- **Branch:** `feat/tv-device-pairing`, off `master`.
- **The two entrances are untouched.** `/auth/request-link` mints a `login` token only for `ROLE_MEMBER`; `/auth/verify` 410s a `login` token held by an owner; `/auth/password-signin` requires `ROLE_OWNER` + `STATUS_ACTIVE` + a non-NULL `password_hash`. Pairing adds a **third** way for an *already-authenticated* account to place a session on a device it owns. It must not create accounts, must not bypass either entrance, and must mint a session only for `approved_account_id`.
- **Never modify `_bad_credentials()`** in `backend/app/api/auth.py`, and never add a password failure path.
- **No Alembic.** New tables are created by `create_all()` **only if imported in `app/database/models/__init__.py`** — a model imported only by a router silently does not exist in production. New columns must be nullable and are added by `sync_columns()` on startup.
- **SQLAlchemy 1.4** style, not 2.0.
- **Naive UTC everywhere.** Timestamp columns are plain `DateTime` (no `timezone=True`) and every default is a **callable** (`default=_utcnow`, not `default=_utcnow()`), because `Model.created_at` evaluates its default once at class-definition time. All auth code reads and writes naive UTC via `app.services.auth.utcnow()`.
- **Tokens never appear in a URL path.** `middleware/error_handler.py` logs `request.method` + `request.url.path` to stdout and to a 7-day file in the persisted `logs` volume. Query strings and bodies are not logged. `device_code` therefore travels only in a JSON **body**; `user_code` may appear in a frontend query string.
- **An auth dependency must never declare `Depends(get_db)`.** Endpoints use `Annotated[Session, Depends(get_db)]` + `with db as session:`, entered exactly **once**. Do not copy `api/schedules.py`, which gets this wrong.
- **No new `.env` key without adding the `Settings` field first** — `pydantic-settings` runs `extra='forbid'` and an undeclared key crashes the backend at import.
- **Backend tests are baked into the image, not bind-mounted.** Run with the explicit mount, from the repo root:
  `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/<file> -v`
- **Frontend:** host `node` v22.15.0 and `frontend/node_modules` are present; run `npx tsc --noEmit`, `npx vitest run`, `npm run build` from `frontend/`. If `rm -rf .next` is refused a macOS ACL is set — `chmod -RN .next` first. Baselines to match or beat: backend **471 passed**, frontend **82 files / 898 tests**.
- **TV surface rules.** Anything under `frontend/src/app/(bigscreen)/` must not import `globals.css`, `framer-motion`, or anything from `@/components/`, and must not use `backdrop-filter`, `mix-blend-mode`, SVG filters or `filter: blur()`. `npm run test:tv` is the guard. Only `bigscreen/diag/page.tsx` may carry `@allow-legacy-probes`.
- **Conventional Commits.**

## Review Focus

Five behaviours the spec implies but does not spell out as tests. Each is pinned by a test in the task that owns the code.

1. **A consumed `device_code` replayed must not mint a second session.** A TV that polls once more after success, or an attacker who captured the body, must get a refusal — not another cookie. *(Task 4)*
2. **A TV polling every 2s for the full 10-minute TTL (~300 polls) must not throttle itself into failure.** The liveness the flow depends on must not look like abuse. *(Task 4)*
3. **An account suspended between approve and poll must not receive a session.** `STATUS_ACTIVE` is re-checked at poll time, not trusted from approval. *(Task 4)*
4. **Two TVs pairing simultaneously must not cross-wire.** `user_code` is generated with collision retry, and approving one must leave the other pending. *(Task 2 and Task 5)*
5. **A pairing that expires between approve and poll must fail closed.** An approved-but-expired row mints nothing. *(Task 4)*

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `backend/app/database/models/accounts.py` | `DevicePairing` table; `device_name` / `device_kind` on `AuthSession` | 1 |
| `backend/app/database/models/__init__.py` | Export `DevicePairing` so `create_all()` sees it | 1 |
| `backend/app/services/device_pairing.py` | **NEW** — code generation, row lifecycle, status transitions. All pure except the session argument | 2 |
| `backend/app/models.py` | Pydantic request/response schemas for the five endpoints | 3 |
| `backend/app/api/auth.py` | `device/start`, `device/poll`, `device/approve`, `GET/DELETE /devices` | 3, 4, 5, 6 |
| `backend/app/services/auth.py` | `touch_session` slides `expires_at` for device sessions; `create_session` accepts device metadata | 5 |
| `backend/app/config.py` | `device_session_ttl_days`, `device_pairing_ttl_minutes` | 5 |
| `frontend/src/services/devices.ts` | **NEW** — typed client for the five endpoints | 7 |
| `frontend/src/services/api-client.ts` | 401 under `/bigscreen` routes to `/bigscreen/pair`, not `/signin` | 7 |
| `frontend/src/app/(web)/link/page.tsx` | **NEW** — the phone approval screen | 8 |
| `frontend/src/app/(bigscreen)/bigscreen/pair/page.tsx` | **NEW** — the TV pairing screen | 9 |
| `frontend/public/bigscreen.css` | Pairing-screen classes (`.bs-code`, `.bs-qr`, `.bs-pair`) | 9 |

Backend tests: `test_device_pairing_service.py` (2), `test_device_pairing_api.py` (3, 4), `test_device_sessions.py` (5), `test_device_revocation.py` (6).
Frontend tests: `devices.test.ts` (7), `link-page.test.tsx` (8), `pair-page.test.tsx` (9).

---

## Task 1: Schema — `DevicePairing` table and device columns on `AuthSession`

A new table plus two nullable columns. `create_all()` builds the table in full on next startup **provided it is exported from the package `__init__`**; `sync_columns()` adds the two columns to the existing `auth_sessions`.

**Files:**
- Modify: `backend/app/database/models/accounts.py`
- Modify: `backend/app/database/models/__init__.py`
- Test: `backend/tests/test_device_pairing_schema.py` (create)

**Interfaces:**
- Produces: `DevicePairing` with columns `id`, `device_code_hash`, `user_code`, `status`, `device_name`, `approved_account_id`, `created_at`, `expires_at`, `consumed_at`, `poll_count`, `approve_attempts`; and the status constants `PAIRING_PENDING`, `PAIRING_APPROVED`, `PAIRING_DENIED`, `PAIRING_CONSUMED`. `AuthSession` gains `device_name: Optional[str]` and `device_kind: Optional[str]`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_device_pairing_schema.py`:

```python
"""The pairing table must reach Base.metadata, and AuthSession must carry device columns.

A model imported only by a router never reaches Base.metadata and silently does not
exist in production — accounts.py's own module docstring warns about exactly this. The
first test is the guard for it.
"""
import datetime

from app.database.session import Base
from app.database.models import DevicePairing, AuthSession
from app.database.models.accounts import (
    PAIRING_PENDING, PAIRING_APPROVED, PAIRING_DENIED, PAIRING_CONSUMED,
)


def test_table_is_registered_on_the_metadata():
    assert "auth_device_pairings" in Base.metadata.tables


def test_pairing_columns_exist():
    cols = {c.name for c in DevicePairing.__table__.columns}
    assert {
        "id", "device_code_hash", "user_code", "status", "device_name",
        "approved_account_id", "created_at", "expires_at", "consumed_at",
        "poll_count", "approve_attempts",
    } <= cols


def test_device_code_hash_is_unique_and_indexed():
    col = DevicePairing.__table__.columns["device_code_hash"]
    assert col.unique is True
    assert col.index is True


def test_user_code_is_indexed_but_not_unique():
    # Uniqueness among LIVE rows is enforced in application code; a partial unique
    # index is not expressible through sync_indexes, and a full unique index would
    # make a consumed row block its code forever.
    col = DevicePairing.__table__.columns["user_code"]
    assert col.index is True
    assert not col.unique


def test_timestamp_defaults_are_callables():
    # Model.created_at's default is evaluated once at class-definition time, so every
    # row written by a process would share a timestamp. Defaults must be callables.
    for name in ("created_at", "expires_at"):
        default = DevicePairing.__table__.columns[name].default
        assert default is not None and callable(default.arg), name


def test_status_constants():
    assert (PAIRING_PENDING, PAIRING_APPROVED, PAIRING_DENIED, PAIRING_CONSUMED) == (
        "pending", "approved", "denied", "consumed",
    )


def test_auth_session_gained_nullable_device_columns():
    cols = AuthSession.__table__.columns
    assert "device_name" in cols and cols["device_name"].nullable
    assert "device_kind" in cols and cols["device_kind"].nullable


def test_is_usable_requires_pending_and_unexpired():
    now = datetime.datetime(2026, 1, 1, 12, 0, 0)
    row = DevicePairing(
        status=PAIRING_PENDING, expires_at=now + datetime.timedelta(minutes=5)
    )
    assert row.is_usable(now) is True
    row.status = PAIRING_CONSUMED
    assert row.is_usable(now) is False
    row.status = PAIRING_PENDING
    row.expires_at = now - datetime.timedelta(seconds=1)
    assert row.is_usable(now) is False
```

- [ ] **Step 2: Run to verify it fails**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/test_device_pairing_schema.py -v
```

Expected: `ImportError: cannot import name 'DevicePairing'`.

- [ ] **Step 3: Add the model**

In `backend/app/database/models/accounts.py`, after the `AuthSession` class and before the composite-index block at the end of the file, add:

```python
# Pairing statuses. A row moves pending -> approved -> consumed, or pending -> denied.
# "consumed" is terminal and is what makes a device_code single-use.
PAIRING_PENDING = "pending"
PAIRING_APPROVED = "approved"
PAIRING_DENIED = "denied"
PAIRING_CONSUMED = "consumed"


class DevicePairing(Model):
    """One in-flight attempt to put a session on a device that has no keyboard.

    Two secrets with different jobs. ``device_code`` is long, random and stays on the
    device; it is the thing that receives the session, so only its sha256 is stored.
    ``user_code`` is short enough to read off a television across a room, so it is NOT
    a secret — it is an index into a pending request. Guessing one lets an attacker
    approve somebody else's device, which requires them to already hold a valid account
    and gains them nothing.
    """

    __tablename__ = "auth_device_pairings"

    id = Column(String, primary_key=True, default=generate_uuid)

    device_code_hash = Column(String, nullable=False, unique=True, index=True)

    # Indexed but NOT unique: uniqueness is enforced among live rows in application
    # code (generate, check, retry). A full unique index would let one consumed row
    # reserve its code forever, and a partial index is not expressible via sync_indexes.
    user_code = Column(String, nullable=False, index=True)

    status = Column(String, nullable=False, default=PAIRING_PENDING, index=True)
    device_name = Column(String, nullable=True)
    approved_account_id = Column(
        String, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True, index=True
    )

    created_at = Column(DateTime, nullable=False, default=_utcnow)
    expires_at = Column(DateTime, nullable=False, default=_utcnow, index=True)
    consumed_at = Column(DateTime, nullable=True)

    # Abuse counters. poll_count is also how a stuck device shows up in the logs.
    poll_count = Column(Integer, nullable=False, default=0)
    approve_attempts = Column(Integer, nullable=False, default=0)

    account = relationship("Account", foreign_keys=[approved_account_id])

    def is_usable(self, now: datetime.datetime) -> bool:
        """Still awaiting approval. Approved rows are NOT usable — see is_claimable."""
        return (
            self.status == PAIRING_PENDING
            and self.expires_at is not None
            and self.expires_at > now
        )

    def is_claimable(self, now: datetime.datetime) -> bool:
        """Approved and not yet exchanged for a session."""
        return (
            self.status == PAIRING_APPROVED
            and self.consumed_at is None
            and self.expires_at is not None
            and self.expires_at > now
        )
```

Then add the two columns to `AuthSession`, immediately after `user_agent`:

```python
    # Set only for a session minted by device pairing. device_kind drives the sliding
    # expiry in touch_session: a television cannot re-authenticate by itself, so its
    # session renews on use, while a browser session keeps its absolute expiry.
    device_name = Column(String, nullable=True)
    device_kind = Column(String, nullable=True)
```

- [ ] **Step 4: Export it so `create_all()` sees it**

In `backend/app/database/models/__init__.py`, extend the `accounts` import:

```python
from .accounts import (
    Account,
    AuthSession,
    AuthToken,
    DevicePairing,
    Instance,
    Invite,
)
```

- [ ] **Step 5: Run the tests**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/test_device_pairing_schema.py tests/test_migrations.py tests/test_sync_indexes.py -v
```

Expected: all PASS. `test_migrations.py` and `test_sync_indexes.py` are the existing guards that the DDL passes still work.

- [ ] **Step 6: Commit**

```bash
git add backend/app/database/models/accounts.py backend/app/database/models/__init__.py \
  backend/tests/test_device_pairing_schema.py
git commit -m "feat(auth): add the device-pairing table and device columns on sessions

A pairing row holds two secrets with different jobs: device_code is long,
stays on the device and receives the session (sha256 only at rest), while
user_code is short enough to read off a television and is an index, not a
secret. Exported from the models package so create_all() builds the table."
```

---

## Task 2: The pairing service

All the lifecycle logic in one module, so the endpoints stay thin and the hard parts are unit-testable without HTTP.

**Files:**
- Create: `backend/app/services/device_pairing.py`
- Test: `backend/tests/test_device_pairing_service.py` (create)

**Interfaces:**
- Consumes: `DevicePairing`, the status constants, `auth_service.utcnow()`, `auth_service.generate_token()`, `auth_service.hash_token()`.
- Produces:
  - `USER_CODE_ALPHABET: str`, `USER_CODE_LENGTH: int = 8`
  - `generate_user_code(session) -> str`
  - `format_user_code(code: str) -> str` → `"XXXX-XXXX"`
  - `normalize_user_code(raw: str) -> str` → upper, strip non-alphabet
  - `start_pairing(session, *, ttl_minutes: int) -> tuple[str, DevicePairing]` → `(raw_device_code, row)`
  - `find_by_device_code(session, raw: str) -> Optional[DevicePairing]`
  - `find_claimable_by_user_code(session, user_code: str) -> Optional[DevicePairing]`
  - `find_pending_by_user_code(session, user_code: str) -> Optional[DevicePairing]` *(Task 5 calls this)*
  - `approve(session, row, *, account_id: str, device_name: str) -> None`
  - `deny(session, row) -> None` *(Task 4 calls this)*
  - `consume(session, row) -> None`
  - `DEVICE_NAME_MAX_LENGTH: int = 64`, `DEFAULT_DEVICE_NAME: str = "Television"`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_device_pairing_service.py`:

```python
"""Pairing lifecycle, without HTTP.

The user_code alphabet is the interesting part: it must not be able to spell a word
(so a code can never look like an instruction) and must not contain glyphs that are
misread across a room.
"""
import datetime

import pytest

from app.database.models.accounts import (
    DevicePairing, PAIRING_PENDING, PAIRING_APPROVED, PAIRING_CONSUMED,
)
from app.services import auth as auth_service
from app.services import device_pairing as dp


def test_alphabet_has_no_vowels_and_no_confusable_glyphs():
    assert set("AEIOU") & set(dp.USER_CODE_ALPHABET) == set()
    assert set("01OI") & set(dp.USER_CODE_ALPHABET) == set()
    assert len(dp.USER_CODE_ALPHABET) == len(set(dp.USER_CODE_ALPHABET))


def test_format_and_normalize_round_trip():
    assert dp.format_user_code("BCDFGHJK") == "BCDF-GHJK"
    assert dp.normalize_user_code("bcdf-ghjk") == "BCDFGHJK"
    assert dp.normalize_user_code("  BCDF GHJK  ") == "BCDFGHJK"
    assert dp.normalize_user_code("BCDF-GHJK") == dp.normalize_user_code("bcdfghjk")


def test_normalize_drops_characters_outside_the_alphabet():
    # A phone keyboard will happily offer O and 0; neither is in the alphabet, so a
    # code containing one was mistyped and must not silently match something else.
    assert dp.normalize_user_code("BCDF-GH0K") == "BCDFGHK"


def test_start_pairing_returns_a_raw_code_and_stores_only_its_hash(db_session):
    raw, row = dp.start_pairing(db_session, ttl_minutes=10)
    assert len(raw) > 30
    assert row.device_code_hash == auth_service.hash_token(raw)
    assert raw not in (row.device_code_hash or "")
    assert row.status == PAIRING_PENDING
    assert len(row.user_code) == dp.USER_CODE_LENGTH
    assert set(row.user_code) <= set(dp.USER_CODE_ALPHABET)


def test_start_pairing_sets_the_ttl(db_session):
    before = auth_service.utcnow()
    _, row = dp.start_pairing(db_session, ttl_minutes=10)
    delta = row.expires_at - before
    assert datetime.timedelta(minutes=9) < delta <= datetime.timedelta(minutes=10, seconds=5)


def test_two_pairings_do_not_share_a_user_code(db_session):
    _, a = dp.start_pairing(db_session, ttl_minutes=10)
    _, b = dp.start_pairing(db_session, ttl_minutes=10)
    assert a.user_code != b.user_code
    assert a.device_code_hash != b.device_code_hash


def test_user_code_collision_is_retried(db_session, monkeypatch):
    # Force the generator to repeat itself once, then differ. The retry loop must
    # notice the live row and try again rather than cross-wiring two devices.
    _, first = dp.start_pairing(db_session, ttl_minutes=10)
    db_session.flush()
    seq = iter([first.user_code, "ZZZZZZZZ"])
    monkeypatch.setattr(dp, "_random_user_code", lambda: next(seq))
    _, second = dp.start_pairing(db_session, ttl_minutes=10)
    assert second.user_code == "ZZZZZZZZ"


def test_find_by_device_code_matches_only_the_hash(db_session):
    raw, row = dp.start_pairing(db_session, ttl_minutes=10)
    db_session.flush()
    assert dp.find_by_device_code(db_session, raw) is not None
    assert dp.find_by_device_code(db_session, raw + "x") is None
    assert dp.find_by_device_code(db_session, "") is None


def test_find_claimable_ignores_pending_and_expired(db_session):
    raw, row = dp.start_pairing(db_session, ttl_minutes=10)
    db_session.flush()
    # Pending is not claimable — only approval makes it so.
    assert dp.find_claimable_by_user_code(db_session, row.user_code) is None
    dp.approve(db_session, row, account_id="acct-1", device_name="Living Room TV")
    db_session.flush()
    assert dp.find_claimable_by_user_code(db_session, row.user_code) is not None
    row.expires_at = auth_service.utcnow() - datetime.timedelta(seconds=1)
    db_session.flush()
    assert dp.find_claimable_by_user_code(db_session, row.user_code) is None


def test_approve_records_account_and_name(db_session):
    _, row = dp.start_pairing(db_session, ttl_minutes=10)
    dp.approve(db_session, row, account_id="acct-1", device_name="Living Room TV")
    assert row.status == PAIRING_APPROVED
    assert row.approved_account_id == "acct-1"
    assert row.device_name == "Living Room TV"


def test_approve_truncates_a_hostile_device_name(db_session):
    _, row = dp.start_pairing(db_session, ttl_minutes=10)
    dp.approve(db_session, row, account_id="a", device_name="x" * 5000)
    assert len(row.device_name) <= dp.DEVICE_NAME_MAX_LENGTH


def test_approve_falls_back_to_a_default_name(db_session):
    _, row = dp.start_pairing(db_session, ttl_minutes=10)
    dp.approve(db_session, row, account_id="a", device_name="   ")
    assert row.device_name == dp.DEFAULT_DEVICE_NAME


def test_consume_is_terminal(db_session):
    _, row = dp.start_pairing(db_session, ttl_minutes=10)
    dp.approve(db_session, row, account_id="a", device_name="TV")
    dp.consume(db_session, row)
    assert row.status == PAIRING_CONSUMED
    assert row.consumed_at is not None
    now = auth_service.utcnow()
    assert row.is_claimable(now) is False
    assert row.is_usable(now) is False
```

Add a `db_session` fixture if `backend/tests/conftest.py` does not already provide one. Check first:

```bash
grep -n 'def db_session' backend/tests/conftest.py
```

If absent, append to `backend/tests/conftest.py`:

```python
@pytest.fixture
def db_session():
    """An isolated in-memory session for pure-service tests.

    Rolled back and closed per test, so rows never leak between cases.
    """
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.database.session import Base
    import app.database.models  # noqa: F401 — registers every table on Base.metadata

    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    s = Session()
    try:
        yield s
    finally:
        s.rollback()
        s.close()
```

- [ ] **Step 2: Run to verify it fails**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/test_device_pairing_service.py -v
```

Expected: `ModuleNotFoundError: No module named 'app.services.device_pairing'`.

- [ ] **Step 3: Write the service**

Create `backend/app/services/device_pairing.py`:

```python
"""Device-pairing lifecycle: start, look up, approve, consume.

Kept out of the API layer so the parts worth testing — code generation, collision
retry, the status transitions — can be exercised without HTTP.

Why two different secrets:

* ``device_code`` is 32 random bytes. It never leaves the device, travels only in a
  JSON body (never a URL path, which is logged), and is the thing that is exchanged
  for a session. Only its sha256 is stored, so a database read cannot impersonate a
  device.
* ``user_code`` is eight characters that a person reads off a television and types
  into a phone. It is NOT a secret and is not treated as one. Guessing a live code
  lets an attacker approve somebody else's pending device, which requires them to
  already hold a valid account on this instance and gains them nothing.
"""

import datetime
import secrets
from typing import Optional

from sqlalchemy.orm import Session

from app.database.models.accounts import (
    DevicePairing,
    PAIRING_PENDING,
    PAIRING_APPROVED,
    PAIRING_CONSUMED,
    PAIRING_DENIED,
)
from app.services import auth as auth_service

# No vowels, so a code can never spell a word — a device that displays "SEND CASH"
# is a social-engineering gift. No 0/O/1/I, which are the glyphs people misread from
# across a room. 28 characters ** 8 is ~3.8e11, and codes live for ten minutes.
USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789"
USER_CODE_LENGTH = 8

DEVICE_NAME_MAX_LENGTH = 64
DEFAULT_DEVICE_NAME = "Television"

# Bounded so a pathological run of collisions cannot spin. With ~3.8e11 codes and a
# household's worth of live rows, reaching even two is already impossible in practice.
_MAX_CODE_ATTEMPTS = 8


def _random_user_code() -> str:
    """Separate function so a test can force a collision."""
    return "".join(secrets.choice(USER_CODE_ALPHABET) for _ in range(USER_CODE_LENGTH))


def format_user_code(code: str) -> str:
    """``BCDFGHJK`` -> ``BCDF-GHJK``. Display only; never stored in this form."""
    half = USER_CODE_LENGTH // 2
    return f"{code[:half]}-{code[half:]}"


def normalize_user_code(raw: str) -> str:
    """Upper-case and drop anything outside the alphabet.

    A phone keyboard offers O and 0 and a person will type the hyphen we showed them.
    Dropping unknown glyphs rather than rejecting the whole string means a near-miss
    fails to match a code instead of failing to parse, which is the same outcome with
    a better error.
    """
    return "".join(c for c in (raw or "").upper() if c in USER_CODE_ALPHABET)


def generate_user_code(session: Session) -> str:
    """A code not currently held by any live (pending or approved, unexpired) row."""
    now = auth_service.utcnow()
    for _ in range(_MAX_CODE_ATTEMPTS):
        candidate = _random_user_code()
        clash = (
            session.query(DevicePairing)
            .filter(
                DevicePairing.user_code == candidate,
                DevicePairing.status.in_([PAIRING_PENDING, PAIRING_APPROVED]),
                DevicePairing.expires_at > now,
            )
            .first()
        )
        if clash is None:
            return candidate
    raise RuntimeError("could not allocate a free user_code")


def start_pairing(session: Session, *, ttl_minutes: int) -> tuple[str, DevicePairing]:
    """Create a pending pairing. Returns ``(raw_device_code, row)``.

    The raw device code is returned ONCE and never stored.
    """
    raw = auth_service.generate_token()
    row = DevicePairing(
        device_code_hash=auth_service.hash_token(raw),
        user_code=generate_user_code(session),
        status=PAIRING_PENDING,
        created_at=auth_service.utcnow(),
        expires_at=auth_service.utcnow() + datetime.timedelta(minutes=ttl_minutes),
        poll_count=0,
        approve_attempts=0,
    )
    session.add(row)
    session.flush()
    return raw, row


def find_by_device_code(session: Session, raw: str) -> Optional[DevicePairing]:
    """Resolve a raw device code to its row, whatever its status.

    Status is deliberately NOT filtered here: the poll endpoint needs to tell
    "approved" from "already consumed" from "denied", and collapsing them into None
    would make a replayed code indistinguishable from a wrong one.
    """
    if not raw:
        return None
    return (
        session.query(DevicePairing)
        .filter(DevicePairing.device_code_hash == auth_service.hash_token(raw))
        .first()
    )


def find_claimable_by_user_code(session: Session, user_code: str) -> Optional[DevicePairing]:
    """An approved, unexpired, unconsumed row for this code."""
    code = normalize_user_code(user_code)
    if len(code) != USER_CODE_LENGTH:
        return None
    now = auth_service.utcnow()
    row = (
        session.query(DevicePairing)
        .filter(DevicePairing.user_code == code)
        .order_by(DevicePairing.created_at.desc())
        .first()
    )
    return row if row is not None and row.is_claimable(now) else None


def find_pending_by_user_code(session: Session, user_code: str) -> Optional[DevicePairing]:
    """A pending, unexpired row for this code — what the approver acts on."""
    code = normalize_user_code(user_code)
    if len(code) != USER_CODE_LENGTH:
        return None
    now = auth_service.utcnow()
    row = (
        session.query(DevicePairing)
        .filter(DevicePairing.user_code == code)
        .order_by(DevicePairing.created_at.desc())
        .first()
    )
    return row if row is not None and row.is_usable(now) else None


def approve(session: Session, row: DevicePairing, *, account_id: str, device_name: str) -> None:
    """Bind a pending row to the approving account."""
    name = (device_name or "").strip()[:DEVICE_NAME_MAX_LENGTH] or DEFAULT_DEVICE_NAME
    row.status = PAIRING_APPROVED
    row.approved_account_id = account_id
    row.device_name = name


def deny(session: Session, row: DevicePairing) -> None:
    row.status = PAIRING_DENIED


def consume(session: Session, row: DevicePairing) -> None:
    """Terminal. This is what makes a device_code single-use."""
    row.status = PAIRING_CONSUMED
    row.consumed_at = auth_service.utcnow()
```

- [ ] **Step 4: Run the tests**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/test_device_pairing_service.py -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/device_pairing.py backend/tests/test_device_pairing_service.py backend/tests/conftest.py
git commit -m "feat(auth): device-pairing lifecycle service

Code generation with collision retry, the status transitions, and the
two-secret split: device_code is long and stays on the device, user_code
is eight vowel-free characters a person reads off a television."
```

---

## Task 3: `POST /auth/device/start`

The TV's opening call. Public, no body.

**Files:**
- Modify: `backend/app/models.py` (schemas)
- Modify: `backend/app/api/auth.py`
- Modify: `backend/app/config.py`
- Test: `backend/tests/test_device_pairing_api.py` (create)

**Interfaces:**
- Consumes: `device_pairing` service from Task 2.
- Produces: `DeviceStartResponse{device_code, user_code, verification_uri, expires_in, interval}`; settings `device_pairing_ttl_minutes: int = 10`, `device_session_ttl_days: int = 180`; module constants `_DEVICE_START_LIMIT`, `_DEVICE_START_WINDOW`.

- [ ] **Step 1: Add the settings fields**

In `backend/app/config.py`, after `invite_ttl_hours`:

```python
    # Device pairing. The TTL is short because a code is readable off a screen; the
    # session TTL is long and SLIDING because a television cannot re-authenticate by
    # itself — see touch_session.
    device_pairing_ttl_minutes: int = 10
    device_session_ttl_days: int = 180
```

- [ ] **Step 2: Add the schemas**

In `backend/app/models.py`, next to `VerifyTokenResponse`:

```python
class DeviceStartResponse(BaseModel):
    """Handed to a device that has no keyboard.

    ``device_code`` is the secret and appears only in this body. ``user_code`` is the
    short code a person reads off the screen; it is an index, not a secret.
    """
    device_code: str
    user_code: str
    verification_uri: str
    expires_in: int
    interval: int


class DevicePollRequest(BaseModel):
    device_code: str


class DevicePollResponse(BaseModel):
    status: str  # pending | approved | denied | expired


class DeviceApproveRequest(BaseModel):
    user_code: str
    device_name: str = ""


class DeviceSessionResponse(BaseModel):
    id: str
    device_name: Optional[str] = None
    device_kind: Optional[str] = None
    created_at: Optional[datetime.datetime] = None
    last_seen_at: Optional[datetime.datetime] = None
    current: bool = False
```

If `datetime` is not already imported in `models.py`, add `import datetime` at the top.

- [ ] **Step 3: Write the failing test**

Create `backend/tests/test_device_pairing_api.py`:

```python
"""The device-pairing endpoints.

The flow is an RFC 8628-shaped device authorization grant: a device with no keyboard
gets a long secret and a short human code, and a signed-in phone approves it.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import device_pairing as dp

client = TestClient(app)


def test_start_is_public_and_returns_both_codes():
    r = client.post("/api/v1/auth/device/start")
    assert r.status_code == 200
    body = r.json()
    assert len(body["device_code"]) > 30
    assert len(dp.normalize_user_code(body["user_code"])) == dp.USER_CODE_LENGTH
    assert body["expires_in"] == 600
    assert body["interval"] >= 1
    assert body["verification_uri"].endswith("/link")


def test_start_returns_the_user_code_already_formatted():
    body = client.post("/api/v1/auth/device/start").json()
    assert "-" in body["user_code"]


def test_two_starts_differ():
    a = client.post("/api/v1/auth/device/start").json()
    b = client.post("/api/v1/auth/device/start").json()
    assert a["device_code"] != b["device_code"]
    assert a["user_code"] != b["user_code"]


def test_start_never_puts_the_device_code_in_the_path():
    # middleware/error_handler.py logs request.url.path to stdout and to a retained
    # file. A secret in a path is a secret in the logs.
    r = client.post("/api/v1/auth/device/start")
    assert r.request.url.path == "/api/v1/auth/device/start"
```

- [ ] **Step 4: Run to verify it fails**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/test_device_pairing_api.py -v
```

Expected: 404 — the route does not exist.

- [ ] **Step 5: Implement the endpoint**

In `backend/app/api/auth.py`, add to the rate-limit constants block:

```python
# Generous: a device polls every two seconds for the whole ten-minute TTL, which is
# ~300 calls, and that liveness is the flow working rather than abuse. The bucket is
# per device_code, so one stuck device cannot throttle another.
_DEVICE_POLL_LIMIT = 450
_DEVICE_POLL_WINDOW = 15 * 60
# Unauthenticated, so this one is a global bucket. A household never approaches it.
_DEVICE_START_LIMIT = 30
_DEVICE_START_WINDOW = 15 * 60
# Wrong codes typed by one signed-in account, mirroring the /claim wrong-code budget.
_DEVICE_APPROVE_LIMIT = 10
_DEVICE_APPROVE_WINDOW = 15 * 60
```

Extend the imports at the top of `backend/app/api/auth.py`. The existing
`from app.database.models.accounts import (...)` block gains `AuthSession`,
`PAIRING_PENDING`, `PAIRING_CONSUMED`, `PAIRING_DENIED`; add
`from app.services import device_pairing`; and the `from app.models import (...)` block
gains `DeviceStartResponse`, `DevicePollRequest`, `DevicePollResponse`,
`DeviceApproveRequest`, `DeviceSessionResponse`. `Account`, `STATUS_ACTIVE` and
`OkResponse` are already imported. Then add:

```python
@router.post("/device/start", response_model=DeviceStartResponse)
async def device_start(db: Annotated[Session, Depends(get_db)]):
    """Begin pairing a device that has no usable keyboard.

    Public by necessity — the device has no credentials yet. That is safe because
    starting a pairing grants nothing: the row is inert until an authenticated account
    approves it, and the session is handed only to whoever holds the device_code.
    """
    if not auth_service.rate_limiter.check(
        "device-start", limit=_DEVICE_START_LIMIT, window_seconds=_DEVICE_START_WINDOW
    ):
        raise HTTPException(status_code=429, detail="Too many pairing attempts")

    with db as session:
        raw, row = device_pairing.start_pairing(
            session, ttl_minutes=settings.device_pairing_ttl_minutes
        )
        user_code = device_pairing.format_user_code(row.user_code)

    return DeviceStartResponse(
        device_code=raw,
        user_code=user_code,
        verification_uri=f"{settings.app_public_url.rstrip('/')}/link",
        expires_in=settings.device_pairing_ttl_minutes * 60,
        interval=2,
    )
```

- [ ] **Step 6: Run the tests**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/test_device_pairing_api.py -v
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/auth.py backend/app/models.py backend/app/config.py \
  backend/tests/test_device_pairing_api.py
git commit -m "feat(auth): POST /auth/device/start

Public because the device has no credentials yet, which is safe: the row
is inert until an authenticated account approves it, and the session goes
only to whoever holds the device_code."
```

---

## Task 4: `POST /auth/device/poll` — where the session is minted

The security-critical endpoint. Four of the five Review Focus items live here.

**Files:**
- Modify: `backend/app/api/auth.py`
- Test: `backend/tests/test_device_pairing_api.py` (extend)

**Interfaces:**
- Consumes: `device_pairing.find_by_device_code/consume`, `auth_service.create_session`, `_set_session_cookie`.
- Produces: `POST /auth/device/poll` → `DevicePollResponse`, plus `Set-Cookie: ff_session=…` on the single approved poll.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_device_pairing_api.py`:

```python
from app.database.models.accounts import (
    Account, DevicePairing, PAIRING_APPROVED, PAIRING_CONSUMED,
    ROLE_OWNER, STATUS_ACTIVE,
)
from app.database.session import get_db
from app.services import auth as auth_service


def _approve_directly(device_code: str, *, account_id: str, name: str = "Living Room TV"):
    """Approve without going through the HTTP approve endpoint (that is Task 5)."""
    with get_db() as session:
        row = dp.find_by_device_code(session, device_code)
        dp.approve(session, row, account_id=account_id, device_name=name)
        session.commit()


@pytest.fixture
def an_account():
    with get_db() as session:
        acct = Account(
            email="pairing-test@example.com", role=ROLE_OWNER, status=STATUS_ACTIVE
        )
        session.add(acct)
        session.commit()
        yield acct.id
        session.query(Account).filter(Account.id == acct.id).delete()
        session.commit()


def test_poll_is_pending_before_approval():
    start = client.post("/api/v1/auth/device/start").json()
    r = client.post("/api/v1/auth/device/poll", json={"device_code": start["device_code"]})
    assert r.status_code == 200
    assert r.json()["status"] == "pending"
    assert "set-cookie" not in {k.lower() for k in r.headers}


def test_poll_mints_a_session_once_approved(an_account):
    start = client.post("/api/v1/auth/device/start").json()
    _approve_directly(start["device_code"], account_id=an_account)
    r = client.post("/api/v1/auth/device/poll", json={"device_code": start["device_code"]})
    assert r.status_code == 200
    assert r.json()["status"] == "approved"
    assert "ff_session=" in r.headers.get("set-cookie", "")


def test_a_consumed_device_code_mints_nothing_on_replay(an_account):
    """REVIEW FOCUS 1 — a replayed device_code must not mint a second session."""
    start = client.post("/api/v1/auth/device/start").json()
    _approve_directly(start["device_code"], account_id=an_account)
    first = client.post("/api/v1/auth/device/poll", json={"device_code": start["device_code"]})
    assert "ff_session=" in first.headers.get("set-cookie", "")

    second = client.post("/api/v1/auth/device/poll", json={"device_code": start["device_code"]})
    assert second.status_code == 200
    assert second.json()["status"] == "expired"
    assert "ff_session=" not in second.headers.get("set-cookie", "")


def test_three_hundred_polls_do_not_throttle_the_device():
    """REVIEW FOCUS 2 — a device polls every 2s for 10 minutes. That is the flow
    working, not abuse, and it must not throttle itself into failure."""
    start = client.post("/api/v1/auth/device/start").json()
    for _ in range(300):
        r = client.post("/api/v1/auth/device/poll", json={"device_code": start["device_code"]})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "pending"


def test_a_suspended_account_receives_no_session(an_account):
    """REVIEW FOCUS 3 — STATUS_ACTIVE is re-checked at poll time, never trusted
    from the moment of approval."""
    start = client.post("/api/v1/auth/device/start").json()
    _approve_directly(start["device_code"], account_id=an_account)
    with get_db() as session:
        acct = session.query(Account).filter(Account.id == an_account).first()
        acct.status = "suspended"
        session.commit()

    r = client.post("/api/v1/auth/device/poll", json={"device_code": start["device_code"]})
    assert r.json()["status"] == "denied"
    assert "ff_session=" not in r.headers.get("set-cookie", "")


def test_a_pairing_that_expired_after_approval_mints_nothing(an_account):
    """REVIEW FOCUS 5 — approved but expired must fail closed."""
    start = client.post("/api/v1/auth/device/start").json()
    _approve_directly(start["device_code"], account_id=an_account)
    with get_db() as session:
        row = dp.find_by_device_code(session, start["device_code"])
        row.expires_at = auth_service.utcnow() - __import__("datetime").timedelta(seconds=1)
        session.commit()

    r = client.post("/api/v1/auth/device/poll", json={"device_code": start["device_code"]})
    assert r.json()["status"] == "expired"
    assert "ff_session=" not in r.headers.get("set-cookie", "")


def test_an_unknown_device_code_is_indistinguishable_from_an_expired_one():
    r = client.post("/api/v1/auth/device/poll", json={"device_code": "not-a-real-code"})
    assert r.status_code == 200
    assert r.json()["status"] == "expired"


def test_the_minted_session_is_tagged_as_a_device(an_account):
    start = client.post("/api/v1/auth/device/start").json()
    _approve_directly(start["device_code"], account_id=an_account, name="Living Room TV")
    client.post("/api/v1/auth/device/poll", json={"device_code": start["device_code"]})
    with get_db() as session:
        from app.database.models.accounts import AuthSession
        row = (
            session.query(AuthSession)
            .filter(AuthSession.account_id == an_account)
            .order_by(AuthSession.id.desc())
            .first()
        )
        assert row.device_kind == "tv"
        assert row.device_name == "Living Room TV"
```

- [ ] **Step 2: Run to verify they fail**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/test_device_pairing_api.py -v
```

Expected: the poll tests 404.

- [ ] **Step 3: Implement the endpoint**

```python
@router.post("/device/poll", response_model=DevicePollResponse)
async def device_poll(
    payload: DevicePollRequest,
    response: Response,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
):
    """Exchange an approved pairing for a session.

    Four refusals collapse into ``expired``: unknown code, already consumed, past its
    TTL, and denied-because-the-account-is-no-longer-active is the one that does not —
    it answers ``denied`` so the screen can say something useful. An unknown code and a
    consumed one deliberately look identical, so a replayed body cannot be told from a
    guessed one.

    ``STATUS_ACTIVE`` is re-checked HERE rather than trusted from the moment of
    approval: an account suspended in between must not receive a session.
    """
    code = payload.device_code or ""
    if not auth_service.rate_limiter.check(
        f"device-poll:{auth_service.hash_token(code)}",
        limit=_DEVICE_POLL_LIMIT,
        window_seconds=_DEVICE_POLL_WINDOW,
    ):
        raise HTTPException(status_code=429, detail="Polling too fast")

    raw: Optional[str] = None
    status = "expired"
    with db as session:
        row = device_pairing.find_by_device_code(session, code)
        now = auth_service.utcnow()

        if row is None or row.status == PAIRING_CONSUMED or row.expires_at <= now:
            status = "expired"
        elif row.status == PAIRING_DENIED:
            status = "denied"
        elif row.status == PAIRING_PENDING:
            row.poll_count = (row.poll_count or 0) + 1
            status = "pending"
        elif row.is_claimable(now):
            account = (
                session.query(Account)
                .filter(Account.id == row.approved_account_id)
                .first()
            )
            if account is None or account.status != STATUS_ACTIVE:
                # The approval is stale. Burn the row so the device cannot sit and
                # retry against an account that is no longer allowed in.
                device_pairing.deny(session, row)
                status = "denied"
            else:
                raw, _ = auth_service.create_session(
                    session,
                    account,
                    user_agent=request.headers.get("user-agent"),
                    device_name=row.device_name,
                    device_kind="tv",
                )
                device_pairing.consume(session, row)
                status = "approved"

    if raw is not None:
        _set_device_session_cookie(response, raw)
    return DevicePollResponse(status=status)
```

Add the device-cookie helper next to `_set_session_cookie`:

```python
def _set_device_session_cookie(response: Response, raw: str) -> None:
    """Same cookie, longer Max-Age.

    A television cannot re-authenticate by itself, so its cookie outlives a browser's
    — and touch_session slides the row's expiry on use, so an in-use TV never lapses.
    """
    response.set_cookie(
        settings.cookie_name,
        raw,
        max_age=settings.device_session_ttl_days * 86400,
        **auth_service.cookie_kwargs(),
    )
```

- [ ] **Step 4: Run the tests**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/test_device_pairing_api.py -v
```

Expected: all PASS. `create_session` gains its two keyword arguments in Task 5 — if that task has not run yet, add them there and re-run this file at the end of Task 5.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/auth.py backend/tests/test_device_pairing_api.py
git commit -m "feat(auth): POST /auth/device/poll mints the device session

Unknown, consumed and expired codes all answer 'expired' so a replayed
body cannot be told from a guessed one. STATUS_ACTIVE is re-checked at
poll time rather than trusted from approval, and consuming the row is
what makes a device_code single-use."
```

---

## Task 5: `POST /auth/device/approve`, device metadata on sessions, and sliding expiry

The phone's half of the flow, plus the two `services/auth.py` changes it depends on.

**Files:**
- Modify: `backend/app/services/auth.py` (`create_session`, `touch_session`)
- Modify: `backend/app/api/auth.py`
- Test: `backend/tests/test_device_sessions.py` (create), `backend/tests/test_device_pairing_api.py` (extend)

**Interfaces:**
- Consumes: `device_pairing.find_pending_by_user_code/approve`, `require_session`.
- Produces: `create_session(session, account, *, user_agent=None, device_name=None, device_kind=None)`; `touch_session` slides `expires_at` when `device_kind` is set; `POST /auth/device/approve` → `OkResponse`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_device_sessions.py`:

```python
"""Device sessions slide; browser sessions do not.

A person can sign in again. A television cannot — it has no keyboard and the person
who paired it may not be in the room. So a device session renews on use, while a
browser session keeps the absolute 30-day expiry it has always had.
"""
import datetime

from app.config import settings
from app.database.models.accounts import Account, AuthSession, ROLE_OWNER, STATUS_ACTIVE
from app.services import auth as auth_service


def _account(db_session):
    a = Account(email="slide@example.com", role=ROLE_OWNER, status=STATUS_ACTIVE)
    db_session.add(a)
    db_session.flush()
    return a


def test_browser_session_has_the_absolute_ttl(db_session):
    _, row = auth_service.create_session(db_session, _account(db_session))
    delta = row.expires_at - auth_service.utcnow()
    assert abs(delta.days - settings.session_ttl_days) <= 1
    assert row.device_kind is None
    assert row.device_name is None


def test_device_session_has_the_long_ttl_and_its_metadata(db_session):
    _, row = auth_service.create_session(
        db_session, _account(db_session), device_name="Living Room TV", device_kind="tv"
    )
    delta = row.expires_at - auth_service.utcnow()
    assert abs(delta.days - settings.device_session_ttl_days) <= 1
    assert row.device_kind == "tv"
    assert row.device_name == "Living Room TV"


def test_touch_slides_a_device_session(db_session):
    _, row = auth_service.create_session(
        db_session, _account(db_session), device_name="TV", device_kind="tv"
    )
    row.expires_at = auth_service.utcnow() + datetime.timedelta(days=1)
    row.last_seen_at = auth_service.utcnow() - datetime.timedelta(minutes=5)
    auth_service.touch_session(db_session, row)
    assert row.expires_at - auth_service.utcnow() > datetime.timedelta(days=100)


def test_touch_does_not_slide_a_browser_session(db_session):
    _, row = auth_service.create_session(db_session, _account(db_session))
    row.expires_at = auth_service.utcnow() + datetime.timedelta(days=1)
    row.last_seen_at = auth_service.utcnow() - datetime.timedelta(minutes=5)
    auth_service.touch_session(db_session, row)
    assert row.expires_at - auth_service.utcnow() < datetime.timedelta(days=2)


def test_touch_still_throttles_the_last_seen_write(db_session):
    # The throttle exists because an unguarded UPDATE on every request is real write
    # amplification on the Raspberry Pi target. Sliding must not defeat it.
    _, row = auth_service.create_session(
        db_session, _account(db_session), device_name="TV", device_kind="tv"
    )
    row.last_seen_at = auth_service.utcnow()
    before = row.expires_at
    auth_service.touch_session(db_session, row)
    assert row.expires_at == before
```

Append the approve tests to `backend/tests/test_device_pairing_api.py`:

```python
def test_approve_requires_a_session():
    start = client.post("/api/v1/auth/device/start").json()
    r = client.post(
        "/api/v1/auth/device/approve",
        json={"user_code": start["user_code"], "device_name": "TV"},
    )
    assert r.status_code in (401, 403)


def test_approve_then_poll_pairs_the_device(an_account, signed_in_client):
    start = client.post("/api/v1/auth/device/start").json()
    r = signed_in_client.post(
        "/api/v1/auth/device/approve",
        json={"user_code": start["user_code"], "device_name": "Living Room TV"},
    )
    assert r.status_code == 200
    polled = client.post("/api/v1/auth/device/poll", json={"device_code": start["device_code"]})
    assert polled.json()["status"] == "approved"


def test_approve_accepts_the_hyphenated_form_and_lower_case(signed_in_client):
    start = client.post("/api/v1/auth/device/start").json()
    typed = start["user_code"].lower()
    r = signed_in_client.post(
        "/api/v1/auth/device/approve", json={"user_code": typed, "device_name": "TV"}
    )
    assert r.status_code == 200


def test_approving_one_device_leaves_another_pending(signed_in_client):
    """REVIEW FOCUS 4 — two devices pairing at once must not cross-wire."""
    a = client.post("/api/v1/auth/device/start").json()
    b = client.post("/api/v1/auth/device/start").json()
    signed_in_client.post(
        "/api/v1/auth/device/approve", json={"user_code": a["user_code"], "device_name": "A"}
    )
    assert client.post("/api/v1/auth/device/poll", json={"device_code": a["device_code"]}).json()["status"] == "approved"
    assert client.post("/api/v1/auth/device/poll", json={"device_code": b["device_code"]}).json()["status"] == "pending"


def test_a_wrong_code_is_refused_and_budgeted(signed_in_client):
    for _ in range(10):
        r = signed_in_client.post(
            "/api/v1/auth/device/approve", json={"user_code": "ZZZZ-ZZZZ", "device_name": "x"}
        )
        assert r.status_code in (404, 429)
    # The budget mirrors the /claim wrong-code budget: a signed-in account cannot sit
    # and enumerate live codes.
    final = signed_in_client.post(
        "/api/v1/auth/device/approve", json={"user_code": "ZZZZ-ZZZZ", "device_name": "x"}
    )
    assert final.status_code == 429
```

Add a `signed_in_client` fixture to `backend/tests/test_device_pairing_api.py`:

```python
@pytest.fixture
def signed_in_client(an_account):
    """A TestClient carrying a real session cookie for `an_account`."""
    from app.database.models.accounts import Account
    c = TestClient(app)
    with get_db() as session:
        acct = session.query(Account).filter(Account.id == an_account).first()
        raw, _ = auth_service.create_session(session, acct)
        session.commit()
    c.cookies.set("ff_session", raw)
    return c
```

- [ ] **Step 2: Run to verify they fail**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/test_device_sessions.py tests/test_device_pairing_api.py -v
```

Expected: `TypeError: create_session() got an unexpected keyword argument 'device_name'`, and 404 on approve.

- [ ] **Step 3: Extend `create_session`**

In `backend/app/services/auth.py`, change the signature and body:

```python
def create_session(
    session: Session,
    account: Account,
    *,
    user_agent: Optional[str] = None,
    device_name: Optional[str] = None,
    device_kind: Optional[str] = None,
) -> tuple[str, AuthSession]:
    """Start a signed-in session. Returns ``(raw_cookie_value, row)``.

    ``device_kind`` set means this session belongs to something that cannot sign itself
    in again — a television. Those get a much longer TTL and, in touch_session, a
    sliding one.
    """
    raw = generate_token()
    ttl_days = settings.device_session_ttl_days if device_kind else settings.session_ttl_days
    row = AuthSession(
        token_hash=hash_token(raw),
        account_id=account.id,
        expires_at=utcnow() + datetime.timedelta(days=ttl_days),
        last_seen_at=utcnow(),
        user_agent=(user_agent or "")[:512] or None,
        device_name=device_name,
        device_kind=device_kind,
        unlocked_profiles=[],
    )
    session.add(row)
    account.last_login_at = utcnow()
    session.flush()
    return raw, row
```

- [ ] **Step 4: Make `touch_session` slide device sessions**

```python
def touch_session(session: Session, row: AuthSession) -> None:
    """Sliding ``last_seen_at``, written at most once a minute.

    Without the throttle every request on every page would issue an UPDATE, which on
    a Raspberry Pi instance is real write amplification for no benefit.

    For a DEVICE session the same write also slides ``expires_at`` forward. A browser
    session keeps its absolute expiry because a person can sign in again; a television
    cannot, so an in-use TV must never lapse. The asymmetry is deliberate and is the
    only behaviour change to existing sessions in this stage.
    """
    now = utcnow()
    if row.last_seen_at is None or (now - row.last_seen_at).total_seconds() > 60:
        row.last_seen_at = now
        if row.device_kind:
            row.expires_at = now + datetime.timedelta(days=settings.device_session_ttl_days)
```

- [ ] **Step 5: Implement the approve endpoint**

```python
@router.post("/device/approve", response_model=OkResponse)
async def device_approve(
    payload: DeviceApproveRequest,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_session),
):
    """Bind a pending pairing to the caller's account.

    The genuine risk in any device grant is social engineering — persuading a
    signed-in person to approve a device that is not theirs. The mitigations are the
    screen (which names the device and shows the code to compare), the ten-minute TTL,
    and this per-account wrong-code budget, which mirrors the one /claim already uses
    so a signed-in account cannot sit and enumerate live codes.
    """
    if not auth_service.rate_limiter.check(
        f"device-approve:{ctx.account_id}",
        limit=_DEVICE_APPROVE_LIMIT,
        window_seconds=_DEVICE_APPROVE_WINDOW,
    ):
        raise HTTPException(status_code=429, detail="Too many attempts")

    with db as session:
        row = device_pairing.find_pending_by_user_code(session, payload.user_code)
        if row is None:
            raise HTTPException(status_code=404, detail="That code is not valid")
        row.approve_attempts = (row.approve_attempts or 0) + 1
        device_pairing.approve(
            session,
            row,
            account_id=ctx.account_id,
            device_name=payload.device_name,
        )
        # A correct code clears the budget, so a mistyped attempt followed by a correct
        # one does not leave someone locked out of pairing their own television.
        auth_service.rate_limiter.reset(f"device-approve:{ctx.account_id}")

    return OkResponse(ok=True)
```

- [ ] **Step 6: Run everything**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/test_device_sessions.py tests/test_device_pairing_api.py \
  tests/test_auth_service.py tests/test_owner_password.py tests/test_claim_flow.py -v
```

Expected: all PASS. The last three are the existing auth guards — they prove the two entrances and the session model still behave.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/auth.py backend/app/api/auth.py \
  backend/tests/test_device_sessions.py backend/tests/test_device_pairing_api.py
git commit -m "feat(auth): approve a pairing, and slide device sessions

A person can sign in again; a television cannot, so a device session
renews on use while a browser session keeps its absolute expiry. Approval
carries a per-account wrong-code budget mirroring /claim's."
```

---

## Task 6: Per-device revocation

A living-room TV that cannot be revoked independently is a liability.

**Files:**
- Modify: `backend/app/api/auth.py`
- Test: `backend/tests/test_device_revocation.py` (create)

**Interfaces:**
- Produces: `GET /auth/devices` → `list[DeviceSessionResponse]`; `DELETE /auth/devices/{session_id}` → `OkResponse`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_device_revocation.py`:

```python
"""Listing and revoking individual sessions.

Before this, the only options were self-signout and account-wide revocation, so
un-pairing a television meant signing every browser out too.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database.models.accounts import Account, AuthSession, ROLE_OWNER, STATUS_ACTIVE
from app.database.session import get_db
from app.services import auth as auth_service

client = TestClient(app)


@pytest.fixture
def account_with_two_sessions():
    with get_db() as session:
        acct = Account(email="revoke@example.com", role=ROLE_OWNER, status=STATUS_ACTIVE)
        session.add(acct)
        session.flush()
        browser_raw, browser = auth_service.create_session(session, acct)
        tv_raw, tv = auth_service.create_session(
            session, acct, device_name="Living Room TV", device_kind="tv"
        )
        ids = (acct.id, browser_raw, browser.id, tv_raw, tv.id)
        session.commit()
    yield ids
    with get_db() as session:
        session.query(Account).filter(Account.id == ids[0]).delete()
        session.commit()


def test_list_shows_both_and_marks_the_current_one(account_with_two_sessions):
    _, browser_raw, browser_id, _, tv_id = account_with_two_sessions
    c = TestClient(app)
    c.cookies.set("ff_session", browser_raw)
    r = c.get("/api/v1/auth/devices")
    assert r.status_code == 200
    rows = {row["id"]: row for row in r.json()}
    assert rows[browser_id]["current"] is True
    assert rows[tv_id]["current"] is False
    assert rows[tv_id]["device_name"] == "Living Room TV"
    assert rows[tv_id]["device_kind"] == "tv"


def test_list_never_returns_a_token_hash(account_with_two_sessions):
    _, browser_raw, _, _, _ = account_with_two_sessions
    c = TestClient(app)
    c.cookies.set("ff_session", browser_raw)
    body = c.get("/api/v1/auth/devices").text
    assert "token_hash" not in body


def test_revoking_the_tv_leaves_the_browser_signed_in(account_with_two_sessions):
    _, browser_raw, _, tv_raw, tv_id = account_with_two_sessions
    c = TestClient(app)
    c.cookies.set("ff_session", browser_raw)
    assert c.delete(f"/api/v1/auth/devices/{tv_id}").status_code == 200
    assert c.get("/api/v1/auth/me").status_code == 200

    tv = TestClient(app)
    tv.cookies.set("ff_session", tv_raw)
    assert tv.get("/api/v1/auth/me").status_code == 401


def test_cannot_revoke_a_session_belonging_to_another_account(account_with_two_sessions):
    _, browser_raw, _, _, _ = account_with_two_sessions
    with get_db() as session:
        other = Account(email="other@example.com", role=ROLE_OWNER, status=STATUS_ACTIVE)
        session.add(other)
        session.flush()
        _, other_session = auth_service.create_session(session, other)
        other_id = other_session.id
        session.commit()

    c = TestClient(app)
    c.cookies.set("ff_session", browser_raw)
    assert c.delete(f"/api/v1/auth/devices/{other_id}").status_code == 404


def test_devices_requires_a_session():
    assert TestClient(app).get("/api/v1/auth/devices").status_code in (401, 403)
```

- [ ] **Step 2: Run to verify it fails**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/test_device_revocation.py -v
```

Expected: 404 — the routes do not exist.

- [ ] **Step 3: Implement**

```python
@router.get("/devices", response_model=list[DeviceSessionResponse])
async def list_devices(
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_session),
):
    """Every live session on this account, so a television can be un-paired alone."""
    now = auth_service.utcnow()
    with db as session:
        rows = (
            session.query(AuthSession)
            .filter(
                AuthSession.account_id == ctx.account_id,
                AuthSession.revoked_at.is_(None),
                AuthSession.expires_at > now,
            )
            .order_by(AuthSession.last_seen_at.desc().nullslast())
            .all()
        )
        return [
            DeviceSessionResponse(
                id=r.id,
                device_name=r.device_name,
                device_kind=r.device_kind,
                created_at=r.created_at,
                last_seen_at=r.last_seen_at,
                current=(r.id == ctx.session_id),
            )
            for r in rows
        ]


@router.delete("/devices/{session_id}", response_model=OkResponse)
async def revoke_device(
    session_id: str,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_session),
):
    """Revoke one session. A session belonging to another account answers 404, not
    403 — whether an id exists is not this caller's business."""
    with db as session:
        row = (
            session.query(AuthSession)
            .filter(
                AuthSession.id == session_id,
                AuthSession.account_id == ctx.account_id,
            )
            .first()
        )
        if row is None:
            raise HTTPException(status_code=404, detail="No such device")
        auth_service.revoke_session(session, row)
    return OkResponse(ok=True)
```

- [ ] **Step 4: Run the tests**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/test_device_revocation.py -v
```

Expected: all PASS.

- [ ] **Step 5: Run the full backend suite**

```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" \
  backend python -m pytest tests/ -q
```

Expected: no new failures against the 471 baseline.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/auth.py backend/tests/test_device_revocation.py
git commit -m "feat(auth): list and revoke individual sessions

Un-pairing a television previously meant account-wide revocation, which
signed every browser out too. A session on another account answers 404,
not 403 — whether an id exists is not the caller's business."
```

---

## Task 7: Frontend client and the 401 branch

**Files:**
- Create: `frontend/src/services/devices.ts`
- Modify: `frontend/src/services/api-client.ts`
- Test: `frontend/src/services/devices.test.ts` (create)

**Interfaces:**
- Produces: `devicesService.start()`, `.poll(deviceCode)`, `.approve(userCode, deviceName)`, `.list()`, `.revoke(sessionId)`, and the types `DeviceStart`, `DevicePollStatus`, `DeviceSession`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/services/devices.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { devicesService } from './devices';
import apiClient from './api-client';

vi.mock('./api-client', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

describe('devicesService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('start posts with no body and returns the payload', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { device_code: 'dc', user_code: 'BCDF-GHJK', verification_uri: 'http://x/link', expires_in: 600, interval: 2 },
    });
    const r = await devicesService.start();
    expect(apiClient.post).toHaveBeenCalledWith('/auth/device/start');
    expect(r.user_code).toBe('BCDF-GHJK');
  });

  it('poll sends the device_code in the BODY, never the path', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { status: 'pending' } });
    await devicesService.poll('secret-code');
    const [path, body] = (apiClient.post as ReturnType<typeof vi.fn>).mock.calls[0];
    // The error middleware logs request.url.path. A secret in a path is a secret in
    // the logs, which is why the backend takes it in a JSON body.
    expect(path).toBe('/auth/device/poll');
    expect(path).not.toContain('secret-code');
    expect(body).toEqual({ device_code: 'secret-code' });
  });

  it('poll opts out of the global 401 redirect', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { status: 'pending' } });
    await devicesService.poll('dc');
    const cfg = (apiClient.post as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(cfg?.__allow401).toBe(true);
  });

  it('approve normalizes nothing client-side — the server owns the alphabet', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { ok: true } });
    await devicesService.approve('bcdf-ghjk', 'Living Room TV');
    expect(apiClient.post).toHaveBeenCalledWith('/auth/device/approve', {
      user_code: 'bcdf-ghjk',
      device_name: 'Living Room TV',
    });
  });

  it('revoke deletes by id', async () => {
    (apiClient.delete as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { ok: true } });
    await devicesService.revoke('sess-1');
    expect(apiClient.delete).toHaveBeenCalledWith('/auth/devices/sess-1');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd frontend && npx vitest run src/services/devices.test.ts
```

Expected: cannot resolve `./devices`.

- [ ] **Step 3: Write the service**

Create `frontend/src/services/devices.ts`:

```ts
import apiClient from './api-client';

export interface DeviceStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export type DevicePollStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface DeviceSession {
  id: string;
  device_name: string | null;
  device_kind: string | null;
  created_at: string | null;
  last_seen_at: string | null;
  current: boolean;
}

export const devicesService = {
  async start(): Promise<DeviceStart> {
    const response = await apiClient.post<DeviceStart>('/auth/device/start');
    return response.data;
  },

  // The device_code travels in the BODY. middleware/error_handler.py logs
  // request.url.path to stdout and to a retained file, so a secret in a path is a
  // secret in the logs.
  async poll(deviceCode: string): Promise<DevicePollStatus> {
    const response = await apiClient.post<{ status: DevicePollStatus }>(
      '/auth/device/poll',
      { device_code: deviceCode },
      // The TV is unauthenticated until this call succeeds; a 401 here is the normal
      // state, not a reason to bounce the page.
      { __allow401: true },
    );
    return response.data.status;
  },

  async approve(userCode: string, deviceName: string): Promise<void> {
    await apiClient.post('/auth/device/approve', {
      user_code: userCode,
      device_name: deviceName,
    });
  },

  async list(): Promise<DeviceSession[]> {
    const response = await apiClient.get<DeviceSession[]>('/auth/devices');
    return response.data;
  },

  async revoke(sessionId: string): Promise<void> {
    await apiClient.delete(`/auth/devices/${sessionId}`);
  },
};
```

- [ ] **Step 4: Branch the 401 handler**

In `frontend/src/services/api-client.ts`, replace `handleUnauthorized`:

```ts
function handleUnauthorized(error: AxiosError): void {
  if (isServer || redirecting) return;
  if (error.config?.__allow401) return;
  const { pathname, search } = window.location;
  if (PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))) return;
  // The TV surface has its own front door. Sending it to /signin would land a remote
  // on an email-and-password form it cannot usefully fill in.
  if (pathname.startsWith('/bigscreen')) {
    if (pathname.startsWith('/bigscreen/pair')) return;
    redirecting = true;
    window.location.replace('/bigscreen/pair');
    return;
  }
  redirecting = true;
  window.location.replace(`/signin?next=${encodeURIComponent(`${pathname}${search}`)}`);
}
```

- [ ] **Step 5: Run the tests**

```bash
cd frontend && npx vitest run src/services && npx tsc --noEmit
```

Expected: PASS and clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/devices.ts frontend/src/services/devices.test.ts frontend/src/services/api-client.ts
git commit -m "feat(tv): device-pairing client, and route TV 401s to /bigscreen/pair

Sending the TV to /signin would land a remote on an email-and-password
form it cannot usefully fill in."
```

---

## Task 8: `/link` — the phone approval screen

**Files:**
- Create: `frontend/src/app/(web)/link/page.tsx`
- Test: `frontend/src/app/(web)/link/page.test.tsx` (create)

**Interfaces:**
- Consumes: `devicesService.approve`.
- Produces: the route `/link`, accepting `?code=XXXX-XXXX` to pre-fill.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/app/(web)/link/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LinkPage from './page';

vi.mock('@/services/devices', () => ({
  devicesService: { approve: vi.fn() },
}));
const mockSearchParams = { get: vi.fn() };
vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

import { devicesService } from '@/services/devices';

describe('/link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.get.mockReturnValue(null);
  });

  it('pre-fills the code from the query string', () => {
    mockSearchParams.get.mockReturnValue('BCDF-GHJK');
    render(<LinkPage />);
    expect((screen.getByLabelText(/code/i) as HTMLInputElement).value).toBe('BCDF-GHJK');
  });

  it('shows the code back for comparison before approving', () => {
    mockSearchParams.get.mockReturnValue('BCDF-GHJK');
    render(<LinkPage />);
    // The genuine risk is social engineering, so the screen must let the person
    // compare what they are approving against what the television shows.
    expect(screen.getByText(/BCDF-GHJK/)).toBeInTheDocument();
  });

  it('approves with the typed code and device name', async () => {
    (devicesService.approve as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<LinkPage />);
    await userEvent.type(screen.getByLabelText(/code/i), 'BCDF-GHJK');
    await userEvent.clear(screen.getByLabelText(/name/i));
    await userEvent.type(screen.getByLabelText(/name/i), 'Living Room TV');
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() =>
      expect(devicesService.approve).toHaveBeenCalledWith('BCDF-GHJK', 'Living Room TV'),
    );
  });

  it('reports a rejected code without saying whether it ever existed', async () => {
    (devicesService.approve as ReturnType<typeof vi.fn>).mockRejectedValue({
      response: { status: 404 },
    });
    render(<LinkPage />);
    await userEvent.type(screen.getByLabelText(/code/i), 'ZZZZ-ZZZZ');
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(await screen.findByText(/not valid/i)).toBeInTheDocument();
  });

  it('reports the throttle distinctly, because the person can act on it', async () => {
    (devicesService.approve as ReturnType<typeof vi.fn>).mockRejectedValue({
      response: { status: 429 },
    });
    render(<LinkPage />);
    await userEvent.type(screen.getByLabelText(/code/i), 'ZZZZ-ZZZZ');
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(await screen.findByText(/too many/i)).toBeInTheDocument();
  });

  it('confirms success', async () => {
    (devicesService.approve as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<LinkPage />);
    await userEvent.type(screen.getByLabelText(/code/i), 'BCDF-GHJK');
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(await screen.findByText(/paired/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails, then write the page**

```bash
cd frontend && npx vitest run 'src/app/(web)/link'
```

Create `frontend/src/app/(web)/link/page.tsx`. Follow the house pattern in
`(web)/signin/owner/page.tsx`: `'use client'`, a `Suspense` boundary around the
`useSearchParams` consumer, and the `AuthShell` / `AuthPanel` / `Field` / `Input` /
`Button` components from `@/components/ui/fre` and `@/components/auth`.

Requirements the tests pin:
- A **Code** field, pre-filled from `?code=`.
- A **Name this device** field, defaulting to `Television`.
- The code rendered **as text** as well as in the input, so the person can compare it
  with the screen across the room. This is the main mitigation against approving
  somebody else's device, so it must be visually prominent — not a placeholder.
- `404` → "That code is not valid or has expired." `429` → "Too many attempts. Wait a
  few minutes." Anything else → a generic failure.
- On success, a confirmation containing the word "paired" and the device name.

- [ ] **Step 3: Run the tests and typecheck**

```bash
cd frontend && npx vitest run 'src/app/(web)/link' && npx tsc --noEmit && npm run build
```

Expected: PASS, clean, and `/link` in the route list with every pre-existing route unchanged.

- [ ] **Step 4: Commit**

```bash
git add 'frontend/src/app/(web)/link'
git commit -m "feat(tv): /link, the phone approval screen

Shows the code back as prominent text, not just a pre-filled input: the
real risk in a device grant is approving somebody else's device, and
comparing against the screen across the room is the mitigation."
```

---

## Task 9: `/bigscreen/pair` — the TV screen

**Files:**
- Create: `frontend/src/app/(bigscreen)/bigscreen/pair/page.tsx`
- Modify: `frontend/public/bigscreen.css`
- Modify: `frontend/package.json` (add `qrcode`)
- Test: `frontend/src/app/(bigscreen)/bigscreen/pair/page.test.tsx` (create)

**Interfaces:**
- Consumes: `devicesService.start/poll`.
- Produces: the route `/bigscreen/pair`.

**QR decision.** A person standing at a television should not have to type a LAN URL
into a phone. Add the `qrcode` npm package and **`import()` it lazily inside the
component**, so it is code-split and a failure to load degrades to the text the page
already shows. The code and the URL are always rendered as text; the QR is an
enhancement, never the only route. Per `CLAUDE.md`, a new npm dep needs
`docker compose up -V` or a rebuild, or it stays invisible in the container and fails
with `MODULE_NOT_FOUND`.

- [ ] **Step 1: Add the dependency**

```bash
cd frontend && npm install qrcode && npm install --save-dev @types/qrcode
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/app/(bigscreen)/bigscreen/pair/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import PairPage from './page';

vi.mock('@/services/devices', () => ({
  devicesService: { start: vi.fn(), poll: vi.fn() },
}));
import { devicesService } from '@/services/devices';

const START = {
  device_code: 'dc-secret',
  user_code: 'BCDF-GHJK',
  verification_uri: 'http://192.168.1.9:3001/link',
  expires_in: 600,
  interval: 2,
};

describe('/bigscreen/pair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    (devicesService.start as ReturnType<typeof vi.fn>).mockResolvedValue(START);
    (devicesService.poll as ReturnType<typeof vi.fn>).mockResolvedValue('pending');
  });
  afterEach(() => vi.useRealTimers());

  it('shows the code large, and the URL as text', async () => {
    render(<PairPage />);
    expect(await screen.findByText('BCDF-GHJK')).toBeInTheDocument();
    // The QR is an enhancement; the URL must always be readable so a phone can get
    // there without a camera.
    expect(screen.getByText(/192\.168\.1\.9:3001\/link/)).toBeInTheDocument();
  });

  it('never renders the device_code on screen', async () => {
    const { container } = render(<PairPage />);
    await screen.findByText('BCDF-GHJK');
    expect(container.textContent).not.toContain('dc-secret');
  });

  it('polls at the interval the server asked for', async () => {
    render(<PairPage />);
    await screen.findByText('BCDF-GHJK');
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect((devicesService.poll as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(devicesService.poll).toHaveBeenCalledWith('dc-secret');
  });

  it('stops polling and reloads once approved', async () => {
    const replace = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, replace, origin: 'http://192.168.1.9:3001' },
      writable: true,
    });
    (devicesService.poll as ReturnType<typeof vi.fn>).mockResolvedValue('approved');
    render(<PairPage />);
    await screen.findByText('BCDF-GHJK');
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    await waitFor(() => expect(replace).toHaveBeenCalled());
  });

  it('restarts when the code expires rather than stranding the screen', async () => {
    (devicesService.poll as ReturnType<typeof vi.fn>).mockResolvedValue('expired');
    render(<PairPage />);
    await screen.findByText('BCDF-GHJK');
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    await waitFor(() =>
      expect((devicesService.start as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });

  it('shows a readable message if start fails', async () => {
    (devicesService.start as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    render(<PairPage />);
    expect(await screen.findByText(/can.t reach/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Write the page**

Create `frontend/src/app/(bigscreen)/bigscreen/pair/page.tsx`. Constraints:

- `'use client'`. **No** `@/components` import, no `framer-motion`, no `globals.css` —
  `npm run test:tv` enforces all three.
- Style with the `bs-` classes only.
- Render the **user code** at display size, the **verification URI** as text (built
  from `window.location.origin` so it matches whatever host the TV was pointed at),
  and the QR lazily:

```tsx
useEffect(() => {
  if (!start) return;
  let cancelled = false;
  // Lazily imported so the QR is code-split and its absence degrades to the text
  // above rather than breaking the screen.
  import('qrcode')
    .then((QR) => QR.toDataURL(linkUrl, { margin: 1, width: 360 }))
    .then((url) => { if (!cancelled) setQr(url); })
    .catch(() => { /* text URL is the fallback and is already on screen */ });
  return () => { cancelled = true; };
}, [start, linkUrl]);
```

- Poll on `start.interval` seconds with `setTimeout` chained from the previous
  response (not `setInterval`, which would stack requests if one is slow).
- `approved` → `window.location.replace('/bigscreen')`. The cookie is already set, and
  a hard navigation is required because `SessionProvider` boots once per document.
- `expired` → call `start()` again and show the new code, rather than stranding the
  screen on a code nobody can use.
- `denied` → a message plus a Try again control.
- A failure to reach the server → "Can't reach Freeflix" with the address being used.

- [ ] **Step 4: Add the styles**

Append to `frontend/public/bigscreen.css` — nothing from the forbidden list:

```css
/* --- pairing ---------------------------------------------------------- */
.bs-pair { max-width: 1400px; }
.bs-code {
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: 96px;
  letter-spacing: 12px;
  color: var(--gold);
  margin: 24px 0;
}
.bs-pair-url { font-size: 28px; color: var(--muted); word-break: break-all; }
.bs-qr {
  width: 360px;
  height: 360px;
  background: #fff;      /* a QR needs a light quiet zone to scan reliably */
  padding: 16px;
  border-radius: var(--radius);
}
.bs-pair-row { display: flex; gap: 48px; align-items: center; flex-wrap: wrap; }
```

- [ ] **Step 5: Run everything**

```bash
cd frontend && npx vitest run && npm run test:tv && npx tsc --noEmit && npm run build
```

Expected: full suite green against the 82-file / 898-test baseline plus the new files;
`test:tv` green; `/bigscreen/pair` in the route list with every pre-existing route
unchanged.

- [ ] **Step 6: Restart the container so the new dep is visible**

```bash
cd .. && docker compose up -d -V frontend && sleep 20
curl -s -o /dev/null -w '/bigscreen/pair -> %{http_code}\n' http://localhost:3001/bigscreen/pair
```

`/app/node_modules` is an anonymous volume in the dev override and survives an ordinary
`docker compose up`, so without `-V` the freshly installed `qrcode` stays invisible in
the container and the page fails with `MODULE_NOT_FOUND`.

- [ ] **Step 7: Commit**

```bash
git add 'frontend/src/app/(bigscreen)/bigscreen/pair' frontend/public/bigscreen.css \
  frontend/package.json frontend/package-lock.json
git commit -m "feat(tv): /bigscreen/pair, the television pairing screen

Code at display size, the URL always readable as text, and the QR lazily
imported so its absence degrades to that text rather than breaking the
screen. Polls with a chained setTimeout so a slow response cannot stack
requests, and restarts on expiry rather than stranding the screen."
```

---

## Two deliberate departures from the spec's wording

Both are noted here so a reviewer does not read them as misses.

- **§6.6 says "`PUBLIC_PATH_PREFIXES` gains `/bigscreen/pair`".** Task 7 instead adds a
  `/bigscreen` branch inside `handleUnauthorized`. A bare prefix entry would make every
  401 anywhere under `/bigscreen` silently do nothing, so a TV with a lapsed session
  would sit on a dead screen. The branch sends it to the pairing door and returns early
  only when it is already there, which is the behaviour the spec wanted.

- **§6.6's third bullet — "the TV player must distinguish 401 → re-pair from still
  buffering" — is NOT in this plan.** The TV player does not exist yet; it is stage 7,
  and the spec's §7.4 already carries the matching requirement about honouring the 503.
  Nothing here regresses it.

---

## Manual verification

With the branch running, on the TV:

1. Open `http://<host>:3001/bigscreen/pair`. A code appears, large, with the URL and a QR.
2. On a phone already signed in, open `/link` (or scan). The code is pre-filled; compare it with the screen.
3. Name the device and approve.
4. Within a couple of seconds the TV should move to `/bigscreen`, signed in.
5. In the web app, confirm the device is listed and can be revoked on its own, leaving your browser signed in.
