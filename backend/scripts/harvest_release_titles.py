"""Harvest real release titles from the live catalog provider, for the frozen corpus.

Why this exists
---------------
``backend/tests/data/releases.tsv`` is the only measurement of ``parse_release_facts``
against names a human did not invent. At selection time the release title is all there is
(``providers/catalog.py:59-70`` keeps seven upstream keys and no file list), so parser
precision *is* the capability profile's accuracy — and a corpus of titles the author
imagined would measure the author, not the provider.

The local cache (``catalog_items.torrents_json``) supplies the movie half for free, but
``set_torrents`` has exactly one caller (``services/movies.py:97``) and ``services/tv.py``
never calls it, so the two naming shapes that matter most for the television — ``SxxExx``
and the season pack — are **structurally absent** from the cache. They can only come from a
live query, which is what this script is for.

It is a one-shot developer tool, not part of the test suite or the running app. Its output
is pasted into ``tests/data/releases.tsv`` and then **hand-labelled**. It must never write
the label columns: a corpus whose labels came from the parser proves only that the parser is
deterministic.

Running it
----------
``backend/scripts/`` is **not** copied into the image (``backend/Dockerfile`` copies
``app/``, ``serve.py``, ``tests/`` and ``shell.py`` only), so the directory needs an explicit
mount, and ``PYTHONPATH`` needs the workdir because the app package is not pip-installed:

.. code-block:: bash

    docker compose run --rm \
      -v "$(pwd)/backend/scripts:/opt/freeflix/scripts" \
      -e PYTHONPATH=/opt/freeflix \
      backend python scripts/harvest_release_titles.py --out /opt/freeflix/logs/harvest.jsonl

The provider is a live third party. ``--delay`` defaults to 1.2s between requests and every
failure is skipped rather than retried in a loop; do not lower it to hammer the host.
"""
import argparse
import asyncio
import json
import sys
from typing import Dict, List

from app.providers import catalog

# ----------------------------------------------------------------------------------------
# Shows, for the two TV shapes. ``S01E01`` and ``S01`` are asked separately because the
# provider answers them differently: the episode query returns single-episode names, the
# bare-season query returns season packs (and some single episodes alongside).
#
# Chosen for *naming* spread rather than taste — the streaming-era AMZN/NTb/FLUX house
# style, the disc-era REMUX style, the HDTV/x264 back catalogue, and anime, whose fansub
# names are a different grammar again.
# ----------------------------------------------------------------------------------------
TV_SHOWS: List[str] = [
    # Streaming originals: DDP/Atmos/H 264, mostly space-separated
    "The Boys", "Fallout", "Reacher", "The Bear", "Severance", "Silo",
    "The Last of Us", "House of the Dragon", "Shogun", "Andor",
    "Stranger Things", "The Mandalorian", "Loki", "Ted Lasso",
    # 4K-era HDR/DV television
    "Arcane", "The Witcher", "Foundation", "Rings of Power", "Wednesday",
    # Disc and back-catalogue shapes: REMUX, BluRay, DTS-HD
    "Breaking Bad", "Game of Thrones", "The Wire", "The Sopranos", "Chernobyl",
    "Band of Brothers", "True Detective", "Mad Men", "Westworld",
    # HDTV/x264 era, often 720p with AC3 or AAC
    "The Office", "Friends", "Seinfeld", "Lost", "Dexter", "Prison Break",
    "Doctor Who", "Top Gear", "Planet Earth",
    # Anime, a separate naming grammar (fansub group brackets, Hi10P, FLAC, Opus)
    "Attack on Titan", "Death Note", "One Punch Man", "Demon Slayer",
    "Jujutsu Kaisen", "Cowboy Bebop",
]

