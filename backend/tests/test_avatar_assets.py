import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


@pytest.mark.parametrize("bad", [
    "https://evil.example/x.jpg",
    "//evil.example/x.jpg",
    "/../../etc/passwd",
    "/abc.jpg",                      # too short
    "/abc123def456ghi789jkl.gif",    # disallowed extension
    "",
])
def test_from_tmdb_rejects_anything_that_is_not_a_tmdb_path(bad):
    r = client.post("/api/v1/avatars/from-tmdb", json={"path": bad})
    assert r.status_code == 422, r.text


def test_serving_an_unknown_asset_404s():
    r = client.get("/api/v1/assets/avatars/deadbeefdeadbeef.jpg")
    assert r.status_code == 404


@pytest.mark.parametrize("hostile", ["..%2F..%2Fetc%2Fpasswd", "....//etc/passwd"])
def test_serving_refuses_traversal(hostile):
    r = client.get(f"/api/v1/assets/avatars/{hostile}")
    assert r.status_code in (404, 422)
