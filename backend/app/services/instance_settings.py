"""Owner-chosen instance settings. NULL columns mean "never chosen"."""

from dataclasses import dataclass, fields
from typing import Optional

from app.database.models.accounts import Instance


@dataclass(frozen=True)
class EffectiveSettings:
    autovacuum_enabled: bool
    autovacuum_days: int
    autovacuum_watched_gate: bool
    autovacuum_watched_pct: int
    auto_next_enabled: bool
    auto_next_pct: int


DEFAULTS = EffectiveSettings(False, 30, True, 80, True, 80)
SETTING_FIELDS: tuple = tuple(f.name for f in fields(EffectiveSettings))


def effective_settings(instance: Optional[Instance]) -> EffectiveSettings:
    """Stored value if not None, else the default. Never `or`: False is a choice."""
    values = {}
    for name in SETTING_FIELDS:
        stored = getattr(instance, name, None) if instance is not None else None
        values[name] = stored if stored is not None else getattr(DEFAULTS, name)
    return EffectiveSettings(**values)
