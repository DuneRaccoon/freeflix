"""FastAPI dependencies that gate the API behind an instance session.

**The landmine this file exists to avoid.** ``get_db()`` is decorated
``@contextmanager``, so ``Depends(get_db)`` injects the ``_GeneratorContextManager``
OBJECT rather than a ``Session``, and FastAPI caches sub-dependency results per request.
If a dependency here declared ``db: Session = Depends(get_db)``, the endpoint that also
declares it would receive the SAME, already-exhausted context manager, and its own
``with db as session:`` would raise ``AttributeError: '_GeneratorContextManager' object
has no attribute 'args'`` — which the error middleware converts into an opaque 500 that
looks like a random database fault rather than an auth bug.

So every dependency below opens its own session with ``with get_db() as db:`` (note the
CALL), which is the pattern ``api/streaming.py`` already uses for the same reason.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from loguru import logger

from app.config import settings
from app.database.models import User
from app.database.models.accounts import (
    Account,
    ROLE_OWNER,
    STATUS_ACTIVE,
)
from app.database.session import get_db
from app.services import auth as auth_service


@dataclass
class AuthContext:
    """Everything an endpoint needs to know about the caller, resolved once."""

    account_id: str
    email: Optional[str]
    role: str
    status: str
    session_id: Optional[str]
    unlocked_profiles: list[str]

    @property
    def is_owner(self) -> bool:
        return self.role == ROLE_OWNER


# The context handed out when settings.auth_enabled is False. Development only.
_DEV_CONTEXT = AuthContext(
    account_id="dev-owner",
    email=None,
    role=ROLE_OWNER,
    status=STATUS_ACTIVE,
    session_id=None,
    unlocked_profiles=[],
)

def _unauthenticated() -> HTTPException:
    """A FRESH 401 every time — never a module-level singleton.

    Raising one shared exception object appends the raising frames to its
    ``__traceback__`` on every raise, and nothing ever clears it. Each retained
    traceback pins a frame, and each frame pins its locals — including the ``db``
    Session with its identity map. On an internet-reachable instance, where scanners and
    every signed-out page load produce a 401, that is an unbounded leak of sessions and
    request objects for the life of the process.
    """
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not signed in",
    )


class SilentUnauthorized(Exception):
    """A 401 that must be served with an EMPTY body.

    ``HTTPException`` always renders ``{"detail": ...}``, which is fine for XHR and fatal
    for byte-serving routes — see :func:`require_session_silent`. ``main.py`` registers an
    exception handler for this type that returns a bare ``Response(status_code=401)``.

    Registering a handler for a dedicated exception class rather than sniffing the request
    path keeps the decision where the knowledge is (the dependency knows it is guarding a
    media route; the handler does not have to re-derive it from a URL shape), and leaves
    FastAPI's own handler in charge of every other error.
    """


def _session_cookie(request: Request) -> Optional[str]:
    return request.cookies.get(settings.cookie_name)


def require_session(request: Request) -> AuthContext:
    """401 unless the request carries a live session cookie for an active account."""
    if not settings.auth_enabled:
        return _DEV_CONTEXT

    raw = _session_cookie(request)
    if not raw:
        raise _unauthenticated()

    # Resolved inside the block, raised OUTSIDE it. get_db() logs every exception that
    # escapes its `with` at ERROR level and rolls the session back, so raising in here
    # would make an ordinary signed-out page load read as a database failure in the logs
    # — and a signed-out browser polls, so it is continuous noise that buries real faults.
    ctx: Optional[AuthContext] = None
    with get_db() as db:
        row = auth_service.lookup_session(db, raw)
        if row is not None:
            account = db.query(Account).filter(Account.id == row.account_id).first()
            # A revoked account must stop authenticating immediately. This is a status
            # check, not a deleted_at check: CRUDMixin.delete() only stamps deleted_at
            # and nothing in the codebase filters on it, so a soft-deleted account would
            # still pass every lookup.
            if account is not None and account.status == STATUS_ACTIVE:
                auth_service.touch_session(db, row)
                ctx = AuthContext(
                    account_id=account.id,
                    email=account.email,
                    role=account.role,
                    status=account.status,
                    session_id=row.id,
                    unlocked_profiles=list(row.unlocked_profiles or []),
                )

    if ctx is None:
        raise _unauthenticated()
    return ctx


def require_owner(ctx: AuthContext = Depends(require_session)) -> AuthContext:
    """403 unless the caller owns this instance."""
    if not ctx.is_owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the instance owner can do this",
        )
    return ctx


def require_session_silent(request: Request) -> AuthContext:
    """Session gate for byte-serving endpoints.

    ``GET /api/v1/streaming/{id}/video`` is loaded by a raw ``<video src>``. The element
    hands whatever comes back to the decoder, so a JSON or HTML 401 body arrives as
    malformed media and surfaces through ``PatchedVideoPlayer.handleVideoError``, which
    classifies a network error during an active download as *recoverable* and merely
    logs a console warning. An expired session would present as a mysterious playback
    failure that never prompts anyone to sign in.

    So this raises :class:`SilentUnauthorized`, which ``main.py`` renders as a 401 with an
    EMPTY body and no redirect. The player's error handler checks the status explicitly
    and routes to sign-in.
    """
    try:
        return require_session(request)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_401_UNAUTHORIZED:
            raise SilentUnauthorized() from exc
        raise


def resolve_profile(user_id: str, ctx: AuthContext) -> Optional[User]:
    """Shared body of :func:`require_profile`, usable from inside an endpoint too.

    Must be called with its own session; returns a detached-but-loaded ``User``.

    With ``auth_enabled`` off this is a pure pass-through that does not even open a
    session, so behaviour is byte-identical to the pre-auth app (the endpoints already
    do their own existence checks). The content guard's kill switch sets the same
    precedent: off means *nothing happens*, not *a weaker check happens*.
    """
    if not settings.auth_enabled:
        return None

    with get_db() as db:
        profile = db.query(User).filter(User.id == user_id).first()
        if profile is None:
            raise HTTPException(status_code=404, detail="Profile not found")

        # An un-migrated profile (account_id NULL) belongs to nobody and must not
        # be readable by a signed-in stranger. The startup migration assigns one to
        # every row, so this only fires if that migration failed.
        if profile.account_id is None:
            logger.error(
                f"Profile {user_id} has no account_id — the instance-claim "
                "migration did not complete for this row."
            )
            raise HTTPException(status_code=403, detail="Profile not available")
        # Note: the OWNER deliberately gets no override here. Owning the instance
        # is not the same as being allowed to read a household member's watch
        # history or watchlist.
        if profile.account_id != ctx.account_id:
            raise HTTPException(status_code=403, detail="Not your profile")

        settings_row = profile.settings
        if settings_row is not None and settings_row.require_passcode:
            if user_id not in ctx.unlocked_profiles:
                raise HTTPException(
                    status_code=status.HTTP_423_LOCKED,
                    detail="Profile is locked",
                )
        return profile


def require_profile(
    user_id: str, ctx: AuthContext = Depends(require_session)
) -> str:
    """Path-param guard for every ``{user_id}``-scoped route.

    404 unknown · 403 not yours · 423 locked (passcode not entered this session).
    Returns the id so an endpoint can depend on it directly.
    """
    resolve_profile(user_id, ctx)
    return user_id


def require_optional_profile(
    user_id: Optional[str] = None, ctx: AuthContext = Depends(require_session)
) -> Optional[str]:
    """Guard for routes where the profile is an OPTIONAL query parameter.

    ``GET /api/v1/rails?user_id=`` personalises its ordering from the profile's watch
    history and watchlist, and seeds the daily shuffle from the id. Left unvalidated,
    any signed-in member could pass another member's profile id and read back an
    ordering derived from their viewing — a slow but real leak of what that person
    watches. Omitting the parameter stays legal and yields the anonymous rails.
    """
    if user_id is None or user_id == "":
        return None
    resolve_profile(user_id, ctx)
    return user_id
