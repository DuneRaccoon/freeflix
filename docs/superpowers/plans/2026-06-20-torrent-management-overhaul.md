# Torrent / Download Management Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the downloads flow fully work end-to-end — Pause/Resume that sticks, Remove that actually deletes (with a keep-files vs delete-everything choice, preserving watch history), batch operations, and user-visible feedback.

**Architecture:** Unify Pause/Resume in the libtorrent manager (Pause unloads the torrent from the session and saves resume data; Resume re-adds it — fast via libtorrent-2.0 resume data, correct via on-disk recheck). Remove hard-deletes the torrent row; the watch-history FK becomes `ON DELETE SET NULL` so history survives. Add a `/torrents/batch` endpoint and wire toasts + batch controls into the React downloads view.

**Tech Stack:** Backend — FastAPI, libtorrent **2.0.11**, SQLAlchemy **1.4**, Pydantic v2, pytest (SQLite for tests). Frontend — Next.js 15 / React 19 / TypeScript, Tailwind v4, `react-hot-toast`, Vitest + Testing Library.

## Global Constraints

- **libtorrent is 2.0.11** — use the 2.0 buffer API: `lt.parse_magnet_uri(uri)`, `lt.read_resume_data(buf)`, `lt.write_resume_data_buf(alert.params)`, `session.add_torrent(atp)`. Do NOT use the deprecated `lt.add_magnet_uri` / `atp.resume_data = lt.bdecode(...)` / `alert.resume_data`.
- **SQLAlchemy 1.4 style** (not 2.0). The `get_db()` context-manager pattern is intentional — endpoints do `with db as session:`.
- **No Alembic.** Schema is created by `init_db()` → `create_all()` + additive `sync_columns()`. The FK change in this plan is NOT additive, so **the DB volume must be recreated**: `docker compose down -v && make up`. (User confirmed pre-launch; this is acceptable.)
- **Tests are baked into the image, not bind-mounted.** Run new/edited backend tests with an explicit mount:
  `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/<file> -v`
- **Backend test DB convention:** set `os.environ.setdefault("DB_PATH", "/tmp/<name>.db")` at the very top of each test file (before importing app modules) so the app uses a throwaway SQLite file instead of Postgres. SQLite does NOT enforce `ON DELETE` actions unless `PRAGMA foreign_keys=ON` — enable it via an `event.listen(engine, "connect", ...)` in cascade/manager tests.
- **content_id format unchanged** (`movie:{tmdb}` / `tv:{tmdb}:s{n}:e{n}`); watch history keyed by `movie_id` survives torrent removal.
- **Commit per task** using Conventional Commits (`feat:`/`fix:`/`refactor:`/`test:`). Work happens on branch `feat/torrent-management-overhaul`.
- **Canonical states** (use everywhere, no ad-hoc string sets):
  - `ACTIVE_DOWNLOAD_STATES = {queued, checking, downloading_metadata, downloading, allocating, checking_fastresume}`
  - `RESUMABLE_STATES = {paused, stopped}`
  - `TERMINAL_STATES = {finished, seeding, error}`

---

## File Structure

**Backend — create:**
- `backend/app/torrent/states.py` — canonical state groupings.
- `backend/app/torrent/storage.py` — `encode_resume_data`, `decode_resume_data`, `safe_rmtree`.
- `backend/tests/test_torrent_states.py`, `test_torrent_storage.py`, `test_torrent_remove_cascade.py`, `test_torrents_api.py`.

**Backend — modify:**
- `backend/app/database/models/streaming.py` — `torrent_id` FK → `SET NULL`, nullable.
- `backend/app/database/models/torrents.py` — relationship `passive_deletes`; `find_loadable_on_startup`.
- `backend/app/torrent/manager.py` — 2.0 resume-data, `_add_torrent`, pause/resume/remove, status-loop guard + periodic save, startup load, dedupe, drop `stop_torrent`/`time.sleep`.
- `backend/app/config.py` — `effective_max_active_downloads()`.
- `backend/app/models.py` — `TorrentAction` literal, `TorrentBatchAction`/`TorrentBatchResponse`, `ActivityCountResponse.max_active_downloads`.
- `backend/app/api/torrents.py` — `/action` narrowed; new `/batch`.
- `backend/app/api/activity.py` — return `max_active_downloads`.

**Frontend — create:**
- `frontend/src/components/ui/fre/RadioGroup.tsx` (+ export in `index.ts`) + `RadioGroup.test.tsx`.

**Frontend — modify:**
- `frontend/src/types/index.ts` — `TorrentAction`, batch types.
- `frontend/src/services/torrents.ts` — `performTorrentAction` typing + `batchAction`.
- `frontend/src/services/activity.ts` — `max_active_downloads`.
- `frontend/src/components/downloads/DownloadsView.tsx` — actions, modal, toasts, batch toolbar.
- `frontend/src/components/downloads/DownloadsView.test.tsx` — updated/added tests.

---

## Task 1: Canonical state vocabulary

**Files:**
- Create: `backend/app/torrent/states.py`
- Test: `backend/tests/test_torrent_states.py`

**Interfaces:**
- Produces: `ACTIVE_DOWNLOAD_STATES`, `RESUMABLE_STATES`, `TERMINAL_STATES` (all `frozenset[str]`), `PAUSED = "paused"`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_torrent_states.py
from app.torrent.states import (
    ACTIVE_DOWNLOAD_STATES, RESUMABLE_STATES, TERMINAL_STATES, PAUSED,
)


def test_active_download_states_membership():
    assert "downloading" in ACTIVE_DOWNLOAD_STATES
    assert "queued" in ACTIVE_DOWNLOAD_STATES
    assert "paused" not in ACTIVE_DOWNLOAD_STATES
    assert "finished" not in ACTIVE_DOWNLOAD_STATES


def test_resumable_states():
    assert RESUMABLE_STATES == frozenset({"paused", "stopped"})
    assert PAUSED == "paused"


def test_state_groups_are_disjoint():
    assert not (ACTIVE_DOWNLOAD_STATES & RESUMABLE_STATES)
    assert not (ACTIVE_DOWNLOAD_STATES & TERMINAL_STATES)
    assert not (RESUMABLE_STATES & TERMINAL_STATES)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_torrent_states.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.torrent.states'`.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/torrent/states.py
"""Canonical torrent state vocabulary, shared across manager / model / API."""

# Mid-download states: count toward the activity badge and auto-resume on startup.
ACTIVE_DOWNLOAD_STATES = frozenset({
    "queued", "checking", "downloading_metadata",
    "downloading", "allocating", "checking_fastresume",
})

# States a user can resume from.
RESUMABLE_STATES = frozenset({"paused", "stopped"})

# Done / dead states.
TERMINAL_STATES = frozenset({"finished", "seeding", "error"})

PAUSED = "paused"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_torrent_states.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/torrent/states.py backend/tests/test_torrent_states.py
git commit -m "feat(torrents): add canonical state vocabulary module"
```

---

## Task 2: Resume-data + safe-rmtree helpers

**Files:**
- Create: `backend/app/torrent/storage.py`
- Test: `backend/tests/test_torrent_storage.py`

**Interfaces:**
- Produces:
  - `encode_resume_data(buf: bytes) -> str` (base64 ASCII)
  - `decode_resume_data(s: str | bytes) -> bytes`
  - `safe_rmtree(path: str | Path, root: str | Path) -> bool` — removes `path` only if it's an existing dir strictly inside `root`; returns `True` if removed, else `False`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_torrent_storage.py
from pathlib import Path
from app.torrent.storage import encode_resume_data, decode_resume_data, safe_rmtree


def test_resume_data_roundtrip():
    original = b"\x00\x01libtorrent-resume\xff"
    encoded = encode_resume_data(original)
    assert isinstance(encoded, str)
    assert decode_resume_data(encoded) == original


def test_safe_rmtree_removes_subdir(tmp_path):
    root = tmp_path / "downloads"
    target = root / "Some Movie (2021)"
    target.mkdir(parents=True)
    (target / "movie.mkv").write_bytes(b"x")
    assert safe_rmtree(target, root) is True
    assert not target.exists()


def test_safe_rmtree_refuses_root_itself(tmp_path):
    root = tmp_path / "downloads"
    root.mkdir()
    assert safe_rmtree(root, root) is False
    assert root.exists()


def test_safe_rmtree_refuses_outside_root(tmp_path):
    root = tmp_path / "downloads"
    root.mkdir()
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    assert safe_rmtree(outside, root) is False
    assert outside.exists()


def test_safe_rmtree_missing_path_is_false(tmp_path):
    root = tmp_path / "downloads"
    root.mkdir()
    assert safe_rmtree(root / "nope", root) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_torrent_storage.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.torrent.storage'`.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/torrent/storage.py
