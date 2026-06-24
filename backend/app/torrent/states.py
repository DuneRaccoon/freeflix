"""Canonical torrent state vocabulary, shared across manager / model / API."""

# Mid-download states: count toward the activity badge and auto-resume on startup.
ACTIVE_DOWNLOAD_STATES = frozenset({
    "queued", "checking", "downloading_metadata",
    "downloading", "allocating", "checking_fastresume",
})

# States a user can resume from.
RESUMABLE_STATES = frozenset({"paused", "stopped"})

# Done / dead states.
TERMINAL_STATES = frozenset({"finished", "seeding", "error", "blocked"})

PAUSED = "paused"
