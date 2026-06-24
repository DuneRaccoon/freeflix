"""W4: await_pieces_async resolves when pieces arrive (via the waiter Futures)
and times out cleanly when they do not — no busy-poll."""
import asyncio
import types
import pytest
from app.torrent.manager import torrent_manager


@pytest.fixture(autouse=True)
def _clean():
    torrent_manager._piece_waiters.clear()
    yield
    torrent_manager._piece_waiters.clear()


class _Handle:
    def __init__(self, have):
        self._have = set(have)

    def have_piece(self, p):
        return p in self._have

    def piece_priority(self, p, pr):
        pass

    def set_piece_deadline(self, p, d):
        pass

    def status(self):
        return types.SimpleNamespace(num_peers=3, download_rate=0)


def test_returns_true_immediately_when_all_present():
    async def _run():
        torrent_manager._loop = asyncio.get_running_loop()
        torrent_manager.active_torrents["t-a"] = (_Handle({0, 1, 2}), {})
        try:
            ok = await torrent_manager.await_pieces_async(
                torrent_manager.active_torrents["t-a"][0], [0, 1, 2], timeout=1.0
            )
        finally:
            del torrent_manager.active_torrents["t-a"]
        assert ok is True
    asyncio.run(_run())


def test_resolves_when_piece_arrives_via_alert():
    async def _run():
        torrent_manager._loop = asyncio.get_running_loop()
        h = _Handle({0})  # piece 1 missing initially
        torrent_manager.active_torrents["t-b"] = (h, {})

        async def _deliver():
            await asyncio.sleep(0.05)
            h._have.add(1)
            torrent_manager._on_piece_finished("t-b", 1)

        try:
            deliver = asyncio.create_task(_deliver())
            ok = await torrent_manager.await_pieces_async(h, [0, 1], timeout=2.0)
            await deliver
        finally:
            del torrent_manager.active_torrents["t-b"]
        assert ok is True
    asyncio.run(_run())


def test_times_out_when_pieces_never_arrive():
    async def _run():
        torrent_manager._loop = asyncio.get_running_loop()
        h = _Handle(set())  # nothing ever arrives
        torrent_manager.active_torrents["t-c"] = (h, {})
        try:
            ok = await torrent_manager.await_pieces_async(h, [0, 1], timeout=0.2)
        finally:
            del torrent_manager.active_torrents["t-c"]
        assert ok is False
        # Waiter Futures were cleaned up.
        assert torrent_manager._piece_waiters.get("t-c") in (None, {})
    asyncio.run(_run())
