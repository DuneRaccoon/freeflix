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

THREE REPAIRS, because the first cannot reach backwards and the second did not reach far
enough:

1. `_save_resume_data` asks for `save_info_dict`, so every blob written from now on
   carries its file list and the four-gate path works as designed — packs included.
2. `_completed_single_file` resolves a SINGLE-file torrent from a blob that has no info
   dict, which is every blob a household already has. A finished torrent is never
   re-added, so its resume data is never rewritten: without this, repair (1) would only
   help downloads that have not happened yet.
3. `_completed_lone_video` resolves ONE video file inside a release DIRECTORY — which,
   measured against the real database the day after (1) and (2) shipped, is what SIX OF
   THE SEVEN completed downloads on the box actually are. The reported URL was
   `GET /api/v1/streaming/2f8da8dd-.../info` -> 404 on a 3.7 GB complete file, with
   `blob.name = 'www.UIndex.org    -    The Boys S01E05 ... FLUX'`: a tracker-branded
   folder, so (2) refused it for having a directory rather than a file name, and the pack
   path refused it for having no index to look up. Section 5 holds that half.

WHAT STILL REFUSES, so the limit is read rather than rediscovered: two or more video files
under one directory with a blind blob. A listing's ORDER is not a libtorrent file index,
and choosing between candidates is the "serve the wrong episode" defect this whole file
exists to refuse. It now says so in the log, because the silent version of that refusal is
what made the 2026-10-21 bug cost a database probe to diagnose.
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
from app.torrent.storage import decode_resume_data, encode_resume_data

client = TestClient(app)

VIDEO = "/api/v1/streaming/{tid}/video"
INFO = "/api/v1/streaming/{tid}/info"
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
    # `name` is set on BOTH shapes, because libtorrent writes it on both: a blob produced
    # with `save_info_dict` carries the `info` dict AND a `name` key (verified by driving
    # libtorrent 2.0.11 in the backend image). Setting it only on the blind shape made
    # `test_an_info_dict_blob_never_reaches_this_path` pass because the name was EMPTY
    # rather than because the info dict was refused — found by mutation.
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


def test_a_DIRECTORY_NAME_is_refused_by_the_single_file_path(single_file):
    """The single-file path's deliberate limit, stated against the function it belongs to.

    With no info dict, `name` is the containing DIRECTORY and says nothing about what is
    in it or in what order — so `save_path/name` is not a file and this path has no answer.

    THIS ROW USED TO ASSERT THE WHOLE LOOKUP REFUSED, and that was the reported bug of
    2026-10-21: six of the seven completed downloads on the box are exactly this shape (a
    tracker-branded folder holding one episode), and every one of them 404ed. The limit
    being pinned here is real and unchanged — this path still cannot name a file inside a
    directory — but it is a limit of `_completed_single_file`, not of the lookup, which now
    walks for a lone video afterwards. What is still never done is reconstructing an index
    from a listing's ORDER: see `test_two_videos_are_refused_rather_than_chosen_between`.
    """
    # Modelled the way libtorrent actually writes it: the files live under a directory
    # and the blob's `name` IS that directory. (The first draft of this row set `name` to
    # the episode's own path and passed for the wrong reason — the fallback resolved it
    # by joining an attacker-supplied path, which is what the row below forbids.)
    tid, save_path = single_file(name="Pack.S01/Pack.S01E01.mkv", blob_name="Pack.S01")
    assert (save_path / "Pack.S01").is_dir()
    with manager_mod.get_db() as db:
        blob = db.query(DbTorrent).filter(DbTorrent.id == tid).first().resume_data
    assert torrent_manager._completed_single_file(tid, blob, str(save_path), None) is None
    # The lone-video walk is what answers it now, and it answers with the episode.
    got = torrent_manager.get_completed_video_file_info(tid, None)
    assert got is not None and got["path"].endswith("Pack.S01E01.mkv")


