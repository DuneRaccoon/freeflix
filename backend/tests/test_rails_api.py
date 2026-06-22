"""Rails endpoint returns an ordered list and validates mode."""
import os
os.environ.setdefault("DB_PATH", "/tmp/test_rails_api.db")

import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def test_rails_cold_start_returns_rails(client):
    r = client.get("/api/v1/rails?mode=movie&limit=8")
    assert r.status_code == 200
    rails = r.json()["rails"]
    assert len(rails) == 8
    assert rails[0]["params"]["api"] == "popular"


def test_rails_rejects_bad_mode(client):
    r = client.get("/api/v1/rails?mode=podcast")
    assert r.status_code == 422


def test_rails_tv_mode(client):
    r = client.get("/api/v1/rails?mode=tv&limit=6")
    assert r.status_code == 200
    assert r.json()["rails"][0]["title"].endswith("Series")
