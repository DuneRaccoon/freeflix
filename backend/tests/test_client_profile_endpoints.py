"""``client=<profile>`` on the wire, and the refusal the television can read.

Where stage 8 becomes visible to a device. ``test_apply_profile.py`` proves the ordering
and ``test_capability_*.py`` the table; this file proves the two endpoints **carry the
profile at all**, and that the one irreversible act in the system -- starting a
multi-gigabyte download -- lands on a file this television can actually decode.

**So the assertions here read ``state.added``, not the response body.** A 200 with the
right-looking JSON proves the API answered; ``state.added[-1].magnet`` proves *which file
began*. Every ordering row below asserts the pre-profile result in the same function, by
issuing the same request with ``client`` omitted, so the reversal is visible to the reader
rather than taken on trust -- a fixture where the profiled and unprofiled answers agree
would be green with the whole feature deleted.

Three failure shapes this file is built against, all of them found in this repo:

* **the silent drop.** pydantic v2 defaults to ``extra='ignore'``, so a model that does not
  declare ``client`` answers 200 and throws the field away: the profile is absent while
  every response looks correct. ``TorrentRequest`` therefore sets ``extra='forbid'``
  (``models.py``) and the undeclared-key row below is its proof.
  **Measured, because the plan's justification for the forbid is wrong:** with the forbid
  removed *and* the field renamed server-side, seven rows here go red anyway -- each asserts
  a profiled *effect* (a 404, or which magnet started), so the drop does **not** pass
  unnoticed. What only the forbid can catch is the mirror case, a server that declares
  ``client`` correctly and a device that sends a typo'd key: no profiled-effect assertion
  exists for a key the device got wrong, so without the forbid that device is silently
  unprofiled with a 200. That is the failure this file's undeclared-key row stands in for.
* **the vacuous verdict assertion.** ``device_verdict`` is truthy **iff** the television
  refuses the release and ``None`` when it accepts -- so "every candidate carries a
  non-null ``device_verdict``" cannot be the proof that a profile ran; on an acceptable
  library it would be red with the feature working. The profile-ran assertions here read
  ``device_reasons`` (non-empty, naming the matched rule ids) and the **order**.
* **the loose substring.** Both refusal details must contain "no torrents" because the
  television keys on exactly that (``_data/title.ts``'s ``reasonFor``), so the rows that
  pin the substring are separate from the rows that pin the exact sentence: the substring
  row would pass against either sentence, and only the exact rows catch a copy edit.

Fixture titles come from ``test_apply_profile.py`` -- imported, not copied, because a
second copy of a release name would drift from the file whose parse-pin test guards it.
The two season-pack titles are local and pinned here.
"""
import os
os.environ.setdefault("DB_PATH", "/tmp/test_client_profile_endpoints.db")

import types

import pytest
from fastapi.testclient import TestClient

import app.api.torrents as torrents_api
from app.main import app
from app.providers.quality import parse_quality, parse_release_facts
from app.services.capability import PROFILE_ID

# The titles and the deterministic hit/rank helpers, imported rather than copied: these
# names' parsed facts are pinned by test_apply_profile's own
# ``test_fixture_titles_parse_to_the_facts_these_tests_assume``, so a parser change that
# would make the rows below measure something else is already a named failure there.
from test_apply_profile import (
    A_720,
    A_1080,
    B_2160,
    DTSHD_1080,
    DTSHD_2160,
    PLAIN_1080,
    _hit,
    _ranked,
)

#: The accepted id, sent the way a television sends it. Read off the module the profile
#: lives in, so a rename of the profile keeps this file honest; the 422 rows below hard-code
#: a *garbage* id instead, which is what they are about.
TV = PROFILE_ID

#: The two refusal sentences, hard-coded on purpose. Importing them from
#: ``api/torrents.py`` would make a copy edit invisible, which is the mutation task 6 names.
D_INCAPABLE = "No torrents this television can play"
D_WITHHELD = (
    "Only 4K sources exist for this title "
    "— no torrents this television can play in HD"
)
#: Unchanged, and it must stay unchanged: it means "the indexer returned nothing", which is
#: a different thing to say to a viewer than "this box cannot play what exists".
D_EMPTY = "No torrents found"

#: Season packs. One playable, one the television cannot decode. ``S01`` with no ``SxxExx``
#: is what ``_is_season_pack`` keys on; pinned below, and asserted through the response's
#: own ``is_season_pack`` rather than by importing the private helper.
PACK_A_1080 = "Show.S01.1080p.BluRay.x264.DD5.1-GRP"
PACK_DTSHD_2160 = "Show.S01.2160p.BluRay.x265.DTS-HD.MA.5.1-GRP"


