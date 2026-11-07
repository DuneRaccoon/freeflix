import asyncio
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services import vacuum


def test_the_loop_sleeps_to_four_runs_and_survives_a_failing_run():
    sleeps, runs = [], []

    async def fake_sleep(s):
        sleeps.append(s)
        if len(sleeps) == 3:
            raise asyncio.CancelledError

    def fake_run(now):
        runs.append(now)
        if len(runs) == 1:
            raise RuntimeError("disk on fire")
        return []

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(vacuum._vacuum_loop(
            sleep=fake_sleep, run=fake_run, tz=timezone.utc,
            clock=lambda: datetime(2026, 11, 7, 3, 0, tzinfo=timezone.utc)))
    assert sleeps == [3600.0, 3600.0, 3600.0]
    assert len(runs) == 2 and all(r.tzinfo is None for r in runs)


def test_start_is_idempotent_and_stop_cancels():
    async def scenario():
        t1 = vacuum.start_vacuum_task()
        t2 = vacuum.start_vacuum_task()
        assert t1 is t2 and not t1.done()
        await vacuum.stop_vacuum_task()
        assert t1.cancelled() and vacuum._task is None

    asyncio.run(scenario())


def test_stop_without_a_task_is_a_no_op():
    vacuum._task = None
    asyncio.run(vacuum.stop_vacuum_task())
    assert vacuum._task is None


def test_startup_starts_it_even_with_cron_disabled_and_shutdown_stops_it(monkeypatch):
    monkeypatch.setattr(settings, "cron_enabled", False)
    with TestClient(app):
        task = vacuum._task
        assert task is not None and not task.done()
    assert vacuum._task is None and task.done()
