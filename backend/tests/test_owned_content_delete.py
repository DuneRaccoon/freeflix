"""Deleting a download deletes only what that torrent owns (spec §4.5).

`save_path` is `default_download_path / <label>` and is SHARED by every download of a
title. While another row resolves to the same `save_path`, removing one download may
delete only `save_path / <its content name>` and its `.<v1hex>.parts` partfile, then
`save_path` itself only if that left it empty. When no other row shares it, the
directory is wholly this download's and goes whole, leftovers included.
"""
from pathlib import Path
from types import SimpleNamespace

import libtorrent as lt
import pytest

import app.torrent.manager as mgr
from app.database.models import Torrent as DbTorrent
from app.torrent.storage import (
    decode_resume_data,
    delete_owned_content,
    encode_resume_data,
    owned_content_paths,
    remove_dir_if_empty,
)


def _magnet(hex40: str) -> str:
    return "magnet:?xt=urn:btih:" + hex40


def _blind_blob(save_path, name: str) -> str:
    """A resume blob with no info dict: it still names its content (memory
    *completed-download-recovery*)."""
    atp = lt.add_torrent_params()
    atp.name = name
    atp.save_path = str(save_path)
    blob = encode_resume_data(lt.write_resume_data_buf(atp))
    # Positive control: without it "nothing deleted" passes for the wrong reason.
    assert lt.read_resume_data(decode_resume_data(blob)).name == name
    return blob


@pytest.fixture
def layout(tmp_path, monkeypatch, override_get_db, session_factory):
    root = tmp_path / "downloads"
    title = root / "Title"
    for rel in ("Release.A/a.mkv", "Release.B/b.mkv", "leftover.mkv"):
        f = title / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"x")
    monkeypatch.setattr(mgr.settings, "default_download_path", root)
    monkeypatch.setattr(mgr, "get_db", override_get_db)

    inst = mgr.TorrentManager.__new__(mgr.TorrentManager)
    inst.active_torrents = {}
    inst.session = SimpleNamespace(remove_torrent=lambda h: None)

    def add(tid, hex40=None, blob_name=None, save_path=None, magnet=None):
        sp = title if save_path is None else save_path
        s = session_factory()
        s.add(DbTorrent(
            id=tid, movie_title="Title", quality="1080p",
            magnet=magnet if magnet is not None else _magnet(hex40),
            url="u", save_path=str(sp), state="finished",
            resume_data=_blind_blob(sp, blob_name) if blob_name else None,
        ))
        s.commit()
        s.close()

    def row_exists(tid):
        s = session_factory()
        try:
            return s.get(DbTorrent, tid) is not None
        finally:
            s.close()

    return SimpleNamespace(root=root, title=title, mgr=inst, add=add, row_exists=row_exists,
                           tmp_path=tmp_path)


def _all_fixture_files_present(title: Path):
    return all((title / rel).exists() for rel in ("Release.A/a.mkv", "Release.B/b.mkv", "leftover.mkv"))


# --- shared save_path: owned-only deletion ---------------------------------------------

def test_remove_deletes_only_its_own_release_dir(layout):
    layout.add("A", "a1" * 20, "Release.A")
    layout.add("B", "b1" * 20, "Release.B")

    assert layout.mgr.remove_torrent("A", delete_files=True) is True

    assert not layout.row_exists("A")
    assert not (layout.title / "Release.A").exists()
    assert (layout.title / "Release.B" / "b.mkv").exists()
    assert (layout.title / "leftover.mkv").exists()
    assert layout.title.exists()


def test_a_name_claimed_by_a_sibling_is_kept(layout):
    layout.add("A", "a1" * 20, "Release.A")
    layout.add("A2", "a2" * 20, "Release.A")

    assert layout.mgr.remove_torrent("A", delete_files=True) is True

    assert (layout.title / "Release.A" / "a.mkv").exists()


def test_sibling_spelled_relative_is_still_a_sibling(layout, monkeypatch):
    monkeypatch.chdir(layout.tmp_path)
    layout.add("A", "a1" * 20, "Release.A", save_path=layout.title)
    layout.add("A2", "a2" * 20, "Release.A", save_path=Path("downloads/Title"))

    assert layout.mgr.remove_torrent("A", delete_files=True) is True

    assert (layout.title / "Release.A" / "a.mkv").exists()


def test_same_infohash_sibling_owns_everything(layout):
    layout.add("A", "ab" * 20, "Release.A")
    layout.add("A2", "ab" * 20, None)  # no blob: claims no name, but it is the same torrent

    assert layout.mgr.remove_torrent("A", delete_files=True) is True

    assert (layout.title / "Release.A" / "a.mkv").exists()


def test_unparseable_magnets_are_not_the_same_torrent(layout):
    assert mgr._v1_hex("magnet:?x") is None
    layout.add("A", blob_name="Release.A", magnet="magnet:?x")
    layout.add("B", blob_name="Release.B", magnet="magnet:?x")

    assert layout.mgr.remove_torrent("A", delete_files=True) is True

    assert not (layout.title / "Release.A").exists()
    assert (layout.title / "Release.B" / "b.mkv").exists()


