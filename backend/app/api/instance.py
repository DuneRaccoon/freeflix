# app/api/instance.py
"""Instance claim, membership and ownership.

Three audiences share this module:

* ``GET /instance/status`` is **public** — it is the very first call the frontend makes,
  before it knows whether anyone has ever signed in. It reports only whether the
  instance is claimed; the claim code itself never crosses this boundary.
* ``POST /claim`` is **public** and mounted at ``/api/v1/claim`` (not under
  ``/instance``) because that is the path the spec's flow and the ``/claim`` page use.
  It lives here so all claim logic sits in one file.
* Everything else is **owner-only** via ``Depends(require_owner)``.

The lifecycle actions deliberately do not use ``CRUDMixin.delete()``: its default is a
soft delete that merely stamps ``deleted_at``, and nothing in this codebase filters on
that column — a "removed" member would keep authenticating. Revocation is a status
change the session lookup checks; removal is a real DELETE that cascades.
"""

from typing import Annotated, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from loguru import logger
from sqlalchemy.orm import Session

from app.config import settings
from app.database.models.accounts import (
    Account,
    Invite,
    PURPOSE_CLAIM_VERIFY,
    PURPOSE_PASSWORD_RESET,
    ROLE_MEMBER,
)
from app.database.session import get_db
from app.dependencies.auth import AuthContext, require_owner
from app.models import (
    AccountResponse,
    ClaimRequest,
    ClaimResponse,
    InstanceSettingsUpdate,
    InstanceStatusResponse,
    InviteCreateRequest,
    InviteResponse,
    InviteSendResponse,
    MemberResponse,
    MembersResponse,
    OkResponse,
    TransferOwnershipRequest,
)
from app.services import accounts as accounts_service
from app.services import auth as auth_service
from app.services import mailer

router = APIRouter()

# Mounted separately at /api/v1 so the path is POST /api/v1/claim.
claim_router = APIRouter()

# Per-email budget for claim attempts, plus a small GLOBAL budget for wrong codes.
# The global one is what actually protects the code: it is 12 characters from a
# 32-symbol alphabet, and an attacker who controls many addresses would otherwise get a
# fresh per-email budget for each one.
_CLAIM_LIMIT = 5
_CLAIM_WINDOW = 15 * 60
_CLAIM_FAILURE_LIMIT = 10

# Reasons raised by app.services.accounts, mapped to the status codes the frontend
# branches on. An unmapped reason is a bug, not a client error, so it 500s loudly.
_INVITE_ERRORS = {
    "already_a_member": (409, "That person is already a member."),
    "email_in_use": (409, "That email already belongs to another account."),
    "invalid_email": (422, "That does not look like an email address."),
    "unknown_account": (404, "That account no longer exists."),
}


def _instance_status(session: Session) -> InstanceStatusResponse:
    row = accounts_service.get_instance(session, create=False)
    claimed = bool(row and row.claimed_at is not None)
    return InstanceStatusResponse(
        claimed=claimed,
        needs_claim=not claimed,
        instance_name=(row.instance_name if row else None),
        claimed_at=(row.claimed_at if row else None),
    )


def _open_invites(session: Session) -> List[Invite]:
    return (
        session.query(Invite)
        .filter(Invite.accepted_at.is_(None), Invite.revoked_at.is_(None))
        .order_by(Invite.created_at.desc(), Invite.id.asc())
        .all()
    )


def _invite_error(exc: ValueError) -> HTTPException:
    code, detail = _INVITE_ERRORS.get(str(exc), (0, ""))
    if not code:
        raise exc
    return HTTPException(status_code=code, detail=detail)


def _owner_account(session: Session, ctx: AuthContext) -> Account:
    account = session.query(Account).filter(Account.id == ctx.account_id).first()
    if account is None:
        # Only reachable with auth_enabled=False, where require_session hands out a
        # synthetic owner context with no row behind it.
        raise HTTPException(status_code=401, detail="Not signed in")
    return account


def _target_account(session: Session, account_id: str, ctx: AuthContext) -> Account:
    """Load the account an owner action applies to, refusing self-targeting.

    An owner who revokes, removes or demotes themselves leaves an instance with no
    owner and no way to appoint one — there is no console, and the claim code is long
    gone. This is the single guard that makes that unreachable.
    """
    account = session.query(Account).filter(Account.id == account_id).first()
    if account is None:
        raise HTTPException(status_code=404, detail="That account no longer exists.")
    if account.id == ctx.account_id:
        raise HTTPException(
            status_code=400,
            detail="You cannot do that to your own account. Transfer ownership first.",
        )
    return account


