"""Resume data has to be able to say what files the torrent holds.

THE BUG THIS FILE IS BUILT FROM, reported from the living room: an episode watched
halfway through one night, the compose project brought down and back up, and on return
the television said *"This title isn't on the box any more — the download this was
playing from is no longer on the box. Nothing here can bring it back."* The 4.6 GB file
was sitting on disk the whole time.

THE MECHANISM, measured on the real database rather than reasoned about:

* a finished torrent is never re-added to the session (`find_loadable_on_startup`:
  "Paused/stopped/finished/seeding/error stay unloaded"), so after a restart the only
  thing that can resolve its files is `get_completed_video_file_info`;
* that function reads the file list out of the STORED RESUME DATA;
* and libtorrent 2.0 **drops the `info` dict from resume data unless it is asked for**.
  Every `save_resume_data()` call in `manager.py` was flagless, so `read_resume_data(
  blob).ti` was `None` for every blob this application had ever written, the file list
  came back empty, and every streaming route 404ed.

The 404 is what the television reads as "gone". So the whole completed-download
fallback — four gates, a dedicated 516-line suite — has been INERT in production since
the day it shipped.

WHY ITS OWN SUITE WAS GREEN ANYWAY, which is the part worth keeping. The fixture in
`test_finished_torrent_streamable.py` builds its blob by hand:

    atp = lt.add_torrent_params()
    atp.ti = ti                       # <- set here, and nowhere in production
    blob = encode_resume_data(lt.write_resume_data_buf(atp))

`.ti` is assigned directly, so every row in that file exercises a blob shape the
application cannot produce. The tests were not wrong about the resolver; they were wrong
about the ARTEFACT, and no assertion inside them could notice. This file is the missing
half: it drives the blob the way the app writes one, and it pins the flag that makes the
app's own blobs self-describing.

TWO REPAIRS, because one of them cannot reach backwards:

1. `_save_resume_data` asks for `save_info_dict`, so every blob written from now on
   carries its file list and the four-gate path works as designed — packs included.
2. `_completed_single_file` resolves a SINGLE-file torrent from a blob that has no info
   dict, which is every blob a household already has. A finished torrent is never
   re-added, so its resume data is never rewritten: without this, repair (1) would only
   help downloads that have not happened yet.
"""

import os

import libtorrent as lt
import pytest
from fastapi.testclient import TestClient

from app.api import streaming as streaming_api
from app.database.models.torrents import Torrent as DbTorrent
from app.main import app
from app.torrent import manager as manager_mod
from app.torrent.manager import torrent_manager
from app.torrent.storage import encode_resume_data

client = TestClient(app)

VIDEO = "/api/v1/streaming/{tid}/video"
MOVIE = "A.Film.2026.1080p.mkv"
BYTES = b"M" * 8192


# ==========================================================================
# 1. The flag: what the application asks libtorrent for
# ==========================================================================

class _Handle:
    """A stand-in that records how `save_resume_data` was called."""

    def __init__(self):
        self.calls = []

    def save_resume_data(self, *args):
        self.calls.append(args)


def test_the_app_asks_for_the_info_dict():
    """THE ROW THE WHOLE FIX RESTS ON.

    A flagless call writes a blob that can restart a download and cannot describe it.
    """
    handle = _Handle()
    torrent_manager._save_resume_data(handle)
    assert handle.calls == [(lt.save_resume_flags_t.save_info_dict,)]


def test_every_resume_save_in_the_manager_goes_through_that_one_helper():
    """Three call sites had the flag missing; one helper is how they stay fixed.

    A source scan, because the alternative is three behavioural tests that each pass
    while a fourth call site is added flagless. `_save_resume_data`'s own body holds the
    only bare call, and it is the fallback for a libtorrent build without the flag.
    """
    src = open(manager_mod.__file__, encoding="utf-8").read()
    body_start = src.index("def _save_resume_data")
    body_end = src.index("def _add_torrent", body_start)
    helper, rest = src[body_start:body_end], src[:body_start] + src[body_end:]

    # Outside the helper, nothing calls it on a handle directly.
    assert "handle.save_resume_data(" not in rest
    assert rest.count("self._save_resume_data(handle)") >= 3
    # Inside it, both arms exist: the flag, and the degradation for a build without it.
    assert "handle.save_resume_data(_SAVE_INFO_DICT)" in helper
    assert "handle.save_resume_data()" in helper


