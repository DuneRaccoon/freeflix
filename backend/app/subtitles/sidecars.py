"""The sidecar lister's pure half: what may be listed, where it may live, and
whether its bytes are really on disk.

`TorrentManager.list_sidecars` owns the libtorrent reads (the session lookup,
the metadata, the pad-file flags and `contiguous_available`); everything that is
a *policy* lives here, so there is exactly one place that decides which
extensions exist, one place that asserts containment, and one place that stats a
path. The division is not cosmetic — the stage-9 gate
(`backend/tests/test_stage9_leaves_the_selectors_alone.py`) scans this file for
`piece_priority` / `set_piece_deadline` and the whole package for the three
file-priority calls, because a lister that touched either would make a GET
mutating (plan D2) and would undo the playhead's raised window (D1/C1).

Three decisions here are measured, not stylistic:

* **The listed set is hard-coded** and intersected with `settings.subtitle_extensions`
  rather than read from it. A `.env` can only ever NARROW what this answers.
  `SUBTITLE_EXTENSIONS` is a declared pydantic field and therefore env-overridable
  the moment it exists, and this route hands a file's contents back as readable
  text, so "the settings say `.exe` is a subtitle" must not be a sentence this
  application can be made to believe. Plan task 2(e) names the settings tests as
  settings tests for exactly this reason and points at the request-time guard here.
* **Containment is asserted on the RESOLVED path**, the `safe_rmtree` idiom
  (`app/torrent/storage.py:33-42`), because nothing on the existing resolution
  path asserts it (`_resolve_video_file` checks only `os.path.exists`,
  `api/streaming.py:200`) and `fi.path` is attacker-supplied metadata. D9.
* **An on-disk stat is half of readiness, never the whole of it** (D7 as C1
  corrected it). `present_at_declared_size` cannot see a tail libtorrent has not
  hash-verified — `file_progress()` is called with no granularity flag anywhere
  in this repo, so it counts unverified blocks — and `contiguous_available`
  cannot see that the bytes are still in a `.<infohash>.parts` part file. The two
  conjuncts catch different lies and the caller takes their `and`.
"""
import os
from pathlib import Path
from typing import Optional, Tuple

from loguru import logger

from app.config import settings

# The lister's three answers, per D6. `coverage` is an ENVELOPE field precisely
# because `200 []` already carries three meanings on /files and the repo's own
# suite records that it "means 'not ready, or evicted' and never 'this pack has
# no episodes'" (`test_finished_torrent_streamable.py:226-230`). A fourth bare
# empty list would inherit a meaning the suite has already declared unusable.
COVERAGE_LISTED = "listed"
COVERAGE_NONE = "none"
COVERAGE_UNKNOWN = "unknown"

# The only source stage 9 has. Resolution is the LIVE SESSION ONLY (D5): all
# three `save_resume_data()` calls are flagless, so libtorrent 2.0.11 omits the
# `info` dict and `lt.read_resume_data(...).ti` is None for every blob this
# application has ever written. A `source: "resume"` arm becomes possible only
# after the stage-7 `save_info_dict` repair, and adding it is purely additive.
# NOTHING REFERENCES THIS YET, and that is stated so it is not mistaken for a
# tested constant: `list_sidecars` returns `(coverage, entries)` and D5's
# `source` field belongs to task 8's envelope. The same is true of this module's
# re-exports in `app/subtitles/__init__.py` — `manager.py` imports the submodule
# directly, so deleting that block is a green mutation (measured in review).
SOURCE_SESSION = "session"

# The request-time listed set. HARD-CODED, and the reason is above.
LISTED_EXTENSIONS = frozenset({".srt", ".vtt", ".ass", ".ssa"})

# Per-entry reasons. `unsupported-format` is spelled exactly as `vtt.py:294`
# spells it, so the picker's row and the VTT route's 415 cannot drift apart.
# There is deliberately NO size reason: an oversized sidecar is not listed at
# all (see `listable_size`), and the converter keeps its own `too-large` for a
# body whose decoded form outgrew the cap on the way through.
REASON_UNSUPPORTED_FORMAT = "unsupported-format"
REASON_UNREADABLE = "unreadable"


def _ext(rel_path: str) -> str:
    """The lowercased extension of a torrent-relative path, with its dot.

    Separator-normalised first: `fi.path` is torrent metadata and a Windows-built
    torrent can carry backslashes, which `os.path.splitext` would not treat as a
    separator on Linux. The extension is unaffected either way; the normalisation
    is here so this function and `contained_path` agree about what a segment is.
    """
    return os.path.splitext(str(rel_path).replace("\\", "/"))[1].lower()


def listed_extension(rel_path: str) -> Optional[str]:
    """The sidecar extension this path may be listed under, or None.

    BOTH sets must agree: the hard-coded one above (so a hostile or careless
    `.env` cannot widen the route) and `settings.subtitle_extensions` (so an
    owner can narrow it). Dropping either half is a mutation task 3(d) reddens.
    """
    ext = _ext(rel_path)
    if ext not in LISTED_EXTENSIONS:
        return None
    configured = {str(e).strip().lower() for e in (settings.subtitle_extensions or ())}
    if ext not in configured:
        return None
    return ext


