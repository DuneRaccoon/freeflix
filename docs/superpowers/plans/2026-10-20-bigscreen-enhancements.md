# Big-screen enhancements — what shipped, what it costs, what is still unproven

Branch `feat/bigscreen-enhancements`, off `d1a9299` (the stage 9+10 merge, which put all ten TV
stages on master). Four asks, in the order they were given:

1. a visual spruce, with the judgement left to the implementation;
2. transport controls that are not rectangles;
3. episode history with a real trace, and episode stills instead of a list of names;
4. an "auto start downloading the next episode" system behind a setting that defaults on, plus a
   Next-episode control and — "if it's possible from the metadata, i don't know" — the control
   surfacing when the credits are reached.

**The honest answer to the credits half is no**, and §4.4 below says exactly what shipped in its
place. Nothing else was scaled down.

---

## 1. The visual pass

All of it inside the existing constraints: `legacy-target.test.ts` still forbids every GPU
construct it forbade before (no `backdrop-filter`, no `mix-blend-mode`, no `filter: blur()`, no
SVG filters), `bigscreen-tokens.test.ts` still pins the ten colours against the web stylesheet's
copies, and no positional selector was added. No new COLOUR token: the two tokens added
(`--pill`, `--halo`) are geometry, which this surface owns.

| What | Was | Is |
| --- | --- | --- |
| `.bs-btn` | 8px-radius rectangle, 60px | pill, 64px, 600 weight, letter-spaced |
| `.bs-btn:focus` | ring | ring + an 8px SOLID halo (`--halo`, zero blur radius) |
| `.bs-btn--ghost` | `transparent` | `--ink` at 0.45, so a ghost over artwork is legible |
| `.bs-nav__item`, `.bs-show__season` | 8px rectangles | pills, with the halo |
| `.bs-hero__title` | 56px | 64px, tighter leading — it was the same size as the DETAIL screens' |
| `.bs-hero__meta` | 24px muted | 22px uppercase gold, letter-spaced |
| `.bs-hero__scrim`, `.bs-title__scrim` | one bottom gradient | two gradients on one element: the bottom wash plus a left wash under the text |
| `.bs-rail__eyebrow` | muted | gold — it is the rail head's only accent |
| `.bs-card__art` | no border | a hairline, so a poster that fades to black still has an edge |
| `.bs-card:focus` | ring + scale | …and the label takes the accent colour |
| `.bs-skel` | flat fill | a static two-stop gradient (still no shimmer: §9 allows transform and opacity only) |

**The halo is a `box-shadow` with ZERO blur radius**, which is why it is allowed at all.
`legacy-target.test.ts` does not list `box-shadow`, so the restraint is deliberate rather than
enforced — a blurred shadow is a per-paint rasterisation this surface refuses on the same grounds
as `filter: blur()`. It is NOT applied to `.bs-card:focus`: the rail track's vertical padding was
measured against that scale and that ring (32px of padding for 8.96px of clearance at the tallest
realistic card), and a halo reaches 8px further than the ring does.

**Measured by rendering, not by reading.** `bigscreen.css` was served at 1920x1080 in Chromium
against hand-written markup for the home, show and player surfaces. That is what caught the one
real defect in this pass: the transport cell was 88px wide — the width of its own circle — so the
Subtitles cell's longest state clipped to `none in this…`, a state a viewer cannot read. The cell
is 132px now.

---

## 2. The transport controls

`_player/TransportBar.tsx` + `_player/glyphs.tsx` + the `.bs-tp*` block at the foot of
`bigscreen.css`.

Each cell is an 88px circle with an inline SVG in it, inside a 132px-wide button, and the
control's NAME is revealed under it while it holds focus. Play/Pause and Try again wear the gold
fill; everything else is a hairline ghost.

Three things are load-bearing and are pinned in `playerCss.test.tsx`:

- **The name is hidden by OPACITY, never by `display` or `visibility`.** The label element IS the
  button's accessible name — the glyph is `aria-hidden` and carries no text at all — so either of
  those would delete the name of every control in the row, and with it every
  `getByRole('button', { name })` in this directory and anything that reads the screen aloud.