# --------------------------------------------------------------------------------------
# The harness. Fakes stand in for the catalog provider and the torrent session only; the
# ranking, the profile and the endpoint logic are all the real thing.
# --------------------------------------------------------------------------------------

@pytest.fixture()
def client(monkeypatch):
    """A TestClient whose hit set each test sets, with every started torrent recorded.

    ``state.hits`` is a list of ``(title, seeds)``. ``/download`` ranks it through the real
    ``rank_candidates``; ``/sources``' fakes rank it through ``_ranked`` (the same function
    with the same thresholds), because in production those services return an
    already-ranked list and the profile is a *second* sort over it -- a hand-built list in
    an arbitrary order would prove nothing about the composition.

    ``state.added`` is the only output that matters for the download rows: it is what the
    libtorrent session was actually asked to start.
    """
    state = types.SimpleNamespace(added=[], hits=[], pack_hits=[], calls=[])

    async def fake_resolve(tmdb_id):
        return "Movie", 2020

    async def fake_show(tmdb_id):
        return "Show"

    async def fake_catalog_torrents(name):
        state.calls.append(("catalog.torrents", name))
        return [_hit(title, seeds) for title, seeds in state.hits]

    async def fake_movie_candidates(tmdb_id, quality):
        state.calls.append(("get_candidates", quality))
        return _ranked(state.hits, quality)

    async def fake_episode_candidates(tmdb_id, season, episode, quality):
        state.calls.append(("episode_candidates", quality))
        return _ranked(state.hits, quality)

    async def fake_season_candidates(tmdb_id, season, quality):
        state.calls.append(("season_candidates", quality))
        return _ranked(state.pack_hits, quality)

    async def fake_add(dl_movie, dl_torrent, save_path=None):
        state.added.append(dl_torrent)
        return "tid-1"

    def fake_status(tid):
        now = __import__("datetime").datetime.utcnow()
        return types.SimpleNamespace(
            id=tid, movie_title="Movie", quality="1080p", state="downloading",
            magnet="magnet:?x", progress=0.0, download_rate=0.0, upload_rate=0.0,
            total_downloaded=0, total_uploaded=0, num_peers=0, save_path="/x",
            created_at=now, updated_at=now, eta=None, error_message=None,
            chosen_quality=None,
        )

    monkeypatch.setattr(torrents_api.movie_service, "resolve_title_year", fake_resolve)
    monkeypatch.setattr(torrents_api.movie_service, "get_candidates", fake_movie_candidates)
    monkeypatch.setattr(torrents_api.tv_service, "resolve_show_name", fake_show)
    monkeypatch.setattr(torrents_api.tv_service, "episode_candidates", fake_episode_candidates)
    monkeypatch.setattr(torrents_api.tv_service, "season_candidates", fake_season_candidates)
    monkeypatch.setattr(torrents_api.catalog, "torrents", fake_catalog_torrents)
    monkeypatch.setattr(torrents_api.torrent_manager, "add_torrent", fake_add)
    monkeypatch.setattr(torrents_api.torrent_manager, "get_torrent_status", fake_status)
    with TestClient(app) as c:
        c.state = state
        yield c


def _download(tc, **body):
    """POST /download. ``tc`` rather than ``client`` because ``client`` is a request field."""
    payload = {"tmdb_id": 1, "quality": "1080p", "media_type": "movie"}
    payload.update(body)
    return tc.post("/api/v1/torrents/download", json=payload)


def _sources(tc, **params):
    """GET /sources. ``tc`` rather than ``client`` because ``client`` is a query param."""
    query = {"tmdb_id": 1, "quality": "1080p"}
    query.update(params)
    return tc.get("/api/v1/torrents/sources", params=query)


def _rows(response):
    return [(c["release_title"], c["device_verdict"], c["device_reasons"])
            for c in response.json()]


def _titles(response):
    return [c["release_title"] for c in response.json()]


# --------------------------------------------------------------------------------------
# The fixtures themselves. Without this row every assertion below could be vacuous.
# --------------------------------------------------------------------------------------

