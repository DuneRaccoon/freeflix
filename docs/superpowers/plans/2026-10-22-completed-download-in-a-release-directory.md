# A completed download inside a release directory

Reported from the living room, the day after the `save_info_dict` repair shipped:

> there is still an outstanding bug when trying to start streams of existing downloads (at
> least after restarting the services). `GET /api/v1/streaming/2f8da8dd-.../info` ->
> `{"detail":"Video file not found or not ready for streaming"}`. it works when removing
> the file and restarting/rewatching it

---

## 1. What the logs settled before any code was read

The box's own log named the line:

```
manager.py:1335 | Resume data for 2f8da8dd-... carries no metadata; cannot resolve its
                  files without the session
```

That line only exists in `6308dee`, so **the box was running the fix**. This was not a stale
deploy, and `origin/master` was at `009affc`. What follows is therefore a gap in the repair,
not its absence.

Nothing else was logged between that line and the 404 — which is the second finding, and the
one that cost the most: **both recovery paths refused silently.**

## 2. The root cause, read off the production database

No SSH to the box, so the row was read directly over the published Postgres port:

```
movie_title  : The Boys S01E05        state: seeding    progress: 100.0
save_path    : downloads/The Boys S01E05
precomputed  : {"0": {"season": 1, "episode": 5}}
blob.ti      : None
blob.name    : 'www.UIndex.org    -    The Boys S01E05 Good for the Soul 1080p AMZN WEB-DL DDP5 1 H 264-FLUX'
blob.save_path: '/opt/freeflix/downloads/The Boys S01E05'
```

`name` is a **tracker-branded release directory**, not a file. So:

* `_completed_single_file` refuses: `_is_video_file(name)` is false for a directory;
* `_completed_pack_file` refuses: `file_index is None`, so there is no episode to look up.

Both refusals are correct for the shapes they model. Neither models the shape in front of
them, which is the ordinary one: **one episode inside a release folder, asked for without an
index** — because it is one episode, not a pack.

**It was not one title. Six of the seven completed downloads on the box are that shape:**

| title | `blob.name` is | map | resolves before |
| --- | --- | --- | --- |
| The Boys S01E01 / E02 / E05 | release dir | `{"0": …}` | no |
| The Boys S01E03 / E04 | release dir | NULL | no |
| Don't Look Down | release dir | NULL | no |
| The Uprising | `The Uprising 2026 … BONE.mkv` | NULL | **yes** |

The one that worked is the one whose `name` happens to be the `.mkv` itself. "Delete and
re-download" works because that restores a live handle and none of this is reached.

### One hypothesis refuted on the way

The first theory was that an info-dict-less blob carries no `name` either, which would make
the whole `6308dee` repair inert. **Disproved by driving libtorrent 2.0.11 in the backend
image**: a flagless `save_resume_data()` blob carries `name`, `save_path` and the piece
state, and only the `info` dict is dropped. It also carries `name` *with* the flag — which
later turned out to matter (§5).

## 3. What shipped

`_completed_lone_video`, the third and last blind path in
`get_completed_video_file_info`'s fallback chain.

**The rule.** When the directory the blob names holds **exactly one** video file, that file
is the answer. Two or more and it refuses — out loud, naming them.

This does not loosen the judgement the other two paths protect. Their rule is that a
directory listing's ORDER is not a libtorrent file index, so an index must never be resolved
by position. With one candidate there is no order to reconstruct and no choice to make.

**Ownership is `name`, and it is the whole reason this is safe.** The walk starts at
`save_path/name`, never at `save_path` — because `save_path` is **not this torrent's
directory**. It is `default_download_path / label` where label is the bare title, so it is
shared by every download of that title and by the leftovers of deleted attempts
(`DELETE /torrents/{id}` defaults to `delete_files=False`). See §5, finding 1.

**The episode is checked when the row can check it.** A one-entry `precomputed_episodes`
says which episode this torrent's single video is, so a file parsing to a different one is
refused rather than served under that label. A map naming several files is a pack and is
refused outright.