def test_live_handle_name_wins_when_loaded(layout):
    (layout.title / "Release.L").mkdir()
    (layout.title / "Release.L" / "l.mkv").write_bytes(b"x")
    layout.add("L", "c1" * 20, None)
    layout.add("B", "b1" * 20, "Release.B")
    handle = SimpleNamespace(
        has_metadata=lambda: True,
        get_torrent_info=lambda: SimpleNamespace(name=lambda: "Release.L"),
    )
    layout.mgr.active_torrents["L"] = (handle, {})

    assert layout.mgr.remove_torrent("L", delete_files=True) is True

    assert "L" not in layout.mgr.active_torrents
    assert not (layout.title / "Release.L").exists()
    assert _all_fixture_files_present(layout.title)


def test_single_file_torrent_owns_its_file(layout):
    layout.add("S", "c2" * 20, "leftover.mkv")
    layout.add("B", "b1" * 20, "Release.B")

    assert layout.mgr.remove_torrent("S", delete_files=True) is True

    assert not (layout.title / "leftover.mkv").exists()
    assert (layout.title / "Release.A" / "a.mkv").exists()
    assert (layout.title / "Release.B" / "b.mkv").exists()


def test_partfile_is_owned(layout):
    parts = layout.title / (".%s.parts" % ("cd" * 20))
    parts.write_bytes(b"p")
    layout.add("A", "cd" * 20, "Release.A")
    layout.add("B", "b1" * 20, "Release.B")

    assert layout.mgr.remove_torrent("A", delete_files=True) is True

    assert not (layout.title / "Release.A").exists()
    assert not parts.exists()
    assert (layout.title / "Release.B" / "b.mkv").exists()
    assert (layout.title / "leftover.mkv").exists()


def test_shared_dir_emptied_by_its_own_content_is_removed(layout):
    # The sibling's content is not on disk, so once A's release and leftover-free dir
    # are gone the shared save_path is empty and goes too, but never the root.
    import shutil
    shutil.rmtree(layout.title / "Release.B")
    (layout.title / "leftover.mkv").unlink()
    layout.add("A", "a1" * 20, "Release.A")
    layout.add("B", "b1" * 20, "Release.B")

    assert layout.mgr.remove_torrent("A", delete_files=True) is True

    assert not layout.title.exists()
    assert layout.root.exists()


def test_nothing_known_with_a_sibling_deletes_nothing(layout):
    layout.add("nameless-X", "c3" * 20, None)
    layout.add("sibling-B", "b1" * 20, "Release.B")
    # The manager logs through loguru, which never reaches pytest's caplog.
    warnings: list = []
    sink = mgr.logger.add(
        lambda m: warnings.append(m.record["message"]) if m.record["level"].name == "WARNING" else None,
        level="WARNING",
    )
    try:
        assert layout.mgr.remove_torrent("nameless-X", delete_files=True) is True
    finally:
        mgr.logger.remove(sink)

    assert not layout.row_exists("nameless-X")
    assert _all_fixture_files_present(layout.title)
    assert any("nameless-X" in w and "sibling-B" in w for w in warnings), warnings


# --- nested save_paths: an ancestor or descendant is a sibling too --------------------
#
# Equality alone missed these: a row whose save_path sits inside another row's directory
# (a crafted TorrentRequest.save_path), or a title with a slash ("Love/Hate S01E01" lands
# in downloads/Love/Hate S01E01, under the film "Love"), read as unshared and was rmtree'd.

def test_a_row_nested_in_anothers_release_dir_never_takes_that_release(layout):
    layout.add("A", "a1" * 20, "Release.A")
    layout.add("M", "c1" * 20, "Whatever", save_path=layout.title / "Release.A")

    assert layout.mgr.remove_torrent("M", delete_files=True) is True

    assert not layout.row_exists("M")
    assert (layout.title / "Release.A" / "a.mkv").exists()
    assert _all_fixture_files_present(layout.title)


def test_the_outer_row_keeps_the_entry_a_nested_row_lives_under(layout):
    layout.add("A", "a1" * 20, "Release.A")
    layout.add("M", "c1" * 20, "Whatever", save_path=layout.title / "Release.A")

    assert layout.mgr.remove_torrent("A", delete_files=True) is True

    # Release.A is A's content, but M's save_path lives under it: it is never deleted.
    assert (layout.title / "Release.A" / "a.mkv").exists()
    assert layout.title.exists()


def _love_layout(layout):
    film_dir = layout.root / "Love"
    ep_dir = film_dir / "Hate S01E01"
    (ep_dir / "Ep.Rel").mkdir(parents=True)
    (ep_dir / "Ep.Rel" / "e.mkv").write_bytes(b"x")
    (film_dir / "Love.2015").mkdir()
    (film_dir / "Love.2015" / "f.mkv").write_bytes(b"x")
    layout.add("TV", "d1" * 20, "Ep.Rel", save_path=ep_dir)
    layout.add("FILM", "e1" * 20, "Love.2015", save_path=film_dir)
    return film_dir, ep_dir


