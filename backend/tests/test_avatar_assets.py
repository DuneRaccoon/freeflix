import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import UserUpdate

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


def test_from_tmdb_rejects_png_now_that_only_jpg_is_accepted():
    """TMDB serves .jpg for the stills this feature draws on, and resolve.ts
    hardcodes .jpg when building the asset URL from a cached: id -- so a .png
    source would cache fine here and then 404 on render. Narrowing the input
    is the fix; this pins that the narrowing actually took."""
    r = client.post(
        "/api/v1/avatars/from-tmdb",
        json={"path": "/abcdefghijklmnopqrstuvwx.png"},
    )
    assert r.status_code == 422, r.text


def test_minted_id_satisfies_the_avatar_grammar(monkeypatch):
    """The id this endpoint returns must be storable as a profile avatar.

    Without this, from-tmdb can hand a client an id that 422s on save and
    never renders -- and every other test in this file still passes, because
    none of them trace the returned id anywhere. This constructs the REAL
    `UserUpdate` schema rather than asserting against a regex copied into the
    test, so it breaks if either the minting or the grammar drifts.
    """
    from app.assets import manager as manager_module

    async def _fake_download(self, url, asset_type=None, filename=None):
        # No network: pretend the fetch succeeded without touching image.tmdb.org.
        return True, "fake-path"

    monkeypatch.setattr(manager_module.AssetManager, "download_asset", _fake_download)

    r = client.post(
        "/api/v1/avatars/from-tmdb",
        json={"path": "/9NAZnTjBQ9WcXAQEzZpKy4vDQ9h.jpg"},
    )
    assert r.status_code == 200, r.text
    minted_id = r.json()["id"]

    assert UserUpdate(avatar=minted_id).avatar == minted_id
