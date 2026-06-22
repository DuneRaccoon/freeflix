"""Rail planner: deterministic seed, taste rails, cold-start, mode gating."""
from collections import Counter

import app.services.rails as rails


def test_cold_start_has_no_for_you_rails():
    plan = rails.plan_rails(user_id=None, mode="movie", limit=10)
    assert len(plan) == 10
    assert all(r.eyebrow != "For you" for r in plan)
    # Evergreen leads first.
    assert plan[0].params.get("api") == "popular"
    assert plan[1].variant == "ranked"


def test_seed_is_deterministic_within_day():
    a = rails.plan_rails(user_id=None, mode="movie", limit=10)
    b = rails.plan_rails(user_id=None, mode="movie", limit=10)
    assert [r.key for r in a] == [r.key for r in b]


def test_surface_changes_lineup():
    home = rails.plan_rails(user_id=None, mode="movie", limit=10, surface="home")
    movies = rails.plan_rails(user_id=None, mode="movie", limit=10, surface="movies")
    # Leads are identical; the seeded tail differs.
    assert [r.key for r in home] != [r.key for r in movies]
    assert [r.key for r in home[:3]] == [r.key for r in movies[:3]]


def test_taste_genre_and_origin_rails(monkeypatch):
    monkeypatch.setattr(rails, "affinity",
                        lambda uid, mode: {"genres": Counter({28: 5, 35: 2}),
                                           "origins": Counter({"KR": 4})})
    plan = rails.plan_rails(user_id="u1", mode="movie", limit=12)
    titles = [r.title for r in plan]
    assert "Because you watch Action" in titles
    assert "Korean Movies" in titles
    assert any(r.eyebrow == "For you" for r in plan)


def test_anime_taste_when_japanese_and_animation(monkeypatch):
    monkeypatch.setattr(rails, "affinity",
                        lambda uid, mode: {"genres": Counter({16: 6}),
                                           "origins": Counter({"JP": 5})})
    plan = rails.plan_rails(user_id="u1", mode="movie", limit=12)
    assert any(r.params.get("origin") == "anime" for r in plan)


def test_tv_mode_has_no_company_or_collection_rails():
    plan = rails.plan_rails(user_id=None, mode="tv", limit=20)
    assert all("company" not in r.params and "collection" not in r.params for r in plan)


def test_parse_content_id():
    assert rails._parse_content_id("movie:123") == ("movie", 123)
    assert rails._parse_content_id("tv:456:s1:e2") == ("tv", 456)
    assert rails._parse_content_id("garbage") == (None, None)
    assert rails._parse_content_id("xyzzy:99") == (None, None)


def test_lang_to_origin_mapping():
    assert rails._LANG_TO_ORIGIN["ko"] == "KR"
    assert rails._LANG_TO_ORIGIN["ja"] == "JP"
    assert rails._LANG_TO_ORIGIN["hi"] == "IN"
    assert "en" not in rails._LANG_TO_ORIGIN


def test_plan_rails_survives_affinity_failure(monkeypatch):
    def boom(uid, mode):
        raise RuntimeError("db down")
    monkeypatch.setattr(rails, "affinity", boom)
    plan = rails.plan_rails(user_id="u1", mode="movie", limit=8)
    assert len(plan) == 8
    assert all(r.eyebrow != "For you" for r in plan)


def test_random_slots_off_by_default_is_deterministic():
    plan = rails.plan_rails(user_id=None, mode="movie", limit=10)
    assert all(not r.key.startswith("rand-") for r in plan)


def test_random_slots_inject_labeled_wildcards():
    plan = rails.plan_rails(user_id=None, mode="movie", limit=10, random_slots=2)
    wild = [r for r in plan if r.key.startswith("rand-")]
    assert len(wild) == 2
    assert all(r.eyebrow == "Surprise pick" for r in wild)
    assert len(plan) == 10
    # Leads are untouched — wildcards never displace position 0.
    assert plan[0].key == "trending"


def test_wildcards_do_not_duplicate_existing_content():
    plan = rails.plan_rails(user_id=None, mode="movie", limit=14, random_slots=3)
    wild = [r for r in plan if r.key.startswith("rand-")]
    other_sigs = {rails._sig(r.params) for r in plan if not r.key.startswith("rand-")}
    wild_sigs = [rails._sig(r.params) for r in wild]
    assert len(wild_sigs) == len(set(wild_sigs))          # distinct from each other
    assert all(s not in other_sigs for s in wild_sigs)    # distinct from the rest


def test_wildcards_respect_tv_mode_gating():
    plan = rails.plan_rails(user_id=None, mode="tv", limit=14, random_slots=4)
    wild = [r for r in plan if r.key.startswith("rand-")]
    assert all("company" not in r.params and "collection" not in r.params for r in wild)
