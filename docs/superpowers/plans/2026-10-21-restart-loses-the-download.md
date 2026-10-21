# "This title isn't on the box any more" after a restart — what it really was

Reported from the living room, 2026-10-21: an episode watched halfway through one night; the
compose project brought down, the repository pulled, and brought back up; and on returning to it
the television said

> This title isn't on the box any more — the download this was playing from is no longer on the
> box. Nothing here can bring it back.

The file was on disk the whole time. Reproduced by the reporter on demand: switch the TV off,
`docker compose down`, `docker compose up`, go back to the app.

Reproduced here too, against the real development database, which held exactly the same shape: a
`seeding` row at 100% whose 4.6 GB file was sitting in `downloads/` and which every streaming
route 404ed on.

---

## 1. What was actually broken

Three things in a line, and only the first is the cause.

**A finished torrent is never re-added to the libtorrent session.**
`Torrent.find_loadable_on_startup`'s own docstring: *"Paused/stopped/finished/seeding/error stay
unloaded."* `_refresh_active_torrents` evicts `finished` mid-session as well. So after any restart
the only thing that can resolve a completed download's files is
`get_completed_video_file_info` — the stage-7 fallback written for exactly this.

**That fallback reads the file list out of the stored resume data, and the resume data has no file
list in it.** libtorrent 2.0 drops the `info` dict from resume data unless it is asked for. Every
`save_resume_data()` call in `manager.py` was flagless, so `read_resume_data(blob).ti` was `None`
for every blob this application had ever written — `_video_files_from_resume_data` returned `[]`
for every torrent, every time.

Measured here, on the real row, before any change:

```
state=seeding progress=100.0 save_path='downloads/Digger' resume=True
resume blob len: 5964          atp.ti is None
files from resume data: []     get_completed_video_file_info -> None
```

So **the stage-7 repair has been inert in production since the day it shipped** — four gates, a
516-line suite, and nothing reachable behind it.

**And a 404 from the stream is read by the television as terminal.** The player probes with HEAD;
`classify.ts` maps 404 to `gone`; the route turns `gone` into the dead-end screen. The probe reads
no body, so its verdict carries no `detail` — and the backend's two 404s ("this torrent does not
exist" and "this file is not resolvable right now") are the same status code. The route already
knows that rule for `/info`, whose 404 is terminal *only* when its detail is `Torrent not found`,
"so the discrimination is done with the torrent's own state from `getTorrentStatus` instead". The
probe never got that treatment.

## 2. Why its own test suite was green

`test_finished_torrent_streamable.py` builds the blob it tests by hand:

```python
atp = lt.add_torrent_params()
atp.ti = ti                       # <- assigned here, and nowhere in production
blob = encode_resume_data(lt.write_resume_data_buf(atp))
```

Every one of its rows therefore exercises a blob shape the application cannot produce. The tests
were not wrong about the resolver — they were wrong about the **artefact**, and no assertion inside
them could notice. This is the "test that cannot fail" shape this repository keeps finding, in its
least visible form: not a weak assertion, a fixture that models something nothing builds.

It was also already known. `webos-tv-parked-findings.md` #24 diagnosed it during stage 9 scouting —
"stage 7's headline repair is INERT on this box, and its docstring asserts the opposite" — and
parked it. It took a household hitting it to get it fixed.

## 3. The fix

**(a) Resume data that can describe itself.** One helper, `_save_resume_data`, is now the only
caller of `save_resume_data` in the manager, and it passes `save_resume_flags_t.save_info_dict`.
Every blob written from now on carries its file list, so the four-gate path works as designed —
packs included. The flag is resolved with `getattr`, so a libtorrent without it degrades to
today's behaviour rather than failing at import.

That fixes nothing already on disk: a finished torrent is never re-added, so its blob is never
rewritten. Hence (b) and (c), which are about the downloads a household already has.

**(b) A single-file torrent, from `name` alone.** An info-dict-less blob still carries `name` and
`save_path`, and for a single-file torrent `name` IS the file. A name carrying a path separator is
refused outright — a resume blob is attacker-adjacent input, and that is what keeps the join from
climbing out of `save_path`.

**(c) One episode of a pack, through the index→episode map.** `precomputed_episodes` is
`{file_index: {season, episode}}`, cached on the row when metadata was known and built by running
`parse_episode` over the same file names that are still on disk. So the index names an episode, the
episode names a file, and the association is *recovered* rather than guessed — both halves are the
same parse of the same names. It refuses a bare request (no index means no episode to look up) and
refuses ambiguity (two files parsing to one episode: a sample, a repack, a proper).

This matters more than (b) for a television: without it, every episode of every season already
downloaded stays unplayable after a restart.

**The gate is allocation, not size.** The four-gate path compares the file on disk with the size
the *metadata* records, which is precisely what is missing here. What is available is better
evidence anyway: libtorrent writes at offsets in sparse storage mode, so a half-downloaded file
already has its full length with holes in it — and those holes are unallocated. `st_blocks` sees
them; a length comparison does not. Measured: a complete 4.6 GB file reads 1.0000, a synthetic
1 GB sparse file reads 0.000004.

**(d) The television stops reading a stream 404 as a dead end.** `onTerminal` now answers whether
it took the player away, and for a `gone` verdict it re-asks `getTorrentStatus` first — the one
request on this surface whose 404 means exactly one thing. If the box still has the torrent, the
404 was about the file, and it goes to the recovery ladder exactly as a 503 would. An unreachable
box is not a verdict either.

The backend fix is the real one; (d) is what stops a transient 404 from ever being a dead end
again.

## 4. The other bug in the same report

> the video player retains a dark overlay when playing … ensure it disappears with the
> buttons/progress.

`useRevealOnKey` armed its quiet period from `onKeyDown` **and nowhere else**. A viewer who starts
a title and then presses nothing — which is what watching something is — never got a first period,
so the control band and the 480px scrim behind it sat over the picture for the whole film. It is
armed on mount now, and composes with the existing refusal contract: on arrival the player usually
has a message up, `mayHide` refuses, and the period is served again until the message goes.

Every quiet-period row in that hook's suite fired a key before advancing the clock, so none of
them could see it. `hides without being pressed at all` is the one that can.

## 5. What is still not recoverable, and should be said plainly

- **A finished pack with no `precomputed_episodes`.** The map is written when metadata arrives; a
  row that never saw metadata while it existed has nothing to recover from. Those stay 404 until
  the torrent is downloaded again — at which point (a) makes it permanent.
- **Files that are genuinely gone.** The development database holds one: a `seeding` row at 100%
  whose save path does not exist. That is the state a mid-download container recreate leaves
  behind, and "no longer on the box" is the honest answer to it. It stays available, and
  `test_a_deleted_file_is_still_refused` keeps it so.
- **A pack where two files parse to the same episode** — refused rather than chosen between.
- **None of this has run on the television.** It is reproduced, fixed and tested against the real
  database rows and the real libtorrent, on this machine.

## 6. Numbers

- New: `backend/tests/test_resume_data_describes_its_files.py`, 34 rows — the flag, the two blob
  shapes, both recovery paths, every gate, and the HTTP level the television actually sees.
- `npm run test:tv`: 1737 → 1740. Backend: +34.
- Three fixes were proved by deleting them and watching a row go red: the mount-armed quiet period,
  the probe reconciliation, and the pack recovery's own gates.
- `specCitations.test.ts` refused the commit until the spec's `torrent/manager.py` line citations
  were re-resolved (+149 past the insertions, +40 before them). They were.