- **The ring is drawn on the circle, not on the button**, which is the one place this surface
  moves it. `.bs-tp:focus` sets `outline: none` and `.bs-tp:focus .bs-tp__glyph` carries the house
  ring. Both halves or neither: the first alone is a control with no ring on a surface where the
  ring is the whole navigation model.
- **The label and the state share ONE reserved line.** Two cells carry a state sub-line
  (Subtitles, Next episode); unfocused a cell shows its state, focused it shows its name. Two
  reserved lines would cost 34px of band over the picture for every frame the band is up.

**No `<text>` in any glyph, ever.** SVG text lands in the button's `textContent`, which this
directory's tests assert is exactly the cell's label. That is why "Back 10s" is a replay arc with
no 10 in it — the number lives in the label the cell reveals on focus. The arc and Try again's arc
are mirror images of each other and are the one confusable pair in the row; they are separated by
direction, by the gold fill, and by Try again only existing after a failure. Judged acceptable
rather than solved.

**The row's width is knowable again.** The player block recorded it as UNKNOWN while the cells
were pills sized to their prose. Eight cells (six base, plus Next episode and Try again) at 132px
with 24px gaps is 1224px inside the 1728px the safe area leaves, and the closed band is ~456px
against the scrim's 480px — both now asserted rather than asserted-about.

---

## 3. The episode list

`_data/showProgress.ts` + `_components/EpisodeList.tsx`.

`episodeMarks` became `episodeTraces`, returning `{ mark, percentage, remainingS }` per episode
rather than a bare mark. One function, one filter, three answers: a second function walking the
same rows under the same filter is a second thing to keep in step, and the one added later for a
progress bar is the one that would quietly disagree.

Each row now carries TMDB's still (`still_url`, re-pointed from the catalog's `w300` to `w500`,
because the box is 256 CSS px and that is a 2x upscale on a 4K panel), with the trace drawn ON it
— a bar across its foot for a part-watched episode, a tick in its corner for a finished one — plus
the number, the title, the runtime, the air date, a two-line overview and the state in words
("In progress · 15 min left"). The season's own tally sits above the list, because "4 of 10
watched" is the question the viewer arrived with and no single row can answer it. The episode the
screen's own primary control would play is badged "Next up", from the same `nextUnwatched` call
that builds that control — one answer to "which is next", not two.

Three details that are not arbitrary:

- **No `transform` on focus.** The row is `width: 100%` inside the safe inset, so a scaled row
  crosses it and shows the page behind — the rule `.bs-hero:focus` and `.bs-player__scrub` already
  live by. The focus signal is the ring, the border and a lift in the surface colour.
- **The air date is parsed by hand.** `new Date('2026-11-02')` is UTC midnight formatted in local
  time, which prints the 1st of November for anyone west of Greenwich; a date with no time in it
  must not be able to move by a day.
- **The text order is part of the contract.** A button's accessible name is its contents in DOM
  order: number, title, runtime, air date, overview, then the state. A state rendered first is a
  control that announces "Watched" before it says what is watched.

---

## 4. The next episode

### 4.1 The setting

`user_settings.auto_next_episode`, nullable, **with no default of any kind** — not a server
default and not a Python-side one. There is no migration framework here: `sync_columns()` can only
emit a bare `ALTER TABLE ... ADD COLUMN`, so on every household's existing database the column
arrives NULL on every row. The read rule is `row.auto_next_episode is not False`
(`api/users.py`), and the obvious tidy-up of it — `bool(...)`, or the bare attribute — ships the
feature OFF for everyone who is not a brand-new install. `test_auto_next_episode.py` is the row
that refuses that edit.

A Python-side `default=True` was removed after it was written, for a reason worth recording: it
fires whenever the attribute is None at flush, including when a caller assigns None explicitly, so
NEW rows stored True while MIGRATED rows held NULL — two implementations of "default on" that can
disagree, and the migrated state was not constructible in a test (measured: the row asserting NULL
came back True).

The client type is **optional** (`auto_next_episode?: boolean`), because a required field would be
a type error in every settings-shaped literal under `src/components/`, which this round does not
touch. So `undefined` reaches the client, and `autoNextFrom` is the one place that says what it
means.

