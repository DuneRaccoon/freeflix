# app/api/users.py
"""Profile CRUD, scoped to the calling account.

The table is still ``users`` (five FK constraints point at ``users.id`` and there is no
migration framework that can rename it), but every route here means PROFILE — one of the
faces behind "Who's watching?", owned by an Account.

Three things this module exists to get right:

* **Scoping.** A profile list is never the instance's profiles, always the caller's.
  ``require_profile`` enforces the same rule on every ``{user_id}`` route, and it gives
  the owner no override: owning the instance is not permission to read a household
  member's watch history.
* **Never 500 on a missing settings row.** The old ``GET /users`` called
  ``user.settings.to_dict()`` with no None guard, so ONE settings-less row blanked the
  whole profile picker — which is the only way into the app. :func:`profile_response`
  creates the row on read instead.
* **The passcode never leaves the server.** It used to be returned in plaintext to every
  caller through ``UserResponse.settings``. It is now write-only: hashed on arrival,
  advertised only as ``has_passcode`` + ``passcode_len``, and verified by
  ``POST /{user_id}/unlock``.
"""

from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger
from sqlalchemy.orm import Session

from app.config import settings
from app.database.models import User, UserSettings
from app.database.models.accounts import Account, AuthSession, ROLE_OWNER, STATUS_PENDING_EMAIL
from app.database.session import get_db
from app.dependencies.auth import AuthContext, require_profile, require_session
from app.models import (
    PasscodeUnlockRequest,
    PasscodeUnlockResponse,
    UserCreate,
    UserResponse,
    UserSettingsResponse,
    UserSettingsUpdate,
    UserUpdate,
)
from app.services import auth as auth_service
from app.services import accounts as accounts_service

router = APIRouter()

# A value outside this set (hand-edited row, older default) would fail the Literal on
# UserSettingsResponse and 500 the profile picker, so it falls back instead.
_QUALITIES = {"720p", "1080p", "2160p"}

_UNLOCK_LIMIT = 5
_UNLOCK_WINDOW = 5 * 60


def ensure_settings(session: Session, profile: User) -> UserSettings:
    """Return the profile's settings row, creating it if the profile has none.

    Self-healing rather than 404: a profile with no ``user_settings`` row is a data bug
    (pre-auth ``User.create_with_settings`` was not the only writer), and the cost of
    that bug used to be a 500 for the entire list.
    """
    row = profile.settings
    if row is None:
        logger.warning(f"Profile {profile.id} had no settings row — creating one")
        row = UserSettings(user_id=profile.id)
        session.add(row)
        session.flush()
        profile.settings = row
    return row


def profile_response(session: Session, profile: User) -> UserResponse:
    """The ONE way a profile is serialized. Also used by ``GET /auth/me``.

    Fields are named explicitly rather than splatted from ``to_dict()``: that helper
    drops every NULL column, so ``UserResponse(**profile.to_dict())`` silently omits
    whichever nullable fields are unset and raises on the required ones — which is
    exactly why ``PUT /users/{id}`` 500s today.
    """
    row = ensure_settings(session, profile)
    quality = row.default_quality if row.default_quality in _QUALITIES else "1080p"
    return UserResponse(
        id=profile.id,
        username=profile.username,
        display_name=profile.display_name,
        avatar=profile.avatar,
        account_id=profile.account_id,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
        settings=UserSettingsResponse(
            id=row.id,
            user_id=row.user_id,
            maturity_restriction=row.maturity_restriction or "none",
            require_passcode=bool(row.require_passcode),
            # The hash, never the code. `passcode_len` is all the keypad needs to draw
            # the right number of dots and auto-submit on the last digit.
            has_passcode=bool(row.passcode_hash),
            passcode_len=row.passcode_len,
            theme=row.theme or "dark",
            default_quality=quality,
            download_path=row.download_path,
        ),
    )


def _owned_profile(session: Session, user_id: str, ctx: AuthContext) -> User:
    """Load a profile the caller is allowed to touch. 404 unknown · 403 not yours.

    ``require_profile`` has usually run already; this repeats the lookup because that
    dependency uses its own session (``get_db()`` is single-use per request) and returns
    only the id.
    """
    profile = session.query(User).filter(User.id == user_id).first()
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    if settings.auth_enabled and profile.account_id != ctx.account_id:
        raise HTTPException(status_code=403, detail="Not your profile")
    return profile


