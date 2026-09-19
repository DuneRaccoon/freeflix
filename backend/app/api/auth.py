# app/api/auth.py
"""Passwordless sign-in: magic links, claim verification, invites, sessions.

Mounted PUBLIC at ``/api/v1/auth`` — the two session-bearing routes declare
``Depends(require_session)`` individually, because everything else here is what an
unauthenticated browser uses to *become* authenticated.

Two shapes in this file are deliberate and easy to "tidy" into a bug:

* Every route that mints a session takes ``response: Response`` as a PARAMETER and calls
  ``response.set_cookie`` on it. Constructing and returning a fresh ``Response`` would
  bypass ``response_model`` entirely, so the wire format would silently drift from the
  Pydantic schema the frontend is typed against.
* Mail is sent AFTER the ``with db as session:`` block closes, i.e. after the commit.
  The token row must be durable before the link reaches an inbox, and holding a pooled
  connection open across an outbound HTTP call is how a 10-connection pool starves.
"""

import secrets
from typing import Annotated, Optional

from fastapi import (
    APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status,
)
from loguru import logger
from sqlalchemy.orm import Session

from app.config import settings
from app.database.models.accounts import (
    Account,
    AuthSession,
    PURPOSE_CLAIM_VERIFY,
    PURPOSE_LOGIN,
    PURPOSE_PASSWORD_RESET,
    ROLE_MEMBER,
    ROLE_OWNER,
    STATUS_ACTIVE,
)
from app.database.session import get_db
from app.dependencies.auth import AuthContext, require_session
from app.models import (
    AccountResponse,
    AuthCapabilityResponse,
    PasswordResetConfirm,
    PasswordResetRequest,
    PasswordSignInRequest,
    InviteAcceptRequest,
    InvitePreviewRequest,
    InvitePreviewResponse,
    MagicLinkRequest,
    MagicLinkResponse,
    OkResponse,
    SessionResponse,
    UserResponse,
    UserSettingsResponse,
    VerifyTokenRequest,
    VerifyTokenResponse,
)
from app.services import accounts as accounts_service
from app.services import auth as auth_service
from app.services import mailer

router = APIRouter()

# Sliding windows for the endpoints an anonymous caller can reach. Keyed on the
# normalised email, never the IP: every browser request arrives from the `frontend`
# container's address through the Next rewrite, so a per-IP bucket would be one global
# bucket (§2.14 of the design).
_REQUEST_LINK_LIMIT = 3
_REQUEST_LINK_WINDOW = 15 * 60

# Password attempts, keyed on the normalised address. Tighter than the link limit
# because each failure is a guess at the key to the whole instance.
_PASSWORD_LIMIT = 5
_PASSWORD_WINDOW = 15 * 60
_RESET_LIMIT = 3
_RESET_WINDOW = 15 * 60

def _bad_credentials() -> HTTPException:
    """One constant refusal for every way a password sign-in can fail: unknown address, a
    member's address, an owner with no password set, a revoked owner, the wrong password,
    or too many attempts. Distinguishing any of them would say who owns the instance.

    A factory, never a module-level instance: re-raising one shared HTTPException appends
    the raising frames to its __traceback__ on every raise and nothing clears it, so each
    retained frame pins its locals — including the DB session — for the life of the
    process. This endpoint is unauthenticated, so that leak would be attacker-driven.
    """
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Email or password is incorrect.",
    )


# A real pbkdf2 hash of an unguessable value, verified against when no account (or no
# password) matches. Without it an unknown address returns before any KDF work and a known
# one pays ~100ms, which times the existence of the owner's address precisely.
_DUMMY_PASSWORD_HASH = auth_service.hash_password(secrets.token_urlsafe(32))


def _set_session_cookie(response: Response, raw: str) -> None:
    response.set_cookie(
        settings.cookie_name,
        raw,
        max_age=settings.session_ttl_days * 86400,
        **auth_service.cookie_kwargs(),
    )