**The index is echoed, not arbitrated.** Once the file is proven to be this torrent's and
the right episode, the index is a label on it, so an explicit `file_index` is answered with
that index. See §5, finding 3 — the first draft got this backwards and would have left
exactly the half-watched episode this bug is about still unplayable.

**Two guards, deliberately redundant** (`name` is a bare component that is not `.` or `..`;
and the resolved directory must sit inside the resolved save path). Each is individually
removable with the suite still green — that is what defence in depth looks like under
mutation — but **the pair is load-bearing** and removing both is caught. `..` is the reason
the second exists: `Path("..").name` is `".."`, not `""`, so `..` passes a
one-component test and walks the parent. The same containment is applied to the file, so a
symlink out of the directory is not followed.

**The misleading log is gone.** `_video_files_from_resume_data` logged "cannot resolve its
files without the session" at INFO *before* the three fallbacks ran, so after this fix it
would be emitted once per Range request and once per `/info` poll, immediately before a
successful resolution — the only log line about this path, stating the opposite of what
happened. It is now DEBUG and worded as the normal condition it is.

## 4. Evidence

* `npm`-free: backend only. **1786 passed** (1755 before), `test_resume_data_describes_its_files.py`
  **65 across 10 consecutive runs, identical**. No frontend file is touched.
* **14 mutations** applied to the new method; 13 caught individually, the 3 redundant-guard
  ones caught as a pair. Two defects in my own tests were found this way:
  * a mapped-pack row that refused for the *two-videos* reason, not the pack guard it named;
  * `test_an_info_dict_blob_never_reaches_this_path`, which refused on an **empty name**
    rather than on the info dict, because the fixture set `atp.name` only on the blind
    shape. libtorrent writes `name` on both, so the fixture now does too — the same class of
    unrealistic artefact this whole file was created to catch.
* The reported URL is covered end to end: `/info` answers 200, `HEAD`/`GET /video` serve the
  bytes, and a Range request inside the file returns 206.

## 5. The review, and the three defects it caught

Five reviewers, each finding adversarially verified by a refuter that had to reproduce it.
20 findings, 10 confirmed. The three that changed the code:

1. **No ownership check (two reviewers, independently).** The first draft walked `save_path`
   and read `name` not at all, so with this row's own file gone, *any* single video under
   that shared directory was served under this row's id, title and `content_id` —
   reproduced, including a same-title/different-`tmdb_id` collision, because `label` drops
   the year. Fixed by containment; the refuter's correction is also recorded: the unowned
   walk is a **pre-existing** property of `_completed_pack_file`, which this fix inherited
   rather than invented, and `parse_episode` agreement does not discriminate between two
   releases of the same episode.
2. **A one-entry map could overturn `_completed_pack_file`'s content refusal.** A pack whose
   other episode was deleted handed back its survivor labelled as the episode asked for.
   Fixed by the episode check.
3. **The index a client holds was refused.** Reporting 0 for a bare request and refusing 2
   meant a fresh start worked and a *resume* did not — the index comes from `/files` while
   the torrent was live, is stored on the progress row, and is rebuilt by every resume link.
   Fixed by echoing it.

Three further confirmed findings were test defects (§4) and two were cheap repairs (the
double walk when both save-path spellings name one directory, now deduplicated by resolved
path; and the misleading log line).

## 6. What is still true, and not claimed

* **Nothing here has run on the television, or on the box.** For `S01E01/E02/E05` the box's
  own map proves the torrent holds exactly one video file (a single entry, index 0), so the
  walk will resolve them. For `S01E03`, `S01E04` and `Don't Look Down` there is no map, so
  that is an inference from an identical release shape — and if one of those folders holds a
  second video, the new WARNING names both files instead of refusing silently.
* **`/streaming/{id}/files` still returns `[]` for every completed download.**
  `get_video_files` is live-session-only with no fallback at all. It does not affect these
  single-episode titles, but it will leave the episode picker blank on a completed **season
  pack**. Untouched here: it is a sibling of this bug, not this bug.
* **A blind pack with no map and all but one episode deleted** will serve that survivor
  under whatever index is asked. The alternative was refusing the index every resume link
  carries, which is worse and is finding 3 above.
* Packs downloaded **since** `6308dee` carry their info dict and never reach any of this.
