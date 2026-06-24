"""_pieces_ready is a pure, non-blocking availability check; _adaptive_piece_timeout
derives a wait budget from live peer/throughput status."""
import types
from app.torrent.manager import torrent_manager


class _Handle:
    def __init__(self, have, status=None):
        self._have = have          # set of piece indices already downloaded
        self._status = status

    def have_piece(self, p):
        return p in self._have

    def status(self):
        return self._status


def test_pieces_ready_true_when_all_present():
    h = _Handle(have={3, 4, 5})
    assert torrent_manager._pieces_ready(h, 3, 5) is True


def test_pieces_ready_false_when_any_missing():
    h = _Handle(have={3, 5})  # 4 missing
    assert torrent_manager._pieces_ready(h, 3, 5) is False


def test_pieces_ready_false_on_exception():
    class _Boom:
        def have_piece(self, p):
            raise RuntimeError("handle invalidated")
    assert torrent_manager._pieces_ready(_Boom(), 0, 1) is False


def test_adaptive_timeout_short_when_no_peers():
    st = types.SimpleNamespace(num_peers=0, download_rate=0)
    t = torrent_manager._adaptive_piece_timeout(_Handle(have=set(), status=st))
    assert t == 2.0


def test_adaptive_timeout_base_when_peers_idle():
    st = types.SimpleNamespace(num_peers=3, download_rate=0)
    t = torrent_manager._adaptive_piece_timeout(_Handle(have=set(), status=st), base=8.0)
    assert t == 8.0


def test_adaptive_timeout_extends_while_downloading():
    st = types.SimpleNamespace(num_peers=10, download_rate=500_000)
    t = torrent_manager._adaptive_piece_timeout(
        _Handle(have=set(), status=st), base=8.0, max_timeout=60.0
    )
    assert 8.0 < t <= 60.0


def test_adaptive_timeout_capped_at_max():
    st = types.SimpleNamespace(num_peers=50, download_rate=10_000_000)
    t = torrent_manager._adaptive_piece_timeout(
        _Handle(have=set(), status=st), base=8.0, max_timeout=60.0
    )
    assert t == 60.0