def _profile_payload(profile) -> UserResponse:
    """Serialize a profile for ``GET /me`` without ever touching ``to_dict()``.

    ``to_dict()`` drops NULL columns, so ``UserResponse(**profile.to_dict())`` omits
    whichever nullable fields happen to be unset and 500s on the required ones. Every
    field is named explicitly here, and a profile with no settings row still renders —
    the bootstrap heals those, but /me is the call the whole app boots from and it must
    never be the thing that fails.
    """
    row = profile.settings
    return UserResponse(
        id=profile.id,
        username=profile.username,
        display_name=profile.display_name,
        avatar=profile.avatar,
        account_id=profile.account_id,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
        settings=UserSettingsResponse(
            id=row.id if row else "",
            user_id=profile.id,
            maturity_restriction=(row.maturity_restriction if row else None) or "none",
            require_passcode=bool(row.require_passcode) if row else False,
            has_passcode=bool(row.passcode_hash) if row else False,
            passcode_len=row.passcode_len if row else None,
            theme=(row.theme if row else None) or "dark",
            default_quality=(row.default_quality if row else None) or "1080p",
            download_path=row.download_path if row else None,
        ),
    )


@router.post("/request-link", response_model=MagicLinkResponse)
async def request_link(
    payload: MagicLinkRequest,
    background: BackgroundTasks,
    db: Annotated[Session, Depends(get_db)],
):
    """Email a sign-in link. The response is a constant, whatever the address is.

    Known, unknown, revoked and rate-limited addresses all get the same bytes back. Any
    difference — a `delivered` flag, an `action_url`, a 429, a slower path — turns this
    form into an email-enumeration oracle for an instance that is on the public internet
    by definition. When no mail provider is configured the mailer logs the link at
    WARNING level instead, which is how a self-hosted operator without Resend recovers
    it.
    """
    email = auth_service.normalize_email(payload.email)
    token: Optional[str] = None

    allowed = auth_service.rate_limiter.check(
        f"request-link:{email}",
        limit=_REQUEST_LINK_LIMIT,
        window_seconds=_REQUEST_LINK_WINDOW,
    )

    if allowed and email:
        with db as session:
            account = (
                session.query(Account)
                .filter(Account.email == email, Account.status == STATUS_ACTIVE)
                .first()
            )
            # ROLE_MEMBER only. The owner authenticates with a password, so minting a
            # login token for them would hand out a second, weaker key to the whole
            # instance — mailbox access alone would be enough. Nothing is sent and the
            # response stays constant, so this does not reveal who the owner is; the
            # /signin page links to the owner entrance for the person who needs it.
            if account is not None and account.role == ROLE_MEMBER:
                # An older link in the same inbox stops working the moment a new one is
                # requested, so a forwarded email cannot be redeemed after a re-request.
                auth_service.invalidate_tokens_for(
                    session, email=email, purpose=PURPOSE_LOGIN
                )
                token, _ = auth_service.issue_auth_token(
                    session,
                    email=email,
                    purpose=PURPOSE_LOGIN,
                    account_id=account.id,
                )

    if token:
        # Scheduled, never awaited here. Awaiting the send would make the response time
        # depend on whether a token was minted — roughly 1s through the render-and-send
        # pipeline for a known address versus single-digit ms for an unknown one, which
        # is a far larger signal than network jitter and defeats the constant response
        # body above. The mailer swallows its own failures, so nothing is lost by
        # returning first.
        background.add_task(
            mailer.send_magic_link,
            to=email,
            token=token,
            expires_in_minutes=settings.magic_link_ttl_minutes,
        )

    return MagicLinkResponse(sent=True)


@router.get("/capabilities", response_model=AuthCapabilityResponse)
async def auth_capabilities():
    """Published rules the sign-in screens render. Nothing here varies by address."""
    return AuthCapabilityResponse(
        password_min_length=auth_service.PASSWORD_MIN_LENGTH
    )