The switch lives on the show screen, beside the episode control, as the `.bs-title__toggle` shape
the movie screen's 4K opt-in already uses. **The web settings screen does not expose it** — every
TV stage has a merge gate saying no `(web)` file is touched, and this round keeps it.

### 4.2 What is next

`_data/nextEpisode.ts`. TMDB is asked at most twice and the second question is cheap because the
first answer contains it: `getSeason` lists this season (the next episode is the lowest listed
number ABOVE the current one — not `+ 1`, because a season can skip and a double episode is listed
once), and if there is none, `getShow`'s season summaries carry `episode_count`, so the first later
REGULAR season that actually has episodes is identified without fetching any of them.

`none` and `unknown` are different answers, and the difference is load-bearing twice: a failed
lookup must not tell a viewer their series has ended, and it must not let the prefetch start a
download for an episode nobody has established exists.

This is the rule `_data/continueWatching.ts` records the web app breaking — it badges a card "Up
next" for `episode + 1` without asking whether episode + 1 exists, then leaves the link on the
episode just finished.

### 4.3 The prefetch

Past 80% of the episode, `prefetchEpisode` runs `titleStateFor` for the next episode and starts a
download **only if the answer is `play`** — i.e. only if nothing on the box covers it. The common
case is the one that must not download: the episode on screen usually came from a season pack, and
`covers()` matches that pack for the next episode too, so the answer is `open` or `preparing` and
there is nothing to fetch. `POST /download` mints a fresh uuid with no magnet or infohash dedupe,
so getting this wrong is a second multi-gigabyte copy of a season already on the box, on a machine
that allows two downloads.

It is gated on `settled && on`, not on `on` alone: an unreadable settings call leaves the toggle
showing the default (a control has to render something) and leaves the prefetch doing nothing.

**80% is a fraction rather than a fixed lead time** because the point is to leave time for the
download, and how much time that buys should scale with the episode: 80% of a 22-minute comedy is
4.4 minutes and of a 70-minute drama 14.

**The scale is not `video.duration`.** On this television the media element routinely never reports
a finite duration for an in-progress stream — that is why the scrub row can be absent for a whole
film — so `episodeScaleSeconds` falls back to the progress row's stored duration and then to
TMDB's runtime, which the season read already had in hand. Without the third source the prefetch
would simply never fire on the common case. TMDB's runtime is an approximation (whole minutes,
and it describes the programme rather than the release); everything that reads it is a threshold,
and nothing that reads it is a readout — the scrub bar still refuses to draw itself without a real
duration.

### 4.4 The end-of-episode prompt, and why it is not credits detection

**Nothing in this system knows where an episode's credits start.** TMDB publishes no chapter or
credit markers, a torrent carries none, and the only thing the box could do about it — decode the
picture and look for a scroll — is not something a Raspberry Pi feeding a 1080p stream is going to
do. The ask said "if this isn't possible, then leave it"; what shipped instead is the nearest
honest thing, named as a guess rather than dressed up as a measurement:

In the last **45 seconds** of the episode (or the moment `ended` fires, which is certain), the band
shows `Next up: S02 · E03 · <title>. Press Next episode.` It is a `message`, which means the
band's auto-hide is suppressed while it is up — that is the whole mechanism: the Next-episode cell
is on screen and reachable at the moment it is for, with no new focus machinery at all. When the
background start was refused, the sentence says so, because the press the viewer is about to make
may be slow or may fail.

It appears only when something could say how long the episode is. With no scale from any of the
three sources there is no "end" to be near, and there is no prompt — silence rather than a guess
at where the end is.

### 4.5 The press

`whereToWatchEpisode` is deliberately **stricter than the show screen's `placeToWatch`**. Two of
`titleStateFor`'s answers mean something different inside a player: `unresolvedEpisode` carries an
href the show screen offers behind a disclosure the viewer reads first, and there is nowhere on a
transport cell to print one — following it would take a viewer who pressed "Next episode" to some
other episode without a word, which is the exact defect that kind exists to prevent. `preparing`
with `fileUnknown` is the same hazard one step earlier. Both refuse, in words. `paused` is resumed
rather than refused.

