"""Who may see and manage a download (spec 2026-11-06 section 3.2).

The owner sees every download. A member sees only the rows their account started. A NULL
``torrents.account_id`` (pre-change rows, schedule-cron downloads) is the owner's, so no
member ever matches it.

This scopes only the *management* routes (list, batch, delete, pause/stop, the activity
badge). Play, status, sources, prioritize, resume and every streaming route stay unscoped
on purpose: a member pressing Play on a film the owner already holds must still play it.
"""
from app.database.models import Torrent
from app.dependencies.auth import AuthContext


def visible_to(row, ctx: AuthContext) -> bool:
    """True when ``ctx`` may see ``row`` (anything with ``.account_id``)."""
    return ctx.is_owner or (row.account_id is not None and row.account_id == ctx.account_id)


def scope_query(query, ctx: AuthContext):
    """``query`` unchanged for the owner, else narrowed to the caller's account."""
    if ctx.is_owner:
        return query
    return query.filter(Torrent.account_id == ctx.account_id)
