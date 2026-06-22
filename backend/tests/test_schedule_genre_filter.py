"""Scheduled discovery must filter by genre via the discover param, not the dead `genre` kwarg."""
import asyncio
import types

import app.cron.jobs as jobs


def test_schedule_genre_passes_genres(monkeypatch):
    captured = {}

    async def fake_browse(**kwargs):
        captured.update(kwargs)
        return types.SimpleNamespace(results=[])

    monkeypatch.setattr(jobs.catalog, "browse", fake_browse)
    sp = types.SimpleNamespace(keyword=None, genre="action", year="all",
                               order_by="featured", page=1)
    asyncio.run(jobs._find_movies_for_schedule(sp))
    assert captured.get("genres") == "28"
    assert "genre" not in captured
