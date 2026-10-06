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
