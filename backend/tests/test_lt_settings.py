import platform
import libtorrent as lt
from app.config import settings, Settings


def test_lt_settings_returns_dict_of_known_keys_only():
    out = settings.lt_settings()
    assert isinstance(out, dict)
    valid = set(lt.default_settings().keys())
    # Every assembled key must be valid in THIS libtorrent build (unknown keys filtered).
    assert set(out).issubset(valid), f"unknown keys leaked: {set(out) - valid}"


def test_lt_settings_filters_an_injected_unknown_key():
    # The assembler must drop any key not present in the running build.
    out = Settings()._assemble_lt_settings({"definitely_not_a_real_lt_key_xyz": 1,
                                            "active_downloads": 2})
    assert "definitely_not_a_real_lt_key_xyz" not in out
    assert out.get("active_downloads") == 2


def test_lt_settings_active_downloads_tracks_effective_cap():
    out = settings.lt_settings()
    # active_downloads is only present if the build supports it; when present it equals the cap.
    if "active_downloads" in out:
        assert out["active_downloads"] == settings.effective_max_active_downloads()


def test_lt_settings_arm_profile_lowers_connection_limit():
    s = Settings()
    arm = s._profile_settings(is_arm=True)
    x86 = s._profile_settings(is_arm=False)
    assert arm["connections_limit"] < x86["connections_limit"]
    assert arm["aio_threads"] <= x86["aio_threads"]


def test_lt_per_torrent_connections_is_positive_int():
    assert isinstance(settings.lt_per_torrent_connections(), int)
    assert settings.lt_per_torrent_connections() > 0


def test_lt_settings_includes_tuning_keys_when_supported():
    out = settings.lt_settings()
    valid = set(lt.default_settings().keys())
    # For any tuning key supported by this build, the assembler must have set it.
    for k in ("peer_connect_timeout", "request_timeout", "piece_timeout",
              "prioritize_partial_pieces", "strict_end_game_mode"):
        if k in valid:
            assert k in out
