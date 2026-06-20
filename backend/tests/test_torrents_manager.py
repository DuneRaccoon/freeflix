# backend/tests/test_torrents_manager.py
import os
os.environ.setdefault("DB_PATH", "/tmp/test_torrents_manager.db")

import types
import pytest
import libtorrent as lt

from app.torrent.manager import torrent_manager
from app.torrent.storage import encode_resume_data


def _fake_atp():
    return types.SimpleNamespace(save_path=None, storage_mode=None)


def test_add_torrent_from_magnet(monkeypatch):
    torrent_manager.active_torrents.clear()
    calls = {}

    def fake_parse(uri):
        calls["uri"] = uri
        return _fake_atp()

    fake_handle = types.SimpleNamespace(set_sequential_download=lambda v: calls.setdefault("seq", v))
    monkeypatch.setattr(lt, "parse_magnet_uri", fake_parse)
    monkeypatch.setattr(torrent_manager.session, "add_torrent", lambda atp: fake_handle)

    handle = torrent_manager._add_torrent("t1", "magnet:?xt=urn:btih:abc", "/tmp/x", {"k": "v"})

    assert calls["uri"] == "magnet:?xt=urn:btih:abc"
    assert calls["seq"] is True
    assert torrent_manager.active_torrents["t1"] == (fake_handle, {"k": "v"})


def test_add_torrent_from_resume_data(monkeypatch):
    torrent_manager.active_torrents.clear()
    seen = {}

    def fake_read(buf):
        seen["buf"] = buf
        return _fake_atp()

    fake_handle = types.SimpleNamespace(set_sequential_download=lambda v: None)
    monkeypatch.setattr(lt, "read_resume_data", fake_read)
    monkeypatch.setattr(torrent_manager.session, "add_torrent", lambda atp: fake_handle)

    blob = encode_resume_data(b"resume-bytes")
    torrent_manager._add_torrent("t2", "magnet:?xt=urn:btih:abc", "/tmp/x", {}, resume_data=blob)

    assert seen["buf"] == b"resume-bytes"
    assert "t2" in torrent_manager.active_torrents
