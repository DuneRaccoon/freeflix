"""RFC 7233 suffix ranges: `bytes=-N` means the LAST N bytes.

Regression: the header was split on "-" and an empty first field became start=0,
so `bytes=-500` served the FIRST 501 bytes under a 206 claiming `bytes 0-500/size`.
TV media pipelines use a suffix range to find a container index at EOF, so this
handed the decoder the wrong bytes with a success status.
"""
from app.api.streaming import parse_range_header, RANGE_NOT_SATISFIABLE, RANGE_MALFORMED


def test_suffix_range_returns_tail_not_head():
    # last 500 bytes of a 1000-byte file == bytes 500..999
    assert parse_range_header("bytes=-500", 1000) == (500, 999)


def test_suffix_range_larger_than_file_is_whole_file():
    assert parse_range_header("bytes=-5000", 1000) == (0, 999)


def test_suffix_range_of_one_byte():
    assert parse_range_header("bytes=-1", 1000) == (999, 999)


def test_suffix_range_of_zero_is_unsatisfiable():
    # "the last 0 bytes" cannot be satisfied
    assert parse_range_header("bytes=-0", 1000) is RANGE_NOT_SATISFIABLE


def test_bare_dash_is_malformed():
    assert parse_range_header("bytes=-", 1000) is RANGE_MALFORMED


def test_whitespace_tolerated():
    assert parse_range_header("bytes= 500 - 799 ", 1000) == (500, 799)