def test_the_flag_is_resolved_defensively_rather_than_imported():
    """A libtorrent without the flag must degrade, not fail at import."""
    assert manager_mod._SAVE_INFO_DICT is lt.save_resume_flags_t.save_info_dict


# ==========================================================================
# 2. The artefact: what a blob written each way actually contains
# ==========================================================================

def _torrent_info(save_path, entries):
    """A real torrent over files that are already written under `save_path`."""
    fs = lt.file_storage()
    for rel, payload in entries.items():
        fs.add_file(rel, len(payload))
    t = lt.create_torrent(fs, piece_size=16384)
    lt.set_piece_hashes(t, str(save_path))
    return lt.torrent_info(t.generate())


def _blob(save_path, entries, *, with_info_dict, blob_name):
    """A resume blob, with or without the info dict — the two shapes that matter.

    `with_info_dict=False` is what EVERY flagless `save_resume_data()` produced, and it
    is the shape sitting in every household's database today: an infohash, a name, a
    save path, the piece state — and no file list.

    `blob_name` is libtorrent's own `name` rule, modelled rather than assumed: for a
    single-file torrent it is the FILE's name, and for a multi-file one it is the
    containing DIRECTORY's. Getting that wrong is what made the first draft of the pack
    row below pass for the wrong reason.
    """
    atp = lt.add_torrent_params()
    ti = _torrent_info(save_path, entries)
    if with_info_dict:
        atp.ti = ti
    else:
        atp.info_hashes = ti.info_hashes()
        atp.name = blob_name
    atp.save_path = str(save_path)
    return encode_resume_data(lt.write_resume_data_buf(atp))


@pytest.fixture
def single_file(tmp_path, monkeypatch, session_factory, override_get_db):
    """One finished single-file torrent on disk, absent from the session."""
    monkeypatch.setattr(manager_mod, "get_db", override_get_db)
    monkeypatch.setattr(streaming_api, "get_db", override_get_db)

    def _build(*, tid="t-single", state="seeding", progress=100.0, name=MOVIE,
               payload=BYTES, with_info_dict=False, block_reason=None, after=None,
               on_disk=True, blob_name=None):
        save_path = tmp_path / tid
        save_path.mkdir(parents=True, exist_ok=True)
        (save_path / name).parent.mkdir(parents=True, exist_ok=True)
        (save_path / name).write_bytes(payload)
        blob = _blob(save_path, {name: payload}, with_info_dict=with_info_dict,
                     blob_name=blob_name or name)
        if not on_disk:
            (save_path / name).unlink()
        if after is not None:
            after(save_path / name)
        with override_get_db() as db:
            db.add(DbTorrent(
                id=tid, movie_title="A Film", quality="1080p",
                magnet="magnet:?xt=urn:btih:deadbeef",
                url="magnet:?xt=urn:btih:deadbeef",
                save_path=str(save_path), state=state, progress=progress,
                block_reason=block_reason, resume_data=blob,
                tmdb_id=603, media_type="movie",
            ))
        assert tid not in torrent_manager.active_torrents
        torrent_manager._resume_video_files.pop(tid, None)
        return tid, save_path

    return _build


def test_a_flagless_blob_carries_no_file_list(tmp_path):
    """THE CHARACTERISATION. This is what production wrote, and it resolves nothing."""
    (tmp_path / MOVIE).write_bytes(BYTES)
    blob = _blob(tmp_path, {MOVIE: BYTES}, with_info_dict=False, blob_name=MOVIE)
    assert lt.read_resume_data(manager_mod.decode_resume_data(blob)).ti is None
    assert torrent_manager._video_files_from_resume_data("t-x", blob, str(tmp_path)) == []


def test_a_blob_WITH_the_info_dict_carries_one(tmp_path):
    """…and the flag is the whole difference, which is what makes repair (1) a repair."""
    (tmp_path / MOVIE).write_bytes(BYTES)
    blob = _blob(tmp_path, {MOVIE: BYTES}, with_info_dict=True, blob_name=MOVIE)
    assert lt.read_resume_data(manager_mod.decode_resume_data(blob)).ti is not None
    files = torrent_manager._video_files_from_resume_data("t-y", blob, str(tmp_path))
    assert [f["name"] for f in files] == [MOVIE]


# ==========================================================================
# 3. The fallback for blobs that cannot describe themselves
# ==========================================================================