"""Resume-data (de)serialization and a guarded recursive delete."""
import base64
import shutil
from pathlib import Path
from typing import Union

from loguru import logger


def encode_resume_data(buf: bytes) -> str:
    """Base64-encode libtorrent resume-data bytes for storage in a Text column."""
    return base64.b64encode(buf).decode("ascii")


def decode_resume_data(s: Union[str, bytes]) -> bytes:
    """Decode base64 resume-data back to raw bytes. Tolerates already-bytes input."""
    if isinstance(s, bytes):
        try:
            return base64.b64decode(s, validate=True)
        except Exception:
            return s
    return base64.b64decode(s)


def safe_rmtree(path: Union[str, Path], root: Union[str, Path]) -> bool:
    """
    Recursively delete ``path`` ONLY when it is an existing directory strictly
    inside ``root`` (and not equal to it). Returns True if removed, else False.
    Guards against ever deleting the download root or anything outside it.
    """
    try:
        target = Path(path).resolve()
        base = Path(root).resolve()
    except Exception as e:  # pragma: no cover - defensive
        logger.error(f"safe_rmtree: cannot resolve paths: {e}")
        return False

    if target == base:
        logger.warning(f"safe_rmtree refused: target equals download root ({target})")
        return False
    if base not in target.parents:
        logger.warning(f"safe_rmtree refused: {target} is not inside {base}")
        return False
    if not target.is_dir():
        logger.info(f"safe_rmtree: nothing to delete at {target}")
        return False

    shutil.rmtree(target)
    logger.info(f"safe_rmtree: removed {target}")
    return True
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_torrent_storage.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/torrent/storage.py backend/tests/test_torrent_storage.py
git commit -m "feat(torrents): add resume-data codec and guarded rmtree helper"
```

---

## Task 3: Watch-history FK → ON DELETE SET NULL (schema change)

**Files:**
- Modify: `backend/app/database/models/streaming.py:17`
- Modify: `backend/app/database/models/torrents.py:51`
- Test: `backend/tests/test_torrent_remove_cascade.py`

**Interfaces:**
- Produces: deleting a `Torrent` row leaves its `UserStreamingProgress` rows intact with `torrent_id = NULL`; `TorrentLog` rows still cascade-delete.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_torrent_remove_cascade.py
import os
os.environ.setdefault("DB_PATH", "/tmp/test_remove_cascade.db")

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.database.session import Base
# Import models so all tables register on Base.metadata
from app.database.models import Torrent as DbTorrent, TorrentLog  # noqa: F401
from app.database.models.users import User
from app.database.models.streaming import UserStreamingProgress


@pytest.fixture()
def session(tmp_path):
    db_file = tmp_path / "cascade.db"
    engine = create_engine(f"sqlite:///{db_file}", connect_args={"check_same_thread": False})

    # SQLite ignores ON DELETE actions unless foreign_keys pragma is on.
    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    s = Session()
    yield s
    s.close()
    engine.dispose()


def test_deleting_torrent_preserves_watch_history(session):
    user = User(username="u1", display_name="U One")
    session.add(user)
    torrent = DbTorrent(
        movie_title="Dune", quality="1080p", magnet="magnet:?xt=test",
        url="http://x/y.torrent", save_path="/tmp/dune", state="downloading",
    )
    session.add(torrent)
    session.flush()

    progress = UserStreamingProgress(
        user_id=user.id, torrent_id=torrent.id, movie_id="movie:438631",
        current_time=120.0, percentage=10.0,
    )
    log = TorrentLog(torrent_id=torrent.id, message="started", level="INFO")
    session.add_all([progress, log])
    session.commit()

    progress_id = progress.id

    # Hard-delete the torrent
    session.delete(torrent)
    session.commit()

    # Watch history survives, detached (torrent_id NULL); movie_id intact
    kept = session.get(UserStreamingProgress, progress_id)
    assert kept is not None
    assert kept.torrent_id is None
    assert kept.movie_id == "movie:438631"

    # Torrent logs cascade away
    assert session.query(TorrentLog).filter_by(torrent_id=torrent.id).count() == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_torrent_remove_cascade.py -v`
Expected: FAIL — the delete raises an IntegrityError or cascades the progress row away (`kept is None`), because the FK is currently `nullable=False, ondelete="CASCADE"` and the relationship is `delete-orphan`.

- [ ] **Step 3: Change the FK (streaming.py:17)**

Replace:
```python
    torrent_id = Column(String, ForeignKey("torrents.id", ondelete="CASCADE"), nullable=False, index=True)
```
with:
```python
    torrent_id = Column(String, ForeignKey("torrents.id", ondelete="SET NULL"), nullable=True, index=True)
```

- [ ] **Step 4: Change the relationship (torrents.py:51)**

Replace:
```python
    streaming_progress = relationship("UserStreamingProgress", back_populates="torrent", cascade="all, delete-orphan")
```
with:
```python
    streaming_progress = relationship("UserStreamingProgress", back_populates="torrent", passive_deletes=True)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_torrent_remove_cascade.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/database/models/streaming.py backend/app/database/models/torrents.py backend/tests/test_torrent_remove_cascade.py
git commit -m "feat(db): detach watch history on torrent delete (ON DELETE SET NULL)"
```

---

## Task 4: Startup-load predicate on the Torrent model

**Files:**
- Modify: `backend/app/database/models/torrents.py` (add classmethod near `find_active`, ~line 101)
- Test: `backend/tests/test_torrent_remove_cascade.py` (append; reuses the `session` fixture)

**Interfaces:**
- Produces: `Torrent.find_loadable_on_startup(db) -> List[Torrent]` — rows whose `state in ACTIVE_DOWNLOAD_STATES`.

- [ ] **Step 1: Write the failing test (append to test_torrent_remove_cascade.py)**

```python
def test_find_loadable_on_startup_only_active(session):
    rows = [
        DbTorrent(movie_title="a", quality="1080p", magnet="m", url="u", save_path="/p", state="downloading"),
        DbTorrent(movie_title="b", quality="1080p", magnet="m", url="u", save_path="/p", state="paused"),
        DbTorrent(movie_title="c", quality="1080p", magnet="m", url="u", save_path="/p", state="finished"),
        DbTorrent(movie_title="d", quality="1080p", magnet="m", url="u", save_path="/p", state="queued"),
    ]
    session.add_all(rows)
    session.commit()

    loadable = DbTorrent.find_loadable_on_startup(session)
    titles = sorted(t.movie_title for t in loadable)
    assert titles == ["a", "d"]  # downloading + queued only
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_torrent_remove_cascade.py::test_find_loadable_on_startup_only_active -v`
Expected: FAIL — `AttributeError: ... has no attribute 'find_loadable_on_startup'`.

- [ ] **Step 3: Add the classmethod (torrents.py, right after `find_active`)**

```python
    @classmethod
    def find_loadable_on_startup(cls, db: Session) -> List["Torrent"]:
        """Torrents to auto re-add to the libtorrent session on startup (were
        mid-download). Paused/stopped/finished/seeding/error stay unloaded."""
        from app.torrent.states import ACTIVE_DOWNLOAD_STATES
        return db.query(cls).filter(cls.state.in_(tuple(ACTIVE_DOWNLOAD_STATES))).all()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_torrent_remove_cascade.py -v`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/database/models/torrents.py backend/tests/test_torrent_remove_cascade.py
