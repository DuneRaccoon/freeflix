from sqlalchemy import UniqueConstraint

from app.database.models import UserStreamingProgress


def test_unique_constraint_declared_on_user_id_movie_id():
    constraints = [
        c for c in UserStreamingProgress.__table__.constraints
        if isinstance(c, UniqueConstraint)
    ]
    cols = [tuple(sorted(col.name for col in c.columns)) for c in constraints]
    assert ("movie_id", "user_id") in cols


def test_content_id_column_exists_and_nullable():
    col = UserStreamingProgress.__table__.columns.get("content_id")
    assert col is not None
    assert col.nullable is True