The press flushes the position and `router.replace`s — never pushes, because a pushed watch URL
leaves a dead history entry pointing at a torrent that may be gone.

**That press is the first thing on this surface that goes from the player TO THE PLAYER**, and it
broke two things that had never been exercised. Both are in `page.next.test.tsx`, and both were
found by reading the route rather than by a failing test — then each was proved by deleting the
fix and watching the row go red.

1. **`leaving` is a latch.** `leave()` sets it so a second press cannot double-navigate, and until
   now every exit left the route for good. React can keep the instance across a `replace` to the
   same dynamic route, so a latch that survived would leave the viewer in the next episode with
   Back and Stop both doing nothing.
2. **The playhead belongs to the FILE, not to the torrent.** Inside a season pack the next episode
   is the same torrent with a different `?file=`, so the arrival effect does not re-run — which is
   deliberate and predates this work: a pack's episodes share one torrent, which is why the sidecar
   read, the seek boundary and the progress read are each keyed on the file, and why the player is
   not torn down between them. What that left uncovered is `position` and `ended`: the new
   episode's `loadedmetadata` seeked to `Math.max(resume, position)`, i.e. to wherever the viewer
   had got to in the episode they had just finished — half an hour in, silently — and `ended`
   would have written the new episode's progress row `completed` before a frame of it played.

   The first fix tried was to key the ARRIVAL on `askedIndex` as well, which is semantically
   tidier and wrong: it tears the player down between episodes of one pack, costs a `/files`, a
   `/status` and a wasted sidecar read, and **it reddened four existing rows** that encode the
   keep-the-player design. The fix that shipped is a reset keyed on the file and nothing else.

---

## What the guard caught, and what no unit test could have

`noDeadExports.test.ts` — the instrument stage 9's C7 produced — went red on all eight exports of
`_data/nextEpisode.ts` the moment the module existed and before the route used it. That is the
guard doing exactly its job.

It does not catch the next one up, and `page.next.test.tsx` does: **`nextFailure` was computed,
timed out and never rendered.** The route set it on a refused press, cleared it on a timer, and
never passed it to `messageFor` — so a Next-episode press that the box refused was silent, which
is the one thing this surface refuses everywhere. Every unit around it was correct and wired; the
seam between them was not. It was found by an integration row asserting that a refused press says
why, not by review.

## Numbers

- `npm run test:tv`: **1603 → 1735**, 66 → 70 files, **20 consecutive identical runs**.
  `npx vitest run`: **2564 → 2696**, 4 consecutive identical runs.
- `npx tsc --noEmit`: clean. `npm run build`: compiles.
- The dead-export guard still has its teeth: pointed at the pre-C7-fix tree (`0e16737`) it fails
  naming `pollSubtitles` and `streamingService.fetchSubtitle`, and passes at this branch's tip.
- One earlier 20-run loop reported 8 failures and was thrown away: it was reading a tree being
  edited underneath it. That is the `agent-left-a-mutation` shape seen from the inside — a loop
  over a moving tree reports the mover's edits as flakes.
- Backend: `test_auto_next_episode.py`, 6 rows, and the suite unchanged otherwise.
- `bigscreen.css`: +~230 lines, two new blocks (the episode card, the transport controls) and one
  rewritten (`.bs-ep*`).

## Not claimed

- **None of it has run on the television.** Nothing since stage 3 has, and this round adds to that
  list rather than shortening it. The geometry claims here were measured in Chromium at 1920x1080,
  which is the design space and not the panel.
- **The 45-second window is a guess**, as §4.4 says.
- **The prefetch competes with the stream.** Starting a second download at 80% takes bandwidth
  from the episode still playing, on a Pi with finite upstream. The setting is how a household
  turns that off; no measurement of the cost exists.
- **A refused prefetch is reported once, at the end.** It is not retried and not polled.
- The CSS citations in the docs tree (`bigscreen.css:NNN`) are now stale by construction — the
  episode-list block above the player block was rewritten. Nothing in this repository reads a CSS
  citation, so they were left rather than re-resolved; the stylesheet's own note says so.