git commit -m "feat(db): add Torrent.find_loadable_on_startup predicate"
```

---

## Task 5: Manager — libtorrent 2.0 resume-data + `_add_torrent` rewrite

**Files:**
- Modify: `backend/app/torrent/manager.py` — imports, `_add_torrent` (112-154), save_resume_data alert (372-390)
- Test: `backend/tests/test_torrents_manager.py` (create)

**Interfaces:**
- Consumes: `app.torrent.storage.encode_resume_data/decode_resume_data`.
- Produces: `_add_torrent(torrent_id, magnet_uri, save_path, metadata, resume_data=None)` builds an `add_torrent_params` via `lt.read_resume_data` (when resume_data present, falling back to magnet on failure) or `lt.parse_magnet_uri`, sets `save_path`/`storage_mode`, calls `self.session.add_torrent(atp)`, enables sequential download, stores `(handle, metadata)` in `active_torrents`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_torrents_manager.py
import os
os.environ.setdefault("DB_PATH", "/tmp/test_torrents_manager.db")

import types
import pytest
import libtorrent as lt

from app.torrent.manager import torrent_manager
from app.torrent.storage import encode_resume_data


def _fake_atp():
    return types.SimpleNamespace(save_path=None, storage_mode=None)


def test_add_torrent_from_magnet(monkeypatch):
    torrent_manager.active_torrents.clear()
    calls = {}

    def fake_parse(uri):
        calls["uri"] = uri
        return _fake_atp()

    fake_handle = types.SimpleNamespace(set_sequential_download=lambda v: calls.setdefault("seq", v))
    monkeypatch.setattr(lt, "parse_magnet_uri", fake_parse)
    monkeypatch.setattr(torrent_manager.session, "add_torrent", lambda atp: fake_handle)

    handle = torrent_manager._add_torrent("t1", "magnet:?xt=urn:btih:abc", "/tmp/x", {"k": "v"})

    assert calls["uri"] == "magnet:?xt=urn:btih:abc"
    assert calls["seq"] is True
    assert torrent_manager.active_torrents["t1"] == (fake_handle, {"k": "v"})


def test_add_torrent_from_resume_data(monkeypatch):
    torrent_manager.active_torrents.clear()
    seen = {}

    def fake_read(buf):
        seen["buf"] = buf
        return _fake_atp()

    fake_handle = types.SimpleNamespace(set_sequential_download=lambda v: None)
    monkeypatch.setattr(lt, "read_resume_data", fake_read)
    monkeypatch.setattr(torrent_manager.session, "add_torrent", lambda atp: fake_handle)

    blob = encode_resume_data(b"resume-bytes")
    torrent_manager._add_torrent("t2", "magnet:?xt=urn:btih:abc", "/tmp/x", {}, resume_data=blob)

    assert seen["buf"] == b"resume-bytes"
    assert "t2" in torrent_manager.active_torrents
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_torrents_manager.py -v`
Expected: FAIL — current `_add_torrent` uses `lt.add_magnet_uri` and `atp.resume_data = lt.bdecode(...)`, so `test_add_torrent_from_resume_data` won't call `lt.read_resume_data` and `test_add_torrent_from_magnet` won't call `lt.parse_magnet_uri`.

- [ ] **Step 3: Add the storage import (top of manager.py, after existing imports ~line 17)**

```python
from app.torrent.storage import encode_resume_data, decode_resume_data, safe_rmtree
from app.torrent.states import ACTIVE_DOWNLOAD_STATES, RESUMABLE_STATES
```

- [ ] **Step 4: Replace `_add_torrent` (manager.py:112-154) with the 2.0 version**

```python
    def _add_torrent(self, torrent_id: str, magnet_uri: str, save_path: Path,
                    metadata: Dict[str, Any], resume_data: Optional[str] = None) -> lt.torrent_handle:
        """Add a torrent to the libtorrent session (libtorrent 2.0 API)."""
        try:
            atp = None
            if resume_data:
                try:
                    atp = lt.read_resume_data(decode_resume_data(resume_data))
                except Exception as e:
                    logger.warning(f"resume_data unusable for {torrent_id} ({e}); re-adding from magnet")
                    atp = None
            if atp is None:
                atp = lt.parse_magnet_uri(magnet_uri)

            atp.save_path = str(save_path)
            atp.storage_mode = lt.storage_mode_t.storage_mode_sparse

            handle = self.session.add_torrent(atp)
            handle.set_sequential_download(True)
            self.active_torrents[torrent_id] = (handle, metadata)
            return handle
        except Exception as e:
            logger.error(f"Error adding torrent {torrent_id}: {e}")
            raise
```

- [ ] **Step 5: Replace the save_resume_data alert handler (manager.py:372-390)**

```python
            elif isinstance(alert, lt.save_resume_data_alert):
                torrent_handle = alert.handle
                try:
                    buf = lt.write_resume_data_buf(alert.params)
                except Exception as e:
                    logger.error(f"write_resume_data_buf failed: {e}")
                    buf = None
                if buf is not None:
                    for torrent_id, (handle, _) in self.active_torrents.items():
                        if handle == torrent_handle:
                            with get_db() as db:
                                torrent = db.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
                                if torrent:
                                    torrent.resume_data = encode_resume_data(buf)
                                    db.commit()
                            break
```

- [ ] **Step 6: Run test to verify it passes**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_torrents_manager.py -v`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add backend/app/torrent/manager.py backend/tests/test_torrents_manager.py
git commit -m "fix(torrents): use libtorrent 2.0 resume-data + magnet API"
```

---

## Task 6: Manager — unify Pause/Resume

**Files:**
- Modify: `backend/app/torrent/manager.py` — `pause_torrent` (746-768), `resume_torrent` (770-829); delete `stop_torrent` (831-864)
- Test: `backend/tests/test_torrents_manager.py` (append)

**Interfaces:**
- Consumes: `_add_torrent` (Task 5), `RESUMABLE_STATES`.
- Produces: `pause_torrent(id) -> bool` (saves resume data, unloads from session, marks `paused`); `resume_torrent(id) -> bool` (re-adds via `_add_torrent`, marks `downloading`, clears error). `stop_torrent` removed.

**Test helper:** these tests monkeypatch the module-level `get_db` used inside the manager so the methods read/write a throwaway SQLite session.

- [ ] **Step 1: Write the failing tests (append to test_torrents_manager.py)**

```python
import types as _types
from contextlib import contextmanager
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database.session import Base
from app.database.models import Torrent as DbTorrent


@pytest.fixture()
def mgr_db(monkeypatch, tmp_path):
    """Point the manager's get_db at a throwaway SQLite session."""
    engine = create_engine(f"sqlite:///{tmp_path/'mgr.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)

    @contextmanager
    def fake_get_db():
        s = Session()
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()

    monkeypatch.setattr("app.torrent.manager.get_db", fake_get_db)
    return Session


def _seed(Session, **kw):
    s = Session()
    t = DbTorrent(movie_title="m", quality="1080p", magnet="magnet:?xt=test",
                  url="u", save_path=str(Path("/tmp/m")), **kw)
    s.add(t); s.commit(); s.refresh(t); tid = t.id; s.close()
    return tid


def test_pause_unloads_and_marks_paused(mgr_db, monkeypatch):
    tid = _seed(mgr_db, state="downloading")
    calls = {}
    handle = _types.SimpleNamespace(
        save_resume_data=lambda: calls.setdefault("saved", True),
        pause=lambda: calls.setdefault("paused", True),
    )
    torrent_manager.active_torrents[tid] = (handle, {})
    monkeypatch.setattr(torrent_manager.session, "remove_torrent", lambda h: calls.setdefault("removed", h))

    assert torrent_manager.pause_torrent(tid) is True
    assert calls.get("saved") and calls.get("paused") and calls.get("removed") is handle
    assert tid not in torrent_manager.active_torrents
    s = mgr_db(); assert s.get(DbTorrent, tid).state == "paused"; s.close()


def test_resume_readds_and_marks_downloading(mgr_db, monkeypatch):
    tid = _seed(mgr_db, state="paused", error_message="boom")
    torrent_manager.active_torrents.pop(tid, None)
    fake_handle = _types.SimpleNamespace(resume=lambda: None)
    added = {}

    def fake_add(torrent_id, magnet, save_path, meta, resume_data=None):
        added["id"] = torrent_id
        torrent_manager.active_torrents[torrent_id] = (fake_handle, meta)
        return fake_handle

    monkeypatch.setattr(torrent_manager, "_add_torrent", fake_add)

    assert torrent_manager.resume_torrent(tid) is True
    assert added["id"] == tid
    s = mgr_db(); row = s.get(DbTorrent, tid)
    assert row.state == "downloading" and row.error_message is None; s.close()


def test_stop_torrent_removed():
    assert not hasattr(torrent_manager, "stop_torrent")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_torrents_manager.py -k "pause or resume or stop_torrent_removed" -v`