# Films, for the movie shape. The cache already holds 888 movie names, so this list is
# deliberately weighted at what the cache is thin on: 4K/HDR/DV/remux disc releases and
# pre-HD catalogue titles.
MOVIES: List[str] = [
    # 4K-era blockbusters: 2160p, HDR10/DV, HEVC, TrueHD/Atmos, REMUX
    "Dune Part Two", "Oppenheimer", "Blade Runner 2049", "Mad Max Fury Road",
    "Top Gun Maverick", "Avatar The Way of Water", "Interstellar", "Dunkirk",
    "John Wick Chapter 4", "Everything Everywhere All at Once", "Tenet",
    "Spider-Man No Way Home", "The Batman", "Sicario", "Arrival",
    "1917", "Gravity", "Mission Impossible Fallout", "No Time to Die",
    # Catalogue films: DVDRip/XviD, 480p, BRRip, 720p x264, early BluRay
    "The Matrix", "Pulp Fiction", "Fight Club", "Alien", "The Thing",
    "Blade Runner", "Apocalypse Now", "Seven Samurai", "Casablanca",
    "2001 A Space Odyssey", "Lawrence of Arabia", "Jaws", "Goodfellas",
    "Heat", "Terminator 2 Judgment Day", "Die Hard", "Aliens",
    "The Good the Bad and the Ugly", "Taxi Driver", "Raging Bull",
]


def _shape(title: str) -> str:
    """Classify a harvested title by naming shape, for coverage reporting only.

    Reporting only: the corpus file's own ``shape`` column is written by hand alongside
    the labels. This is a convenience count so the operator can see whether a harvest met
    the per-shape floor before spending an hour labelling it.
    """
    import re

    if re.search(r"(?<![a-z0-9])s\d{1,2}[-. _]?e\d{1,3}", title, re.IGNORECASE):
        return "episode"
    if re.search(r"(?<![a-z0-9])(?:s\d{1,2}(?![a-z0-9])|season[-. _]?\d{1,2}|complete)", title, re.IGNORECASE):
        return "pack"
    return "movie"


async def _harvest(queries: List[str], delay: float) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    seen = set()
    for i, q in enumerate(queries, 1):
        try:
            hits = await catalog.torrents(q)
        except Exception as exc:                               # noqa: BLE001 - keep going
            print(f"  [{i}/{len(queries)}] {q!r}: FAILED {exc}", file=sys.stderr)
            await asyncio.sleep(delay)
            continue
        fresh = 0
        for hit in hits:
            title = (hit.title or "").strip()
            if not title or title in seen:
                continue
            seen.add(title)
            fresh += 1
            rows.append({"query": q, "shape": _shape(title), "title": title})
        print(f"  [{i}/{len(queries)}] {q!r}: {len(hits)} hits, {fresh} new", file=sys.stderr)
        # Politeness, not throughput. The provider is somebody else's box.
        await asyncio.sleep(delay)
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", required=True, help="JSONL output path")
    ap.add_argument("--delay", type=float, default=1.2,
                    help="seconds between requests (default 1.2; do not lower)")
    ap.add_argument("--tv-only", action="store_true",
                    help="skip the film queries (the local cache already covers movies)")
    ap.add_argument("--limit", type=int, default=0, help="first N queries only, for a smoke run")
    args = ap.parse_args()

    queries: List[str] = []
    for show in TV_SHOWS:
        queries.append(f"{show} S01E01")
        queries.append(f"{show} S01")
    if not args.tv_only:
        queries.extend(MOVIES)
    if args.limit:
        queries = queries[: args.limit]

    print(f"{len(queries)} queries, {args.delay}s apart "
          f"(~{len(queries) * args.delay / 60:.1f} min)", file=sys.stderr)
    rows = asyncio.run(_harvest(queries, args.delay))

    with open(args.out, "w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")

    counts: Dict[str, int] = {}
    for row in rows:
        counts[row["shape"]] = counts.get(row["shape"], 0) + 1
    print(f"\n{len(rows)} distinct titles -> {args.out}", file=sys.stderr)
    for shape in ("movie", "episode", "pack"):
        print(f"  {shape:8s} {counts.get(shape, 0)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
