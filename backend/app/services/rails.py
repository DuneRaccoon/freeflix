"""Personalised, rotating carousel ('rail') planner for browse pages.

Returns ordered RailSpec (title + browse params); the frontend fetches each
rail's items via the existing browse endpoint. Taste is a genre/origin affinity
tally over the profile's recent progress + watchlist, joined to CatalogItemCache.
Remaining rails are filled from a candidate pool by a daily per-profile seed so
lineups rotate (and differ per surface).
"""
import datetime
import hashlib
import random
from collections import Counter
from typing import List, Optional, Dict, Any

from app.models import RailSpec
from app.database.session import get_db
from app.database.models.catalog import CatalogItemCache
from app.database.models.streaming import UserStreamingProgress
from app.database.models.watchlist import UserWatchlist

_GENRE_LABELS = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
    99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
    27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi",
    53: "Thriller", 10752: "War", 37: "Western",
}
_LANG_TO_ORIGIN = {
    "ko": "KR", "ja": "JP", "hi": "IN", "ta": "IN", "te": "IN", "ml": "IN",
    "kn": "IN", "bn": "IN", "pa": "IN", "fr": "FR", "es": "ES", "it": "IT", "zh": "CN",
}
_ORIGIN_LABELS = {
    "KR": "Korean", "JP": "Japanese", "IN": "Indian", "GB": "British",
    "FR": "French", "ES": "Spanish", "IT": "Italian", "CN": "Chinese",
}
_PROVIDER_POOL = [
    ("8", "Netflix"), ("9", "Prime Video"), ("337", "Disney+"), ("1899", "HBO Max"),
    ("15", "Hulu"), ("350", "Apple TV+"), ("531", "Paramount+"), ("386", "Peacock"),
]
_COMPANY_POOL = [
    ("420", "Marvel Studios"), ("3", "Pixar"), ("521", "DreamWorks"), ("2", "Walt Disney"),
    ("174", "Warner Bros"), ("33", "Universal"), ("41077", "A24"), ("10342", "Studio Ghibli"),
    ("923", "Legendary"), ("1632", "Lionsgate"), ("3172", "Blumhouse"),
]
_COLLECTION_POOL = [
    ("86311", "The Avengers"), ("1241", "Harry Potter"), ("10", "Star Wars"),
    ("645", "James Bond 007"), ("9485", "Fast & Furious"), ("119", "Lord of the Rings"),
    ("121938", "The Hobbit"), ("328", "Jurassic Park"), ("131635", "The Hunger Games"),
    ("295", "Pirates of the Caribbean"), ("87359", "Mission Impossible"), ("404609", "John Wick"),
    ("263", "Dark Knight"), ("2344", "The Matrix"), ("10194", "Toy Story"),
    ("2150", "Shrek"), ("86066", "Despicable Me"), ("87096", "Avatar"),
    ("748", "X-Men"), ("8091", "Alien"),
]
_ORIGIN_POOL = ["KR", "JP", "IN", "GB", "FR", "ES", "IT", "CN"]
_BEST_POOL = ["2025", "2024", "2023", "2022", "2021", "2020"]


def _parse_content_id(cid: str):
    """movie:{id} | tv:{id}[:...] -> (media_type, tmdb_id) | (None, None)."""
    if not cid or ":" not in cid:
        return None, None
    parts = cid.split(":")
    if parts[0] not in ("movie", "tv"):
        return None, None
    try:
        return parts[0], int(parts[1])
    except (IndexError, ValueError):
        return None, None


def _seed(user_id: Optional[str], surface: str) -> int:
    key = f"{user_id or 'anon'}:{surface}:{datetime.date.today().isoformat()}"
    return int(hashlib.sha256(key.encode()).hexdigest(), 16)


def _rotate(items: list, seed: int) -> list:
    if not items:
        return []
    off = seed % len(items)
    return items[off:] + items[:off]


def _interleave(lists: List[list]) -> list:
    out, queues = [], [list(l) for l in lists if l]
    while any(queues):
        for q in queues:
            if q:
                out.append(q.pop(0))
    return out


def affinity(user_id: str, mode: str) -> Dict[str, Counter]:
    """Tally genre + origin affinity from the profile's progress + watchlist."""
    genres: Counter = Counter()
    origins: Counter = Counter()
    with get_db() as db:
        cids = [p.movie_id for p in UserStreamingProgress.get_recent_for_user(db, user_id, limit=40)]
        cids += [w.content_id for w in UserWatchlist.get_for_user(db, user_id, limit=60)]
        seen = set()
        for cid in cids:
            mt, tid = _parse_content_id(cid)
            if not tid or (mt, tid) in seen:
                continue
            seen.add((mt, tid))
            row = CatalogItemCache.get_one(db, mt or "movie", tid)
            if not row:
                continue
            for gid in (row.genre_ids or []):
                if gid in _GENRE_LABELS:
                    genres[gid] += 1
            code = _LANG_TO_ORIGIN.get((row.original_language or "").lower())
            if code:
                origins[code] += 1
    return {"genres": genres, "origins": origins}


def _sig(params: Dict[str, Any]):
    """Content identity of a rail's filter, for de-duping across rails."""
    for k in ("genres", "provider", "network", "origin", "company", "collection"):
        if params.get(k):
            return (k, str(params[k]))
    return ("api", str(params.get("api") or "popular"))