def test_a_name_carrying_a_path_is_never_JOINED_whatever_is_at_the_end_of_it(single_file):
    """A resume blob is attacker-adjacent: it came off the wire from whoever built the
    torrent. A single-file torrent's name is a bare file name, so a name with a separator
    in it is a shape this does not model — and refusing it is what keeps the join below
    `save_path` from being somewhere else entirely.

    Stated against `_completed_single_file`, because it is the only path that JOINS `name`
    to anything. The lone-video walk reads `name` not at all: it enumerates what is really
    inside `save_path`, so a climbing name cannot steer it anywhere — which the second
    half of this row now pins directly.
    """
    def blob_of(tid):
        with manager_mod.get_db() as db:
            return db.query(DbTorrent).filter(DbTorrent.id == tid).first().resume_data

    tid, save_path = single_file(name="Pack.S01/Pack.S01E01.mkv",
                                 blob_name="Pack.S01/Pack.S01E01.mkv")
    assert torrent_manager._completed_single_file(tid, blob_of(tid), str(save_path), None) is None
    tid2, save_path2 = single_file(tid="t-climb", blob_name="../../etc/passwd.mkv")
    assert torrent_manager._completed_single_file(tid2, blob_of(tid2), str(save_path2), None) is None
    # ...and the lone-video walk refuses it too, for a different and stronger reason: the
    # blob's `name` is the DIRECTORY that walk starts from, so a climbing name is not
    # ignored, it is rejected before anything is enumerated. (An earlier draft of the walk
    # started at `save_path` and merely ignored `name` — which review showed would serve
    # whatever single video happened to be in that directory, including another torrent's.)
    assert torrent_manager.get_completed_video_file_info(tid2, None) is None
    assert torrent_manager._completed_lone_video(tid2, blob_of(tid2), str(save_path2), None, None) is None


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


# ==========================================================================
# 5. The shape every download on the box actually has: ONE video inside a
#    release DIRECTORY, asked for without an index
# ==========================================================================
#
# Measured against the real database on 2026-10-21, after the flag shipped. Six of the
# seven completed downloads were still unplayable, and all six are this shape:
#
#   blob.name  = 'www.UIndex.org    -    The Boys S01E05 ... DDP5 1 H 264-FLUX'
#   blob.ti    = None
#   request    = GET /streaming/{id}/info      (no file_index: it is ONE episode)
#
# `_completed_single_file` refuses it because `name` is a directory, and
# `_completed_pack_file` refuses it because there is no index to look up. Both refusals
# were silent, so the log said only "carries no metadata" and the viewer was told a
# 3.7 GB file sitting complete on disk was "not ready for streaming".
#
# The judgement this section adds, and its limit: when the tree under `save_path` holds
# exactly ONE video file there is nothing to guess — not which file, and not an order. A
# directory listing's ORDER is still never reconstructed, which is what
# `test_two_videos_are_refused_rather_than_chosen_between` pins.

RELEASE = "www.UIndex.org    -    The Boys S01E05 Good for the Soul 1080p AMZN WEB-DL DDP5 1 H 264-FLUX"
EPISODE = b"E" * 8192


@pytest.fixture
def release_dir(tmp_path, monkeypatch, session_factory, override_get_db):
    """One finished episode inside a tracker-branded release directory, blob blind.

    `save_path_spelling` is the trap this fixture exists to carry: on the box the ROW's
    save path is relative ('downloads/The Boys S01E05') and the BLOB's is absolute
    ('/opt/freeflix/downloads/The Boys S01E05') — the same directory, spelled twice.
    """
    monkeypatch.setattr(manager_mod, "get_db", override_get_db)
    monkeypatch.setattr(streaming_api, "get_db", override_get_db)

    def _build(*, tid="t-release", entries=None, precomputed=None, after=None,
               state="seeding", progress=100.0, block_reason=None, row_save_path=None):
        if entries is None:
            entries = {
                f"{RELEASE}/The.Boys.S01E05.1080p.AMZN.WEB-DL.mkv": EPISODE,
                f"{RELEASE}/the.boys.s01e05.nfo": b"N" * 64,
            }
        save_path = tmp_path / tid
        for rel, payload in entries.items():
            path = save_path / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
        blob = _blob(save_path, entries, with_info_dict=False, blob_name=RELEASE)
        if after is not None:
            after(save_path)
        with override_get_db() as db:
            db.add(DbTorrent(
                id=tid, movie_title="The Boys S01E05", quality="1080p",
                magnet="magnet:?xt=urn:btih:deadbeef",
                url="magnet:?xt=urn:btih:deadbeef",
                save_path=str(save_path) if row_save_path is None else row_save_path,
                state=state, progress=progress, block_reason=block_reason,
                resume_data=blob, precomputed_episodes=precomputed,
                tmdb_id=76479, media_type="tv", season=1, episode=5,
            ))
        assert tid not in torrent_manager.active_torrents
        torrent_manager._resume_video_files.pop(tid, None)
        return tid, save_path

    return _build


