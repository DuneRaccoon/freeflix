from app.config import settings, Settings


def test_seed_threshold_defaults():
    assert settings.min_seeds == 1
    assert settings.healthy_seeds == 5


def test_seed_thresholds_are_ints():
    fresh = Settings()
    assert isinstance(fresh.min_seeds, int)
    assert isinstance(fresh.healthy_seeds, int)
