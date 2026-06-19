"""normalize_item must stamp media_type from the browse/search mode.

Regression: TV browse/search results were defaulting to media_type='movie'
(CatalogItem.media_type was Literal['movie']), so the frontend routed series
cards to /movies/{id} instead of /tv/{id}.
"""
from app.providers.catalog import normalize_item


def test_normalize_item_defaults_to_movie():
    item = normalize_item({"id": 1, "title": "A Movie"})
    assert item.media_type == "movie"
    assert item.title == "A Movie"


def test_normalize_item_tv_mode_sets_tv():
    item = normalize_item({"id": 2, "name": "A Show"}, media_type="tv")
    assert item.media_type == "tv"
    # TV payloads use `name`; normalize_item falls back name -> title
    assert item.title == "A Show"


def test_normalize_item_movie_mode_sets_movie():
    item = normalize_item({"id": 3, "title": "Another Movie"}, media_type="movie")
    assert item.media_type == "movie"


def test_normalize_item_unknown_mode_falls_back_to_movie():
    item = normalize_item({"id": 4, "title": "Fallback"}, media_type="something-else")
    assert item.media_type == "movie"
