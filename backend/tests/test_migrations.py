import os
os.environ.setdefault("DB_PATH", "/tmp/test_migrations.db")

from sqlalchemy import create_engine, MetaData, Table, Column, Integer, String, inspect, text

from app.database.session import sync_columns


def test_sync_columns_adds_missing_columns_to_existing_table(tmp_path):
    """sync_columns should ALTER an existing table to add model columns it lacks."""
    engine = create_engine(f"sqlite:///{tmp_path / 'mig.db'}")
    # Simulate an old deployment: table exists but only has `id`.
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE widget (id INTEGER PRIMARY KEY)"))

    # Desired (model) schema has two extra columns.
    md = MetaData()
    Table(
        "widget", md,
        Column("id", Integer, primary_key=True),
        Column("name", String),
        Column("count", Integer),
    )

    sync_columns(engine, md.sorted_tables)

    cols = {c["name"] for c in inspect(engine).get_columns("widget")}
    assert {"id", "name", "count"} <= cols


def test_sync_columns_is_idempotent_and_skips_present_columns(tmp_path):
    """Running twice is a no-op the second time; existing columns are left alone."""
    engine = create_engine(f"sqlite:///{tmp_path / 'mig.db'}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE widget (id INTEGER PRIMARY KEY, name VARCHAR)"))

    md = MetaData()
    Table(
        "widget", md,
        Column("id", Integer, primary_key=True),
        Column("name", String),
        Column("count", Integer),
    )

    sync_columns(engine, md.sorted_tables)
    sync_columns(engine, md.sorted_tables)  # second run must not raise

    cols = {c["name"] for c in inspect(engine).get_columns("widget")}
    assert {"id", "name", "count"} <= cols


def test_sync_columns_ignores_tables_not_yet_created(tmp_path):
    """A model table absent from the DB is left for create_all; sync_columns skips it cleanly."""
    engine = create_engine(f"sqlite:///{tmp_path / 'mig.db'}")
    md = MetaData()
    Table("ghost", md, Column("id", Integer, primary_key=True), Column("x", Integer))

    # Must not raise even though `ghost` does not exist in the DB.
    sync_columns(engine, md.sorted_tables)

    assert "ghost" not in set(inspect(engine).get_table_names())