@router.post("/password-signin", response_model=VerifyTokenResponse)
async def password_signin(
    payload: PasswordSignInRequest,
    response: Response,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
):
    """The owner's sign-in. Members have no password and cannot use this.

    Every failure path returns the SAME 401 — see :func:`_bad_credentials`. The rate-limit
    refusal deliberately reuses it rather than a 429, because a 429 on one address and a
    401 on another would say which address is worth attacking.
    """
    email = auth_service.normalize_email(payload.email)

    # Rejected before any hashing: PBKDF2 cost scales with input length, so an unbounded
    # password on an unauthenticated endpoint is a cheap way to burn CPU on the Pi target.
    if len(payload.password or "") > auth_service.PASSWORD_MAX_LENGTH:
        raise _bad_credentials()

    if not auth_service.rate_limiter.check(
        f"password-signin:{email}", limit=_PASSWORD_LIMIT, window_seconds=_PASSWORD_WINDOW
    ):
        raise _bad_credentials()

    raw: Optional[str] = None
    with db as session:
        account = (
            session.query(Account).filter(Account.email == email).first()
            if email
            else None
        )
        # Always run the KDF, against a dummy hash when there is nothing to compare to.
        # verify_password() returns False immediately for a NULL hash, so without the
        # fallback an unknown address answers in microseconds while the owner's costs
        # ~100ms — which times the owner's address precisely, defeating the constant body.
        stored = (account.password_hash if account else None) or _DUMMY_PASSWORD_HASH
        ok = auth_service.verify_password(payload.password, stored)
        if (
            account is None
            or account.role != ROLE_OWNER
            or account.status != STATUS_ACTIVE
            or not account.password_hash
            or not ok
        ):
            raise _bad_credentials()

        # A successful sign-in clears the throttle, so a forgotten-then-remembered
        # password does not leave the owner locked out of their own instance.
        auth_service.rate_limiter.reset(f"password-signin:{email}")
        raw, _ = auth_service.create_session(
            session, account, user_agent=request.headers.get("user-agent")
        )

    _set_session_cookie(response, raw)
    return VerifyTokenResponse(ok=True, redirect="/")


@router.post("/request-password-reset", response_model=MagicLinkResponse)
async def request_password_reset(
    payload: PasswordResetRequest,
    background: BackgroundTasks,
    db: Annotated[Session, Depends(get_db)],
):
    """Email the owner a set-a-new-password link. Constant response, as for /request-link.

    Doubles as the FIRST-password path: an owner created by an ownership transfer, or one
    whose instance was claimed before passwords existed, has no ``password_hash`` and uses
    this to set one. That is why it does not require a password to already exist.
    """
    email = auth_service.normalize_email(payload.email)
    token: Optional[str] = None
    first_time = False

    allowed = auth_service.rate_limiter.check(
        f"password-reset:{email}", limit=_RESET_LIMIT, window_seconds=_RESET_WINDOW
    )

    if allowed and email:
        with db as session:
            account = (
                session.query(Account)
                .filter(
                    Account.email == email,
                    Account.role == ROLE_OWNER,
                    Account.status == STATUS_ACTIVE,
                )
                .first()
            )
            if account is not None:
                first_time = not account.password_hash
                auth_service.invalidate_tokens_for(
                    session, account_id=account.id, purpose=PURPOSE_PASSWORD_RESET
                )
                token, _ = auth_service.issue_auth_token(
                    session,
                    email=email,
                    purpose=PURPOSE_PASSWORD_RESET,
                    account_id=account.id,
                )

    if token:
        # Backgrounded so the response time does not depend on whether a token was
        # minted — the same enumeration guard as /request-link.
        background.add_task(
            mailer.send_password_reset,
            to=email,
            token=token,
            expires_in_minutes=settings.magic_link_ttl_minutes,
            is_first_time=first_time,
        )

    return MagicLinkResponse(sent=True)