@pytest.mark.parametrize(
    "title,bucket,resolution,family,audio",
    [
        (PACK_A_1080, "1080p", 1080, "h264", {"ac3"}),
        (PACK_DTSHD_2160, "2160p", 2160, "hevc", {"dtshd"}),
    ],
)
def test_pack_titles_parse_to_the_facts_these_tests_assume(
    title, bucket, resolution, family, audio
):
    """The two local titles, pinned the way test_apply_profile pins its own.

    ``parse_quality`` decides the selector's bucket and ``parse_release_facts`` decides the
    rules' input; the season-pack rows below assume one of these is refused and the other
    is not, and a parser change would leave them green and measuring nothing.
    """
    assert parse_quality(title) == bucket
    facts = parse_release_facts(title)
    assert facts.resolution == resolution
    assert facts.video_family == family
    assert set(facts.audio) == audio


# --------------------------------------------------------------------------------------
# /download -- what actually started
# --------------------------------------------------------------------------------------

def test_download_starts_the_2160p_dts_release_when_no_client_profile_is_sent(client):
    """The control for the row below: without a profile this release is startable.

    If this went red the refusal row would be proving nothing -- a 404 for some unrelated
    reason reads identically to a 404 from the capability table.
    """
    client.state.hits = [(DTSHD_2160, 999)]
    r = _download(client, quality="2160p")
    assert r.status_code == 200
    assert len(client.state.added) == 1
    assert client.state.added[-1].magnet == _hit(DTSHD_2160, 999).magnet


def test_download_refuses_the_2160p_dts_release_as_incapable_for_the_television(client):
    """The point of the task: the file that would have started, does not.

    A 2160p DTS-HD release with 4K opted in. R1 does not fire (4K *was* asked for); R2 does,
    and it is the only AV reject in the table -- §3.2's Ultra HD row permits DD/DD+/AAC
    only. The assertion that matters is ``added == []``: nothing was committed to disk.
    """
    client.state.hits = [(DTSHD_2160, 999)]
    r = _download(client, quality="2160p", client=TV)
    assert r.status_code == 404
    assert r.json()["detail"] == D_INCAPABLE
    assert client.state.added == []


def test_download_withheld_only_set_names_the_4k_action_the_viewer_can_take(client):
    """A 2160p-only title asked for at 1080p: refused, with the copy that offers a way out.

    Both halves in one function, so the change is visible: unprofiled the 2160p starts;
    profiled it is withheld and the detail names 4K. ``withheld`` is a product decision
    (§7.3's opt-in), not an AV claim -- pressing 4K on the detail screen would play this.
    """
    client.state.hits = [(B_2160, 999)]

    before = _download(client, quality="1080p")
    assert before.status_code == 200
    assert client.state.added[-1].magnet == _hit(B_2160, 999).magnet

    started = len(client.state.added)
    after = _download(client, quality="1080p", client=TV)
    assert after.status_code == 404
    assert after.json()["detail"] == D_WITHHELD
    assert len(client.state.added) == started  # nothing new began


def test_download_mixed_withheld_and_incapable_reports_the_incapable_detail(client):
    """The mixed set, and the precedence it pins.

    One candidate the viewer could unlock with 4K (``withheld``) and one the panel cannot
    decode at any ask (``incapable``). The 4K sentence is claimed only when **every**
    refusal is ``withheld``; any other label falls to the weaker sentence, which is true
    whatever the mix. That matches ``capability.REJECT_PRECEDENCE`` and the copy rule
    written beside it. **The stage-8 plan contradicts itself here** -- it states these
    conditions and then says the 4K copy "wins a mixed case" -- so this row is the thing
    that records which way it shipped. Flipping it is one predicate in ``_device_refusal``
    and this test's name.
    """
    client.state.hits = [(B_2160, 999), (DTSHD_2160, 30)]
    r = _download(client, quality="1080p", client=TV)
    assert r.status_code == 404
    assert r.json()["detail"] == D_INCAPABLE
    assert client.state.added == []


@pytest.mark.parametrize(
    "hits,quality,expected",
    [
        ([(B_2160, 999)], "1080p", D_WITHHELD),
        ([(DTSHD_2160, 999)], "2160p", D_INCAPABLE),
    ],
)
def test_download_every_refusal_detail_contains_no_torrents(client, hits, quality, expected):
    """The substring the television's error mapping keys on, pinned from the backend side.

    ``_data/title.ts``'s ``reasonFor`` reads a 404 detail against ``/no torrents/i``: a
    match becomes "No sources found for this title yet.", anything else becomes "The box
    doesn't recognise this title." -- a lie about a title that exists. So this contract is
    copy, enforced at both ends; task 9 owns the television half. Separate from the exact
    rows above on purpose: this row would pass against either sentence.
    """
    client.state.hits = hits
    r = _download(client, quality=quality, client=TV)
    assert r.status_code == 404
    detail = r.json()["detail"]
    assert "no torrents" in detail.lower()
    assert detail == expected