def test_THE_REPORTED_BUG_one_episode_in_a_release_directory_resolves(release_dir):
    """The regression test for the 404 the box served on 2026-10-21.

    No index, a blind blob, and `name` is a directory. There is exactly one video file
    under it, so the answer is not a guess — it is the only candidate there is.
    """
    tid, save_path = release_dir()
    got = torrent_manager.get_completed_video_file_info(tid, None)
    assert got is not None
    assert got["path"] == str(save_path / RELEASE / "The.Boys.S01E05.1080p.AMZN.WEB-DL.mkv")
    assert got["size"] == len(EPISODE)
    assert got["progress"] == 100.0


def test_it_resolves_the_video_and_not_the_nfo_beside_it(release_dir):
    """The content guard still decides what is streamable; an .nfo is not a candidate."""
    tid, _ = release_dir()
    got = torrent_manager.get_completed_video_file_info(tid, None)
    assert got is not None
    assert got["path"].endswith(".mkv")


def test_the_row_and_blob_save_paths_are_the_same_directory_spelled_twice(release_dir):
    """THE TRAP THIS FIXTURE EXISTS FOR, and the first version of this row could not see it.

    On the box the row's save path is RELATIVE ('downloads/The Boys S01E05') and the blob's
    is ABSOLUTE ('/opt/freeflix/downloads/The Boys S01E05'), naming one directory. A search
    that treated them as two places would walk the identical tree twice.

    The first version of this row wrote both as `str(save_path)` and then appended
    `os.sep + "." + os.sep` to the row's — which `pathlib.Path` collapses at construction,
    so the two inputs were byte-identical and the row detected nothing. Review found that.
    This one builds a genuinely different spelling with `os.path.relpath`, and pins the
    deduplication by COUNTING the walks: when there is nothing to find, the "no video file
    under" line must appear once, not twice.
    """
    tid, save_path = release_dir()
    relative = os.path.relpath(str(save_path), os.getcwd())
    assert relative != str(save_path)
    with manager_mod.get_db() as db:
        row = db.query(DbTorrent).filter(DbTorrent.id == tid).first()
        blob_atp = lt.read_resume_data(decode_resume_data(row.resume_data))
        assert blob_atp.save_path == str(save_path)      # absolute, from libtorrent
        row.save_path = relative                          # relative, as the row stores it
        db.commit()
    torrent_manager._resume_video_files.pop(tid, None)
    got = torrent_manager.get_completed_video_file_info(tid, None)
    assert got is not None
    assert got["path"].endswith("The.Boys.S01E05.1080p.AMZN.WEB-DL.mkv")

    # ...and with the file gone, the two spellings are recognised as one directory.
    (save_path / RELEASE / "The.Boys.S01E05.1080p.AMZN.WEB-DL.mkv").unlink()
    lines: list = []
    sink = manager_mod.logger.add(lines.append, level="INFO")
    try:
        assert torrent_manager.get_completed_video_file_info(tid, None) is None
    finally:
        manager_mod.logger.remove(sink)
    assert sum("no video file under" in line for line in lines) == 1, lines


def test_a_wrong_row_save_path_falls_back_to_the_blobs_own(release_dir):
    """The row's path may be relative to a working directory this process no longer has;
    the blob's is absolute and survives it."""
    tid, save_path = release_dir()
    with manager_mod.get_db() as db:
        row = db.query(DbTorrent).filter(DbTorrent.id == tid).first()
        row.save_path = str(save_path.parent / "somewhere-else-entirely")
        db.commit()
    torrent_manager._resume_video_files.pop(tid, None)
    assert torrent_manager.get_completed_video_file_info(tid, None) is not None