def _random_rail(mode: str, used_sigs: set) -> Optional["RailSpec"]:
    """One 'wildcard' rail with a randomly chosen dimension + value, re-rolled per
    call. De-duped against `used_sigs` (mutated) so it never repeats content already
    on the page. Returns None if no fresh pick is found."""
    is_tv = mode == "tv"
    noun = "Series" if is_tv else "Movies"
    dims = ["genre", "provider", "origin", "best"]
    if not is_tv:                       # company/collection are movie-only
        dims += ["company", "collection"]
    for _ in range(12):
        dim = random.choice(dims)
        if dim == "genre":
            gid = random.choice(list(_GENRE_LABELS))
            params, title = {"genres": str(gid)}, _GENRE_LABELS[gid]
        elif dim == "provider":
            pid, label = random.choice(_PROVIDER_POOL)
            params, title = {"provider": pid}, label
        elif dim == "origin":
            code = random.choice(_ORIGIN_POOL)
            params, title = {"origin": code}, f"{_ORIGIN_LABELS[code]} {noun}"
        elif dim == "best":
            yr = random.choice(_BEST_POOL)
            params, title = {"api": f"best_{yr}"}, f"Best of {yr}"
        elif dim == "company":
            cid, label = random.choice(_COMPANY_POOL)
            params, title = {"company": cid}, label
        else:                           # collection
            col, label = random.choice(_COLLECTION_POOL)
            params, title = {"collection": col}, label
        sig = _sig(params)
        if sig not in used_sigs:
            used_sigs.add(sig)
            return RailSpec(key=f"rand-{sig[0]}-{sig[1]}", title=title,
                            eyebrow="Surprise pick", params=params)
    return None


def plan_rails(user_id: Optional[str], mode: str = "movie", limit: int = 10,
               surface: str = "", random_slots: int = 0) -> List[RailSpec]:
    is_tv = mode == "tv"
    noun = "Series" if is_tv else "Movies"
    href = "/tv" if is_tv else "/movies"
    seed = _seed(user_id, surface)

    rails: List[RailSpec] = [
        RailSpec(key="trending", title=f"Trending {noun}", params={"api": "popular"}, see_all_href=href),
        RailSpec(key="top-rated", title=f"Top Rated {noun}", eyebrow="Critically acclaimed",
                 variant="ranked", params={"api": "top_rated"}),
        RailSpec(key="new", title="New Releases",
                 params={"api": "popular", "sort": "primary_release_date.desc"}),
    ]
    used_genres = set()

    if user_id:
        try:
            aff = affinity(user_id, mode)
        except Exception:
            aff = {"genres": Counter(), "origins": Counter()}
        for gid, _ in aff["genres"].most_common(2):
            used_genres.add(gid)
            rails.append(RailSpec(key=f"taste-genre-{gid}", eyebrow="For you",
                                  title=f"Because you watch {_GENRE_LABELS[gid]}",
                                  params={"genres": str(gid)}))
        top = aff["origins"].most_common(1)
        if top:
            code = top[0][0]
            if code == "JP" and aff["genres"].get(16):
                rails.append(RailSpec(key="taste-anime", title="Anime For You",
                                      eyebrow="For you", params={"origin": "anime"}))
            else:
                rails.append(RailSpec(key=f"taste-origin-{code}", eyebrow="For you",
                                      title=f"{_ORIGIN_LABELS[code]} {noun}",
                                      params={"origin": code}))

    # Candidate pool, per-category rotated then interleaved for variety.
    genre_rail = [RailSpec(key=f"genre-{g}", title=_GENRE_LABELS[g], eyebrow="Genre",
                           params={"genres": str(g)})
                  for g in _rotate([g for g in _GENRE_LABELS if g not in used_genres], seed)]
    provider_rail = [RailSpec(key=f"provider-{pid}", title=label, eyebrow="Streaming",
                              params={"provider": pid})
                     for pid, label in _rotate(_PROVIDER_POOL, seed)]
    origin_rail = [RailSpec(key=f"origin-{c}", title=f"{_ORIGIN_LABELS[c]} {noun}",
                            eyebrow="Around the world", params={"origin": c})
                   for c in _rotate(_ORIGIN_POOL, seed)]
    best_rail = [RailSpec(key=f"best-{y}", title=f"Best of {y}", eyebrow="Year in review",
                          params={"api": f"best_{y}"})
                 for y in _rotate(_BEST_POOL, seed)]
    categories = [genre_rail, provider_rail, origin_rail, best_rail]
    if not is_tv:
        categories.append([RailSpec(key=f"company-{cid}", title=label, eyebrow="Studio",
                                    params={"company": cid})
                           for cid, label in _rotate(_COMPANY_POOL, seed)])
        categories.append([RailSpec(key=f"collection-{col}", title=label, eyebrow="Saga",
                                    params={"collection": col})
                           for col, label in _rotate(_COLLECTION_POOL, seed)])

    for rail in _rotate(_interleave(categories), seed):
        if len(rails) >= limit:
            break
        rails.append(rail)

    # Wildcard placements: re-rolled on every call (not seeded), inserted at fixed
    # slots after the evergreen leads. The personalised + daily-rotating rails above
    # stay deterministic; only these slots change per page load.
    if random_slots > 0:
        used_sigs = {_sig(r.params) for r in rails}
        placements = (3, 7, 11, 5, 9)
        for i in range(random_slots):
            wild = _random_rail(mode, used_sigs)
            if wild is None:
                break
            pos = placements[i] if i < len(placements) else len(rails)
            rails.insert(min(pos, len(rails)), wild)

    return rails[:limit]