def test_download_skips_a_refused_top_candidate_and_starts_the_720p(client):
    """The auto-pick walks past a refusal instead of committing to it.

    The pre-profile order is asserted first, in this same function, and it is the leak
    stage 8 exists to close: ``bucket_order`` makes 2160p the *first* downgrade target for a
    1080p ask, so a healthy 999-seed 2160p outranks a healthy 720p and is what starts today.

    **What this row does NOT pin, measured:** the plan names it as the proof of the
    ``if not c.device_verdict`` skip in the auto-pick. It cannot be. ``apply_profile``
    already partitions rejects last, so with the skip replaced by ``candidates[0]`` the
    accepted 720p is still element 0 and this row stayed **green** under that mutation. The
    skip is reachable only when *every* candidate is refused, so the rows that redden are
    the three 404 rows above. What this row does pin is that ``apply_profile`` is called at
    all on the download path, with the client the request carried.
    """
    client.state.hits = [(B_2160, 999), (A_720, 30)]

    before = _download(client, quality="1080p")
    assert before.status_code == 200
    assert client.state.added[-1].magnet == _hit(B_2160, 999).magnet

    after = _download(client, quality="1080p", client=TV)
    assert after.status_code == 200
    assert client.state.added[-1].magnet == _hit(A_720, 30).magnet
    assert client.state.added[-1].quality == "720p"


def test_download_with_no_hits_at_all_keeps_the_unchanged_404(client):
    """An empty indexer answer still says what it always said, profile or no profile.

    "No torrents found" means the title has no sources; the two capability sentences mean
    the sources exist and this panel cannot use them. Collapsing the three would cost the
    television the only signal that distinguishes "wait for a release" from "press 4K".
    """
    client.state.hits = []
    r = _download(client, quality="1080p", client=TV)
    assert r.status_code == 404
    assert r.json()["detail"] == D_EMPTY
    assert client.state.added == []


def test_download_accepts_the_known_profile_and_leaves_an_acceptable_pick_alone(client):
    """With a profile and nothing to refuse, the television gets the same file as the web.

    Guards the opposite failure to every row above: a profile that refuses more than the
    table says, or an endpoint that 404s whenever ``client`` is present.
    """
    client.state.hits = [(A_1080, 30), (PLAIN_1080, 30), (DTSHD_1080, 30)]
    r = _download(client, quality="1080p", client=TV)
    assert r.status_code == 200
    assert client.state.added[-1].magnet == _hit(A_1080, 30).magnet


def test_download_rejects_an_unknown_profile_id_with_422_before_anything_starts(client):
    """A bad *value*. This is what the Literal is for, and why it is not a bare str.

    An unvalidated name would reach ``apply_profile``, which raises ``ValueError`` on an
    unknown id -- deliberately, because "the profile silently did not run" is this stage's
    worst failure -- and the error middleware would render that as an opaque 500. The
    Literal makes the ValueError unreachable from the wire.
    """
    client.state.hits = [(A_1080, 30)]
    r = _download(client, quality="1080p", client="lg-webos25-floor")
    assert r.status_code == 422
    assert client.state.added == []
    assert client.state.calls == []  # refused at validation, not inside the handler


def test_download_rejects_an_undeclared_field_with_422(client):
    """A bad *key*, and the reason ``TorrentRequest`` sets ``extra='forbid'``.

    pydantic v2 defaults to ``extra='ignore'``: without the forbid this request 200s with
    ``clinet`` thrown away and the ranking unprofiled -- a television build shipped ahead
    of the backend would be silently unprofiled while every response looked right. Measured
    under mutation: with the forbid removed, this row 200s.
    """
    client.state.hits = [(DTSHD_2160, 999)]
    r = client.post("/api/v1/torrents/download", json={
        "tmdb_id": 1, "quality": "2160p", "media_type": "movie", "clinet": TV,
    })
    assert r.status_code == 422
    errors = r.json()["detail"]
    assert any(e.get("loc", [])[-1:] == ["clinet"] for e in errors), errors
    assert any(e.get("type") == "extra_forbidden" for e in errors), errors
    assert client.state.added == []