# ------------------------------------------------------------------ public status


@router.get("/status", response_model=InstanceStatusResponse)
async def instance_status(db: Annotated[Session, Depends(get_db)]):
    """Public boot check: has anyone claimed this instance yet?

    Intentionally the only unauthenticated read in the app. It carries no account data
    and never the claim code — a caller learns exactly what the /claim page needs to
    decide whether to render itself.
    """
    with db as session:
        return _instance_status(session)


@claim_router.post("/claim", response_model=ClaimResponse)
async def claim_instance(payload: ClaimRequest, db: Annotated[Session, Depends(get_db)]):
    """First-run claim: prove possession of the boot code, then verify the email.

    The code alone does not claim anything. It mints a ``claim_verify`` magic link, and
    only clicking that link (``POST /auth/verify``) sets ``instance.claimed_at``. That
    second step is what stops a mistyped address from permanently owning the instance.
    """
    email = auth_service.normalize_email(payload.email)
    if not email or "@" not in email:
        raise HTTPException(status_code=422, detail="Enter a valid email address.")

    # Validated BEFORE the claim code is checked, so a weak password does not burn a
    # failure from the wrong-code budget.
    problem = auth_service.password_problem(payload.password, email=email)
    if problem:
        raise HTTPException(status_code=422, detail=problem)

    token: Optional[str] = None

    with db as session:
        if accounts_service.is_claimed(session):
            raise HTTPException(
                status_code=409, detail="This instance has already been claimed."
            )

        if not auth_service.rate_limiter.check(
            f"claim:{email}", limit=_CLAIM_LIMIT, window_seconds=_CLAIM_WINDOW
        ):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many attempts. Try again in a few minutes.",
            )

        if not accounts_service.verify_claim_code(session, payload.claim_code):
            # The failure budget is only spent on a WRONG code, so an operator
            # retyping a correct one is never throttled out of their own instance.
            if not auth_service.rate_limiter.check(
                "claim-failures",
                limit=_CLAIM_FAILURE_LIMIT,
                window_seconds=_CLAIM_WINDOW,
            ):
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many attempts. Restart the container for a new code.",
                )
            raise HTTPException(status_code=403, detail="That claim code is not valid.")

        owner = accounts_service.attach_owner_email(session, email)
        # Stored now, effective only once the emailed link proves the address. A second
        # claim submission overwrites both the address and the password together, and
        # invalidates the first link, so the pair can never end up mismatched.
        owner.password_hash = auth_service.hash_password(payload.password)
        # Scoped by ACCOUNT, not by the submitted address. attach_owner_email has just
        # overwritten owner.email, so filtering on `email` would leave a token already
        # sent to a previously-submitted (mistyped) address live and still pointing at
        # this same owner account — whoever holds that mailbox could claim the instance
        # out from under the operator who corrected the typo.
        auth_service.invalidate_tokens_for(
            session, account_id=owner.id, purpose=PURPOSE_CLAIM_VERIFY
        )
        token, _ = auth_service.issue_auth_token(
            session,
            email=email,
            purpose=PURPOSE_CLAIM_VERIFY,
            account_id=owner.id,
        )

    # Sent after the commit: the token row has to be durable before the link can be
    # clicked, and an outbound HTTP call must not hold a pooled connection open.
    result = await mailer.send_claim_verify(
        to=email, token=token, expires_in_minutes=settings.magic_link_ttl_minutes
    )
    return ClaimResponse(
        sent=True,
        delivered=result.delivered,
        # Surfaced only when there is no mail provider, so a self-hosted operator can
        # still finish the claim by opening the link themselves.
        action_url=None if result.delivered else result.action_url,
    )


# -------------------------------------------------------------------- owner: read


@router.get("/members", response_model=MembersResponse)
async def list_members(
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_owner),
):
    """Everyone on the instance, plus every invite still outstanding.

    ``profile_names`` is included because the upgrade migration created one
    ``pending_email`` account per pre-existing profile: the profile names are the only
    way the owner can tell which row is which cousin before attaching an email to it.
    """
    with db as session:
        accounts = (
            session.query(Account)
            # "owner" sorts after "member", so DESC puts the owner's row first — the
            # members page reads top-down and the owner is the anchor of that list.
            .order_by(Account.role.desc(), Account.created_at.asc(), Account.id.asc())
            .all()
        )
        members = [
            MemberResponse(
                account=AccountResponse.model_validate(account),
                profile_count=len(account.profiles or []),
                profile_names=[p.display_name for p in (account.profiles or [])],
                is_you=account.id == ctx.account_id,
            )
            for account in accounts
        ]
        return MembersResponse(
            members=members,
            invites=[InviteResponse.model_validate(i) for i in _open_invites(session)],
        )