def is_convertible(ext: str) -> bool:
    """Whether the WebVTT route will actually convert this extension.

    Settings-driven on purpose, and it is NOT the ASS guard — and neither is
    anything else in production, which is the part worth stating exactly.
    `vtt.py`'s format check reads the SAME setting (`vtt.py:293`), so moving
    `.ass` into `subtitle_convertible_extensions` flips both at once. MEASURED:
    with `.ass` in that set, `to_webvtt(<an ASS body>, ".ass")` answers
    `reason="no-cues"`, not `"unsupported-format"` — the body goes through the
    SRT parser and yields zero cues. So the body is still never served, but this
    row would advertise `convertible: true` with `reason: None` and the refusal
    would arrive at the television under a different name. What plan task 2(d)
    actually promises is that the move reddens task 6's ASS-refusal ROW; that is
    a test, not a runtime guard, and an earlier draft of this docstring claimed
    the second. `.ass`/`.ssa` are listed and never converted (D17) so the picker
    can say the format out loud rather than stay silent about a file the viewer
    can see in the release.
    """
    configured = {
        str(e).strip().lower()
        for e in (settings.subtitle_convertible_extensions or ())
    }
    return str(ext).strip().lower() in configured


def format_name(ext: str) -> str:
    """`.srt` -> `srt`. The wire spelling, dotless, as `vtt.py:158-165` records."""
    return str(ext).strip().lower().lstrip(".")


def listable_size(size: int) -> bool:
    """Whether a sidecar of this declared size may be listed at all.

    Over the cap it is EXCLUDED rather than listed-and-refused, which is the
    reading `vtt.py:272-273` already took ("the lister already refuses an
    oversized file by its on-disk size"). The route's 415-by-size therefore
    comes from the converter, on a body whose decoded UTF-8 form outgrew the cap
    — reachable, because a cp1252 file grows when it is re-encoded.
    """
    try:
        cap = int(settings.subtitle_max_bytes)
    except (TypeError, ValueError):  # pragma: no cover - defensive
        return False
    return 0 <= int(size) <= cap


def contained_path(save_path: str, rel_path: str) -> Optional[Path]:
    """`save_path / rel_path`, resolved, ONLY if it stays under `save_path`.

    Both sides resolved, the `safe_rmtree` idiom (`app/torrent/storage.py:33-42`):
    a one-sided check is defeated by a symlinked save path, and a string
    `startswith` is defeated by `/downloads/../etc`. `fi.path` is metadata from a
    stranger's torrent, and this route returns file contents as READABLE TEXT —
    which turns incidental cover into a disclosure primitive. Returns None, and
    the caller drops the entry; it never raises.
    """
    try:
        base = Path(save_path).resolve()
        target = (base / str(rel_path).replace("\\", "/")).resolve()
    except Exception as e:  # pragma: no cover - defensive
        logger.warning(f"sidecar path {rel_path!r} could not be resolved: {e}")
        return None
    if target == base or base not in target.parents:
        logger.warning(
            f"sidecar path {rel_path!r} resolves outside the save path "
            f"({target} is not under {base}); refusing to list it"
        )
        return None
    return target


def present_at_declared_size(path, size: int) -> Tuple[bool, Optional[str]]:
    """Is the file at `path` there, at exactly the size the metadata declares?

    Returns `(present, reason)`. HALF of readiness, never the whole of it:

    * a missing path is the normal state of a sidecar whose pieces are HELD but
      not yet flushed — libtorrent 2.0 routes a priority-0 file's bytes into a
      `.<infohash>.parts` file and only moves them into place when the priority
      rises (C1, measured), while `contiguous_available` reports `complete` and
      `file_progress()` reports the full size. That is `(False, None)`: not
      ready, and not an error, because task 7's flush is what fixes it.
    * a SHORT file is the sparse-write case stage 7's gate 3 exists for
      (`manager.py:1274-1285`): libtorrent writes at offsets in sparse storage
      mode, so a partial file already reports its full length with holes that
      read back as zeros.
    * any other `OSError` is REPORTED, never raised (plan task 3): the dev
      database holds a `seeding`/100 row whose `save_path` does not exist on
      disk, and one unreadable sidecar may not cost the whole list.
    """
    try:
        on_disk = os.path.getsize(path)
    except FileNotFoundError:
        return False, None
    except NotADirectoryError:
        # A path segment that is a file, e.g. the part-file layout seen through a
        # stale metadata path. Same meaning as absent, and not an error.
        return False, None
    except OSError as e:
        logger.info(f"sidecar {path} is not readable ({e})")
        return False, REASON_UNREADABLE
    return int(on_disk) == int(size), None
