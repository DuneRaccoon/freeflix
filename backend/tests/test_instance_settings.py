from app.database.models.accounts import Instance, INSTANCE_SINGLETON_ID
from app.services.instance_settings import EffectiveSettings, effective_settings

LITERAL_DEFAULTS = EffectiveSettings(
    autovacuum_enabled=False, autovacuum_days=30, autovacuum_watched_gate=True,
    autovacuum_watched_pct=80, auto_next_enabled=True, auto_next_pct=80,
)
COLUMNS = ("autovacuum_enabled", "autovacuum_days", "autovacuum_watched_gate",
           "autovacuum_watched_pct", "auto_next_enabled", "auto_next_pct")

def test_an_all_null_instance_reads_as_the_spec_defaults():
    assert effective_settings(Instance(id=INSTANCE_SINGLETON_ID)) == LITERAL_DEFAULTS

def test_a_missing_instance_row_reads_as_the_spec_defaults():
    assert effective_settings(None) == LITERAL_DEFAULTS

def test_a_stored_false_is_not_mistaken_for_unset():
    row = Instance(id=INSTANCE_SINGLETON_ID, autovacuum_watched_gate=False, auto_next_enabled=False)
    got = effective_settings(row)
    assert got.autovacuum_watched_gate is False and got.auto_next_enabled is False

def test_stored_values_win():
    row = Instance(id=INSTANCE_SINGLETON_ID, autovacuum_enabled=True, autovacuum_days=7,
                   autovacuum_watched_pct=50, auto_next_pct=65)
    got = effective_settings(row)
    assert (got.autovacuum_enabled, got.autovacuum_days, got.autovacuum_watched_pct, got.auto_next_pct) == (True, 7, 50, 65)

def test_the_columns_are_nullable_with_no_default_so_sync_columns_can_add_them():
    assert len(COLUMNS) == 6
    for name in COLUMNS:
        col = Instance.__table__.columns[name]
        assert col.nullable is True, name
        assert col.default is None and col.server_default is None, name