def test_removing_the_film_love_keeps_love_hate_episodes(layout):
    film_dir, ep_dir = _love_layout(layout)

    assert layout.mgr.remove_torrent("FILM", delete_files=True) is True

    assert (ep_dir / "Ep.Rel" / "e.mkv").exists()
    # Its own content still goes.
    assert not (film_dir / "Love.2015").exists()


def test_removing_the_episode_deletes_only_its_own_content(layout):
    film_dir, ep_dir = _love_layout(layout)

    assert layout.mgr.remove_torrent("TV", delete_files=True) is True

    assert (film_dir / "Love.2015" / "f.mkv").exists()
    assert not (ep_dir / "Ep.Rel").exists()
    # Emptied by its own content, so remove_dir_if_empty still takes the directory.
    assert not ep_dir.exists()
    assert film_dir.exists()


def test_an_ancestor_row_never_rmtrees_even_with_leftovers(layout):
    film_dir, ep_dir = _love_layout(layout)
    (ep_dir / "stray.nfo").write_bytes(b"x")

    assert layout.mgr.remove_torrent("TV", delete_files=True) is True

    # Unshared, the leftover would go with an rmtree; with an ancestor it stays.
    assert (ep_dir / "stray.nfo").exists()
    assert (film_dir / "Love.2015" / "f.mkv").exists()


# --- unshared save_path: the whole directory is this download's ------------------------

def test_last_owner_out_removes_the_empty_title_dir(layout):
    import shutil
    shutil.rmtree(layout.title / "Release.A")
    (layout.title / "leftover.mkv").unlink()
    layout.add("B", "b1" * 20, "Release.B")

    assert layout.mgr.remove_torrent("B", delete_files=True) is True

    assert not layout.title.exists()
    assert layout.root.exists()


def test_nothing_known_and_alone_removes_the_title_dir(layout):
    layout.add("X", "c3" * 20, None)

    assert layout.mgr.remove_torrent("X", delete_files=True) is True

    assert not layout.title.exists()
    assert layout.root.exists()


def test_last_owner_out_takes_leftovers_too(layout):
    import shutil
    shutil.rmtree(layout.title / "Release.A")
    layout.add("B", "b1" * 20, "Release.B")

    assert layout.mgr.remove_torrent("B", delete_files=True) is True

    assert not layout.title.exists()
    assert layout.root.exists()


def test_keep_files_deletes_nothing(layout):
    layout.add("A", "a1" * 20, "Release.A")

    assert layout.mgr.remove_torrent("A", delete_files=False) is True

    assert not layout.row_exists("A")
    assert _all_fixture_files_present(layout.title)


# --- pure path rules -------------------------------------------------------------------

def test_owned_content_paths_refuses_hostile_names(layout):
    claims = ["..", ".", "", "a/b", "..\\x", "Release.A"]
    assert owned_content_paths(layout.title, claims, [], layout.root) == [layout.title / "Release.A"]


def test_owned_content_paths_skips_sibling_claims_and_absent_names(layout):
    claims = ["Release.A", "Release.B", "Not.There"]
    assert owned_content_paths(layout.title, claims, ["Release.B"], layout.root) == [
        layout.title / "Release.A"
    ]


def test_owned_content_paths_refuses_a_save_path_outside_root(layout):
    elsewhere = layout.tmp_path / "elsewhere"
    (elsewhere / "x").mkdir(parents=True)
    assert owned_content_paths(elsewhere, ["x"], [], layout.root) == []


def test_a_symlinked_release_is_unlinked_never_followed(layout):
    outside = layout.tmp_path / "outside"
    outside.mkdir()
    (outside / "precious.mkv").write_bytes(b"x")
    link = layout.title / "Release.S"
    link.symlink_to(outside, target_is_directory=True)

    owned = owned_content_paths(layout.title, ["Release.S"], [], layout.root)
    assert owned == [link]
    assert delete_owned_content(owned) == 1

    assert not link.is_symlink() and not link.exists()
    assert (outside / "precious.mkv").exists()


def test_remove_dir_if_empty_refuses_root_outside_and_non_empty(layout):
    empty_root = layout.tmp_path / "empty-root"
    empty_root.mkdir()
    assert remove_dir_if_empty(empty_root, empty_root) is False
    assert empty_root.exists()

    outside = layout.tmp_path / "outside-empty"
    outside.mkdir()
    assert remove_dir_if_empty(outside, layout.root) is False
    assert outside.exists()

    assert remove_dir_if_empty(layout.title, layout.root) is False
    assert layout.title.exists()

    empty = layout.root / "Empty.Title"
    empty.mkdir()
    assert remove_dir_if_empty(empty, layout.root) is True
    assert not empty.exists()


def test_v1_hex_reads_the_btih():
    assert mgr._v1_hex(_magnet("AB" * 20)) == "ab" * 20
    assert mgr._v1_hex("magnet:?x") is None
    assert mgr._v1_hex("magnet:?xt=urn:btih:nothex") is None
