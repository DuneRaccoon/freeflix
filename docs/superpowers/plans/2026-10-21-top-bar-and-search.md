# A top bar, and a search screen worth using

Two asks: *"ensure there is a proper top header menu on bigscreen"*, and *"ensure the search
function is properly implemented with a better and more user friendly UX design"*.

---

## 1. What was there

**The menu was a row under the hero, on one screen.** `NavRow` rendered four links as the home
screen's third focus row — below the artwork, above the first rail — and nowhere else. So
everything except Home was two Downs and a Right away, and from Search or My List there was no
menu at all: the way back was a single "Back to home" control the screen had to carry itself.

**The search screen was a keyboard with results somewhere underneath it.** Typing a title is
about thirty D-pad presses; then the viewer had to walk the ring down six rows of keyboard to
reach a "Search" button, press it, and walk down past the keyboard again to reach what they had
asked for. The query readout was in the head, a long way from the keys.

## 2. The bar

`_components/Header.tsx`, rendered into `.bs-shell__head` — which sits above `.bs-shell__scroll`
in the shell's column, so the bar keeps its place while the rails move under it with no
`position: fixed`, no layer and nothing composited per frame.

It is on **home, search and My List**: the browsing screens. Not on the title detail screens
(full-bleed artwork with their own Back), not on the player, and not on the profile picker or the
pairing screen, which are flows rather than places. Home is a target like any other, because the
bar appears on screens that are not home and "how do I get back" is the question a top bar exists
to answer.

**The current section is an attribute, not a class.** `aria-current="page"` is what a screen
reader reads and what the stylesheet colours, so the two cannot disagree — the device
`.bs-show__season[aria-pressed]` already uses. Matched **exactly**, not by prefix: `/bigscreen` is
a prefix of every other route here, so `startsWith` would mark Home current on the search screen
too. The current item stays a real, focusable link; a menu item that refused focus because you are
already there is a hole in the row that Left and Right fall into.

### The focus-model change the bar forced

A menu at row 0 means `firstTarget` — "the first populated row" — puts the ring in the menu. Not
only on arrival: on every fall-back, which is a rail emptying, a recovery panel being replaced by
the hero it held the place of, a search clearing its results.

So `firstTarget` and `clampTarget` take a `from` — **where the content starts** — and screens pass
`initialRow: 1`. It is a *preference, not a floor*: if nothing at or after it has items the search
starts again from the top, so a screen whose content has not arrived still has a focus stop.
"Always something focused" outranks "never the menu", because a remote has no Tab and no pointer.

That distinction is the whole of the fix, and the home tests found it: a first version set home's
landing row to the **hero**, which skipped the recovery panel — so the one screen whose entire
point is that the viewer lands on "Try again" put the ring in the menu instead.

**The limit, written down rather than left to be discovered:** once the ring is somewhere real, a
row filling below it does not pull focus. Moving focus the viewer did not ask for is the worse
failure, and on every screen that mounts the bar, row 1 has cells from the first paint.

## 3. The search screen

### It searches when you stop typing

The rule that survived: **no search per keystroke** — nine requests for a nine-letter title is what
a television's network cannot afford. What changed is that the trip to the button was the worst
thing about the screen. A pause is the same intent, expressed by stopping: 500ms after the last
key, for a query of at least three characters.

`autoSearchQuery` lives in `_data/searchQuery.ts` with its three numbers, because a page module
cannot export a constant (Next rejects anything but its own known fields) and a test that re-typed
`500` beside the page's own would be two numbers to keep in step.

**`alreadyAsked` is why it is a function rather than a length check.** A failed search leaves the
query on screen unchanged, so the condition that armed the timer is still true — without it the
screen re-asks a dead box every pause, for ever. "Asked" and "answered" are different facts, and
only the first one stops the loop. The in-flight guard and the generation counter are unchanged.

The Search key stays, and now has a job worth having: it is the **retry**, and the way to ask about
a one- or two-character query.

### You can reach the results

`Go to N results` is **appended** to the action row when there are results — appended, because the
focus model tolerates growth at the end of a row and nothing else. It moves the ring to the first
card. One press instead of six Downs, with the count in the label so it is a decision rather than
a leap.

### It remembers what you searched for

`_data/recentSearches.ts`: the last six searches **that found something**, offered when the query
is empty and there is nothing else on the screen. A list of a viewer's typos is worse than no list,
and a row that stayed would sit between the keyboard and the results for the whole visit.

It is the one thing on this surface stored in `localStorage` rather than `sessionStorage` —
entering "The Lighthouse Keeper" on a D-pad is about fifty presses and a household searches for
the same handful of shows. Deduplicated case-insensitively (the keyboard is upper case and a
restored query is not), newest spelling wins, and what comes back out is re-validated.

### The query looks like a field

The readout moved out of the head (which the bar took over) into a bordered box at the top of the
scroller, with the status line **inside it** — so "Searching…", the result count and every refused
press appear where the viewer is already looking instead of under six rows of keyboard. It is
still not an `<input>` and must not become one: a real input takes DOM focus from the
roving-tabindex grid, and webOS raises its own IME panel over the app when one is focused.

There is no `<h1>Search</h1>` any more. The bar marks the section and the field says what to do in
it; a heading between them was a third way of saying the same word and ~90px that the keyboard and
the results both want. My List keeps its heading — a wall of posters has nothing else labelling it.

## 4. What this cost elsewhere

- `NavRow` and its test are **deleted**. The dead-export guard would have flagged it the moment
  nothing rendered it, which is what it is for.
- Home's focus storage key is `home:v3`. The row layout changed, so a position saved by the
  previous build names a different row; a new key means an old position is discarded rather than
  misread.
- `journeys.test.tsx` walks `HEADER_TARGETS` where it walked `NAV_TARGETS` — still the only way
  search, My List, the picker and diag are reachable at all.
- My List's "the list emptied under the ring" handler sent focus to `row 0`, which was the action
  row and is now the bar. It names `ACTION_ROW`; a hard-coded row index is exactly what does not
  survive a bar being added above it.

## 5. Numbers, and what is not claimed

- `npm run test:tv`: **1755 → 1799**, 69 → 72 files. `npx tsc --noEmit` clean.
- New suites: `Header.test.tsx` (14), `recentSearches.test.ts` (12), `searchQuery.test.ts` (6),
  plus the typing-pause, recents, results-jump and bar rows on the search screen.
- Measured by rendering `bigscreen.css` at 1920x1080 in Chromium, not by reading it — which is
  what removed the redundant Search heading.
- **None of it has run on the television.** The bar's five items fit the safe area by arithmetic
  (`nowrap`, like every other focus row here); a sixth is a measurement, not an edit.
- The two-column layout a TV search "should" have — keyboard left, results right, Right from the
  last key entering the results — is **not** what shipped. It needs spatial focus navigation, and
  this surface's grid is row-indexed: one focus row is one visual line, which a keyboard row and a
  poster row are not. The jump cell buys most of that for none of the risk; a real two-column
  search is a focus-model project.
