from app.providers.quality import parse_quality, parse_release_facts, parse_release_info


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
    # codecs/audio/interlaced must NOT be mistaken for a quality bucket
    assert parse_quality("Movie.2020.x264-GRP") is None
    assert parse_quality("Movie.2020.480i.HDTV") is None
    assert parse_quality("Concert.2020.FLAC.24bit.48kHz") is None


def test_parse_quality_buckets_1080p_uhd_as_2160p_characterisation():
    """CHARACTERISATION, not an endorsement: this answer is wrong and is kept anyway.

    ``_QUALITY_PATTERNS`` tries ``\\b(2160p|4k|uhd)\\b`` before ``1080p``, so a 1080p encode
    of a UHD disc buckets as 2160p. Reordering the list would move releases between buckets
    for every desktop user at once: it regroups the ``SourcePicker`` pill, changes the
    downgrade walk's starting position, and changes which bucket a 2160p cron schedule's
    exact-bucket filter matches. So the defect is **contained rather than fixed** — the
    capability profile keys on ``parse_release_facts(...).resolution``, which has explicit
    ``NNNNp`` precedence and answers 1080 for the same string.

    This test asserts only ``parse_quality``, so that it stays green under any change to
    ``parse_release_facts`` — the independence is the point, and
    :func:`test_the_1080p_uhd_misplacement_is_contained_by_release_facts` below is where
    the two are compared.

    FOLLOW-UP (not stage 8): fix ``parse_quality``'s ordering together with the three
    desktop consumers above — ``SourcePicker``'s grouping, the downgrade walk in
    ``services/torrents_select.py``, and ``cron``'s exact-bucket filter. Out of scope here
    because the stage must not reorder the library for the web surface to serve the TV.
    """
    assert parse_quality("Movie.2020.1080p.UHD.BluRay.DD5.1.x265-GRP") == "2160p"


def test_the_1080p_uhd_misplacement_is_contained_by_release_facts():
    """The containment contract: the two parsers must disagree about this string.

    The capability profile keys on ``facts.resolution``, never on the bucket, so a 1080p
    encode of a UHD disc is not withheld as un-opted-in 4K and is not hit by the 2160p
    audio rule. If these two ever agree, either ``parse_quality`` was reordered (do the
    follow-up above, and the three desktop consumers with it) or ``parse_release_facts``
    lost its explicit-token precedence (a regression: fix the parser, not this test).
    """
    title = "Movie.2020.1080p.UHD.BluRay.DD5.1.x265-GRP"
    assert parse_quality(title) == "2160p"
    assert parse_release_facts(title).resolution == 1080


def test_parse_release_info_extracts_fields():
    info = parse_release_info("Your.Name.2016.2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.5.1-SWT")
    assert info["quality"] == "2160p"
    assert info["codec"] == "x265"
    assert info["source"] == "BluRay"
    assert info["hdr"] is True
