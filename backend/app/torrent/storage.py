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
