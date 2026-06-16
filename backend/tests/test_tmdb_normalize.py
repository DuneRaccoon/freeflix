from app.providers.tmdb import normalize_movie_detail


SAMPLE = {
    "id": 372058, "title": "Your Name.", "overview": "High schoolers...",
    "poster_path": "/p.jpg", "backdrop_path": "/b.jpg", "release_date": "2016-08-26",
    "runtime": 106, "vote_average": 8.5, "vote_count": 12000, "popularity": 90.0,
    "original_language": "ja", "imdb_id": "tt5311514", "tagline": "...",
    "genres": [{"id": 16, "name": "Animation"}, {"id": 18, "name": "Drama"}],
    "credits": {
        "cast": [{"name": "Ryunosuke Kamiki", "character": "Taki", "profile_path": "/c.jpg"}],
        "crew": [{"name": "Makoto Shinkai", "job": "Director"}],
    },
}


def test_normalize_movie_detail_extracts_rich_fields():
    d = normalize_movie_detail(SAMPLE)
    assert d.tmdb_id == 372058
    assert d.year == 2016
    assert d.runtime == 106
    assert d.imdb_id == "tt5311514"
    assert d.genres == ["Animation", "Drama"]
    assert d.director == "Makoto Shinkai"
    assert d.cast[0].name == "Ryunosuke Kamiki"
    assert d.cast[0].image == "https://image.tmdb.org/t/p/w185/c.jpg"