def test_download_still_accepts_every_field_a_shipped_client_sends(client):
    """The safety claim behind ``extra='forbid'``, asserted rather than assumed.

    Forbidding extras is only safe because every shipped caller posts a typed
    ``CatalogTorrentRequest`` (``frontend/src/types/index.ts``) whose fields are all
    declared here. This row sends that whole shape at once, so dropping or renaming a field
    on the model turns a silently-ignored key into a 422 *here* rather than in a viewer's
    player.
    """
    client.state.hits = [(A_1080, 30)]
    r = client.post("/api/v1/torrents/download", json={
        "tmdb_id": 1, "quality": "1080p", "media_type": "movie",
        "save_path": "/tmp/freeflix-test", "season": None, "episode": None,
        "magnet": None, "source_id": None, "client": None,
    })
    assert r.status_code == 200, r.text


def test_download_explicit_magnet_bypasses_the_profile_even_with_a_client(client):
    """Bypass 1, deliberate: an explicit magnet never reaches ``rank_candidates``.

    So it is never judged, even by a television's profile. The viewer picked this exact
    release off a list that already showed them its device marks -- and ``/sources`` is
    advisory for exactly that reason. Unreachable from the TV, which sends no magnet;
    ``test_download_select.py`` pins the no-client half.
    """
    client.state.hits = [(DTSHD_2160, 999)]
    explicit = "magnet:?xt=urn:btih:deadbeefcafebabe0000"
    r = _download(client, quality="2160p", client=TV, magnet=explicit)
    assert r.status_code == 200
    assert client.state.added[-1].magnet == explicit


def test_download_explicit_source_id_bypasses_a_refusal(client):
    """Bypass 2, deliberate: a matched ``source_id`` is honoured over the profile.

    Same reason as bypass 1 -- it is an explicit choice, not an auto-pick -- and also
    unreachable today: both web pickers send ``magnet`` *and* ``source_id``, so bypass 1
    fires first, and the television sends neither. Pinned so that making the download
    commitment stricter is a visible decision rather than a silent one.
    """
    client.state.hits = [(A_1080, 30), (DTSHD_2160, 999)]
    refused = _sources(client, quality="2160p", client=TV).json()
    refused_row = next(c for c in refused if c["device_verdict"] == "incapable")

    r = _download(client, quality="2160p", client=TV, source_id=refused_row["source_id"])
    assert r.status_code == 200
    assert client.state.added[-1].magnet == refused_row["magnet"]


# --------------------------------------------------------------------------------------
# /sources -- advisory, annotated, and never filtered
# --------------------------------------------------------------------------------------

def test_sources_without_a_client_annotates_nothing(client):
    """The absent-profile guarantee, at the wire.

    Both halves asserted: no verdict **and** no reasons. The verdict half alone cannot fail
    for an acceptable library -- an accepted candidate reports ``None`` too -- so
    ``device_reasons == []`` is what distinguishes "no profile ran" from "a profile ran and
    liked everything".
    """
    client.state.hits = [(A_1080, 30), (B_2160, 999), (DTSHD_2160, 30)]
    r = _sources(client)
    assert r.status_code == 200
    assert [c["device_verdict"] for c in r.json()] == [None, None, None]
    assert [c["device_reasons"] for c in r.json()] == [[], [], []]


def test_sources_with_a_client_reports_every_matched_rule_and_moves_refusals_last(client):
    """The profile ran: the marks name the rules, and the order changed.

    The pre-profile order is asserted in this same function and is today's leak -- a healthy
    999-seed 2160p ahead of an exact-bucket 1080p is the ordering the television gets now.
    ``device_reasons`` carries **every** match in table order, shadowed rows included
    (``dtshd-truehd-at-1080p:shadow`` reorders nothing and is still reported), which is what
    makes a deliberately inert rule observable from outside.
    """
    client.state.hits = [(B_2160, 999), (A_1080, 30), (DTSHD_2160, 30), (DTSHD_1080, 30)]

    before = _sources(client)
    assert _titles(before) == [A_1080, DTSHD_1080, B_2160, DTSHD_2160]

    after = _sources(client, client=TV)
    assert after.status_code == 200
    assert _rows(after) == [
        (A_1080, None, ["preferred-measured:in_force"]),
        (DTSHD_1080, None, ["dtshd-truehd-at-1080p:shadow"]),
        (B_2160, "withheld",
         ["withheld-2160p:in_force", "documented-ok:in_force"]),
        (DTSHD_2160, "incapable",
         ["withheld-2160p:in_force", "dts-family-at-2160p:in_force"]),
    ]
    assert len(after.json()) == len(before.json())


