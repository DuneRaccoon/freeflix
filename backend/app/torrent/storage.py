"""Resume-data (de)serialization and guarded deletes under the download root."""
import base64
import shutil
from pathlib import Path
from typing import Iterable, List, Union

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
            logger.warning("decode_resume_data: input was not valid base64; using raw bytes as-is")
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


def _is_bare_component(name: str) -> bool:
    """A single path component: no separator, no ``.``/``..``, nothing that climbs."""
    return (
        bool(name)
        and name not in (".", "..")
        and "/" not in name
        and "\\" not in name
        and Path(name).name == name
    )


def owned_content_paths(
    save_path: Union[str, Path],
    claims: Iterable[str],
    sibling_claims: Iterable[str],
    root: Union[str, Path],
) -> List[Path]:
    """The entries directly under ``save_path`` that a torrent may delete as its own.

    ``save_path`` is shared by every download of a title, so a torrent owns only the
    names it claims (its content name, its partfile) that no sibling under the same
    directory also claims. Each candidate must be a bare name that is present on disk
    and sits directly in ``save_path``. Nothing at all is returned for a ``save_path``
    outside ``root``.
    """
    try:
        base = Path(save_path).resolve()
        download_root = Path(root).resolve()
        if base != download_root and download_root not in base.parents:
            logger.warning(f"owned_content_paths refused: {base} is not inside {root}")
            return []
    except Exception as e:  # pragma: no cover - defensive
        logger.error(f"owned_content_paths: cannot resolve paths: {e}")
        return []

    theirs = set(sibling_claims)
    owned = set()
    for name in claims:
        if name in theirs or not _is_bare_component(name):
            continue
        candidate = Path(save_path) / name
        if not (candidate.exists() or candidate.is_symlink()):
            continue
        if candidate.parent.resolve() != base:
            continue
        owned.add(candidate)
    return sorted(owned)


def delete_owned_content(paths: Iterable[Path]) -> int:
    """Delete each path: a symlink or file is unlinked (never followed), a directory is
    removed recursively. Returns how many were removed."""
    removed = 0
    for path in paths:
        path = Path(path)
        if path.is_symlink() or path.is_file():
            path.unlink()
        elif path.is_dir():
            shutil.rmtree(path)
        else:
            continue
        removed += 1
        logger.info(f"delete_owned_content: removed {path}")
    return removed


def remove_dir_if_empty(path: Union[str, Path], root: Union[str, Path]) -> bool:
    """``rmdir`` ``path`` when it is an empty directory strictly inside ``root``.
    Never ``root`` itself, never anything outside it. Returns True if removed."""
    try:
        target = Path(path).resolve()
        base = Path(root).resolve()
    except Exception as e:  # pragma: no cover - defensive
        logger.error(f"remove_dir_if_empty: cannot resolve paths: {e}")
        return False

    if target == base:
        logger.warning(f"remove_dir_if_empty refused: target equals download root ({target})")
        return False
    if base not in target.parents:
        logger.warning(f"remove_dir_if_empty refused: {target} is not inside {base}")
        return False
    if not target.is_dir() or any(target.iterdir()):
        return False

    target.rmdir()
    logger.info(f"remove_dir_if_empty: removed {target}")
    return True
