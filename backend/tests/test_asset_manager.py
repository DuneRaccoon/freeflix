import os

import pytest

from app.assets.manager import AssetManager


@pytest.fixture
def manager(tmp_path, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "base_app_path", tmp_path)
    return AssetManager()


@pytest.mark.parametrize("hostile", [
    "../../../etc/passwd",
    "avatars/../../../etc/passwd",
    "/etc/passwd",
])
def test_serve_asset_refuses_to_escape_the_cache_root(manager, hostile):
    with pytest.raises(FileNotFoundError):
        manager.serve_asset(hostile)


def test_serve_asset_reads_a_file_inside_the_cache(manager):
    target = manager.asset_paths["avatar"] / "abc123.jpg"
    target.write_bytes(b"\xff\xd8\xff")
    content, content_type = manager.serve_asset("avatars/abc123.jpg")
    assert content == b"\xff\xd8\xff"
    assert content_type == "image/jpeg"


def test_missing_file_raises_rather_than_leaking_the_path(manager):
    with pytest.raises(FileNotFoundError):
        manager.serve_asset("avatars/nope.jpg")


def test_serve_asset_refuses_relative_traversal_even_when_the_target_exists(manager):
    """The ``../../../etc/passwd``-style cases above pass whether or not the
    guard exists: pytest's tmp_path sandbox is deep enough that 3 levels of
    ``../`` never reach a real file, so ``open()`` raises FileNotFoundError on
    its own -- a false positive that would pass even with the guard deleted.

    This test plants a real file just outside the cache root and computes the
    exact ``../`` traversal that reaches it, so the assertion is only true
    because of the guard, not an accident of directory depth.
    """
    decoy = manager.base_path / "escaped.jpg"
    decoy.write_bytes(b"secret")

    hostile = os.path.relpath(decoy, manager.cache_path)

    # Sanity check: prove the crafted path really does reach the decoy via the
    # naive join, so this test isn't a false positive either.
    naive_path = (manager.cache_path / hostile).resolve()
    assert naive_path == decoy.resolve()

    with pytest.raises(FileNotFoundError):
        manager.serve_asset(hostile)