def test_two_videos_are_refused_rather_than_chosen_between(release_dir):
    """THE LIMIT, unchanged from the pack path: an ORDER is never reconstructed.

    Two videos under one directory is a real pack (or a release with a sample), and
    picking between them by size or by listing order is the "serve the wrong episode"
    defect this file refuses throughout. It now says so in the LOG, because a silent
    refusal is what made the reported bug cost a database probe to diagnose.
    """
    tid, _ = release_dir(entries={
        f"{RELEASE}/Pack.S01E01.mkv": b"A" * 4096,
        f"{RELEASE}/Pack.S01E02.mkv": b"B" * 8192,
    })
    # This module logs through loguru, which does not reach pytest's caplog at all — an
    # assertion on caplog here would pass whatever the code did.
    lines: list = []
    sink = manager_mod.logger.add(lines.append, level="WARNING")
    try:
        assert torrent_manager.get_completed_video_file_info(tid, None) is None
    finally:
        manager_mod.logger.remove(sink)
    said = "".join(lines)
    assert tid in said and "2 video files" in said, said
    assert "Pack.S01E01.mkv" in said and "Pack.S01E02.mkv" in said, said


def test_a_mapped_PACK_still_refuses_a_bare_request(release_dir):
    """A row whose map names several files IS a pack, and 'the main video' is not a
    question a pack answers. Its episodes stay `_completed_pack_file`'s business, where an
    index means an episode rather than a position in a listing."""
    tid, _ = release_dir(
        entries={
            f"{RELEASE}/Pack.S01E01.mkv": b"A" * 4096,
            f"{RELEASE}/Pack.S01E02.mkv": b"B" * 8192,
        },
        precomputed={"1": {"season": 1, "episode": 1}, "2": {"season": 1, "episode": 2}},
    )
    assert torrent_manager.get_completed_video_file_info(tid, None) is None


def test_a_mapped_pack_with_ONE_episode_left_STILL_refuses_a_bare_request(release_dir):
    """ISOLATES THE PACK GUARD, which the row above does not.

    Found by mutation: deleting `if precomputed and len(precomputed) > 1` left the whole
    suite green, because with two videos on disk the refusal came from "never choose
    between candidates" instead. Delete one episode and that rule stops applying — but the
    row's map still says this torrent is a pack of several files, and "the main video" is
    not a question a pack answers. Without the guard the lookup would hand back whichever
    episode happened to survive, labelled index 0.
    """
    def remove_one(save_path):
        (save_path / RELEASE / "Pack.S01E01.mkv").unlink()

    tid, _ = release_dir(
        entries={
            f"{RELEASE}/Pack.S01E01.mkv": b"A" * 4096,
            f"{RELEASE}/Pack.S01E02.mkv": b"B" * 8192,
        },
        precomputed={"1": {"season": 1, "episode": 1}, "2": {"season": 1, "episode": 2}},
        after=remove_one,
    )
    assert torrent_manager.get_completed_video_file_info(tid, None) is None
    # ...and the survivor is still reachable BY ITS INDEX, through the map — so the
    # refusal is about the bare question, not about the pack being damaged.
    got = torrent_manager.get_completed_video_file_info(tid, 2)
    assert got is not None and got["path"].endswith("Pack.S01E02.mkv")


def test_the_index_it_reports_is_the_one_the_row_recorded(release_dir):
    """ROUND TRIP, and the reason this cannot report a convenient 0.

    /info's answer carries an index, and the client asks for bytes with it. The row's map
    was cached while metadata WAS known, so when it names exactly one file that key is the
    real libtorrent index — not a guess — and asking again with it must resolve the same
    file.
    """
    tid, _ = release_dir(precomputed={"3": {"season": 1, "episode": 5}})
    bare = torrent_manager.get_completed_video_file_info(tid, None)
    assert bare is not None and bare["index"] == 3
    again = torrent_manager.get_completed_video_file_info(tid, 3)
    assert again is not None and again["path"] == bare["path"]


def test_with_no_map_the_index_round_trips_as_zero(release_dir):
    """Three of the five episodes on the box have no map at all. The index has to be
    SOMETHING, and whatever it is, asking again with it must return the same file."""
    tid, _ = release_dir(precomputed=None)
    bare = torrent_manager.get_completed_video_file_info(tid, None)
    assert bare is not None and bare["index"] == 0
    again = torrent_manager.get_completed_video_file_info(tid, 0)
    assert again is not None and again["path"] == bare["path"]