def _caller_account(session: Session, ctx: AuthContext) -> Account:
    """The Account row behind the context, minting one only in the dev kill-switch case.

    With ``auth_enabled=False`` require_session hands out a synthetic owner context with
    no row behind it, so profile creation would have nothing to hang the new row off.
    Falling back to the real owner (or creating it, exactly as the boot migration would)
    keeps the kill switch meaning "auth does not happen" rather than "the app is
    half-broken".
    """
    account = session.query(Account).filter(Account.id == ctx.account_id).first()
    if account is not None:
        return account

    if settings.auth_enabled:
        raise HTTPException(status_code=401, detail="Not signed in")

    account = session.query(Account).filter(Account.role == ROLE_OWNER).first()
    if account is None:
        account = Account(role=ROLE_OWNER, status=STATUS_PENDING_EMAIL)
        session.add(account)
        session.flush()
    return account


@router.get("", response_model=List[UserResponse])
async def get_users(
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_session),
):
    """Every profile on THIS account — never the whole instance's."""
    with db as session:
        query = session.query(User)
        if settings.auth_enabled:
            query = query.filter(User.account_id == ctx.account_id)
        profiles = query.order_by(User.created_at.asc(), User.id.asc()).all()
        return [profile_response(session, profile) for profile in profiles]


@router.post("", response_model=UserResponse, status_code=201)
async def create_user(
    payload: UserCreate,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_session),
):
    """Create a profile and its settings row under the calling account.

    ``username`` is generated server-side. The old client-side generator
    (``slug-${Date.now().toString(36).slice(-4)}``) could collide against the
    instance-global UNIQUE constraint and surfaced only as a generic failure toast.
    """
    display_name = (payload.display_name or "").strip()
    if not display_name:
        raise HTTPException(status_code=422, detail="A profile name is required")

    with db as session:
        account = _caller_account(session, ctx)
        profile = accounts_service.create_profile(
            session,
            account=account,
            display_name=display_name,
            avatar=payload.avatar,
        )
        return profile_response(session, profile)


@router.get(
    "/{user_id}",
    response_model=UserResponse,
    dependencies=[Depends(require_profile)],
)
async def get_user(
    user_id: str,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_session),
):
    with db as session:
        return profile_response(session, _owned_profile(session, user_id, ctx))


@router.put(
    "/{user_id}",
    response_model=UserResponse,
    dependencies=[Depends(require_profile)],
)
async def update_user(
    user_id: str,
    payload: UserUpdate,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_session),
):
    with db as session:
        profile = _owned_profile(session, user_id, ctx)

        if payload.display_name is not None:
            display_name = payload.display_name.strip()
            if not display_name:
                raise HTTPException(status_code=422, detail="A profile name is required")
            profile.display_name = display_name
        # An empty string is a legitimate value here: it clears the avatar.
        if payload.avatar is not None:
            profile.avatar = payload.avatar

        session.flush()
        return profile_response(session, profile)


@router.delete("/{user_id}")
async def delete_user(
    user_id: str,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_session),
):
    """Delete a profile, unless it is the account's last one.

    An account with zero profiles cannot reach any user-scoped endpoint, so it would be
    signed in and unable to do anything — and the picker offers no way back.

    Deliberately NOT behind ``require_profile``: ``_owned_profile`` below enforces
    ownership, but the passcode gate is skipped on purpose so a forgotten code is never
    a dead end. With the lock on, reading the profile and editing its settings both 423,
    so without this exemption the only way back would be a database edit. Deleting is a
    destructive, confirmed action that discards the profile's data anyway, which is why
    it — and not "turn the lock off" — is the recovery path: exempting PUT /settings
    would let anyone holding the device simply switch the lock off and defeat it.
    """
    with db as session:
        profile = _owned_profile(session, user_id, ctx)

        siblings = session.query(User)
        if profile.account_id is not None:
            siblings = siblings.filter(User.account_id == profile.account_id)
        if siblings.count() <= 1:
            raise HTTPException(
                status_code=409,
                detail="This is your only profile. Create another one first.",
            )

        session.delete(profile)
        return {"message": "Profile deleted successfully"}


