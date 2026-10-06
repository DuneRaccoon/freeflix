"""Every extension the app accepts as video must have an explicit MIME type.

The 8 uncovered extensions fell through to mimetypes.guess_type() on the
container's Python 3.10, whose table is smaller than a dev machine's, so some
became application/octet-stream — which most media stacks refuse outright.
"""
from app.api.streaming import VIDEO_MIME_TYPES, get_mime_type
from app.config import settings


def test_every_configured_video_extension_is_mapped_explicitly():
    missing = sorted(settings.video_extensions - set(VIDEO_MIME_TYPES))
    assert not missing, (
        f"these accepted video extensions have no explicit MIME entry and would "
        f"depend on the container's mimetypes table: {missing}"
    )


def test_no_configured_extension_degrades_to_octet_stream():
    for ext in sorted(settings.video_extensions):
        assert get_mime_type(f"/tmp/sample{ext}") != "application/octet-stream", ext


def test_transport_stream_extensions_map_to_mp2t():
    assert get_mime_type("/tmp/a.ts") == "video/mp2t"
    assert get_mime_type("/tmp/a.m2ts") == "video/mp2t"
    assert get_mime_type("/tmp/a.mts") == "video/mp2t"


def test_matroska_still_maps_to_x_matroska():
    # The common torrent case; webOS 22 lists .mkv as a supported container.
    assert get_mime_type("/tmp/a.mkv") == "video/x-matroska"


def test_unknown_extension_still_falls_back():
    assert get_mime_type("/tmp/a.zzz") == "application/octet-stream"