def test_the_index_a_CLIENT_HOLDS_is_answered_rather_than_refused(release_dir):
    """THE ASYMMETRY REVIEW CAUGHT, and it would have left resumes broken.

    An earlier draft reported index 0 for a bare request and refused every other index.
    But the index a client holds is the REAL one: it came from /files while the torrent was
    live, the television stores it on the progress row, and every resume link rebuilds the
    watch URL from `progress.file_index`. So a half-watched episode — the case this whole
    bug is about — would have gone on 404ing while a fresh start worked.

    Once the file is proven to be this torrent's (it is the only video in the directory the
    blob names) and the right episode, the index is a label on it, so it is echoed.
    """
    tid, _ = release_dir(precomputed={"3": {"season": 1, "episode": 5}})
    for asked in (0, 3, 4):
        got = torrent_manager.get_completed_video_file_info(tid, asked)
        assert got is not None, asked
        assert got["index"] == asked
        assert got["path"].endswith("The.Boys.S01E05.1080p.AMZN.WEB-DL.mkv")


def test_the_allocation_gate_still_applies_in_a_release_directory(release_dir):
    """The straight-through branch does no piece gating, so this path may not skip it."""
    def punch(save_path):
        path = save_path / RELEASE / "The.Boys.S01E05.1080p.AMZN.WEB-DL.mkv"
        size = path.stat().st_size
        path.unlink()
        with open(path, "wb") as f:
            f.truncate(size)

    tid, _ = release_dir(after=punch)
    assert torrent_manager.get_completed_video_file_info(tid, None) is None


def test_a_deleted_episode_in_a_release_directory_is_refused(release_dir):
    """"No longer on the box" stays available for the case where it is true."""
    def remove(save_path):
        (save_path / RELEASE / "The.Boys.S01E05.1080p.AMZN.WEB-DL.mkv").unlink()

    tid, _ = release_dir(after=remove)
    assert torrent_manager.get_completed_video_file_info(tid, None) is None


def test_the_earlier_gates_still_come_first(release_dir):
    """Gates 1, 2 and 4a are not weakened by a new way of answering gate 4b."""
    tid, _ = release_dir(tid="t-downloading", state="downloading")
    assert torrent_manager.get_completed_video_file_info(tid, None) is None
    tid, _ = release_dir(tid="t-partial", progress=41.0)
    assert torrent_manager.get_completed_video_file_info(tid, None) is None
    tid, _ = release_dir(tid="t-blocked", block_reason="content guard")
    assert torrent_manager.get_completed_video_file_info(tid, None) is None


def test_an_info_dict_blob_never_reaches_this_path(release_dir):
    """It is the blind case's answer only: a blob that can describe itself is resolved by
    the metadata, and whatever that decides stands — the same rule the single-file path
    states against itself."""
    tid, save_path = release_dir()
    with manager_mod.get_db() as db:
        blob = db.query(DbTorrent).filter(DbTorrent.id == tid).first().resume_data
    # Blind: this is the path that answers.
    assert torrent_manager._completed_lone_video(tid, blob, str(save_path), None, None) is not None
    # Re-written with its info dict, the function refuses and leaves it to the metadata.
    seeing = _blob(
        save_path,
        {f"{RELEASE}/The.Boys.S01E05.1080p.AMZN.WEB-DL.mkv": EPISODE,
         f"{RELEASE}/the.boys.s01e05.nfo": b"N" * 64},
        with_info_dict=True, blob_name=RELEASE,
    )
    assert torrent_manager._completed_lone_video(tid, seeing, str(save_path), None, None) is None


def test_without_a_READABLE_BLOB_there_is_no_OWNERSHIP_and_so_no_answer(release_dir):
    """The blob is required, because it is the only thing that says which directory holds
    THIS torrent's files.

    An earlier draft treated the blob as optional — a convenience for a second search base —
    and walked `save_path` itself when it was missing. `save_path` is
    `default_download_path / label` with label the bare title, so it is shared by every
    download of that title and by the leftovers of deleted ones: walking it serves another
    torrent's file under this row's id. Without a readable blob there is no `name`, so
    there is no directory this row owns, so there is no answer.
    """
    tid, save_path = release_dir()
    assert torrent_manager._completed_lone_video(tid, None, str(save_path), None, None) is None
    assert torrent_manager._completed_lone_video(tid, "not-a-blob", str(save_path), None, None) is None
    assert torrent_manager._completed_lone_video(tid, None, "", None, None) is None