@router.get("/invites", response_model=List[InviteResponse])
async def list_invites(
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_owner),
):
    with db as session:
        return [InviteResponse.model_validate(i) for i in _open_invites(session)]


# ------------------------------------------------------------------ owner: invites


@router.post("/invites", response_model=InviteSendResponse, status_code=201)
async def create_invite(
    payload: InviteCreateRequest,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_owner),
):
    """Invite an address, optionally onto an account that already exists.

    ``account_id`` is the upgrade path: the migration left one ``pending_email`` account
    per pre-auth profile, and adopting one attaches the invitee's email to it so they
    keep their profiles, watch positions and watchlist. Without it a brand-new account
    is created and the old rows stay orphaned under an account nobody can sign in to.
    """
    token: Optional[str] = None
    invite_payload: Optional[InviteResponse] = None
    email = auth_service.normalize_email(payload.email)
    inviter_name: Optional[str] = None

    with db as session:
        owner = _owner_account(session, ctx)
        inviter_name = owner.display_name or owner.email

        if payload.account_id:
            try:
                accounts_service.adopt_pending_account(
                    session, account_id=payload.account_id, email=email
                )
            except ValueError as e:
                raise _invite_error(e)

        try:
            token, invite, _target = accounts_service.create_invite(
                session, email=email, invited_by=owner, role=ROLE_MEMBER
            )
        except ValueError as e:
            raise _invite_error(e)

        invite_payload = InviteResponse.model_validate(invite)

    result = await mailer.send_invite(
        to=email,
        token=token,
        invited_by=inviter_name,
        expires_in_hours=settings.invite_ttl_hours,
    )
    return InviteSendResponse(
        invite=invite_payload,
        sent=True,
        delivered=result.delivered,
        action_url=None if result.delivered else result.action_url,
    )


@router.delete("/invites/{invite_id}", response_model=OkResponse)
async def revoke_invite(
    invite_id: str,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_owner),
):
    with db as session:
        invite = session.query(Invite).filter(Invite.id == invite_id).first()
        if invite is None:
            raise HTTPException(status_code=404, detail="That invite no longer exists.")
        if invite.accepted_at is not None:
            raise HTTPException(
                status_code=409,
                detail="That invite has already been accepted. Revoke the member instead.",
            )
        invite.revoked_at = auth_service.utcnow()
        return OkResponse(ok=True)


@router.post("/invites/{invite_id}/resend", response_model=InviteSendResponse)
async def resend_invite(
    invite_id: str,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_owner),
):
    """Mint a fresh invite for the same address; the old link dies immediately.

    A resend is a new token rather than a re-send of the old one — the stored value is
    a sha256, so the original raw token cannot be recovered, and reusing it would also
    mean a forwarded old email stayed redeemable after the resend.
    """
    token: Optional[str] = None
    invite_payload: Optional[InviteResponse] = None
    email: Optional[str] = None
    inviter_name: Optional[str] = None

    with db as session:
        existing = session.query(Invite).filter(Invite.id == invite_id).first()
        if existing is None:
            raise HTTPException(status_code=404, detail="That invite no longer exists.")
        if existing.accepted_at is not None:
            raise HTTPException(
                status_code=409, detail="That invite has already been accepted."
            )

        owner = _owner_account(session, ctx)
        inviter_name = owner.display_name or owner.email
        email = existing.email

        try:
            token, invite, _target = accounts_service.create_invite(
                session, email=email, invited_by=owner, role=existing.role or ROLE_MEMBER
            )
        except ValueError as e:
            raise _invite_error(e)

        invite_payload = InviteResponse.model_validate(invite)

    result = await mailer.send_invite(
        to=email,
        token=token,
        invited_by=inviter_name,
        expires_in_hours=settings.invite_ttl_hours,
    )
    return InviteSendResponse(
        invite=invite_payload,
        sent=True,
        delivered=result.delivered,
        action_url=None if result.delivered else result.action_url,
    )


# ------------------------------------------------------------------ owner: members