Expected: FAIL — current pause leaves the torrent in `active_torrents` and doesn't call `remove_torrent`; resume doesn't clear `error_message`; `stop_torrent` still exists.

- [ ] **Step 3: Replace `pause_torrent` (manager.py:746-768)**

```python
    def pause_torrent(self, torrent_id: str) -> bool:
        """Pause a download: save resume data, unload from the session (freeing
        the slot), and mark it paused. Survives restart; resumable later."""
        found = False
        if torrent_id in self.active_torrents:
            handle, _ = self.active_torrents[torrent_id]
            try:
                handle.save_resume_data()
            except Exception:
                pass
            try:
                handle.pause()
            except Exception:
                pass
            try:
                self.session.remove_torrent(handle)
            except Exception as e:
                logger.warning(f"pause: remove_torrent failed for {torrent_id}: {e}")
            self.active_torrents.pop(torrent_id, None)
            found = True

        with get_db() as db:
            torrent = DbTorrent.get_by_id(db, torrent_id)
            if torrent:
                torrent.update(db, state="paused")
                torrent.add_log(db, message="Download paused", level="INFO", state="paused")
                found = True

        if found:
            logger.info(f"Paused torrent {torrent_id}")
        else:
            logger.warning(f"Pause: torrent {torrent_id} not found")
        return found
```

- [ ] **Step 4: Replace `resume_torrent` (manager.py:770-829)**

```python
    def resume_torrent(self, torrent_id: str) -> bool:
        """Resume a paused/stopped/errored torrent: re-add to the session (fast
        via resume data, correct via on-disk recheck) and continue downloading."""
        with get_db() as db:
            torrent = DbTorrent.get_by_id(db, torrent_id)
            if not torrent:
                logger.warning(f"Resume: torrent {torrent_id} not found")
                return False
            magnet = torrent.magnet
            save_path = Path(torrent.save_path)
            meta = torrent.meta_data or {}
            resume_blob = torrent.resume_data

        try:
            if torrent_id in self.active_torrents:
                handle, _ = self.active_torrents[torrent_id]
                handle.resume()
            else:
                handle = self._add_torrent(torrent_id, magnet, save_path, meta, resume_blob)
                handle.resume()
        except Exception as e:
            logger.error(f"Resume: failed to re-add torrent {torrent_id}: {e}")
            return False

        with get_db() as db:
            torrent = DbTorrent.get_by_id(db, torrent_id)
            if torrent:
                torrent.update(db, state="downloading", error_message=None)
                torrent.add_log(db, message="Download resumed", level="INFO", state="downloading")

        logger.info(f"Resumed torrent {torrent_id}")
        return True
```

- [ ] **Step 5: Delete `stop_torrent` (manager.py:831-864)** — remove the entire method.

- [ ] **Step 6: Run tests to verify they pass**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_torrents_manager.py -v`
Expected: PASS (all manager tests).

- [ ] **Step 7: Commit**

```bash
git add backend/app/torrent/manager.py backend/tests/test_torrents_manager.py
git commit -m "feat(torrents): unify pause/resume; pause unloads session, resume re-adds"
```

---

## Task 7: Manager — Remove that hard-deletes + deletes files

**Files:**
- Modify: `backend/app/torrent/manager.py` — `remove_torrent` (866-900)
- Test: `backend/tests/test_torrents_manager.py` (append)

**Interfaces:**
- Consumes: `safe_rmtree`, `settings.default_download_path`.
- Produces: `remove_torrent(id, delete_files=False) -> bool` — removes from session if loaded, hard-deletes the DB row, and `safe_rmtree`s the save_path only when `delete_files=True`.

- [ ] **Step 1: Write the failing tests (append to test_torrents_manager.py)**

```python
def test_remove_hard_deletes_row_keep_files(mgr_db, monkeypatch, tmp_path):
    root = tmp_path / "downloads"; sub = root / "movie"; sub.mkdir(parents=True)
    tid = _seed(mgr_db, state="finished")
    s = mgr_db(); s.get(DbTorrent, tid).save_path = str(sub); s.commit(); s.close()
    monkeypatch.setattr("app.torrent.manager.settings.default_download_path", root, raising=False)
    torrent_manager.active_torrents.pop(tid, None)

    assert torrent_manager.remove_torrent(tid, delete_files=False) is True
    s = mgr_db(); assert s.get(DbTorrent, tid) is None; s.close()
    assert sub.exists()  # files kept


def test_remove_delete_files_rmtrees(mgr_db, monkeypatch, tmp_path):
    root = tmp_path / "downloads"; sub = root / "movie"; sub.mkdir(parents=True)
    (sub / "f.mkv").write_bytes(b"x")
    tid = _seed(mgr_db, state="finished")
    s = mgr_db(); s.get(DbTorrent, tid).save_path = str(sub); s.commit(); s.close()
    monkeypatch.setattr("app.torrent.manager.settings.default_download_path", root, raising=False)
    torrent_manager.active_torrents.pop(tid, None)

    assert torrent_manager.remove_torrent(tid, delete_files=True) is True
    s = mgr_db(); assert s.get(DbTorrent, tid) is None; s.close()
    assert not sub.exists()  # files deleted


def test_remove_unloads_active_handle(mgr_db, monkeypatch):
    tid = _seed(mgr_db, state="downloading")
    handle = _types.SimpleNamespace()
    torrent_manager.active_torrents[tid] = (handle, {})
    removed = {}
    monkeypatch.setattr(torrent_manager.session, "remove_torrent", lambda h: removed.setdefault("h", h))

    assert torrent_manager.remove_torrent(tid, delete_files=False) is True
    assert removed["h"] is handle
    assert tid not in torrent_manager.active_torrents
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_torrents_manager.py -k remove -v`
Expected: FAIL — current `remove_torrent` with `delete_files=False` never deletes the row, and only soft-deletes when `delete_files=True`.

- [ ] **Step 3: Replace `remove_torrent` (manager.py:866-900)**

```python
    def remove_torrent(self, torrent_id: str, delete_files: bool = False) -> bool:
        """Remove a torrent: unload from the session, hard-delete the DB row
        (watch history is detached via ON DELETE SET NULL), and optionally
        delete the downloaded files."""
        try:
            removed = False
            if torrent_id in self.active_torrents:
                handle, _ = self.active_torrents[torrent_id]
                try:
                    self.session.remove_torrent(handle)
                except Exception as e:
                    logger.warning(f"remove: session.remove_torrent failed for {torrent_id}: {e}")
                self.active_torrents.pop(torrent_id, None)
                removed = True

            save_path = None
            with get_db() as db:
                torrent = DbTorrent.get_by_id(db, torrent_id)
                if torrent:
                    save_path = torrent.save_path
                    torrent.delete(db, hard_delete=True)
                    removed = True

            if delete_files and save_path:
                safe_rmtree(save_path, settings.default_download_path)

            logger.info(f"Removed torrent {torrent_id} (delete_files={delete_files})")
            return removed
        except Exception as e:
            logger.error(f"Error removing torrent {torrent_id}: {e}")
            return False
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_torrents_manager.py -k remove -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/torrent/manager.py backend/tests/test_torrents_manager.py
git commit -m "fix(torrents): remove hard-deletes row and optionally deletes files"
```

---

## Task 8: Manager — dedupe, startup load, refresh & status-loop guard

**Files:**
- Modify: `backend/app/torrent/manager.py` — delete the FIRST `get_torrent_status` (639-688) and FIRST `get_all_torrents` (691-744); `_load_saved_torrents` (76-100); `_refresh_active_torrents` (322-342); `_update_torrents_status` loop (175-210)

**Interfaces:**
- Produces: a single `get_torrent_status`/`get_all_torrents` (the `to_status()` versions at 902/935 remain); startup re-adds only `ACTIVE_DOWNLOAD_STATES`; the status loop never resurrects a `paused` torrent and periodically saves resume data.

This task is structural cleanup; verify by booting the app (Step 6) and re-running the full backend suite.

- [ ] **Step 1: Delete the duplicate methods**

Remove the FIRST definition of `get_torrent_status` (manager.py:639-688, the block starting `# Improved get_torrent_status method`) and the FIRST `get_all_torrents` (manager.py:691-744, `# Improved get_all_torrents method`). Keep the later `to_status()`-based definitions (currently 902-933 and 935-968).