def test_a_finished_single_file_resolves_from_a_blob_with_no_info_dict(single_file):
    """THE REPORTED BUG, at the level the fallback lives.

    Before repair (2) this answered None and the television said the title was gone.
    """
    tid, save_path = single_file()
    got = torrent_manager.get_completed_video_file_info(tid, None)
    assert got is not None
    assert got["path"] == str(save_path / MOVIE)
    assert got["size"] == len(BYTES)
    # A single-file torrent's only file is libtorrent index 0.
    assert got["index"] == 0


def test_the_television_can_play_it_again(single_file):
    """THE REPORTED BUG, at the level the television actually sees.

    The player probes with HEAD and reads a 404 as terminal — "no longer on the box" —
    so this status code IS the error message the viewer was shown.
    """
    tid, _ = single_file()
    assert client.head(VIDEO.format(tid=tid)).status_code == 200
    r = client.get(VIDEO.format(tid=tid))
    assert r.status_code == 200
    assert r.content == BYTES


def test_an_explicit_index_0_is_the_same_file(single_file):
    tid, _ = single_file()
    assert torrent_manager.get_completed_video_file_info(tid, 0) is not None


def test_any_other_index_is_refused_rather_than_approximated(single_file):
    """A question about a file this cannot see is a refusal, not a near-enough match."""
    tid, _ = single_file()
    assert torrent_manager.get_completed_video_file_info(tid, 1) is None


def test_a_PACK_is_refused_by_the_single_file_path(single_file):
    """The single-file path's deliberate limit.

    With no info dict, `name` is the containing DIRECTORY and says nothing about what is
    in it or in what order — and `?file_index=N` is a libtorrent index, which a directory
    walk cannot reconstruct. A pack is answered by `_completed_pack_file` instead, through
    the index->episode map, or not at all; it is never guessed at from a listing's order.
    """
    # Modelled the way libtorrent actually writes it: the files live under a directory
    # and the blob's `name` IS that directory. (The first draft of this row set `name` to
    # the episode's own path and passed for the wrong reason — the fallback resolved it,
    # which is precisely the guess this test is supposed to forbid.)
    tid, save_path = single_file(name="Pack.S01/Pack.S01E01.mkv", blob_name="Pack.S01")
    assert (save_path / "Pack.S01").is_dir()
    assert torrent_manager.get_completed_video_file_info(tid, None) is None


def test_a_name_carrying_a_path_is_refused_whatever_is_at_the_end_of_it(single_file):
    """A resume blob is attacker-adjacent: it came off the wire from whoever built the
    torrent. A single-file torrent's name is a bare file name, so a name with a separator
    in it is a shape this does not model — and refusing it is what keeps the join below
    `save_path` from being somewhere else entirely."""
    tid, _ = single_file(name="Pack.S01/Pack.S01E01.mkv",
                         blob_name="Pack.S01/Pack.S01E01.mkv")
    assert torrent_manager.get_completed_video_file_info(tid, None) is None
    tid2, _ = single_file(tid="t-climb", blob_name="../../etc/passwd.mkv")
    assert torrent_manager.get_completed_video_file_info(tid2, None) is None


def test_a_sparse_full_length_file_is_refused(single_file):
    """THE GATE, and it is stricter than the size comparison it stands in for.

    libtorrent writes at offsets in sparse storage mode, so a half-downloaded file
    already reports its FULL length with holes inside that read back as zeros. A size
    comparison cannot see them; allocated blocks can. The straight-through branch does no
    piece gating, so an ungated fallback hands those zeros to a decoder — which presents
    as corrupt media rather than as an error.
    """
    def punch(path):
        size = path.stat().st_size
        path.unlink()
        with open(path, "wb") as f:
            f.truncate(size)          # full length, nothing allocated

    tid, save_path = single_file(after=punch)
    assert (save_path / MOVIE).stat().st_size == len(BYTES)
    assert torrent_manager.get_completed_video_file_info(tid, None) is None


def test_a_deleted_file_is_still_refused(single_file):
    """The state a container recreate can leave behind: the row says 100%, the bytes are
    gone. "No longer on the box" is the honest answer HERE, and it stays available."""
    tid, _ = single_file(on_disk=False)
    assert torrent_manager.get_completed_video_file_info(tid, None) is None


@pytest.mark.parametrize("state", ["downloading", "paused", "error", "stopped"])
def test_only_a_terminal_complete_state_falls_back(single_file, state):
    """Unchanged by this work: an incomplete download is not served off disk."""
    tid, _ = single_file(state=state)
    assert torrent_manager.get_completed_video_file_info(tid, None) is None


