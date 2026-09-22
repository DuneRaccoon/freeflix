"""parse_range_header must signal HTTP 416 (not silently clamp) when the
requested range starts at or beyond the file size."""
from app.api.streaming import (
    parse_range_header,
    RANGE_NOT_SATISFIABLE,
    RANGE_MALFORMED,
    RANGE_FILE_NOT_READY,
)


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


def test_empty_file_is_not_ready_rather_than_unsatisfiable():
    # A zero-length file is a torrent whose metadata arrived but whose file
    # libtorrent has not allocated. 416 tells <video> to give up permanently over
    # a condition that clears itself in seconds, so the endpoint answers 503 +
    # Retry-After instead — and it must do so whether or not a Range was asked for.
    assert parse_range_header("bytes=0-", 0) is RANGE_FILE_NOT_READY
    assert parse_range_header("bytes=-500", 0) is RANGE_FILE_NOT_READY
    assert parse_range_header(None, 0) is RANGE_FILE_NOT_READY
    assert parse_range_header("", 0) is RANGE_FILE_NOT_READY


def test_not_ready_wins_over_an_unsupported_range_unit():
    # Ordering check: the file being unallocated is the more actionable fact, and
    # serving "200 with the full body" for an ignored Range would mean promising
    # Content-Length 0 on a file that is about to have bytes.
    assert parse_range_header("items=0-5", 0) is RANGE_FILE_NOT_READY


def test_negative_file_size_is_not_ready():
    assert parse_range_header(None, -1) is RANGE_FILE_NOT_READY


def test_multipart_range_is_malformed_not_parsed():
    # Legal HTTP we do not implement. int('99,200') used to raise -> HTTP 500.
    assert parse_range_header("bytes=0-99,200-299", 1000) is RANGE_MALFORMED


def test_non_numeric_range_is_malformed():
    assert parse_range_header("bytes=abc-def", 1000) is RANGE_MALFORMED
    assert parse_range_header("bytes=10-abc", 1000) is RANGE_MALFORMED


def test_end_before_start_is_malformed():
    assert parse_range_header("bytes=500-100", 1000) is RANGE_MALFORMED


def test_missing_dash_is_malformed():
    assert parse_range_header("bytes=500", 1000) is RANGE_MALFORMED
