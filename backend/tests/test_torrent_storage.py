from pathlib import Path
from app.torrent.storage import encode_resume_data, decode_resume_data, safe_rmtree


def test_resume_data_roundtrip():
    original = b"\x00\x01libtorrent-resume\xff"
    encoded = encode_resume_data(original)
    assert isinstance(encoded, str)
    assert decode_resume_data(encoded) == original


def test_safe_rmtree_removes_subdir(tmp_path):
    root = tmp_path / "downloads"
    target = root / "Some Movie (2021)"
    target.mkdir(parents=True)
    (target / "movie.mkv").write_bytes(b"x")
    assert safe_rmtree(target, root) is True
    assert not target.exists()


def test_safe_rmtree_refuses_root_itself(tmp_path):
    root = tmp_path / "downloads"
    root.mkdir()
    assert safe_rmtree(root, root) is False
    assert root.exists()


def test_safe_rmtree_refuses_outside_root(tmp_path):
    root = tmp_path / "downloads"
    root.mkdir()
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    assert safe_rmtree(outside, root) is False
    assert outside.exists()


def test_safe_rmtree_missing_path_is_false(tmp_path):
    root = tmp_path / "downloads"
    root.mkdir()
    assert safe_rmtree(root / "nope", root) is False