def test_an_incomplete_progress_is_refused(single_file):
    tid, _ = single_file(progress=99.0)
    assert torrent_manager.get_completed_video_file_info(tid, None) is None


def test_the_content_guard_still_refuses_a_blocked_row(single_file):
    tid, _ = single_file(block_reason="nope")
    assert torrent_manager.get_completed_video_file_info(tid, None) is None


def test_a_non_video_file_is_not_streamable(single_file):
    tid, _ = single_file(name="A.Film.2026.1080p.nfo")
    assert torrent_manager.get_completed_video_file_info(tid, None) is None


def test_the_fallback_defers_to_a_blob_that_can_describe_itself(single_file, monkeypatch):
    """ORDER IS THE SEAM, as it is for the live lookup.

    With an info dict present the four-gate path owns the answer; this one must not be a
    second opinion about it. Asserted by having the gated path refuse (the file is
    truncated after the metadata was sealed) and requiring the whole call to refuse too —
    if the fallback ran anyway it would resolve from `name` and serve the short file.
    """
    def truncate(path):
        path.write_bytes(BYTES[:16])

    tid, _ = single_file(with_info_dict=True, after=truncate)
    assert torrent_manager.get_completed_video_file_info(tid, None) is None


def test_the_single_file_path_is_not_reachable_with_an_info_dict(single_file):
    """The same rule, stated against the function rather than through the caller."""
    tid, save_path = single_file(with_info_dict=True)
    blob = None
    with manager_mod.get_db() as db:
        blob = db.query(DbTorrent).filter(DbTorrent.id == tid).first().resume_data
    assert torrent_manager._completed_single_file(tid, blob, str(save_path), None) is None


def test_without_resume_data_there_is_nothing_to_resolve(single_file):
    tid, save_path = single_file()
    assert torrent_manager._completed_single_file(tid, None, str(save_path), None) is None


def test_the_allocation_gate_is_not_vacuous(tmp_path):
    """A gate that passed everything would make the sparse row green for ever."""
    full = tmp_path / "full.mkv"
    full.write_bytes(b"x" * 1_000_000)
    st = os.stat(full)
    assert st.st_blocks * 512 >= st.st_size * manager_mod._ALLOCATED_AT_LEAST

    holey = tmp_path / "holey.mkv"
    with open(holey, "wb") as f:
        f.truncate(1_000_000)
    st = os.stat(holey)
    assert st.st_blocks * 512 < st.st_size * manager_mod._ALLOCATED_AT_LEAST


# ==========================================================================
# 4. One episode of a pack, recovered through the index -> episode map
# ==========================================================================

EPISODES = {
    "Pack.S01/Pack.S01E01.mkv": b"A" * 4096,
    "Pack.S01/Pack.S01E02.mkv": b"B" * 8192,
    "Pack.S01/00-notes.nfo": b"N" * 64,
}


@pytest.fixture
def finished_pack(tmp_path, monkeypatch, session_factory, override_get_db):
    """A finished pack on disk, an info-dict-less blob, and the row's cached episode map.

    The map is `{file_index: {season, episode}}` exactly as `precompute_episode_map`
    writes it — built by running `parse_episode` over the file NAMES, which is the same
    parse the recovery below runs over the names still on disk.
    """
    monkeypatch.setattr(manager_mod, "get_db", override_get_db)
    monkeypatch.setattr(streaming_api, "get_db", override_get_db)

    def _build(*, tid="t-pack", entries=None, precomputed=None, after=None):
        entries = dict(EPISODES if entries is None else entries)
        save_path = tmp_path / tid
        for rel, payload in entries.items():
            path = save_path / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
        blob = _blob(save_path, entries, with_info_dict=False, blob_name="Pack.S01")
        if after is not None:
            after(save_path)
        if precomputed is None:
            precomputed = {"1": {"season": 1, "episode": 1}, "2": {"season": 1, "episode": 2}}
        with override_get_db() as db:
            db.add(DbTorrent(
                id=tid, movie_title="A Pack", quality="1080p",
                magnet="magnet:?xt=urn:btih:deadbeef",
                url="magnet:?xt=urn:btih:deadbeef",
                save_path=str(save_path), state="seeding", progress=100.0,
                resume_data=blob, precomputed_episodes=precomputed,
                tmdb_id=1399, media_type="tv", season=1,
            ))
        assert tid not in torrent_manager.active_torrents
        torrent_manager._resume_video_files.pop(tid, None)
        return tid, save_path

    return _build


