# Torrent Content Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block malicious/fake torrents (executables, no-playable-video, fake patterns) at the metadata checkpoint before their content downloads, and never stream them.

**Architecture:** A pure classifier (`content_guard.py`) decides block/allow from a `(path, size)` file list. The `TorrentManager` calls it in the `metadata_received_alert` handler (the first point the file list is known, before bulk download); on a block it removes the torrent from the libtorrent session, deletes partial files, and persists `state='blocked'` + `block_reason`. Non-video files are skipped (priority 0). The streaming page renders a dedicated "Blocked for safety" screen. One env-overridable kill switch gates the whole feature.

**Tech Stack:** Python 3.10, FastAPI, libtorrent 2.0, SQLAlchemy 1.4, pydantic-settings; Next.js 15 / React 19 / TypeScript frontend.

## Global Constraints

- **SQLAlchemy 1.4** style (not 2.0).
- **No Alembic.** New columns must be **nullable** ORM columns; `sync_columns()` auto-adds them on startup. Never write a migration.
- **Kill switch:** `content_guard_enabled` defaults `True`. When `False`, behavior is **identical to today**: no validation, no blocking, no non-video skip.
- **Block reason strings** are produced by the classifier and stored verbatim in `block_reason`; the frontend displays them as-is (no hardcoded matching). Tests assert on substrings, not exact strings.
- **Default extension lists are exact** (copied verbatim below).
- **Conventional Commits** (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`).
- **Tests are baked into the image, not bind-mounted.** Run new/edited test files with an explicit mount:
  `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/<file> -v`
- Frontend typecheck: `cd frontend && npx tsc --noEmit`.

### Canonical values (used across multiple tasks — keep identical)

**`blocked_extensions`** (set of lowercased extensions, leading dot):
```
.exe .scr .com .bat .cmd .msi .apk .jar .vbs .vbe .js .wsf .ps1 .lnk .dll .sys
.reg .hta .cpl .gadget .sh .run .deb .rpm .pkg .dmg .iso .bin
```

**`video_extensions`** (set of lowercased extensions, leading dot):
```
.mp4 .mkv .avi .mov .webm .ogv .wmv .flv .m4v .mpg .mpeg .ts .m2ts .vob .3gp .mts
```

**Block reason strings** (produced by `classify_torrent_files`):
- Rule 1: `"Contains an executable file ({name}) — blocked for safety."`
- Rule 2: `"No playable video file found — likely a fake or archive-only release."`
- Rule 3: `"Matches a known fake-torrent pattern — blocked for safety."`

---

### Task 1: Config settings (kill switch + extension lists)

**Files:**
- Modify: `backend/app/config.py` (add 4 fields to `Settings`, after `healthy_seeds` / near the other torrent settings)
- Test: `backend/tests/test_content_guard_config.py` (create)

**Interfaces:**
- Produces: `settings.content_guard_enabled: bool`, `settings.blocked_extensions: set[str]`, `settings.video_extensions: set[str]`, `settings.fake_torrent_heuristics: bool` — consumed by Tasks 2/4/5/6.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_content_guard_config.py`:
```python
"""Content-guard settings: kill switch + extension lists with sane defaults."""
from app.config import settings, Settings


def test_guard_enabled_by_default():
    assert Settings().content_guard_enabled is True


def test_default_extension_lists():
    s = Settings()
    # executables are blocked; common video containers are allowed
    assert ".exe" in s.blocked_extensions
    assert ".iso" in s.blocked_extensions and ".bin" in s.blocked_extensions
    assert {".mp4", ".mkv", ".m4v", ".ts"} <= s.video_extensions
    # no overlap between the two lists
    assert not (s.blocked_extensions & s.video_extensions)


def test_fake_heuristics_off_by_default():
    assert Settings().fake_torrent_heuristics is False


def test_extensions_are_lowercased_with_dot():
    s = Settings()
    for ext in s.blocked_extensions | s.video_extensions:
        assert ext.startswith(".") and ext == ext.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_content_guard_config.py -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'content_guard_enabled'`.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/config.py`, add inside the `Settings` class (after the `min_seeds` / `healthy_seeds` block at line ~91, before `lt_auto_managed_queue`):
```python
    # --- Content guard (heuristic malware / fake-torrent block) ---
    # Master kill switch. When False, NO validation, blocking, or non-video skip
    # happens — behavior is identical to before the guard existed.
    content_guard_enabled: bool = True
    # Extensions (lowercased, leading dot) that hard-block a torrent if any file matches.
    blocked_extensions: set[str] = {
        ".exe", ".scr", ".com", ".bat", ".cmd", ".msi", ".apk", ".jar", ".vbs",
        ".vbe", ".js", ".wsf", ".ps1", ".lnk", ".dll", ".sys", ".reg", ".hta",
        ".cpl", ".gadget", ".sh", ".run", ".deb", ".rpm", ".pkg", ".dmg", ".iso", ".bin",
    }
    # Extensions counted as playable video (a torrent with none of these is blocked).
    video_extensions: set[str] = {
        ".mp4", ".mkv", ".avi", ".mov", ".webm", ".ogv", ".wmv", ".flv", ".m4v",
        ".mpg", ".mpeg", ".ts", ".m2ts", ".vob", ".3gp", ".mts",
    }
    # Enables the optional structural fake-torrent heuristic (rule 3). Default off
    # to minimize false positives.
    fake_torrent_heuristics: bool = False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_content_guard_config.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/config.py backend/tests/test_content_guard_config.py
git commit -m "feat(config): content-guard settings (kill switch + extension lists)"
```

---

### Task 2: Pure classifier (`content_guard.py`)

**Files:**
- Create: `backend/app/torrent/content_guard.py`
- Test: `backend/tests/test_content_guard.py` (create)

**Interfaces:**
- Produces:
  - `file_ext(path: str) -> str` — lowercased extension incl. dot (`''` if none).
  - `is_video_file(path: str, video_extensions: Iterable[str]) -> bool`.
  - `classify_torrent_files(files: Iterable[tuple[str, int]], *, blocked_extensions, video_extensions, fake_heuristics: bool = False) -> Optional[str]` — returns a block reason or `None`.
- Consumes: extension sets from `settings` (passed by callers in Tasks 4/6).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_content_guard.py`:
```python
"""Pure content-guard classifier: block executables / no-video / fake patterns."""
from app.torrent.content_guard import classify_torrent_files, is_video_file, file_ext

BLOCKED = {".exe", ".iso", ".bin", ".msi", ".dll"}
VIDEO = {".mp4", ".mkv", ".m4v", ".ts"}


def classify(files, fake=False):
    return classify_torrent_files(
        files, blocked_extensions=BLOCKED, video_extensions=VIDEO, fake_heuristics=fake
    )


def test_single_exe_blocked():
    reason = classify([("Setup.exe", 1_000_000)])
    assert reason and "executable" in reason.lower()


def test_video_plus_exe_blocked_by_rule1():
    reason = classify([("movie.mkv", 2_000_000_000), ("codec.exe", 500_000)])
    assert reason and "executable" in reason.lower()


def test_archive_only_blocked_no_video():
    reason = classify([("movie.rar", 2_000_000_000), ("movie.r01", 1_000_000)])
    assert reason and "no playable video" in reason.lower()


def test_document_only_blocked_no_video():
    reason = classify([("readme.txt", 500), ("poster.jpg", 50_000)])
    assert reason and "no playable video" in reason.lower()


def test_video_with_subs_and_nfo_allowed():
    assert classify([
        ("The.Movie.2026.1080p.mkv", 2_000_000_000),
        ("The.Movie.2026.1080p.srt", 80_000),
        ("info.nfo", 1_200),
    ]) is None


def test_expanded_extensions_allowed():
    assert classify([("ep.m4v", 1_000_000_000)]) is None
    assert classify([("ep.ts", 1_000_000_000)]) is None


def test_structural_fake_blocked_only_when_enabled():
    files = [
        ("Movie.mp4", 800_000),                 # tiny "video"
        ("Movie_FULL.bin", 2_000_000_000),      # huge non-video (largest)
        ("password.txt", 300),                  # fake companion
    ]
    # rule 1/2 don't catch it (.bin IS blocked here though) -> use a non-blocked big file
    files = [
        ("Movie.mp4", 800_000),
        ("Movie_FULL.dat", 2_000_000_000),      # .dat not blocked, not video
        ("password.txt", 300),
    ]
    assert classify(files, fake=False) is None
    reason = classify(files, fake=True)
    assert reason and "fake" in reason.lower()


def test_helpers():
    assert file_ext("A/B/c.MKV") == ".mkv"
    assert file_ext("noext") == ""
    assert is_video_file("x.mp4", VIDEO) is True
    assert is_video_file("x.exe", VIDEO) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_content_guard.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.torrent.content_guard'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/app/torrent/content_guard.py`:
```python
"""Heuristic torrent content guard — pure classification, no libtorrent.

Given a torrent's file list (path, size), decide whether it should be BLOCKED
before its content downloads. Returns a human-readable reason, or None if allowed.
Rules (first hard-fail wins):
  1. any file with a blocked (executable/installer/script/disc-image) extension
  2. no streamable video file at all
  3. (opt-in) a fake-torrent structural pattern
"""
import re
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

_FAKE_COMPANION_RE = re.compile(r"password|how ?to|read ?me|install", re.IGNORECASE)
_FAKE_COMPANION_EXTS = {".txt", ".nfo", ".html", ".htm", ".url"}


def file_ext(path: str) -> str:
    """Lowercased file extension including the leading dot ('' if none)."""
    return Path(path).suffix.lower()


def is_video_file(path: str, video_extensions: Iterable[str]) -> bool:
    """True if `path`'s extension is in `video_extensions` (each like '.mp4')."""
    return file_ext(path) in set(video_extensions)


def classify_torrent_files(
    files: Iterable[Tuple[str, int]],
    *,
    blocked_extensions: Iterable[str],
    video_extensions: Iterable[str],
    fake_heuristics: bool = False,
) -> Optional[str]:
    """Return a block reason, or None if the torrent is allowed.

    `files` is an iterable of (path: str, size: int).
    """
    files_list: List[Tuple[str, int]] = list(files)
    blocked = set(blocked_extensions)
    videos = set(video_extensions)

    # Rule 1: any executable / installer / script / disc image present.
    for path, _size in files_list:
        if file_ext(path) in blocked:
            return f"Contains an executable file ({Path(path).name}) — blocked for safety."

    # Rule 2: no streamable video file at all.
    if not any(file_ext(p) in videos for p, _ in files_list):
        return "No playable video file found — likely a fake or archive-only release."

    # Rule 3 (opt-in): largest file is a non-video AND a fake-companion text file exists.
    if fake_heuristics and files_list:
        largest_path, _ = max(files_list, key=lambda f: f[1])
        if file_ext(largest_path) not in videos:
            for p, _ in files_list:
                if file_ext(p) in _FAKE_COMPANION_EXTS and _FAKE_COMPANION_RE.search(Path(p).name):
                    return "Matches a known fake-torrent pattern — blocked for safety."

    return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_content_guard.py -v`
Expected: PASS (8 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/torrent/content_guard.py backend/tests/test_content_guard.py
git commit -m "feat(torrent): pure heuristic content-guard classifier"
```

---

### Task 3: State + model plumbing (`blocked` state, `block_reason`)

**Files:**
- Modify: `backend/app/models.py` (add `TorrentState.BLOCKED`; add `TorrentStatus.block_reason`)
- Modify: `backend/app/database/models/torrents.py` (add `block_reason` column; map it in `to_status`)
- Modify: `backend/app/torrent/states.py` (add `"blocked"` to `TERMINAL_STATES`)
- Test: `backend/tests/test_blocked_state.py` (create)

**Interfaces:**
- Produces: `TorrentState.BLOCKED == "blocked"`; `DbTorrent.block_reason` (nullable String); `TorrentStatus.block_reason: Optional[str]`. Consumed by Task 6 (sets them) and Task 7 (frontend reads them).
- Note: `BLOCKED` is intentionally absent from `ACTIVE_DOWNLOAD_STATES`, so `find_loadable_on_startup` never re-adds a blocked torrent.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_blocked_state.py`:
```python
"""'blocked' torrent state + block_reason plumbing."""
from app.models import TorrentState, TorrentStatus
from app.torrent.states import ACTIVE_DOWNLOAD_STATES, TERMINAL_STATES


def test_blocked_state_value():
    assert TorrentState("blocked") is TorrentState.BLOCKED
    assert TorrentState.BLOCKED.value == "blocked"


def test_blocked_not_resumable_on_startup():
    # not an active-download state -> find_loadable_on_startup won't re-add it
    assert "blocked" not in ACTIVE_DOWNLOAD_STATES
    assert "blocked" in TERMINAL_STATES


def test_torrent_status_carries_block_reason():
    from datetime import datetime
    s = TorrentStatus(
        id="t1", movie_title="X", quality="1080p", state=TorrentState.BLOCKED,
        save_path="/x", created_at=datetime.now(), updated_at=datetime.now(),
        block_reason="No playable video file found.",
    )
    assert s.block_reason == "No playable video file found."


def test_torrent_status_block_reason_defaults_none():
    from datetime import datetime
    s = TorrentStatus(
        id="t1", movie_title="X", quality="1080p", state=TorrentState.DOWNLOADING,
        save_path="/x", created_at=datetime.now(), updated_at=datetime.now(),
    )
    assert s.block_reason is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_blocked_state.py -v`
Expected: FAIL — `ValueError: 'blocked' is not a valid TorrentState`.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/models.py`, add to the `TorrentState` enum (after `STOPPED = "stopped"`, line ~25):
```python
    BLOCKED = "blocked"
```
In `backend/app/models.py`, add to `TorrentStatus` (after `error_message: Optional[str] = None`, line ~351):
```python
    block_reason: Optional[str] = None   # set when state == 'blocked' (content guard)
```
In `backend/app/torrent/states.py`, change `TERMINAL_STATES` (line 13):
```python
TERMINAL_STATES = frozenset({"finished", "seeding", "error", "blocked"})
```
In `backend/app/database/models/torrents.py`, add the column after `error_message` (line ~39):
```python
    block_reason = Column(String, nullable=True)  # content-guard reason when state == 'blocked'
```
In the same file, add to the `to_status()` `TorrentStatus(...)` call (after `error_message=self.error_message`, line ~77 — add a trailing comma to that line):
```python
            error_message=self.error_message,
            block_reason=self.block_reason,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_blocked_state.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/database/models/torrents.py backend/app/torrent/states.py backend/tests/test_blocked_state.py
git commit -m "feat(torrent): add 'blocked' state + block_reason plumbing"
```

---

### Task 4: Route `_is_video_file` through settings (expanded extensions)

**Files:**
- Modify: `backend/app/torrent/manager.py` (remove module constant `VIDEO_EXTENSIONS` at line 35; rewrite `_is_video_file` at lines 982-984 to use `settings.video_extensions` via the shared helper)
- Test: `backend/tests/test_is_video_file_settings.py` (create)

**Interfaces:**
- Consumes: `settings.video_extensions` (Task 1), `content_guard.is_video_file` (Task 2).
- Produces: `TorrentManager._is_video_file(path) -> bool` now recognizes the expanded extension set.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_is_video_file_settings.py`:
```python
"""_is_video_file is settings-driven and recognizes the expanded extension list."""
from app.torrent.manager import torrent_manager


def test_recognizes_expanded_extensions():
    assert torrent_manager._is_video_file("Show.S01E01.m4v") is True
    assert torrent_manager._is_video_file("clip.ts") is True
    assert torrent_manager._is_video_file("movie.mkv") is True


def test_rejects_executables_and_unknowns():
    assert torrent_manager._is_video_file("Setup.exe") is False
    assert torrent_manager._is_video_file("notes.txt") is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_is_video_file_settings.py -v`
Expected: FAIL — `test_recognizes_expanded_extensions` fails (`.m4v`/`.ts` not in the old hardcoded list).

- [ ] **Step 3: Write minimal implementation**

First confirm the constant is only used by `_is_video_file`:
Run: `grep -n "VIDEO_EXTENSIONS" backend/app/torrent/manager.py`
Expected: only the definition (line 35) and its use inside `_is_video_file`.

In `backend/app/torrent/manager.py`, delete the module constant (line 35):
```python
VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.ogv', '.wmv', '.flv']
```
Replace `_is_video_file` (lines 982-984) with:
```python
    def _is_video_file(self, file_path: str) -> bool:
        """Check if a file is a video based on its extension (settings-driven)."""
        from app.torrent.content_guard import is_video_file
        return is_video_file(file_path, settings.video_extensions)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_is_video_file_settings.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/torrent/manager.py backend/tests/test_is_video_file_settings.py
git commit -m "refactor(torrent): _is_video_file reads expanded settings.video_extensions"
```

---

### Task 5: Skip non-video downloads (priority 0)

**Files:**
- Modify: `backend/app/torrent/manager.py` (change `prioritize_video_files` non-video branch line ~1148 from `1` to `0`; add `skip_non_video_files`)
- Test: `backend/tests/test_skip_non_video.py` (create)

**Interfaces:**
- Produces: `TorrentManager.skip_non_video_files(torrent_id: str, handle) -> None` — sets non-video files to priority 0, video files to 1. Consumed by Task 6 (called on the allowed path).
- `prioritize_video_files` now assigns priority 0 (not 1) to non-video files.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_skip_non_video.py`:
```python
"""Non-video files are skipped (priority 0) for guarded torrents."""
import types
from app.torrent.manager import torrent_manager


class _TI:
    def __init__(self, paths):
        self._paths = paths
    def num_files(self):
        return len(self._paths)
    def file_at(self, i):
        return types.SimpleNamespace(path=self._paths[i], size=1000)


class _Handle:
    def __init__(self, paths):
        self._ti = _TI(paths)
        self.applied = None
    def has_metadata(self):
        return True
    def get_torrent_info(self):
        return self._ti
    def prioritize_files(self, prios):
        self.applied = list(prios)


def test_skip_non_video_sets_zero_for_non_video():
    h = _Handle(["movie.mkv", "Setup.exe", "info.nfo", "subs.srt"])
    torrent_manager.skip_non_video_files("t-skip", h)
    # video -> 1, everything else -> 0
    assert h.applied == [1, 0, 0, 0]


def test_skip_non_video_no_metadata_is_noop():
    class _NoMeta(_Handle):
        def has_metadata(self):
            return False
    h = _NoMeta(["movie.mkv"])
    torrent_manager.skip_non_video_files("t-skip", h)
    assert h.applied is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_skip_non_video.py -v`
Expected: FAIL — `AttributeError: 'TorrentManager' object has no attribute 'skip_non_video_files'`.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/torrent/manager.py`, change the non-video branch in `prioritize_video_files` (line ~1147-1148):
```python
                else:
                    # Skip non-video files entirely (priority 0) — don't waste
                    # Pi bandwidth/disk on extras.
                    file_priorities.append(0)
```
Add a new method (place it just before `prioritize_video_files`, around line 1097):
```python
    def skip_non_video_files(self, torrent_id: str, handle) -> None:
        """Set non-video files to priority 0 (skip) and video files to 1, so a
        guarded torrent never spends Pi bandwidth/disk on non-video extras.
        No-op without metadata. Best-effort — never raises into the caller."""
        try:
            if not handle.has_metadata():
                return
            ti = handle.get_torrent_info()
            priorities = [
                1 if self._is_video_file(ti.file_at(i).path) else 0
                for i in range(ti.num_files())
            ]
            if priorities:
                handle.prioritize_files(priorities)
        except Exception as e:
            logger.warning(f"skip_non_video_files failed for {torrent_id}: {e}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_skip_non_video.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/torrent/manager.py backend/tests/test_skip_non_video.py
git commit -m "feat(torrent): skip non-video files (priority 0) for guarded torrents"
```

---

### Task 6: Content-guard validation, enforcement, and handler wiring

**Files:**
- Modify: `backend/app/torrent/manager.py` (add `validate_torrent_content` + `_block_torrent`; wire both into the `metadata_received_alert` handler at lines 549-555)
- Test: `backend/tests/test_content_guard_manager.py` (create)

**Interfaces:**
- Consumes: `classify_torrent_files` (Task 2), `settings.content_guard_enabled` / `blocked_extensions` / `video_extensions` / `fake_torrent_heuristics` (Task 1), `skip_non_video_files` (Task 5), `'blocked'` state + `block_reason` column (Task 3), existing `self.session`, `self.active_torrents`, `safe_rmtree`, `DbTorrent`, `TorrentLog`, `get_db`.
- Produces: `validate_torrent_content(handle) -> Optional[str]`; `_block_torrent(torrent_id, handle, reason) -> None`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_content_guard_manager.py`:
```python
"""Manager content-guard: validate file list + enforce a block (remove, delete, mark)."""
import os
os.environ.setdefault("DB_PATH", "/tmp/test_content_guard_manager.db")

import types
from pathlib import Path
from app.torrent.manager import torrent_manager
from app.database.session import get_db
from app.database.models.torrents import Torrent as DbTorrent


class _TI:
    def __init__(self, files):  # files: list[(path, size)]
        self._files = files
    def num_files(self):
        return len(self._files)
    def file_at(self, i):
        p, s = self._files[i]
        return types.SimpleNamespace(path=p, size=s)


class _Handle:
    def __init__(self, files, meta=True):
        self._ti = _TI(files)
        self._meta = meta
    def has_metadata(self):
        return self._meta
    def get_torrent_info(self):
        return self._ti


class _Session:
    def __init__(self):
        self.removed = []
    def remove_torrent(self, handle):
        self.removed.append(handle)


def test_validate_flags_executable():
    h = _Handle([("movie.mkv", 2_000_000_000), ("Setup.exe", 500_000)])
    reason = torrent_manager.validate_torrent_content(h)
    assert reason and "executable" in reason.lower()


def test_validate_allows_clean_video():
    h = _Handle([("movie.mkv", 2_000_000_000), ("subs.srt", 50_000)])
    assert torrent_manager.validate_torrent_content(h) is None


def test_validate_no_metadata_returns_none():
    h = _Handle([("Setup.exe", 1)], meta=False)
    assert torrent_manager.validate_torrent_content(h) is None


def test_block_torrent_removes_deletes_and_marks(tmp_path):
    # Arrange a real save_path with a junk file + a DB row + a fake session.
    save_path = tmp_path / "Fake.Movie"
    save_path.mkdir()
    (save_path / "Setup.exe").write_bytes(b"junk")

    tid = "t-block-1"
    with get_db() as db:
        db.add(DbTorrent(
            id=tid, movie_title="Fake Movie", quality="1080p",
            magnet="magnet:?x", url="magnet:?x", save_path=str(save_path),
            state="downloading", progress=1.0,
        ))
        db.commit()

    h = _Handle([("Setup.exe", 4)])
    fake_session = _Session()
    torrent_manager.session = fake_session
    torrent_manager.active_torrents[tid] = (h, {})

    # Make safe_rmtree permit our tmp dir (it guards against deleting outside the
    # download root): point the download root at tmp_path for this call.
    import app.torrent.manager as mgr
    orig_root = mgr.settings.default_download_path
    mgr.settings.default_download_path = tmp_path
    try:
        torrent_manager._block_torrent(tid, h, "Contains an executable file (Setup.exe) — blocked for safety.")
    finally:
        mgr.settings.default_download_path = orig_root

    # Assert: removed from session, dropped from active_torrents, files gone, DB marked.
    assert h in fake_session.removed
    assert tid not in torrent_manager.active_torrents
    assert not save_path.exists()
    with get_db() as db:
        row = db.query(DbTorrent).filter(DbTorrent.id == tid).first()
        assert row.state == "blocked"
        assert "executable" in (row.block_reason or "").lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_content_guard_manager.py -v`
Expected: FAIL — `AttributeError: 'TorrentManager' object has no attribute 'validate_torrent_content'`.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/torrent/manager.py`, add two methods (place them just before `skip_non_video_files` from Task 5, around line 1097):
```python
    def validate_torrent_content(self, handle) -> Optional[str]:
        """Inspect a torrent's file list (metadata required) and return a content-
        guard block reason if it should be rejected, else None. Best-effort — any
        read error returns None (fail-open: never block on our own error)."""
        from app.torrent.content_guard import classify_torrent_files
        try:
            if not handle.has_metadata():
                return None
            ti = handle.get_torrent_info()
            files = [(ti.file_at(i).path, ti.file_at(i).size) for i in range(ti.num_files())]
        except Exception as e:
            logger.warning(f"content guard could not read file list: {e}")
            return None
        return classify_torrent_files(
            files,
            blocked_extensions=settings.blocked_extensions,
            video_extensions=settings.video_extensions,
            fake_heuristics=settings.fake_torrent_heuristics,
        )

    def _block_torrent(self, torrent_id: str, handle, reason: str) -> None:
        """Enforce a content-guard block: remove from the session, delete partial
        files, and persist state='blocked' + block_reason."""
        logger.warning(f"Content guard BLOCKED torrent {torrent_id}: {reason}")
        try:
            self.session.remove_torrent(handle)
        except Exception as e:
            logger.warning(f"block: session.remove_torrent failed for {torrent_id}: {e}")
        self.active_torrents.pop(torrent_id, None)

        save_path = None
        try:
            with get_db() as db:
                torrent = db.query(DbTorrent).filter(DbTorrent.id == torrent_id).first()
                if torrent:
                    save_path = torrent.save_path
                    torrent.state = 'blocked'
                    torrent.block_reason = reason
                    db.add(TorrentLog(
                        torrent_id=torrent_id,
                        message=f"Blocked by content guard: {reason}",
                        level="WARNING",
                        state='blocked',
                    ))
                    db.commit()
        except Exception as e:
            logger.error(f"block: DB update failed for {torrent_id}: {e}")

        if save_path:
            try:
                safe_rmtree(save_path, settings.default_download_path)
            except Exception as e:
                logger.warning(f"block: safe_rmtree failed for {torrent_id}: {e}")
```

Then wire it into the `metadata_received_alert` handler. Replace the current block at lines 549-555:
```python
                        # Files are now known: cache per-file season/episode so content_id
                        # resolution never depends on a per-request filename parse.
                        try:
                            self.precompute_episode_map(torrent_id)
                        except Exception as e:
                            logger.warning(f"Episode precompute failed for {torrent_id}: {e}")
                        break
```
with:
```python
                        # Content guard: vet the now-known file list BEFORE the bulk
                        # download. Blocks executables / no-video / fake torrents,
                        # otherwise skips non-video files. Gated by the kill switch.
                        if settings.content_guard_enabled:
                            reason = self.validate_torrent_content(handle)
                            if reason:
                                self._block_torrent(torrent_id, handle, reason)
                                break
                            self.skip_non_video_files(torrent_id, handle)
                        # Files are now known: cache per-file season/episode so content_id
                        # resolution never depends on a per-request filename parse.
                        try:
                            self.precompute_episode_map(torrent_id)
                        except Exception as e:
                            logger.warning(f"Episode precompute failed for {torrent_id}: {e}")
                        break
```
(`_block_torrent` pops `active_torrents` and we `break` immediately, so the in-progress `for ... in self.active_torrents.items()` loop is never resumed after the mutation.)

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest tests/test_content_guard_manager.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Run the full backend suite (no regressions)**

Run: `docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/torrent/manager.py backend/tests/test_content_guard_manager.py
git commit -m "feat(torrent): content guard blocks malicious/fake torrents at metadata"
```

---

### Task 7: Frontend — `blocked` type + "Blocked for safety" screen

**Files:**
- Modify: `frontend/src/types/index.ts` (add `TorrentState.BLOCKED`; add `block_reason?` to `TorrentStatus`)
- Modify: `frontend/src/app/streaming/[id]/page.tsx` (render a blocked screen when `state === 'blocked'`, before the generic error gate at line 432)
- Test: `cd frontend && npx tsc --noEmit` (typecheck gate)

**Interfaces:**
- Consumes: `TorrentStatus.state` / `block_reason` from the status poll (already fetched every interval at `page.tsx:182`); existing `handleBackClick`.

- [ ] **Step 1: Add the type members**

In `frontend/src/types/index.ts`, add to the `TorrentState` enum (after `STOPPED = "stopped"`, line ~90):
```typescript
  BLOCKED = "blocked",
```
And add to the `TorrentStatus` interface (after `error_message?: string;`, line ~108):
```typescript
  block_reason?: string;
```

- [ ] **Step 2: Render the blocked screen**

In `frontend/src/app/streaming/[id]/page.tsx`, insert a new gate **immediately before** the `if (error || !torrentStatus)` block (line 432):
```tsx
  // Blocked-for-safety state — the content guard rejected this torrent.
  if (torrentStatus?.state === TorrentState.BLOCKED) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-ink p-8">
        <div className="w-16 h-16 rounded-full border border-hairline bg-surface flex items-center justify-center mb-6">
          <ExclamationTriangleIcon className="w-8 h-8 text-gold" />
        </div>
        <h2 className="font-display text-2xl text-text mb-3 tracking-tight">Blocked for Safety</h2>
        <p className="text-muted text-center mb-8 max-w-md text-sm leading-relaxed">
          {torrentStatus.block_reason ||
            'This torrent was blocked because it has no playable video or contains an executable.'}
        </p>
        <div className="flex gap-3 flex-wrap justify-center">
          <Button variant="primary" size="sm" onClick={handleBackClick}>
            <ArrowLeftIcon className="w-4 h-4" />
            Choose another source
          </Button>
        </div>
      </div>
    );
  }

```
(`TorrentState`, `Button`, `ExclamationTriangleIcon`, `ArrowLeftIcon`, and `handleBackClick` are already imported/defined in this file — confirm with `grep -nE "TorrentState|ExclamationTriangleIcon|handleBackClick" frontend/src/app/streaming/\[id\]/page.tsx`. If `TorrentState` is not imported, add it to the existing import from `@/types`.)

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 4: Manual sanity (optional, documented)**

With the guard enabled, attempt a known-bad source; the streaming page should show "Blocked for Safety" with the reason and a "Choose another source" button instead of the generic "Unable to Stream."

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts "frontend/src/app/streaming/[id]/page.tsx"
git commit -m "feat(player): 'Blocked for safety' screen for guard-blocked torrents"
```

---

### Task 8: Document the kill switch in `.env`

**Files:**
- Modify/Create: `backend/.env.example` (document `CONTENT_GUARD_ENABLED`; mention the optional advanced vars)

**Interfaces:** none (docs only).

- [ ] **Step 1: Locate the example env file**

Run: `ls backend/.env.example .env.example 2>/dev/null; echo "---"; grep -rn "CONTENT_GUARD" backend/.env.example .env.example 2>/dev/null || echo "not documented yet"`
Expected: shows whether a `.env.example` exists and that the var is undocumented.

- [ ] **Step 2: Document the setting**

Append to `backend/.env.example` (create the file if it does not exist):
```bash
# --- Content guard (heuristic malware / fake-torrent block) ---
# Master kill switch. true (default) blocks torrents that contain executables,
# have no playable video, or match fake-torrent patterns — before they download.
# Set to false to disable entirely (behaves exactly as before the guard existed).
CONTENT_GUARD_ENABLED=true
# Advanced (optional) — JSON arrays to override the built-in lists, and the
# opt-in structural heuristic. Leave unset to use the defaults in app/config.py.
# BLOCKED_EXTENSIONS=[".exe",".scr",".msi",".iso",".bin"]
# VIDEO_EXTENSIONS=[".mp4",".mkv",".m4v",".ts"]
# FAKE_TORRENT_HEURISTICS=false
```

- [ ] **Step 3: Commit**

```bash
git add backend/.env.example
git commit -m "docs(env): document CONTENT_GUARD_ENABLED kill switch"
```

---

## Post-implementation

After Task 8, run the full backend suite once more and the frontend typecheck:
```bash
docker compose run --rm -v "$(pwd)/backend/tests:/opt/freeflix/tests" backend python -m pytest -q
cd frontend && npx tsc --noEmit
```
Then use **superpowers:finishing-a-development-branch** to merge/PR `feat/content-guard` (note it is stacked on `feat/streaming-optimization`; that branch should land first).

## Self-review notes (author)

- **Spec coverage:** checkpoint (T6), rules 1-3 (T2), extension lists (T1/T4), enforcement block+delete+state (T6), skip non-video (T5), config kill switch (T1/T8), data model (T3), API field (T3), frontend blocked screen (T7), tests (every task). ✅
- **Type consistency:** `classify_torrent_files(files, *, blocked_extensions, video_extensions, fake_heuristics)` is identical in T2 (def) and T6 (call). `skip_non_video_files(torrent_id, handle)` def in T5, called in T6. `TorrentState.BLOCKED == "blocked"` consistent in backend (T3) and frontend (T7). `block_reason` consistent across model column (T3), Pydantic (T3), `to_status` (T3), and frontend type (T7). ✅
- **No placeholders:** every code/test step contains full code and an exact run command + expected result. ✅
- **Fail-open:** `validate_torrent_content` returns `None` on any read error (never blocks on our own bug); the whole guard is gated by `content_guard_enabled`. ✅
