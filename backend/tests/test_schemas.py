from app.models import CatalogItem, MovieDetail, TorrentHit, CatalogPage, TorrentRequest


def test_catalog_item_defaults():
    item = CatalogItem(tmdb_id=372058, title="Your Name.")
    assert item.media_type == "movie"
    assert item.genre_ids == [] and item.genres == []
    assert item.vote_average == 0.0


def test_movie_detail_is_catalog_item_plus_fields():
    d = MovieDetail(tmdb_id=1, title="X", runtime=107, available_qualities=["1080p"])
    assert d.tmdb_id == 1 and d.runtime == 107
    assert d.available_qualities == ["1080p"]


def test_torrent_request_requires_tmdb_id_int():
    req = TorrentRequest(tmdb_id=372058, quality="1080p")
    assert req.tmdb_id == 372058 and req.quality == "1080p"


def test_catalog_page_shape():
    page = CatalogPage(page=2, results=[CatalogItem(tmdb_id=1, title="X")], total_pages=5, total_results=99)
    assert page.page == 2 and page.total_pages == 5 and len(page.results) == 1
