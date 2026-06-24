"""W4: the manager owns a per-torrent piece-waiter registry, a lock guarding it,
and a loop slot captured for cross-thread wakeups."""
import asyncio
import threading
from app.torrent.manager import torrent_manager


def test_registry_and_lock_exist():
    assert isinstance(torrent_manager._piece_waiters, dict)
    assert isinstance(torrent_manager._waiter_lock, type(threading.Lock()))


def test_loop_slot_exists():
    # Captured lazily in start_update_task; None before the task starts.
    assert hasattr(torrent_manager, "_loop")


def test_start_update_task_captures_running_loop():
    async def _run():
        await torrent_manager.start_update_task()
        captured = torrent_manager._loop
        # Cancel the background task we just started so the loop can close.
        if torrent_manager.update_task:
            torrent_manager.update_task.cancel()
        return captured

    loop = asyncio.new_event_loop()
    try:
        captured = loop.run_until_complete(_run())
    finally:
        loop.close()
        torrent_manager.update_task = None
    assert captured is loop
