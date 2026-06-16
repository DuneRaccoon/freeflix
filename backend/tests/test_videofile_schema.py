from app.models import VideoFile


def test_videofile_defaults():
    f = VideoFile(index=2, name="The.Boys.S01E03.mkv", size=1000, mime_type="video/x-matroska",
                  stream_url="/api/v1/streaming/abc/video?file_index=2")
    assert f.index == 2 and f.downloaded == 0 and f.progress == 0.0
    assert f.season is None and f.episode is None


def test_videofile_with_episode():
    f = VideoFile(index=0, name="x.mkv", size=5, mime_type="video/mp4", stream_url="/x",
                  season=1, episode=3, downloaded=5, progress=100.0)
    assert f.season == 1 and f.episode == 3 and f.progress == 100.0