@router.post("/members/{account_id}/revoke", response_model=OkResponse)
async def revoke_member(
    account_id: str,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_owner),
):
    """Stop an account signing in, destroying nothing. Reversible via /restore."""
    notify_to: Optional[str] = None
    notify_name: Optional[str] = None

    with db as session:
        account = _target_account(session, account_id, ctx)
        notify_to = account.email
        notify_name = account.display_name
        accounts_service.revoke_account(session, account)

    if notify_to:
        await mailer.send_access_revoked(to=notify_to, display_name=notify_name)
    return OkResponse(ok=True)


@router.post("/members/{account_id}/restore", response_model=OkResponse)
async def restore_member(
    account_id: str,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_owner),
):
    with db as session:
        account = _target_account(session, account_id, ctx)
        accounts_service.restore_account(session, account)
        return OkResponse(ok=True)


@router.delete("/members/{account_id}", response_model=OkResponse)
async def remove_member(
    account_id: str,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_owner),
):
    """Hard-delete an account: profiles, settings, watch progress and watchlist go too.

    Irreversible, and the UI confirms it with an explicit list of what is destroyed.
    ``torrents.user_id`` and ``schedules.user_id`` are NULL on every row, so no download
    or schedule is orphaned.
    """
    notify_to: Optional[str] = None
    notify_name: Optional[str] = None

    with db as session:
        account = _target_account(session, account_id, ctx)
        notify_to = account.email
        notify_name = account.display_name
        accounts_service.remove_account(session, account)
        logger.info(f"Removed account {account_id} from the instance")

    if notify_to:
        await mailer.send_access_revoked(to=notify_to, display_name=notify_name)
    return OkResponse(ok=True)


@router.post("/transfer", response_model=OkResponse)
async def transfer_ownership(
    payload: TransferOwnershipRequest,
    background: BackgroundTasks,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_owner),
):
    """Hand the instance to an active member; the current owner becomes a member.

    The two roles authenticate differently, so a transfer swaps credentials as well as
    permissions. The incoming owner has no password (members never do), so they get a
    set-a-new-password link; their existing session keeps working until they follow it, so
    the transfer is not a lockout. The outgoing owner keeps no password — they are a
    member now, and members sign in by magic link.
    """
    target_email: Optional[str] = None
    reset_token: Optional[str] = None

    with db as session:
        current = _owner_account(session, ctx)
        target = _target_account(session, payload.account_id, ctx)
        try:
            accounts_service.transfer_ownership(
                session, current=current, target=target
            )
        except ValueError as e:
            if str(e) == "target_not_active":
                raise HTTPException(
                    status_code=409,
                    detail="That person has not accepted their invite yet.",
                )
            raise

        # The old owner's password stops being a way in the moment they are a member,
        # because /auth/password-signin requires ROLE_OWNER. Clearing it means a later
        # transfer back cannot silently resurrect a stale credential.
        #
        # Their SESSION is deliberately left alone: require_session re-reads the role
        # from the database on every request, so there is no stale privilege to revoke,
        # and killing it here would 401 the outgoing owner's very next request — which
        # reads as a bug rather than as a handover.
        current.password_hash = None

        target_email = target.email
        if target_email and not target.password_hash:
            # Unreachable today (the target is a member, and members never hold reset
            # tokens), but a transfer that is undone and redone would otherwise leave two
            # live set-password links for the same account.
            auth_service.invalidate_tokens_for(
                session, account_id=target.id, purpose=PURPOSE_PASSWORD_RESET
            )
            reset_token, _ = auth_service.issue_auth_token(
                session,
                email=target_email,
                purpose=PURPOSE_PASSWORD_RESET,
                account_id=target.id,
            )

    if reset_token and target_email:
        background.add_task(
            mailer.send_password_reset,
            to=target_email,
            token=reset_token,
            expires_in_minutes=settings.magic_link_ttl_minutes,
            is_first_time=True,
        )

    return OkResponse(ok=True)


@router.put("/settings", response_model=InstanceStatusResponse)
async def update_instance_settings(
    payload: InstanceSettingsUpdate,
    db: Annotated[Session, Depends(get_db)],
    ctx: AuthContext = Depends(require_owner),
):
    with db as session:
        instance = accounts_service.get_instance(session)
        if payload.instance_name is not None:
            # An empty string is a legitimate value: it clears the name and the UI falls
            # back to the product name.
            instance.instance_name = payload.instance_name.strip() or None
        session.flush()
        return _instance_status(session)