- [ ] **Step 2: Update `_load_saved_torrents` (manager.py:76-100)**

Replace the body's query line:
```python
                active_torrents = DbTorrent.find_active(db)

                for torrent in active_torrents:
                    if torrent.state != 'error':
                        try:
```
with:
```python
                active_torrents = DbTorrent.find_loadable_on_startup(db)

                for torrent in active_torrents:
                        try:
```
(Drop the now-redundant `if torrent.state != 'error':` guard — the predicate already excludes error; keep the inner `try/except` and its body, re-indented one level left.)

- [ ] **Step 3: Update `_refresh_active_torrents` (manager.py:330-334)**

Replace:
```python
                active_ids = set(
                    row[0] for row in db.query(DbTorrent.id).filter(
                        ~DbTorrent.state.in_(['error', 'finished', 'stopped'])
                    ).all()
                )
```
with:
```python
                active_ids = set(
                    row[0] for row in db.query(DbTorrent.id).filter(
                        ~DbTorrent.state.in_(['error', 'finished', 'stopped', 'paused'])
                    ).all()
                )
```

- [ ] **Step 4: Add a paused-guard + periodic resume-save in the status loop (manager.py ~184-191)**

After the block that fetches the fresh torrent and before `torrent.state = state_str`:
```python
                            if not torrent:
                                logger.warning(f"Torrent {torrent_id} not found in database, but exists in active_torrents")
                                continue

                            # Never resurrect a paused torrent (defensive — paused
                            # torrents are normally unloaded from the session).
                            if torrent.state == 'paused':
                                continue

                            # Keep resume data fresh for fast pause/resume + crash recovery.
                            try:
                                if handle.need_save_resume_data():
                                    handle.save_resume_data()
                            except Exception:
                                pass

                            # Update basic state and progress
                            torrent.state = state_str
```

- [ ] **Step 5: Run the full backend suite**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/ -q`
Expected: PASS (no import errors from the deleted duplicates; existing tests still green).

- [ ] **Step 6: Boot smoke-check (import the app)**

Run: `docker compose run --rm backend python -c "import app.main; print('import OK')"`
Expected: prints `import OK` (the singleton constructs without error).

- [ ] **Step 7: Commit**

```bash
git add backend/app/torrent/manager.py
git commit -m "refactor(torrents): dedupe status methods, fix startup load and paused guard"
```

---

## Task 9: API models — actions, batch, activity field

**Files:**
- Modify: `backend/app/models.py` — `TorrentAction` (344-345), add batch models (after 345), `ActivityCountResponse` (511-514)
- Test: `backend/tests/test_schemas.py` (append) — or create `backend/tests/test_torrent_action_schema.py`

**Interfaces:**
- Produces:
  - `TorrentAction.action: Literal['pause','resume','stop']` (`stop` kept as a legacy alias).
  - `TorrentBatchAction { action: Literal['pause','resume','clear_completed','retry']; delete_files: bool = False }`
  - `TorrentBatchResult { id: str; success: bool }`
  - `TorrentBatchResponse { action: str; succeeded: int; failed: int; results: List[TorrentBatchResult] }`
  - `ActivityCountResponse.max_active_downloads: int`

- [ ] **Step 1: Write the failing test (create test_torrent_action_schema.py)**

```python
# backend/tests/test_torrent_action_schema.py
import pytest
from pydantic import ValidationError
from app.models import (
    TorrentAction, TorrentBatchAction, TorrentBatchResponse, ActivityCountResponse,
)


def test_action_rejects_remove():
    with pytest.raises(ValidationError):
        TorrentAction(action="remove")


def test_action_allows_pause_resume_stop():
    for a in ("pause", "resume", "stop"):
        assert TorrentAction(action=a).action == a


def test_batch_action_defaults_delete_files_false():
    b = TorrentBatchAction(action="resume")
    assert b.delete_files is False


def test_batch_response_shape():
    r = TorrentBatchResponse(action="pause", succeeded=1, failed=0,
                             results=[{"id": "t1", "success": True}])
    assert r.results[0].id == "t1"


def test_activity_response_has_max():
    r = ActivityCountResponse(active_downloads=0, aggregate_progress=0.0, max_active_downloads=2)
    assert r.max_active_downloads == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_torrent_action_schema.py -v`
Expected: FAIL — `TorrentAction(action="remove")` currently validates; `TorrentBatchAction` and `max_active_downloads` don't exist.

- [ ] **Step 3: Update `TorrentAction` (models.py:344-345)**

```python
class TorrentAction(BaseModel):
    # 'stop' is accepted as a legacy alias of 'pause'. Use DELETE to remove.
    action: Literal['pause', 'resume', 'stop']


class TorrentBatchAction(BaseModel):
    action: Literal['pause', 'resume', 'clear_completed', 'retry']
    delete_files: bool = False


class TorrentBatchResult(BaseModel):
    id: str
    success: bool


class TorrentBatchResponse(BaseModel):
    action: str
    succeeded: int
    failed: int
    results: List[TorrentBatchResult]
```

- [ ] **Step 4: Update `ActivityCountResponse` (models.py:511-514)**

```python
class ActivityCountResponse(BaseModel):
    """Active-download summary returned by GET /api/v1/activity/count."""
    active_downloads: int
    aggregate_progress: float  # 0.0–100.0, mean progress across active torrents
    max_active_downloads: int  # configured concurrent-download ceiling (ARM-capped)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_torrent_action_schema.py -v`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/tests/test_torrent_action_schema.py
git commit -m "feat(api): torrent action/batch schemas + activity max field"
```

---

## Task 10: API — `/action` narrowed + `/batch` endpoint

**Files:**
- Modify: `backend/app/api/torrents.py` — imports (10), `torrent_action` (134-158), add `batch_action`
- Test: `backend/tests/test_torrents_api.py` (create)

**Interfaces:**
- Consumes: `torrent_manager.{pause_torrent,resume_torrent,remove_torrent,get_all_torrents}`, `TorrentBatchAction`, `TorrentBatchResponse`, state groups.
- Produces: `POST /action/{id}` (pause/resume; stop→pause; anything else→400); `POST /batch`.

- [ ] **Step 1: Write the failing tests (create test_torrents_api.py)**

```python
# backend/tests/test_torrents_api.py
import os
os.environ.setdefault("DB_PATH", "/tmp/test_torrents_api.db")

import types
import pytest
from fastapi.testclient import TestClient

import app.api.torrents as torrents_api
from app.main import app


@pytest.fixture()
def client(monkeypatch):
    fake = types.SimpleNamespace(
        pause_calls=[], resume_calls=[], remove_calls=[], all=[],
    )
    fake.pause_torrent = lambda tid: (fake.pause_calls.append(tid) or True)
    fake.resume_torrent = lambda tid: (fake.resume_calls.append(tid) or True)
    fake.remove_torrent = lambda tid, delete_files=False: (
        fake.remove_calls.append((tid, delete_files)) or True
    )
    fake.get_all_torrents = lambda: fake.all
    monkeypatch.setattr(torrents_api, "torrent_manager", fake)
    with TestClient(app) as c:
        c.fake = fake
        yield c


def test_action_pause(client):
    r = client.post("/api/v1/torrents/action/t1", json={"action": "pause"})
    assert r.status_code == 200 and client.fake.pause_calls == ["t1"]


def test_action_stop_aliases_pause(client):
    r = client.post("/api/v1/torrents/action/t2", json={"action": "stop"})
    assert r.status_code == 200 and client.fake.pause_calls == ["t2"]


def test_action_resume(client):
    r = client.post("/api/v1/torrents/action/t3", json={"action": "resume"})
    assert r.status_code == 200 and client.fake.resume_calls == ["t3"]


def test_action_remove_rejected_422(client):
    r = client.post("/api/v1/torrents/action/t4", json={"action": "remove"})
    assert r.status_code == 422  # not in the Literal


def test_delete_passes_delete_files_flag(client):
    r = client.delete("/api/v1/torrents/t5", params={"delete_files": "true"})
    assert r.status_code == 200 and client.fake.remove_calls == [("t5", True)]