def test_THE_REPORTED_URL_now_answers_200(release_dir):
    """The exact request the box served a 404 for, through the real route.

        GET /api/v1/streaming/2f8da8dd-.../info
        -> {"detail":"Video file not found or not ready for streaming"}

    A resolver that answers a dict is not the same claim as a route that answers 200:
    /info goes on to read a MIME type, a content id and the seek boundary off a torrent
    with no live handle, and any of those could have turned the fix into a 500.
    """
    tid, _ = release_dir()
    r = client.get(INFO.format(tid=tid))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["video_file"]["name"] == "The.Boys.S01E05.1080p.AMZN.WEB-DL.mkv"
    assert body["video_file"]["size"] == len(EPISODE)
    assert body["video_file"]["mime_type"] == "video/x-matroska"
    # No live handle, so the boundary is UNKNOWN rather than a zero run — the client must
    # read null as unbounded, which is true of a download that is entirely on disk.
    assert body["video_file"]["contiguous"] is None
    assert body["file_index"] == 0
    assert body["season"] == 1 and body["episode"] == 5


def test_the_television_can_play_an_episode_in_a_release_directory_again(release_dir):
    """HEAD first, because the player probes with HEAD and reads a 404 as terminal."""
    tid, _ = release_dir()
    assert client.head(VIDEO.format(tid=tid)).status_code == 200
    r = client.get(VIDEO.format(tid=tid))
    assert r.status_code == 200
    assert r.content == EPISODE


def test_the_stream_url_info_hands_back_is_one_that_works(release_dir):
    """THE ROUND TRIP, proven through the routes rather than argued about.

    /info names a `stream_url` and a `file_index`, and the player asks for bytes with
    them. If the index this reports were a convenient 0 that the byte route then refused,
    /info would answer 200 and playback would still fail — a half-fix that would have
    looked green in every unit row above.
    """
    tid, _ = release_dir(precomputed={"3": {"season": 1, "episode": 5}})
    body = client.get(INFO.format(tid=tid)).json()
    assert body["file_index"] == 3
    assert client.get(body["video_file"]["stream_url"]).status_code == 200
    # ...and the index it reported is one the byte route honours when asked explicitly.
    r = client.get(VIDEO.format(tid=tid) + f"?file_index={body['file_index']}")
    assert r.status_code == 200
    assert r.content == EPISODE


def test_a_range_request_inside_it_is_served_from_disk(release_dir):
    """The straight-through branch does no piece gating, which is why the allocation gate
    above is load-bearing; this is the request that reaches it."""
    tid, _ = release_dir()
    r = client.get(VIDEO.format(tid=tid), headers={"Range": "bytes=100-199"})
    assert r.status_code == 206
    assert r.content == EPISODE[100:200]


# ==========================================================================
# 6. Ownership: `save_path` is NOT this torrent's directory, and `name` is
# ==========================================================================
#
# Found by review and reproduced: the first version of the walk started at `save_path` and
# read `name` not at all. `save_path` is `default_download_path / label`, and label is the
# bare title (api/torrents.py) — no year, no quality — so one directory routinely holds a
# second download of the same title, and `DELETE /torrents/{id}` defaults to
# `delete_files=False`, so it also holds the leftovers of deleted attempts. Walking it
# served another torrent's film under this row's id, title and content_id.

def _blob_naming(save_path, entries, blob_name):
    return _blob(save_path, entries, with_info_dict=False, blob_name=blob_name)


def test_a_FOREIGN_video_sharing_the_save_path_is_not_served_as_this_torrent(release_dir):
    """THE REVIEW'S CRITICAL, as a regression test.

    This row's own episode is gone; a different release — another torrent's download of
    another title — is sitting in the same `save_path`, in its own folder. Before the
    containment rule the lookup answered 200 with that file, under this row's id and
    content_id. The honest answer is the 404 the row has earned.
    """
    tid, save_path = release_dir()
    (save_path / RELEASE / "The.Boys.S01E05.1080p.AMZN.WEB-DL.mkv").unlink()
    foreign = save_path / "Some.Other.Release-GRP"
    foreign.mkdir(parents=True, exist_ok=True)
    (foreign / "Completely.Different.Movie.2019.1080p.mkv").write_bytes(b"F" * 8192)
    assert torrent_manager.get_completed_video_file_info(tid, None) is None
    assert client.get(INFO.format(tid=tid)).status_code == 404


