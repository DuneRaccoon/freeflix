"""Outbound transactional email, rendered and sent by the Next.js side.

React Email is a React library, so the templates cannot live in this Python service.
The split is:

    FastAPI (owns the tokens)
      │  POST {frontend_internal_url}/api/internal/mail
      │  x-internal-mail-secret: <shared secret>
      ▼
    Next.js  src/app/api/internal/mail/route.ts
      ├─ render(<Template {...props} />)      (async since @react-email/render 1.0)
      └─ resend.emails.send(...)

Uses the house httpx pattern from ``app/providers/tmdb.py`` — httpx is already a
dependency, so nothing new is installed.

**Sending never fails a request.** Every helper returns a :class:`MailResult` and logs;
callers report ``{"sent": True, "delivered": <bool>}``. A household instance with no
Resend key still has to work, so when delivery is unavailable the action URL is logged
at WARNING level and the operator can paste it to the invitee by hand.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import urlencode

import httpx
from loguru import logger

from app.config import settings

# Template ids — must match the switch in src/app/api/internal/mail/route.ts.
TEMPLATE_INVITE = "invite"
TEMPLATE_MAGIC_LINK = "magic-link"
TEMPLATE_CLAIM_VERIFY = "claim-verify"
TEMPLATE_WELCOME = "welcome"
TEMPLATE_ACCESS_REVOKED = "access-revoked"
TEMPLATE_PASSWORD_RESET = "password-reset"


@dataclass
class MailResult:
    sent: bool          # the request was accepted for delivery
    delivered: bool     # a provider actually took it
    reason: Optional[str] = None
    action_url: Optional[str] = None


def _public_url(path: str, **params: str) -> str:
    """Build a link for an email body.

    The token always rides in the QUERY STRING of a FRONTEND page, never in a backend
    path. ``middleware/error_handler.py`` logs ``request.url.path`` to stdout AND to a
    7-day-retained file in the persisted ``logs`` volume; a token in the path would be
    replayable by anyone with log access for a week. Query strings are not logged, and
    the page POSTs the token to the API in a JSON body.
    """
    base = settings.app_public_url.rstrip("/")
    query = f"?{urlencode(params)}" if params else ""
    return f"{base}{path}{query}"


def verify_url(token: str) -> str:
    return _public_url("/auth/verify", token=token)


def invite_url(token: str) -> str:
    return _public_url("/invite", token=token)


def password_reset_url(token: str) -> str:
    return _public_url("/auth/reset-password", token=token)


async def _post(template: str, to: str, props: dict[str, Any]) -> MailResult:
    action_url = props.get("actionUrl")

    if not settings.internal_mail_secret:
        logger.warning(
            f"INTERNAL_MAIL_SECRET is unset — not sending '{template}' to {to}. "
            f"Action URL: {action_url}"
        )
        return MailResult(
            sent=False, delivered=False, reason="no_secret", action_url=action_url
        )

    url = f"{settings.frontend_internal_url.rstrip('/')}/api/internal/mail"
    payload = {"template": template, "to": to, "props": props}

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                url,
                json=payload,
                headers={"x-internal-mail-secret": settings.internal_mail_secret},
                timeout=20.0,
            )
            resp.raise_for_status()
            body = resp.json()
    except Exception as e:
        # Never let a mail failure 500 the caller: the invite row is already committed,
        # and the owner can resend from /members.
        logger.error(f"Mail send failed for '{template}' to {to}: {e}")
        logger.warning(f"Undelivered action URL for {to}: {action_url}")
        return MailResult(
            sent=False, delivered=False, reason="transport_error", action_url=action_url
        )

    delivered = bool(body.get("delivered"))
    if not delivered:
        # The route renders successfully but has no Resend key configured. This is a
        # supported self-hosted mode, so log the link loudly instead of failing.
        logger.warning(
            f"'{template}' for {to} was rendered but not delivered "
            f"({body.get('reason')}). Action URL: {body.get('actionUrl') or action_url}"
        )
    else:
        logger.info(f"Sent '{template}' to {to}")

    return MailResult(
        sent=True,
        delivered=delivered,
        reason=body.get("reason"),
        action_url=body.get("actionUrl") or action_url,
    )


async def send_invite(
    *, to: str, token: str, invited_by: Optional[str], expires_in_hours: int
) -> MailResult:
    return await _post(
        TEMPLATE_INVITE,
        to,
        {
            "actionUrl": invite_url(token),
            "invitedBy": invited_by,
            "instanceName": settings.project_name,
            "expiresInHours": expires_in_hours,
        },
    )


async def send_magic_link(*, to: str, token: str, expires_in_minutes: int) -> MailResult:
    return await _post(
        TEMPLATE_MAGIC_LINK,
        to,
        {
            "actionUrl": verify_url(token),
            "expiresInMinutes": expires_in_minutes,
        },
    )


async def send_claim_verify(
    *, to: str, token: str, expires_in_minutes: int
) -> MailResult:
    return await _post(
        TEMPLATE_CLAIM_VERIFY,
        to,
        {
            "actionUrl": verify_url(token),
            "expiresInMinutes": expires_in_minutes,
        },
    )


async def send_password_reset(
    *, to: str, token: str, expires_in_minutes: int, is_first_time: bool = False
) -> MailResult:
    """Set-a-new-password link for the instance owner.

    ``is_first_time`` covers an owner who has no password yet — a transferred owner, or
    one whose instance was claimed before passwords existed — so the copy reads "set your
    password" rather than "reset".
    """
    return await _post(
        TEMPLATE_PASSWORD_RESET,
        to,
        {
            "actionUrl": password_reset_url(token),
            "expiresInMinutes": expires_in_minutes,
            "isFirstTime": is_first_time,
        },
    )


async def send_welcome(*, to: str, display_name: Optional[str]) -> MailResult:
    return await _post(
        TEMPLATE_WELCOME,
        to,
        {
            "actionUrl": settings.app_public_url.rstrip("/") + "/",
            "displayName": display_name,
        },
    )


async def send_access_revoked(*, to: str, display_name: Optional[str]) -> MailResult:
    return await _post(
        TEMPLATE_ACCESS_REVOKED,
        to,
        {"displayName": display_name, "instanceName": settings.project_name},
    )