def test_sources_returns_a_full_list_even_when_every_candidate_is_refused(client):
    """Nothing is filtered, which is the opposite of the ``/download`` 404.

    The web's alternatives modal (guarded on ``candidates.length > 0``) and the in-player
    switcher both disappear on an empty list, so dropping refused rows would make the web
    play a bad release **with no warning** instead of offering a better one. The list is
    advisory; the download is the commitment.
    """
    client.state.hits = [(B_2160, 999), (DTSHD_2160, 30)]
    r = _sources(client, client=TV)
    assert r.status_code == 200
    assert len(r.json()) == 2
    assert [c["device_verdict"] for c in r.json()] == ["withheld", "incapable"]


def test_sources_2160p_ask_lifts_the_withholding(client):
    """``allow_2160p=(quality == '2160p')`` is wired, and R1 is the only rule that reads it.

    The same release, the same profile, two asks: withheld at 1080p, accepted at 2160p.
    Hard-coding the flag either way reddens one of these two halves.
    """
    client.state.hits = [(B_2160, 999)]

    hd = _sources(client, quality="1080p", client=TV).json()
    assert (hd[0]["device_verdict"], hd[0]["device_reasons"]) == (
        "withheld", ["withheld-2160p:in_force", "documented-ok:in_force"])

    uhd = _sources(client, quality="2160p", client=TV).json()
    assert (uhd[0]["device_verdict"], uhd[0]["device_reasons"]) == (
        None, ["documented-ok:in_force"])


def test_sources_season_pack_path_applies_the_profile(client):
    """The season-pack path's **first** endpoint test, and it carries the profile.

    ``/sources`` with a season and no episode is the one branch nothing exercised before
    stage 8 -- a TV season pack is one torrent with many video files, so a refused pack is
    a whole season the television cannot play. Both halves in one function: unprofiled the
    undecodable 2160p pack leads, profiled it is marked and last.

    The fixture is leak (a), the health term outranking the quality bucket: a healthy
    999-seed 2160p pack against a low-health 1080p one. Equal health would let the exact
    bucket win on its own and the reversal below would happen with the profile deleted.
    """
    client.state.pack_hits = [(PACK_DTSHD_2160, 999), (PACK_A_1080, 2)]

    before = _sources(client, media_type="tv", season=1)
    assert before.status_code == 200
    assert _titles(before) == [PACK_DTSHD_2160, PACK_A_1080]
    assert [c["is_season_pack"] for c in before.json()] == [True, True]
    assert [c["device_reasons"] for c in before.json()] == [[], []]

    after = _sources(client, media_type="tv", season=1, client=TV)
    assert after.status_code == 200
    assert _rows(after) == [
        (PACK_A_1080, None, ["preferred-measured:in_force"]),
        (PACK_DTSHD_2160, "incapable",
         ["withheld-2160p:in_force", "dts-family-at-2160p:in_force"]),
    ]
    assert ("season_candidates", "1080p") in client.state.calls


def test_sources_episode_path_applies_the_profile(client):
    """The single-episode branch too, so the profile is not wired to one path of three.

    Not an ordering row, deliberately: both hits are healthy so the exact bucket already
    puts the 1080p first unprofiled, and this order would hold with the profile deleted.
    What proves the profile ran here is the marks -- the verdict and the matched rule ids.
    """
    client.state.hits = [(B_2160, 999), (A_1080, 30)]
    r = _sources(client, media_type="tv", season=1, episode=4, client=TV)
    assert r.status_code == 200
    assert _rows(r) == [
        (A_1080, None, ["preferred-measured:in_force"]),
        (B_2160, "withheld", ["withheld-2160p:in_force", "documented-ok:in_force"]),
    ]


def test_sources_rejects_an_unknown_profile_id_with_422_before_the_service_is_called(client):
    """``quality`` beside it is a bare ``str``; ``client`` must not be.

    An unvalidated name would reach ``apply_profile`` and raise ``ValueError`` inside the
    handler, which the error middleware renders as a 500 with no useful detail. Asserting
    ``calls == []`` is what proves the refusal happened at validation rather than in the
    500 path, where the status code alone would not tell them apart.
    """
    client.state.hits = [(A_1080, 30)]
    r = _sources(client, client="lg-webos25-floor")
    assert r.status_code == 422
    assert client.state.calls == []


def test_sources_tv_without_a_season_still_422s_with_a_client(client):
    """The pre-existing 422 is reached before the profile, not replaced by it."""
    r = _sources(client, media_type="tv", client=TV)
    assert r.status_code == 422
    assert client.state.calls == []
