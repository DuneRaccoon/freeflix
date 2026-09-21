import asyncio
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


class _FakeStreamResponse:
    """Mimics the subset of an httpx streaming response that download_asset uses."""

    def __init__(self, chunks, content_type="image/jpeg"):
        self._chunks = chunks
        self.headers = {"content-type": content_type}
        self.consumed_chunks = 0

    def raise_for_status(self):
        pass

    async def aiter_bytes(self):
        for chunk in self._chunks:
            self.consumed_chunks += 1
            yield chunk


class _FakeStream:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self._response

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeAsyncClient:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def stream(self, method, url, timeout=None, follow_redirects=None):
        return _FakeStream(self._response)


def test_download_asset_aborts_streaming_once_the_cap_is_exceeded(manager, monkeypatch):
    """The size cap has to bound memory, not just what reaches disk: it must abort
    while streaming rather than buffer the whole body via ``response.content`` and
    reject afterwards. A test that only checks the return value would pass against
    that old buffering implementation too -- the same false-green shape flagged
    for the traversal tests above. This test additionally proves the abort
    happened mid-stream: not every available chunk was pulled from the iterator.
    """
    from app.assets import manager as manager_module

    MAX_BYTES = 2 * 1024 * 1024
    chunk_size = 512 * 1024
    chunk_count = (MAX_BYTES // chunk_size) + 4  # far more than needed to cross the cap
    chunks = [b"x" * chunk_size for _ in range(chunk_count)]

    fake_response = _FakeStreamResponse(chunks)
    monkeypatch.setattr(
        manager_module.httpx, "AsyncClient", lambda: _FakeAsyncClient(fake_response)
    )

    url = "http://example.com/big.jpg"
    local_path = manager.get_local_path(url)

    async def _run():
        return await manager.download_asset(url)

    success, message = asyncio.run(_run())

    # Property 1: the call reports failure and never wrote the file.
    assert success is False
    assert "too large" in message
    assert not local_path.exists()

    # Property 2: the abort happened during streaming, not after buffering
    # everything -- only enough chunks to cross MAX_BYTES were consumed.
    assert 0 < fake_response.consumed_chunks < len(chunks)
