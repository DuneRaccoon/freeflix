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
  caller through ``UserResponse.settings``. It is now write-only: set, changed and removed
  only by ``PUT /{user_id}/passcode`` (which asks for the current code first), hashed on
  arrival, advertised only as ``has_passcode`` + ``passcode_len``, and verified by
  ``POST /{user_id}/select``.
"""

import re
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
    OkResponse,
    PasscodeChangeRequest,
    ProfileSelectRequest,
    ProfileSelectResponse,
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
            # `is not False`, NEVER `bool(...)`. The column is nullable because
            # `sync_columns()` can only ADD a bare column — no DEFAULT, no backfill — so
            # every profile that existed before this build reads NULL, and `bool(None)` is
            # False. That would ship the feature OFF for every household that already has
            # one, which is the opposite of the default it is specified to have. NULL means
            # "never chosen"; only an explicit False is an opt-out.
            auto_next_episode=row.auto_next_episode is not False,
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


# Declared before every ``/{user_id}`` route, so that a ``POST /{user_id}`` added later can
# never capture "deselect" as a profile id. (Today the order is not load-bearing: Starlette
# keeps looking past a path match whose method differs, so moving this below the
# GET/PUT/DELETE ``/{user_id}`` routes still resolves here.)
@router.post("/deselect", response_model=OkResponse)
async def deselect(
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_session),
):
    """Close the session's open profile, called when the UI returns to "Who's watching?".

    Every locked profile is locked again afterwards. No profile id: the session holds at
    most one, so there is nothing to name.
    """
    with db as session:
        auth_row = _session_row(session, ctx)
        if auth_row is not None:
            auth_service.set_active_profile(session, auth_row, None)
        return OkResponse(ok=True)


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
    """Update settings. The lock is not one of them: see ``PUT /{user_id}/passcode``.

    ``passcode`` and ``require_passcode`` are no longer fields of ``UserSettingsUpdate``,
    so a body carrying them is saved without them rather than refused. Otherwise anyone
    holding a device on an open profile could switch its lock off without the code.
    """
    with db as session:
        profile = _owned_profile(session, user_id, ctx)
        row = ensure_settings(session, profile)

        data = payload.model_dump(exclude_unset=True)
        for key, value in data.items():
            if value is not None:
                setattr(row, key, value)

        # The legacy plaintext column is never trusted again. Writing None on every
        # update means a row touched after the upgrade cannot carry a readable code,
        # even if some older path wrote one.
        row.passcode = None

        session.flush()
        return profile_response(session, profile).settings


def _session_row(session: Session, ctx: AuthContext) -> Optional[AuthSession]:
    """The caller's ``auth_sessions`` row, or None when there is no session (dev mode)."""
    if not ctx.session_id:
        return None
    return session.query(AuthSession).filter(AuthSession.id == ctx.session_id).first()


def _check_code(row: UserSettings, user_id: str, code: Optional[str]) -> None:
    """Verify ``code`` against the profile's stored hash, or raise. 429 throttled · 403 wrong.

    The one code check: picking a locked profile and changing or removing its code share
    it, and so share one budget on ``unlock:{user_id}``. A separate key would double the
    guesses available against a four-digit code.

    No length check: a 7-8 digit code stored before the 4-6 rule must still verify.
    """
    key = f"unlock:{user_id}"
    # Throttled per profile because the code is four digits: 10,000 possibilities is
    # minutes of guessing without a limit.
    if not auth_service.rate_limiter.check(
        key, limit=_UNLOCK_LIMIT, window_seconds=_UNLOCK_WINDOW
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many attempts. Try again in a few minutes.",
        )

    # A missing code is a wrong code, and spends an attempt like one.
    if not auth_service.verify_passcode(code or "", row.passcode_hash):
        raise HTTPException(status_code=403, detail="Incorrect passcode")

    # A correct code clears the budget, so a household member who fat-fingers four times
    # and then gets it right is not locked out of their own profile.
    auth_service.rate_limiter.reset(key)


def _select(
    session: Session, user_id: str, passcode: Optional[str], ctx: AuthContext
) -> None:
    """Make ``user_id`` the session's one open profile, asking for its code if locked.

    The session holds at most one profile, and a locked one only after a correct code on
    THIS pick, so picking any profile relocks whichever locked profile was open. Picking
    an unlocked profile empties the list rather than naming it: ``resolve_profile``
    never 423s an unlocked profile, so two tabs on two unlocked profiles never relock
    each other.
    """
    profile = _owned_profile(session, user_id, ctx)
    row = ensure_settings(session, profile)
    auth_row = _session_row(session, ctx)

    # The same predicate as resolve_profile's 423.
    if row.require_passcode:
        _check_code(row, user_id, passcode)
        if auth_row is not None:
            auth_service.set_active_profile(session, auth_row, user_id)
    elif auth_row is not None:
        auth_service.set_active_profile(session, auth_row, None)


@router.post("/{user_id}/select", response_model=ProfileSelectResponse)
async def select_profile(
    user_id: str,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_session),
    payload: Optional[ProfileSelectRequest] = None,
):
    """Pick a profile on "Who's watching?". A locked profile needs its code every time.

    Deliberately NOT behind ``require_profile``: that dependency is what returns 423 for
    a locked profile, so gating the pick with it would make a locked profile impossible
    to open. Ownership is checked in :func:`_select` instead.
    """
    with db as session:
        _select(session, user_id, payload.passcode if payload else None, ctx)
        return ProfileSelectResponse(ok=True)


@router.post("/{user_id}/unlock", response_model=ProfileSelectResponse)
async def unlock_profile(
    user_id: str,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_session),
    payload: Optional[ProfileSelectRequest] = None,
):
    """Alias of /select for one release, for clients built before it existed."""
    with db as session:
        _select(session, user_id, payload.passcode if payload else None, ctx)
        return ProfileSelectResponse(ok=True)


# Digits matched as [0-9], never str.isdigit(): that also accepts "١٢٣٤" (Arabic-Indic),
# a code the numeric keypad can never type, which would lock the profile for good.
_NEW_CODE = re.compile(
    r"[0-9]{%d,%d}" % (auth_service.PASSCODE_MIN_LEN, auth_service.PASSCODE_MAX_LEN)
)


@router.put(
    "/{user_id}/passcode",
    response_model=UserSettingsResponse,
    dependencies=[Depends(require_profile)],
)
async def change_passcode(
    user_id: str,
    payload: PasscodeChangeRequest,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_session),
):
    """Set, change or remove the profile's code. A non-empty ``new_passcode`` sets it; an
    absent or empty one removes it and turns the lock off.

    Changing or removing an existing code needs ``current_passcode``, checked against the
    same throttle as ``/select``: being on an open profile is not knowing its code.

    The new code is validated FIRST, so a malformed one never spends an attempt.
    """
    new = (payload.new_passcode or "").strip()
    if new and not _NEW_CODE.fullmatch(new):
        raise HTTPException(status_code=422, detail="Passcode must be 4 to 6 digits")

    with db as session:
        profile = _owned_profile(session, user_id, ctx)
        row = ensure_settings(session, profile)

        if row.passcode_hash:
            _check_code(row, user_id, payload.current_passcode)

        if new:
            accounts_service.set_passcode(row, new)
            # The caller just chose this code, so leaving this session locked out would
            # 423 every profile-scoped call for the rest of it. This also relocks
            # whatever other locked profile the session had open.
            auth_row = _session_row(session, ctx)
            if auth_row is not None:
                auth_service.set_active_profile(session, auth_row, user_id)
        else:
            accounts_service.clear_passcode(row)

        session.flush()
        return profile_response(session, profile).settings