@router.get(
    "/{user_id}/settings",
    response_model=UserSettingsResponse,
    dependencies=[Depends(require_profile)],
)
async def get_user_settings(
    user_id: str,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_session),
):
    with db as session:
        profile = _owned_profile(session, user_id, ctx)
        return profile_response(session, profile).settings


@router.put(
    "/{user_id}/settings",
    response_model=UserSettingsResponse,
    dependencies=[Depends(require_profile)],
)
async def update_user_settings(
    user_id: str,
    payload: UserSettingsUpdate,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_session),
):
    """Update settings. ``passcode`` is write-only — hashed here, never returned."""
    with db as session:
        profile = _owned_profile(session, user_id, ctx)
        row = ensure_settings(session, profile)

        data = payload.model_dump(exclude_unset=True)
        passcode: Optional[str] = data.pop("passcode", None)

        for key, value in data.items():
            if value is not None:
                setattr(row, key, value)

        # Applied last so that clearing the code also wins over a require_passcode=true
        # sent in the same body.
        if passcode is not None:
            cleaned = passcode.strip()
            if cleaned:
                # DIGITS ONLY, and bounded. The unlock UI is a numeric keypad that can
                # emit nothing else, so a passcode containing a letter or a space can
                # never be re-entered — and with the lock on, settings and delete are
                # both behind the same 423, so the profile would be unrecoverable.
                if not cleaned.isdigit() or not (4 <= len(cleaned) <= 8):
                    raise HTTPException(
                        status_code=422,
                        detail="Passcode must be 4 to 8 digits",
                    )
                row.passcode_hash = auth_service.hash_passcode(cleaned)
                row.passcode_len = len(cleaned)
            else:
                row.passcode_hash = None
                row.passcode_len = None
                row.require_passcode = False

        # The legacy plaintext column is never trusted again. Writing None on every
        # update means a row touched after the upgrade cannot carry a readable code,
        # even if some older path wrote one.
        row.passcode = None

        if row.require_passcode and not row.passcode_hash:
            # Otherwise require_profile would 423 forever and /unlock could never
            # succeed (verify_passcode against a NULL hash is always False) — a
            # permanent lockout from a single checkbox.
            raise HTTPException(
                status_code=422,
                detail="Set a passcode before turning the profile lock on",
            )

        if row.require_passcode and ctx.session_id:
            # The caller just chose this code, so leaving their own session locked out
            # would 423 every profile-scoped call for the rest of it — My List and
            # Continue Watching would silently empty with no prompt, reading as data
            # loss. Unlock the session that performed the change.
            auth_row = (
                session.query(AuthSession)
                .filter(AuthSession.id == ctx.session_id)
                .first()
            )
            if auth_row is not None:
                auth_service.mark_profile_unlocked(session, auth_row, user_id)

        session.flush()
        return profile_response(session, profile).settings


@router.post("/{user_id}/unlock", response_model=PasscodeUnlockResponse)
async def unlock_profile(
    user_id: str,
    payload: PasscodeUnlockRequest,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_session),
):
    """Enter a profile's passcode, recording the unlock on the session row.

    Deliberately NOT behind ``require_profile``: that dependency is what returns 423 for
    a locked profile, so gating the unlock with it would make a locked profile
    impossible to open. Ownership is checked here instead.

    Throttled per profile because the code is four digits — 10,000 possibilities is
    minutes of guessing without a limit.
    """
    with db as session:
        profile = _owned_profile(session, user_id, ctx)
        row = ensure_settings(session, profile)

        if not auth_service.rate_limiter.check(
            f"unlock:{user_id}", limit=_UNLOCK_LIMIT, window_seconds=_UNLOCK_WINDOW
        ):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many attempts. Try again in a few minutes.",
            )

        if not auth_service.verify_passcode(payload.passcode, row.passcode_hash):
            raise HTTPException(status_code=403, detail="Incorrect passcode")

        # A correct code clears the budget, so a household member who fat-fingers four
        # times and then gets it right is not locked out of their own profile.
        auth_service.rate_limiter.reset(f"unlock:{user_id}")

        if ctx.session_id:
            auth_row = (
                session.query(AuthSession)
                .filter(AuthSession.id == ctx.session_id)
                .first()
            )
            if auth_row is not None:
                auth_service.mark_profile_unlocked(session, auth_row, user_id)

        return PasscodeUnlockResponse(ok=True)