@router.post("/reset-password", response_model=VerifyTokenResponse)
async def reset_password(
    payload: PasswordResetConfirm,
    response: Response,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
):
    """Consume a reset token and set a new password, then sign in.

    This is the ONLY consumer of a ``password_reset`` token. ``/auth/verify`` refuses that
    purpose, so the emailed link is not a session on its own — it is worthless without a
    new password being chosen at the same time, which is what keeps the owner
    password-only rather than password-or-link.
    """
    raw: Optional[str] = None
    with db as session:
        row = auth_service.consume_auth_token(
            session, payload.token, purpose=PURPOSE_PASSWORD_RESET
        )
        if row is None:
            raise HTTPException(
                status_code=410, detail="This link is no longer valid."
            )

        account = (
            session.query(Account).filter(Account.id == row.account_id).first()
            if row.account_id
            else None
        )
        # ACTIVE is required, not repaired. A reset token can only be minted for an
        # active owner (/request-password-reset filters on it, and a transfer only targets
        # an active member), so this is unreachable in the happy path — but flipping the
        # status here instead of refusing would turn a reset link into a way to resurrect
        # a revoked account.
        if (
            account is None
            or account.role != ROLE_OWNER
            or account.status != STATUS_ACTIVE
        ):
            raise HTTPException(
                status_code=410, detail="This link is no longer valid."
            )

        problem = auth_service.password_problem(payload.password, email=account.email)
        if problem:
            # The token is already burned at this point, so say so plainly rather than
            # letting the owner retype into a link that no longer works.
            raise HTTPException(
                status_code=422,
                detail=f"{problem} Request a new link and try again.",
            )

        account.password_hash = auth_service.hash_password(payload.password)

        # Every other session is dropped: a password reset is what someone does when they
        # think the old one leaked, and leaving old cookies live would defeat the point.
        auth_service.revoke_all_sessions_for_account(session, account.id)
        raw, _ = auth_service.create_session(
            session, account, user_agent=request.headers.get("user-agent")
        )

    _set_session_cookie(response, raw)
    return VerifyTokenResponse(ok=True, redirect="/")


@router.post("/verify", response_model=VerifyTokenResponse)
async def verify_token(
    payload: VerifyTokenRequest,
    response: Response,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
):
    """Burn a magic-link token and open a session. Handles login AND claim verify.

    The token arrives in a JSON BODY, never a path segment: ``error_handler`` middleware
    logs ``request.url.path`` to stdout and to a 7-day-retained file in the persisted
    logs volume, so a token in the path would be replayable by anyone with log access
    for a week. Query strings and bodies are not logged.
    """
    with db as session:
        # The purposes are passed in, not filtered afterwards: consuming first would
        # burn a password_reset token posted here by mistake, and it would survive only
        # because the 410 happens to roll the transaction back.
        row = auth_service.consume_auth_token(
            session, payload.token, purpose=(PURPOSE_LOGIN, PURPOSE_CLAIM_VERIFY)
        )
        if row is None:
            # Unknown, expired, already-clicked and wrong-purpose are one answer: a
            # distinguishable response would say which links exist.
            raise HTTPException(status_code=410, detail="This link is no longer valid")

        account = (
            session.query(Account).filter(Account.id == row.account_id).first()
            if row.account_id
            else accounts_service.account_for_email(session, row.email)
        )
        if account is None:
            raise HTTPException(status_code=410, detail="This link is no longer valid")

        claimed = False
        if row.purpose == PURPOSE_CLAIM_VERIFY:
            if accounts_service.is_claimed(session):
                # A stale claim link cannot re-finalise an instance that already has an
                # owner, and must never mint a session for whoever holds it.
                raise HTTPException(
                    status_code=410, detail="This link is no longer valid"
                )
            # The token carries the address that was actually verified. POST /claim
            # writes the submitted address onto the owner account immediately, so a
            # second claim attempt (a typo, or a race with someone else who read the
            # boot banner) overwrites it while the FIRST link stays live — whoever
            # clicks first would otherwise take ownership under the other person's
            # address, locking the real operator out with no recovery path.
            account.email = row.email
            accounts_service.finalize_claim(session, account)
            claimed = True
        elif account.status != STATUS_ACTIVE:
            # A revoked or still-pending account cannot sign in even holding a valid
            # token — status is the only thing require_session trusts.
            raise HTTPException(status_code=410, detail="This link is no longer valid")
        elif account.role == ROLE_OWNER:
            # Enforced at mint AND at consumption. A login token that predates an
            # ownership transfer would otherwise still let the new owner in by link,
            # quietly reopening the route this design closes.
            raise HTTPException(status_code=410, detail="This link is no longer valid")

        raw, _ = auth_service.create_session(
            session, account, user_agent=request.headers.get("user-agent")
        )

    _set_session_cookie(response, raw)
    return VerifyTokenResponse(ok=True, redirect="/", claimed=claimed)