def test_batch_resume(client):
    client.fake.all = [
        types.SimpleNamespace(id="a", state=types.SimpleNamespace(value="paused")),
        types.SimpleNamespace(id="b", state=types.SimpleNamespace(value="downloading")),
    ]
    r = client.post("/api/v1/torrents/batch", json={"action": "resume"})
    assert r.status_code == 200
    data = r.json()
    assert data["succeeded"] == 1 and data["results"][0]["id"] == "a"
    assert client.fake.resume_calls == ["a"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_torrents_api.py -v`
Expected: FAIL — `stop` currently calls `stop_torrent` (now deleted → AttributeError/500); `/batch` route 404; `remove` returns 404 not 422 (it's still a valid Literal until Task 9, which this task assumes is done).

- [ ] **Step 3: Update imports (api/torrents.py:10)**

```python
from app.models import (
    TorrentRequest, TorrentStatus, TorrentAction,
    TorrentBatchAction, TorrentBatchResponse, TorrentBatchResult,
)
from app.torrent.states import ACTIVE_DOWNLOAD_STATES, RESUMABLE_STATES
```

- [ ] **Step 4: Replace `torrent_action` (api/torrents.py:134-158)**

```python
@router.post("/action/{torrent_id}", response_model=Dict[str, Any], summary="Perform action on torrent")
async def torrent_action(
    action: TorrentAction,
    torrent_id: str = Path(..., description="ID of the torrent")
):
    """Pause or resume a torrent. ('stop' is a legacy alias of pause; use DELETE to remove.)"""
    if action.action in ("pause", "stop"):
        success = torrent_manager.pause_torrent(torrent_id)
    elif action.action == "resume":
        success = torrent_manager.resume_torrent(torrent_id)
    else:  # pragma: no cover - guarded by the Literal
        raise HTTPException(status_code=400, detail=f"Unsupported action '{action.action}'")

    if not success:
        raise HTTPException(status_code=404, detail="Torrent not found or action failed")

    return {"success": True, "action": action.action, "torrent_id": torrent_id}


@router.post("/batch", response_model=TorrentBatchResponse, summary="Batch torrent action")
async def batch_action(payload: TorrentBatchAction):
    """Apply an action to every torrent matching the action's target set."""
    all_t = torrent_manager.get_all_torrents()
    results: List[TorrentBatchResult] = []

    def _run(ids, fn):
        for tid in ids:
            results.append(TorrentBatchResult(id=tid, success=bool(fn(tid))))

    if payload.action == "pause":
        _run([t.id for t in all_t if t.state.value in ACTIVE_DOWNLOAD_STATES],
             torrent_manager.pause_torrent)
    elif payload.action == "resume":
        _run([t.id for t in all_t if t.state.value in RESUMABLE_STATES],
             torrent_manager.resume_torrent)
    elif payload.action == "clear_completed":
        _run([t.id for t in all_t if t.state.value in ("finished", "seeding")],
             lambda tid: torrent_manager.remove_torrent(tid, delete_files=False))
    elif payload.action == "retry":
        _run([t.id for t in all_t if t.state.value == "error"],
             torrent_manager.resume_torrent)

    succeeded = sum(1 for r in results if r.success)
    return TorrentBatchResponse(
        action=payload.action, succeeded=succeeded,
        failed=len(results) - succeeded, results=results,
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_torrents_api.py -v`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/torrents.py backend/tests/test_torrents_api.py
git commit -m "feat(api): narrow /action to pause|resume and add /batch endpoint"
```

---

## Task 11: Activity — expose configured download cap

**Files:**
- Modify: `backend/app/config.py` — add `effective_max_active_downloads()`
- Modify: `backend/app/api/activity.py` — import settings; return `max_active_downloads`
- Test: `backend/tests/test_activity.py` (append)

**Interfaces:**
- Produces: `settings.effective_max_active_downloads() -> int` (ARM → min(cap, 2)); `GET /activity/count` includes `max_active_downloads`.

- [ ] **Step 1: Write the failing test (append to test_activity.py)**

```python
def test_count_includes_max_active_downloads(client):
    resp = client.get("/api/v1/activity/count")
    assert resp.status_code == 200
    data = resp.json()
    assert "max_active_downloads" in data
    assert isinstance(data["max_active_downloads"], int)
    assert data["max_active_downloads"] >= 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_activity.py::test_count_includes_max_active_downloads -v`
Expected: FAIL — `KeyError`/missing field (`max_active_downloads` not returned).

- [ ] **Step 3: Add the helper to `Settings` (config.py, inside the class near `max_active_downloads`)**

```python
    def effective_max_active_downloads(self) -> int:
        """Configured concurrent-download ceiling, capped to 2 on ARM (Raspberry Pi)."""
        import platform
        if "arm" in platform.machine().lower():
            return min(self.max_active_downloads, 2)
        return self.max_active_downloads
```

- [ ] **Step 4: Update `activity.py` to return the field**

Add the import (after the existing imports):
```python
from app.config import settings
```
Replace the `return` (activity.py:50-53):
```python
    return ActivityCountResponse(
        active_downloads=count,
        aggregate_progress=round(aggregate, 2),
        max_active_downloads=settings.effective_max_active_downloads(),
    )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_activity.py -v`
Expected: PASS (existing activity tests + the new one).

- [ ] **Step 6: Commit**

```bash
git add backend/app/config.py backend/app/api/activity.py backend/tests/test_activity.py
git commit -m "feat(activity): expose effective max_active_downloads in count response"
```

---

## Task 12: Frontend — types + service functions

**Files:**
- Modify: `frontend/src/types/index.ts:117` (and add batch types)
- Modify: `frontend/src/services/torrents.ts:32-35` (typing) + add `batchAction`
- Modify: `frontend/src/services/activity.ts:4-7`

**Interfaces:**
- Produces: `TorrentAction = 'pause' | 'resume'`; `TorrentBatchActionType`; `TorrentBatchResult`; `TorrentBatchResponse`; `torrentsService.batchAction(action, deleteFiles?)`; `ActivityCount.max_active_downloads`.

- [ ] **Step 1: Update `types/index.ts` (replace line 117)**

```typescript
export type TorrentAction = 'pause' | 'resume';

export type TorrentBatchActionType = 'pause' | 'resume' | 'clear_completed' | 'retry';

export interface TorrentBatchResult {
  id: string;
  success: boolean;
}

export interface TorrentBatchResponse {
  action: string;
  succeeded: number;
  failed: number;
  results: TorrentBatchResult[];
}
```

- [ ] **Step 2: Update `services/torrents.ts`**

Change the import (line 2):
```typescript
import { TorrentStatus, TorrentRequest, TorrentAction, TorrentBatchActionType, TorrentBatchResponse, CatalogTorrentRequest } from '@/types';
```
Replace `performTorrentAction` (lines 32-35) and add `batchAction` right after `deleteTorrent`:
```typescript
  // Perform action on torrent (pause | resume)
  performTorrentAction: async (torrentId: string, action: TorrentAction): Promise<any> => {
    const response = await apiClient.post(`/torrents/action/${torrentId}`, { action });
    return response.data;
  },
```
```typescript
  // Batch action across torrents (pause/resume all, clear completed, retry errored)
  batchAction: async (
    action: TorrentBatchActionType,
    deleteFiles = false,
  ): Promise<TorrentBatchResponse> => {
    const response = await apiClient.post(`/torrents/batch`, { action, delete_files: deleteFiles });
    return response.data;
  },
```

- [ ] **Step 3: Update `services/activity.ts` (lines 4-7)**

```typescript
export interface ActivityCount {
  active_downloads: number;
  aggregate_progress: number; // 0.0–100.0, mean progress across active torrents
  max_active_downloads: number; // configured concurrent-download ceiling
}
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (note: `DownloadsView.tsx` still calls `act('stop')` and passes `'stop'` — it will error here. That is fixed in Task 14. If running tasks strictly in order, expect a `'stop'` type error from DownloadsView and proceed; it is resolved in Task 14. To keep this task green in isolation, you may run `npx tsc --noEmit` after Task 14.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/torrents.ts frontend/src/services/activity.ts
git commit -m "feat(web): torrent action/batch types and batchAction service"
```

---

## Task 13: Frontend — RadioGroup primitive

**Files:**
- Create: `frontend/src/components/ui/fre/RadioGroup.tsx`
- Modify: `frontend/src/components/ui/fre/index.ts` (add export)
- Test: `frontend/src/components/ui/fre/RadioGroup.test.tsx`

**Interfaces:**
- Produces: `RadioGroup` with props `{ name: string; value: string; onChange: (v: string) => void; options: { value: string; label: string; hint?: string }[]; className?: string }`, rendered as `role="radiogroup"` with real `<input type="radio">` controls.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/ui/fre/RadioGroup.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RadioGroup } from './RadioGroup';

const opts = [
  { value: 'keep', label: 'Keep files' },
  { value: 'all', label: 'Delete everything' },
];

describe('RadioGroup', () => {
  it('renders all options and reflects the selected value', () => {
    render(<RadioGroup name="mode" value="keep" onChange={() => {}} options={opts} />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    const keep = screen.getByRole('radio', { name: 'Keep files' }) as HTMLInputElement;
    const all = screen.getByRole('radio', { name: 'Delete everything' }) as HTMLInputElement;
    expect(keep.checked).toBe(true);
    expect(all.checked).toBe(false);
  });

  it('calls onChange with the option value when clicked', async () => {
    const onChange = vi.fn();
    render(<RadioGroup name="mode" value="keep" onChange={onChange} options={opts} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Delete everything' }));
    expect(onChange).toHaveBeenCalledWith('all');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ui/fre/RadioGroup.test.tsx`
Expected: FAIL — cannot resolve `./RadioGroup`.

- [ ] **Step 3: Create `RadioGroup.tsx`**

```tsx
'use client';
import React from 'react';
import { cn } from '@/lib/cn';

export interface RadioOption {
  value: string;
  label: string;
  hint?: string;
}

export interface RadioGroupProps {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: RadioOption[];
  className?: string;
}

export const RadioGroup: React.FC<RadioGroupProps> = ({ name, value, onChange, options, className }) => (
  <div role="radiogroup" className={cn('flex flex-col gap-2', className)}>
    {options.map((opt) => {
      const selected = opt.value === value;
      const id = `${name}-${opt.value}`;
      return (
        <label
          key={opt.value}
          htmlFor={id}
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
            selected
              ? 'border-gold/60 bg-gold/10'
              : 'border-hairline bg-surface-2/60 hover:border-gold/40',
          )}
        >
          <input
            type="radio"
            id={id}
            name={name}
            value={opt.value}
            checked={selected}
            onChange={() => onChange(opt.value)}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className={cn(
              'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border',
              'peer-focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
              selected ? 'border-gold' : 'border-hairline',
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', selected ? 'bg-gold' : 'bg-transparent')} />
          </span>
          <span className="flex flex-col">
            <span className="font-ui text-sm text-text">{opt.label}</span>
            {opt.hint && <span className="font-ui text-xs text-muted">{opt.hint}</span>}
          </span>
        </label>
      );
    })}
  </div>
);

export default RadioGroup;
```

- [ ] **Step 4: Export from the barrel (`index.ts`)**

Add:
```typescript
export { RadioGroup } from './RadioGroup';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/ui/fre/RadioGroup.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/fre/RadioGroup.tsx frontend/src/components/ui/fre/RadioGroup.test.tsx frontend/src/components/ui/fre/index.ts
git commit -m "feat(web): add FRÈ RadioGroup primitive"
```

---

## Task 14: Frontend — DownloadsView (actions, modal, toasts, batch)

**Files:**
- Modify: `frontend/src/components/downloads/DownloadsView.tsx`
- Modify: `frontend/src/components/downloads/DownloadsView.test.tsx`

**Interfaces:**
- Consumes: `torrentsService.{performTorrentAction,deleteTorrent,batchAction,prioritizeForStreaming,listTorrents}`, `activityService.getCount`, `RadioGroup`, `toast` from `react-hot-toast`.

- [ ] **Step 1: Update the test mocks + add new tests (DownloadsView.test.tsx)**

Add to the mock block (after the existing `vi.mock('@/services/torrents', ...)`):
```tsx
const mockBatchAction = vi.fn();
// extend the torrents service mock to include batchAction:
//   batchAction: (...args: unknown[]) => mockBatchAction(...args),

const mockGetCount = vi.fn();
vi.mock('@/services/activity', () => ({
  activityService: { getCount: (...a: unknown[]) => mockGetCount(...a) },
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  toast: { success: (...a: unknown[]) => mockToastSuccess(...a), error: (...a: unknown[]) => mockToastError(...a) },
}));
```
Update the torrents mock object to include `batchAction: (...args: unknown[]) => mockBatchAction(...args)`.
In `beforeEach`, add:
```tsx
  mockBatchAction.mockResolvedValue({ action: 'pause', succeeded: 0, failed: 0, results: [] });
  mockGetCount.mockResolvedValue({ active_downloads: 0, aggregate_progress: 0, max_active_downloads: 2 });
```
Add new tests:
```tsx
  it('shows a Resume button for a stopped torrent', async () => {
    mockListTorrents.mockResolvedValue([makeTorrent({ id: 's1', state: TorrentState.STOPPED })]);
    render(<DownloadsView />);
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it('does not show a Stop button', async () => {
    mockListTorrents.mockResolvedValue([makeTorrent({ id: 'd1', state: TorrentState.DOWNLOADING })]);
    render(<DownloadsView />);
    await screen.findByRole('button', { name: 'Pause' });
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('remove with "Delete everything" calls deleteTorrent(id, true)', async () => {
    mockListTorrents.mockResolvedValue([makeTorrent({ id: 'r9', movie_title: 'Bye' })]);
    render(<DownloadsView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm removal' });
    await userEvent.click(within(dialog).getByRole('radio', { name: /Delete everything/i }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm remove' }));
    expect(mockDeleteTorrent).toHaveBeenCalledWith('r9', true);
  });

  it('Pause all calls batchAction("pause")', async () => {
    mockListTorrents.mockResolvedValue([makeTorrent({ id: 'a', state: TorrentState.DOWNLOADING })]);
    render(<DownloadsView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Pause all' }));
    expect(mockBatchAction).toHaveBeenCalledWith('pause');
  });

  it('shows an error toast when an action fails', async () => {
    mockListTorrents.mockResolvedValue([makeTorrent({ id: 'p1', state: TorrentState.DOWNLOADING })]);
    mockPerformTorrentAction.mockRejectedValueOnce(new Error('boom'));
    render(<DownloadsView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
  });
```
Keep the existing `remove (confirmed) calls deleteTorrent(id, false)` test — the modal defaults to "keep files" (`false`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/downloads/DownloadsView.test.tsx`
Expected: FAIL — no `Resume` for stopped, `Stop` still present, no radio in modal, no `Pause all`, no toast on error.

- [ ] **Step 3: Update imports in DownloadsView.tsx (lines 1-7)**

```tsx
'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { TorrentState, TorrentStatus, TorrentBatchActionType } from '@/types';
import { torrentsService } from '@/services/torrents';
import { activityService } from '@/services/activity';
import { Badge, Button, Modal, Pill, Progress, RadioGroup } from '@/components/ui/fre';
import { cn } from '@/lib/cn';
```

- [ ] **Step 4: Rewrite the `TorrentRow` action handlers + flags (lines 95-139)**

```tsx
const TorrentRow: React.FC<TorrentRowProps> = ({ torrent, onRefresh }) => {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteMode, setDeleteMode] = useState<'keep' | 'all'>('keep');

  const act = async (action: 'pause' | 'resume') => {
    setBusy(true);
    try {
      await torrentsService.performTorrentAction(torrent.id, action);
      toast.success(action === 'pause' ? 'Download paused' : 'Download resumed');
    } catch {
      toast.error(`Could not ${action} download`);
    } finally {
      setBusy(false);
      onRefresh();
    }
  };

  const remove = async () => {
    setBusy(true);
    setConfirmDelete(false);
    const deleteFiles = deleteMode === 'all';
    try {
      await torrentsService.deleteTorrent(torrent.id, deleteFiles);
      toast.success(deleteFiles ? 'Removed and deleted files' : 'Removed from downloads');
    } catch {
      toast.error('Could not remove download');
    } finally {
      setBusy(false);
      onRefresh();
    }
  };

  const watch = async () => {
    setBusy(true);
    try {
      await torrentsService.prioritizeForStreaming(torrent.id);
      router.push(`/streaming/${torrent.id}`);
    } catch {
      setBusy(false);
    }
  };

  const canWatch =
    torrent.state === TorrentState.DOWNLOADING ||
    torrent.state === TorrentState.DOWNLOADING_METADATA ||
    torrent.state === TorrentState.FINISHED ||
    torrent.state === TorrentState.SEEDING;

  const canPause =
    torrent.state === TorrentState.DOWNLOADING ||
    torrent.state === TorrentState.DOWNLOADING_METADATA ||
    torrent.state === TorrentState.QUEUED ||
    torrent.state === TorrentState.CHECKING ||
    torrent.state === TorrentState.ALLOCATING ||
    torrent.state === TorrentState.SEEDING;

  const canResume =
    torrent.state === TorrentState.PAUSED ||
    torrent.state === TorrentState.STOPPED;
```

- [ ] **Step 5: Replace the Stop button + remove modal in the JSX**

Delete the entire `{canStop && (...)}` Stop `<Button>` block (lines 229-239).
Replace the delete-confirmation `<Modal>` body (lines 253-270) with:
```tsx
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        label="Confirm removal"
      >
        <p className="font-ui text-sm text-text mb-4">
          Remove <strong className="text-gold-lite">{torrent.movie_title}</strong> from downloads?
        </p>
        <RadioGroup
          name={`remove-${torrent.id}`}
          value={deleteMode}
          onChange={(v) => setDeleteMode(v as 'keep' | 'all')}
          options={[
            { value: 'keep', label: 'Remove from list', hint: 'Keep the downloaded files on disk' },
            { value: 'all', label: 'Delete everything', hint: 'Delete files and the download record' },
          ]}
          className="mb-5"
        />
        <div className="flex gap-3 justify-end">
          <Button size="sm" variant="glass" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" onClick={remove} aria-label="Confirm remove">
            Remove
          </Button>
        </div>
      </Modal>
```

- [ ] **Step 6: Add the batch toolbar + max-aware count in `DownloadsView` (lines 281-344)**

Add state + a batch handler inside `DownloadsView`, after the existing `pollingRef` setup:
```tsx
  const [maxActive, setMaxActive] = useState(2);

  useEffect(() => {
    activityService.getCount()
      .then((c) => setMaxActive(c.max_active_downloads ?? 2))
      .catch(() => {});
  }, []);

  const runBatch = async (action: TorrentBatchActionType, label: string) => {
    try {
      const res = await torrentsService.batchAction(action);
      toast.success(`${label}: ${res.succeeded} done${res.failed ? `, ${res.failed} failed` : ''}`);
    } catch {
      toast.error(`${label} failed`);
    } finally {
      fetch();
    }
  };

  const hasActive = torrents.some((t) => ACTIVE_STATES.has(t.state));
  const hasPaused = torrents.some(
    (t) => t.state === TorrentState.PAUSED || t.state === TorrentState.STOPPED,
  );
  const hasCompleted = torrents.some(
    (t) => t.state === TorrentState.FINISHED || t.state === TorrentState.SEEDING,
  );
  const hasErrored = torrents.some((t) => t.state === TorrentState.ERROR);
```
Change the active-count line (line 325) from `Active {activeCount} / 2` to:
```tsx
              Active {activeCount} / {maxActive}
```
Add the toolbar just below the filter pills block (after line 357, before the List):
```tsx
        {/* Batch actions */}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Batch actions">
          <Button size="sm" variant="glass" disabled={!hasActive}
            onClick={() => runBatch('pause', 'Paused all')}>Pause all</Button>
          <Button size="sm" variant="glass" disabled={!hasPaused}
            onClick={() => runBatch('resume', 'Resumed all')}>Resume all</Button>
          <Button size="sm" variant="ghost" disabled={!hasCompleted}
            onClick={() => runBatch('clear_completed', 'Cleared completed')}>Clear completed</Button>
          <Button size="sm" variant="ghost" disabled={!hasErrored}
            onClick={() => runBatch('retry', 'Retried errored')}>Retry errored</Button>
        </div>
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/downloads/DownloadsView.test.tsx`
Expected: PASS (original + new tests).

- [ ] **Step 8: Typecheck the whole frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (the `'stop'` reference is gone).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/downloads/DownloadsView.tsx frontend/src/components/downloads/DownloadsView.test.tsx
git commit -m "feat(web): unified pause/resume, two-choice remove, batch ops, toasts"
```

---

## Task 15: Integration verification (volume recreate + live smoke)

**Files:** none (verification only).

- [ ] **Step 1: Recreate the DB volume and bring the stack up**

Run: `docker compose down -v && make up d=1`
Expected: backend boots; logs show `Database initialized` and `Torrent manager started successfully` with no FK/import errors.

- [ ] **Step 2: Run the full backend test suite**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/ -q`
Expected: all green.

- [ ] **Step 3: Run the full frontend test suite + typecheck**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 4: Live smoke — pause/resume/remove via the API**

Start a download (replace TMDB id with a real one), then exercise the lifecycle:
```bash
# start
curl -s -X POST localhost:8000/api/v1/torrents/download \
  -H 'content-type: application/json' \
  -d '{"tmdb_id": 27205, "quality": "1080p", "media_type": "movie"}' | python -m json.tool
# capture the returned id as TID, then:
curl -s -X POST localhost:8000/api/v1/torrents/action/$TID -H 'content-type: application/json' -d '{"action":"pause"}'
curl -s localhost:8000/api/v1/torrents/list | python -m json.tool   # state == "paused", persists across polls
curl -s -X POST localhost:8000/api/v1/torrents/action/$TID -H 'content-type: application/json' -d '{"action":"resume"}'
curl -s localhost:8000/api/v1/torrents/list | python -m json.tool   # state back to downloading
curl -s -X DELETE "localhost:8000/api/v1/torrents/$TID?delete_files=true"
curl -s localhost:8000/api/v1/torrents/list | python -m json.tool   # row gone
```
Expected: pause sticks (no flip back), resume continues, delete removes the row AND the files; `GET /activity/count` includes `max_active_downloads`.

- [ ] **Step 5: Live smoke — the UI**

Open `http://localhost:3001/downloads`. Verify: Pause then Resume on a download (no dead-end); Remove shows the two-choice dialog and both options work with toasts; the batch toolbar buttons enable/disable correctly and show result toasts; the header reads `Active N / M`.

- [ ] **Step 6: Final commit (if any verification fixups were needed)**

```bash
git add -A && git commit -m "test(torrents): integration verification fixups" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- Pause unloads + saves resume data → Task 6. Resume from paused/stopped → Task 6. Status-loop paused guard + periodic save → Task 8. ✅
- libtorrent 2.0 resume-data (base64 in Text) + magnet API → Tasks 2, 5. ✅
- Remove hard-deletes + keep/delete-files choice + path guard → Tasks 2, 7, 14. Watch history preserved via FK SET NULL → Task 3. ✅
- Dedupe duplicate methods, drop `time.sleep`/`stop_torrent`, startup load, `_refresh_active_torrents` → Tasks 6, 8. ✅
- `/action` narrowed, `/batch` endpoint, schemas → Tasks 9, 10. Batch ops (pause/resume/clear/retry) → Tasks 10, 14. ✅
- Activity `max_active_downloads` (+ honest "Active N / M") → Tasks 11, 14. ✅
- Toasts on every action → Task 14 (uses existing `react-hot-toast`). ✅
- Two-choice remove modal via new RadioGroup → Tasks 13, 14. ✅
- DB volume recreate documented → Global Constraints + Task 15. ✅

**Placeholder scan:** No TBD/TODO; every code step has concrete code; every test step has runnable assertions. ✅

**Type consistency:** `pause_torrent`/`resume_torrent`/`remove_torrent(id, delete_files)` signatures match across manager (Tasks 6-7), API (Task 10), and tests. `TorrentBatchResponse {action, succeeded, failed, results[]}` identical in models (Task 9), API (Task 10), and TS types (Task 12). `batchAction(action, deleteFiles?)` matches between service (Task 12) and view (Task 14). State group names (`ACTIVE_DOWNLOAD_STATES`, `RESUMABLE_STATES`) consistent across Tasks 1, 4, 5, 6, 10. ✅