def test_one_episode_of_a_pack_is_recovered_through_the_episode_map(finished_pack):
    """THE OTHER HALF OF THE REPORTED BUG, and the one that matters most for a series.

    A finished pack is never re-added to the session either, so without this every episode
    of every season a household has already downloaded stays unplayable after a restart —
    the flag only helps downloads that have not happened yet.

    The association is RECOVERED, not guessed: the row's map was built by parsing the same
    file names that are still on disk.
    """
    tid, save_path = finished_pack()
    got = torrent_manager.get_completed_video_file_info(tid, 2)
    assert got is not None
    assert got["path"] == str(save_path / "Pack.S01/Pack.S01E02.mkv")
    # The INDEX the caller asked about is the index it gets back, not the position of the
    # file in any listing.
    assert got["index"] == 2
    assert got["size"] == len(EPISODES["Pack.S01/Pack.S01E02.mkv"])


def test_it_is_the_right_episode_and_not_merely_a_file(finished_pack):
    """The negative control for the row above: index 1 is E01, index 2 is E02."""
    tid, save_path = finished_pack()
    first = torrent_manager.get_completed_video_file_info(tid, 1)
    assert first is not None and first["path"].endswith("Pack.S01E01.mkv")


def test_the_television_can_play_an_episode_of_it_again(finished_pack):
    tid, _ = finished_pack()
    r = client.get(VIDEO.format(tid=tid) + "?file_index=2")
    assert r.status_code == 200
    assert r.content == EPISODES["Pack.S01/Pack.S01E02.mkv"]


def test_a_bare_request_on_a_pack_is_refused(finished_pack):
    """Without an index there is no episode to look up, and "the largest video file" is a
    statement about a movie rather than about which episode somebody wants."""
    tid, _ = finished_pack()
    assert torrent_manager.get_completed_video_file_info(tid, None) is None


def test_without_the_map_there_is_nothing_to_recover_from(finished_pack):
    tid, _ = finished_pack(precomputed=None if False else {})
    assert torrent_manager.get_completed_video_file_info(tid, 2) is None


def test_an_index_the_map_does_not_name_is_refused(finished_pack):
    tid, _ = finished_pack()
    assert torrent_manager.get_completed_video_file_info(tid, 7) is None


def test_two_files_parsing_to_one_episode_are_refused_rather_than_chosen_between(finished_pack):
    """REFUSES ON AMBIGUITY, which is what keeps this narrow enough to be safe. A sample, a
    repack or a proper beside the episode makes the association unrecoverable, and picking
    the larger one would be the "serve the wrong episode" defect in a different coat."""
    entries = dict(EPISODES)
    entries["Pack.S01/Pack.S01E02.PROPER.mkv"] = b"C" * 2048
    tid, _ = finished_pack(entries=entries)
    assert torrent_manager.get_completed_video_file_info(tid, 2) is None


def test_the_walk_considers_video_files_only(finished_pack):
    """The content guard's "only video extensions are streamable", on this path too.

    The episode exists on disk and its name parses — it is just not a video, so there is
    nothing to resolve. (The earlier draft of this row asserted that an index the map
    points at a non-video file is refused, which is unreachable: the map is built from
    `get_video_files`, so only video indices are ever in it. This is the reachable half.)
    """
    entries = dict(EPISODES)
    entries["Pack.S01/Pack.S01E03.nfo"] = b"N" * 128
    tid, _ = finished_pack(
        entries=entries,
        precomputed={"3": {"season": 1, "episode": 3}},
    )
    assert torrent_manager.get_completed_video_file_info(tid, 3) is None


def test_a_sparse_episode_is_refused(finished_pack):
    def punch(save_path):
        path = save_path / "Pack.S01/Pack.S01E02.mkv"
        size = path.stat().st_size
        path.unlink()
        with open(path, "wb") as f:
            f.truncate(size)

    tid, _ = finished_pack(after=punch)
    assert torrent_manager.get_completed_video_file_info(tid, 2) is None


def test_a_deleted_episode_is_refused(finished_pack):
    def remove(save_path):
        (save_path / "Pack.S01/Pack.S01E02.mkv").unlink()

    tid, _ = finished_pack(after=remove)
    assert torrent_manager.get_completed_video_file_info(tid, 2) is None
    # ...and its sibling still plays, so the refusal is about the file and not the pack.
    assert torrent_manager.get_completed_video_file_info(tid, 1) is not None
