"""W4: _on_piece_finished resolves the per-piece Futures registered by a waiter,
dispatched safely across the alert thread via call_soon_threadsafe."""
import asyncio
import pytest
from app.torrent.manager import torrent_manager


@pytest.fixture(autouse=True)
def _clean_registry():
    torrent_manager._piece_waiters.clear()
    yield
    torrent_manager._piece_waiters.clear()


def test_register_creates_future_in_registry():
    async def _run():
        torrent_manager._loop = asyncio.get_running_loop()
        fut = torrent_manager._register_piece_waiter("t1", 5)
        assert isinstance(fut, asyncio.Future)
        assert torrent_manager._piece_waiters["t1"][5] == [fut]
        fut.cancel()
    asyncio.run(_run())


def test_on_piece_finished_resolves_waiter():
    async def _run():
        torrent_manager._loop = asyncio.get_running_loop()
        fut = torrent_manager._register_piece_waiter("t1", 7)
        # Simulate the alert thread calling in.
        torrent_manager._on_piece_finished("t1", 7)
        result = await asyncio.wait_for(fut, timeout=1.0)
        assert result is True
        # Registry entry for that piece is cleaned up.
        assert 7 not in torrent_manager._piece_waiters.get("t1", {})
    asyncio.run(_run())


def test_on_piece_finished_unknown_piece_is_noop():
    async def _run():
        torrent_manager._loop = asyncio.get_running_loop()
        # No waiter registered -> must not raise.
        torrent_manager._on_piece_finished("nope", 0)
    asyncio.run(_run())


def test_unregister_removes_future():
    async def _run():
        torrent_manager._loop = asyncio.get_running_loop()
        fut = torrent_manager._register_piece_waiter("t1", 3)
        torrent_manager._unregister_piece_waiter("t1", 3, fut)
        assert 3 not in torrent_manager._piece_waiters.get("t1", {})
        fut.cancel()
    asyncio.run(_run())


def test_handle_alert_dispatches_piece_finished():
    """A piece_finished_alert for a known handle calls _on_piece_finished with
    the right torrent_id + piece index."""
    import types

    class _Handle:
        pass

    handle = _Handle()
    torrent_manager.active_torrents["t-alert"] = (handle, {})
    calls = []
    orig = torrent_manager._on_piece_finished
    torrent_manager._on_piece_finished = lambda tid, pi: calls.append((tid, pi))
    try:
        alert = types.SimpleNamespace(handle=handle, piece_index=11)
        # Force the isinstance branch by monkeypatching lt.piece_finished_alert
        # to this SimpleNamespace's type for the duration of the call.
        import app.torrent.manager as mgr
        real_cls = mgr.lt.piece_finished_alert
        mgr.lt.piece_finished_alert = types.SimpleNamespace
        try:
            torrent_manager._handle_alert(alert)
        finally:
            mgr.lt.piece_finished_alert = real_cls
    finally:
        torrent_manager._on_piece_finished = orig
        del torrent_manager.active_torrents["t-alert"]
    assert calls == [("t-alert", 11)]
