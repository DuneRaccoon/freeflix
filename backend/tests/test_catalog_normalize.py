from app.providers.catalog import normalize_item, normalize_hit, image_url, genre_names


def test_image_url_prefixes_relative_path():
    assert image_url("/abc.jpg", "w500") == "https://image.tmdb.org/t/p/w500/abc.jpg"
    assert image_url(None, "w500") is None


def test_genre_names_maps_known_ids():
    assert genre_names([16, 18]) == ["Animation", "Drama"]
    assert genre_names([999999]) == []


def test_normalize_item_from_movie_object():
    raw = {
        "id": 372058, "title": "Your Name.", "overview": "High schoolers...",
        "poster_path": "/p.jpg", "backdrop_path": "/b.jpg",
        "genre_ids": [16, 18], "vote_average": 8.4, "vote_count": 12000,
        "popularity": 100.0, "original_language": "ja", "release_date": "2016-08-26",
    }
    item = normalize_item(raw)
    assert item.tmdb_id == 372058
    assert item.title == "Your Name."
    assert item.year == 2016
    assert item.poster_url == "https://image.tmdb.org/t/p/w500/p.jpg"
    assert item.backdrop_url == "https://image.tmdb.org/t/p/w1280/b.jpg"
    assert item.genres == ["Animation", "Drama"]


def test_normalize_hit_parses_quality_and_renames_magnet():
    raw = {"title": "Your.Name.2016.1080p.BluRay.x264-HAiKU", "seeds": 118,
           "peers": 5, "bytes": 5930685952, "magnetUrl": "magnet:?xt=urn:btih:ABC",
           "hash": "ABC", "source": "Knaben"}
    hit = normalize_hit(raw)
    assert hit.magnet == "magnet:?xt=urn:btih:ABC"
    assert hit.seeds == 118
    assert hit.quality == "1080p"