def test_a_SECOND_DOWNLOAD_of_the_same_title_is_not_served_under_the_first_id(release_dir):
    """The collision that needs no deletion to happen: two rows, one directory.

    `label` drops the year and the quality, so a 1080p and a 2160p download of one title
    share a `save_path`. Row A's own file is gone — the state a backend recreated
    mid-download leaves behind, which is where this whole bug lives — and row B's is not.
    """
    tid, save_path = release_dir()
    (save_path / RELEASE / "The.Boys.S01E05.1080p.AMZN.WEB-DL.mkv").unlink()
    other = save_path / "The.Boys.S01E05.2160p.OTHER-GRP"
    other.mkdir(parents=True, exist_ok=True)
    (other / "The.Boys.S01E05.2160p.mkv").write_bytes(b"B" * 8192)
    assert torrent_manager.get_completed_video_file_info(tid, None) is None


def test_the_walk_starts_at_the_directory_the_BLOB_names(release_dir):
    """Stated positively, so the rule is pinned rather than only its violations.

    The same tree, with the episode present in the blob's own directory AND a foreign video
    beside it: the foreign one is invisible, so it cannot even make the count ambiguous.
    """
    tid, save_path = release_dir()
    foreign = save_path / "Some.Other.Release-GRP"
    foreign.mkdir(parents=True, exist_ok=True)
    (foreign / "Completely.Different.Movie.2019.1080p.mkv").write_bytes(b"F" * 8192)
    got = torrent_manager.get_completed_video_file_info(tid, None)
    assert got is not None
    assert got["path"] == str(save_path / RELEASE / "The.Boys.S01E05.1080p.AMZN.WEB-DL.mkv")


def test_a_name_that_is_not_a_bare_directory_component_aims_nothing(release_dir):
    """A resume blob came off the wire from whoever built the torrent, so `name` is
    attacker-adjacent and it is now a PATH this code walks. It must be one component."""
    tid, save_path = release_dir()
    with manager_mod.get_db() as db:
        blob = db.query(DbTorrent).filter(DbTorrent.id == tid).first().resume_data
    entries = {f"{RELEASE}/The.Boys.S01E05.1080p.AMZN.WEB-DL.mkv": EPISODE}
    # `..` is the one that got through the first draft: `Path("..").name` is `".."`, not
    # `""`, so it is a one-component name that walks the PARENT directory — and the parent
    # of a per-torrent save path holds every other torrent's download.
    for hostile in ("..", ".", "../..", "../" + RELEASE, "/etc", "", "  ", RELEASE + "/.."):
        bad = _blob_naming(save_path, entries, hostile)
        assert torrent_manager._completed_lone_video(
            tid, bad, str(save_path), None, None) is None, hostile
    # The real name still answers, so the refusals above are about the spelling.
    assert torrent_manager._completed_lone_video(tid, blob, str(save_path), None, None) is not None


# ==========================================================================
# 7. The episode the row recorded, checked against the file on disk
# ==========================================================================

def test_a_one_entry_map_cannot_overturn_the_pack_paths_CONTENT_refusal(release_dir):
    """THE OTHER CRITICAL REVIEW FOUND.

    A map with ONE entry does not trip the pack guard, and nothing checked that the file
    found was the episode the map named. So a pack whose other episode was deleted handed
    back its survivor labelled as the episode somebody asked for — which is exactly the
    refusal `_completed_pack_file` had just made, overturned by the path that runs after it.
    """
    tid, save_path = release_dir(
        entries={
            f"{RELEASE}/Show.S01E01.mkv": b"A" * 4096,
            f"{RELEASE}/Show.S01E02.mkv": b"B" * 8192,
        },
        precomputed={"2": {"season": 1, "episode": 2}},
    )
    # The pack path refuses correctly while both are present (two files, one index).
    (save_path / RELEASE / "Show.S01E02.mkv").unlink()
    assert torrent_manager._completed_pack_file(tid, str(save_path), 2, {"2": {"season": 1, "episode": 2}}) is None
    # ...and the lone-video path must not answer with E01 under index 2.
    assert torrent_manager.get_completed_video_file_info(tid, 2) is None
    assert torrent_manager.get_completed_video_file_info(tid, None) is None