@router.post("/invite/preview", response_model=InvitePreviewResponse)
async def preview_invite(
    payload: InvitePreviewRequest, db: Annotated[Session, Depends(get_db)]
):
    """What the /invite page shows before asking for a display name. Read-only."""
    with db as session:
        invite = accounts_service.lookup_invite(session, payload.token)
        if invite is None:
            raise HTTPException(status_code=410, detail="This invite is no longer valid")

        inviter = invite.invited_by
        instance = accounts_service.get_instance(session, create=False)
        return InvitePreviewResponse(
            email=invite.email,
            invited_by=(inviter.display_name or inviter.email) if inviter else None,
            # Falls back to the product name, NOT settings.project_name ("Freeflix
            # API"): nothing in the shipped UI sets instance_name, so that default would
            # be what every invitee sees.
            instance_name=(instance.instance_name if instance else None) or "FRÈ",
            expires_at=invite.expires_at,
        )


@router.post("/invite/accept", response_model=OkResponse)
async def accept_invite(
    payload: InviteAcceptRequest,
    response: Response,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
):
    """Redeem an invite: activate the account, create its first profile, sign in."""
    display_name = (payload.display_name or "").strip()
    if not display_name:
        raise HTTPException(status_code=422, detail="A profile name is required")

    with db as session:
        invite = accounts_service.lookup_invite(session, payload.token)
        if invite is None:
            raise HTTPException(status_code=410, detail="This invite is no longer valid")

        account, _profile = accounts_service.accept_invite(
            session, invite, display_name=display_name, avatar=payload.avatar
        )
        raw, _ = auth_service.create_session(
            session, account, user_agent=request.headers.get("user-agent")
        )
        welcome_to = account.email
        welcome_name = account.display_name or display_name

    _set_session_cookie(response, raw)
    await mailer.send_welcome(to=welcome_to, display_name=welcome_name)
    return OkResponse(ok=True)


@router.get("/me", response_model=SessionResponse, dependencies=[Depends(require_session)])
async def read_me(
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_session),
):
    """The single frontend bootstrap call: who am I, and which profiles are mine."""
    with db as session:
        account = session.query(Account).filter(Account.id == ctx.account_id).first()
        if account is None:
            # Only reachable with auth_enabled=False, where require_session hands out a
            # synthetic owner context that has no row behind it.
            raise HTTPException(status_code=401, detail="Not signed in")

        profiles = accounts_service.profiles_for_account(session, account.id)
        return SessionResponse(
            account=AccountResponse.model_validate(account),
            profiles=[_profile_payload(p) for p in profiles],
        )


@router.post("/signout", response_model=OkResponse, dependencies=[Depends(require_session)])
async def sign_out(
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_session),
):
    """End the session server-side AND clear the cookie.

    Both halves matter: clearing only the cookie leaves a live row that any copy of the
    token still authenticates against, and revoking only the row leaves the browser
    re-sending a dead cookie on every request.
    """
    if ctx.session_id:
        with db as session:
            row = (
                session.query(AuthSession)
                .filter(AuthSession.id == ctx.session_id)
                .first()
            )
            if row is not None:
                auth_service.revoke_session(session, row)
            else:
                logger.warning(f"Sign-out for unknown session id {ctx.session_id}")

    response.delete_cookie(settings.cookie_name, path="/")
    return OkResponse(ok=True)
