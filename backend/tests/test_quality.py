from app.providers.quality import parse_quality, parse_release_info


def test_parse_quality_common_buckets():
    assert parse_quality("Your.Name.2016.1080p.BluRay.x264-HAiKU") == "1080p"
    assert parse_quality("Your Name. (2016) 2160p BRRip 5.1 10Bit x265 -YTS") == "2160p"
    assert parse_quality("Your Name. (2016) 720p BRRip x264 -YTS") == "720p"
    assert parse_quality("Some.Movie.2019.480p.WEBRip") == "480p"


def test_parse_quality_4k_and_uhd_map_to_2160p():
    assert parse_quality("Movie.2020.4K.UHD.BluRay.x265") == "2160p"
    assert parse_quality("Movie 2020 UHD 2160p") == "2160p"


def test_parse_quality_unknown_returns_none():
    assert parse_quality("Movie.2020.DVDRip.XviD") is None
    assert parse_quality("Your.Name.2016.BDRip.x264-HAiKU") is None


def test_parse_release_info_extracts_fields():
    info = parse_release_info("Your.Name.2016.2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.5.1-SWT")
    assert info["quality"] == "2160p"
    assert info["codec"] == "x265"
    assert info["source"] == "BluRay"
    assert info["hdr"] is True