def test_the_episode_check_says_why_it_refused(release_dir):
    tid, save_path = release_dir(
        entries={f"{RELEASE}/Show.S01E01.mkv": b"A" * 4096},
        precomputed={"0": {"season": 1, "episode": 5}},
    )
    lines: list = []
    sink = manager_mod.logger.add(lines.append, level="WARNING")
    try:
        assert torrent_manager.get_completed_video_file_info(tid, None) is None
    finally:
        manager_mod.logger.remove(sink)
    said = "".join(lines)
    assert "Show.S01E01.mkv" in said and "S1E5" in said, said


def test_the_recorded_episode_AGREEING_is_what_lets_it_through(release_dir):
    """The other side of the same gate, so it is not vacuous: the box's own rows have a
    one-entry map whose episode matches the file, and they must resolve."""
    tid, _ = release_dir(precomputed={"0": {"season": 1, "episode": 5}})
    got = torrent_manager.get_completed_video_file_info(tid, None)
    assert got is not None and got["index"] == 0


def test_a_malformed_map_entry_is_refused_rather_than_ignored(release_dir):
    for bad in ({"0": {"season": 1}}, {"0": "not a dict"}, {"not-an-int": {"season": 1, "episode": 5}}):
        tid, _ = release_dir(tid=f"t-bad-{abs(hash(str(bad))) % 9999}", precomputed=bad)
        assert torrent_manager.get_completed_video_file_info(tid, None) is None, bad


# ==========================================================================
# 8. The round trip, isolated from the path that already existed
# ==========================================================================

def test_the_index_round_trip_is_served_by_THIS_path_and_not_the_pack_path(release_dir):
    """Review's finding on two of my own rows: with a map that names the asked index, the
    PRE-EXISTING `_completed_pack_file` answers first, so the round-trip assertion held
    even with the new path's index handling removed.

    This row has NO map, so the pack path cannot answer at all (`file_index is None or not
    precomputed` -> None), and an explicit non-zero index is answerable only here.
    """
    tid, save_path = release_dir(precomputed=None)
    assert torrent_manager._completed_pack_file(tid, str(save_path), 2, None) is None
    got = torrent_manager.get_completed_video_file_info(tid, 2)
    assert got is not None and got["index"] == 2


def test_the_stream_url_carries_the_index_and_that_url_works(release_dir):
    """And through the routes, with the index in the query string — which the earlier
    version of this row never had, because /info only echoes a file_index it was GIVEN."""
    tid, _ = release_dir(precomputed=None)
    body = client.get(INFO.format(tid=tid) + "?file_index=2").json()
    assert body["file_index"] == 2
    assert "file_index=2" in body["video_file"]["stream_url"]
    r = client.get(body["video_file"]["stream_url"])
    assert r.status_code == 200
    assert r.content == EPISODE


def test_a_successful_blind_resolution_no_longer_logs_that_it_FAILED(release_dir):
    """Review's finding: `_video_files_from_resume_data` logged "cannot resolve its files
    without the session" at INFO and returned [] before the fallbacks ran — so the only log
    line about this path was emitted once per Range request and once per /info poll,
    immediately before a successful resolution, stating the opposite of what happened."""
    tid, _ = release_dir()
    lines: list = []
    sink = manager_mod.logger.add(lines.append, level="INFO")
    try:
        assert torrent_manager.get_completed_video_file_info(tid, None) is not None
    finally:
        manager_mod.logger.remove(sink)
    assert not any("cannot" in line for line in lines), lines


def test_a_SYMLINK_out_of_the_release_directory_is_not_followed(release_dir):
    """The containment rule applies to the FILE as well as the directory.

    A torrent can declare a symlink, and a download directory can acquire one. The
    directory walked is this torrent's, but a link inside it resolving to a video
    elsewhere is the same ownership failure one level down — so what is streamed must
    itself resolve inside the directory the blob names.
    """
    tid, save_path = release_dir()
    outside = save_path.parent / "outside.mkv"
    outside.write_bytes(b"O" * 8192)
    (save_path / RELEASE / "The.Boys.S01E05.1080p.AMZN.WEB-DL.mkv").unlink()
    (save_path / RELEASE / "The.Boys.S01E05.1080p.AMZN.WEB-DL.mkv").symlink_to(outside)
    assert (save_path / RELEASE / "The.Boys.S01E05.1080p.AMZN.WEB-DL.mkv").is_file()
    assert torrent_manager.get_completed_video_file_info(tid, None) is None
