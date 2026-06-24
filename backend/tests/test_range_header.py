"""parse_range_header must signal HTTP 416 (not silently clamp) when the
requested range starts at or beyond the file size."""
from app.api.streaming import parse_range_header, RANGE_NOT_SATISFIABLE


def test_no_range_header_returns_full_file():
    assert parse_range_header(None, 1000) == (0, 999)
    assert parse_range_header("", 1000) == (0, 999)


def test_normal_range_parsed():
    assert parse_range_header("bytes=100-299", 1000) == (100, 299)


def test_open_ended_range_clamped_to_eof():
    assert parse_range_header("bytes=500-", 1000) == (500, 999)


def test_end_beyond_eof_clamped():
    # end past EOF is fine to clamp; only start-out-of-bounds is unsatisfiable
    assert parse_range_header("bytes=100-99999", 1000) == (100, 999)


def test_start_equal_to_filesize_is_unsatisfiable():
    assert parse_range_header("bytes=1000-1000", 1000) is RANGE_NOT_SATISFIABLE


def test_start_beyond_filesize_is_unsatisfiable():
    assert parse_range_header("bytes=5000-", 1000) is RANGE_NOT_SATISFIABLE


def test_empty_file_any_range_unsatisfiable():
    assert parse_range_header("bytes=0-", 0) is RANGE_NOT_SATISFIABLE
