# A split search, and a home screen that is not the same every night

Two asks:

1. *"the search needs to be split left/right, with text on the left and a grid of results on
   the right (with infinite scroll)"*
2. *"the home page of big screen needs to randomise carousels/carousel search/content, the
   same way as the browser version operates. it also needs significantly more
   carousels/options for greater variety"*

---

## 1. The premise in (2) is wrong, and the work is still right

**The browser version does not randomise.** `MIXED_RAILS` in `@/lib/buildMixedRailsScreen`
is eight rails in a fixed order, `buildMixedRailsScreen` maps over it in that order, and
`grep -rn "Math.random\|shuffle" frontend/src` returns two comments, both saying it is *not*
used. So there was no browser behaviour to mirror; what shipped is the television's own, and
`railsDrift.test.ts` is rewritten from "the TV lineup equals the web's, less its omissions"
to "the web lineup is a SUBSET of the TV pool".

## 2. The home screen

**31 rails in the pool, 12 on screen, drawn per session.** The pool grows by 24: the
shared-id genres the web never carried (Animation, Documentary, Family, Mystery, Westerns);
the four that are films-only because TMDB has no television equivalent (Horror, Thrillers,
Romance, History); the two that are television-only (Reality, younger viewers); War &
Politics, which is movie `10752` and tv `10768`; seven country and language shelves;
`origin: 'anime'`, which `providers/catalog.py:104` reads as genre 16 **plus** Japanese — the
one shelf that needs two filters and gets them from one word; and three one-sided feeds whose
sort names a column the other mode does not have.

**The content moves too.** Each rail below the headline asks for a random TMDB page, so
"Drama" is not the same twenty titles every time.

### The three decisions worth keeping

**The seed is per session, in `sessionStorage`.** Back from a title screen `push`es home, so
the home screen remounts on every return. A lineup drawn at mount would reshuffle every time
the viewer looked at something and came back — and the focus grid's saved row would then name
a different rail. One lineup per sitting, a new one next launch; on webOS a launch is a fresh
document, which is what a viewer experiences as "next time".

**It is read in a LAYOUT effect, never during render.** `sessionStorage` does not exist while
Next prerenders this page, and a seed chosen during render would make the server's HTML
disagree with the client's first paint — a hydration mismatch in every rail title. Both
render a fixed default lineup and the real one is swapped in before the browser paints.

**The headline is random among three broad feeds only, and stays on page 1.** The hero is
built from the first rail's `lead` and is also where the ring lands on arrival, so a niche
shelf there is the likeliest thing on the screen to be empty.

### What the rails pool must obey, written down because it is not guessable

Read off `providers/catalog.py:96-126`: **any** of `genres`/`year`/`origin`/`lang`/`provider`
switches the upstream request to `api=discover`, and `api` is then **not sent at all**. So on
a filtered rail `api` is decoration and `sort` is the only thing that orders it. And **`sort`
is not translated per mode** — nothing in `providers/` touches it — so `primary_release_date`
is a movie column and `first_air_date` a tv one, and a date sort belongs in one half's params
and never in both. `railLineup.test.ts` pins both rules against the whole pool.

### One bug this would have shipped with

`catalogSettled` asked **the whole pool** whether every rail had answered. With 19 of the 31
never fetched it could never be true, so the recovery panel's "Try again" would have been
unreachable for ever. It asks the lineup.

## 3. The split search

**It needed the focus-model change the last round wrote off.** That round said the split
"needs spatial focus navigation and this surface's grid is row-indexed" and shipped a
`Go to N results` jump cell instead. That cell is gone; Right does the job.

`_focus/panes.ts` is the spatial half, and it is deliberately small. `model.move` is
untouched and still resolves every press that stays inside a region. The new function adds
exactly two things:

1. **Vertical containment.** Up and Down stay in the pane they started in. Without it, Down
   from the bottom of the keyboard lands in the results — the next populated row — which is
   *beside* the keyboard, not below it. Up off the top of either pane reaches the bar, which
   is above both.
2. **Horizontal crossing.** A Left or Right that `move` refuses because the row has ended is
   the press that crosses, and it lands on the row the other pane was last on.

`useFocusGrid` gains one optional `resolveMove`, defaulting to `move`. Every other screen is
byte-identical in behaviour; the roving tabindex, the saved position, the pending restore,
the column memory and the `clampTarget` fall-backs are untouched.

**Recent searches moved panes.** They were a horizontal row under the keyboard; in a split
that is six pills in a 988px column. They now fill the right pane when there is nothing else
to put in it, one per row.

**Infinite scroll is driven by focus, not by a scroll event** — there is no pointer here. The
next page is asked for when the ring reaches the last row of results, and `appendResults`
never re-orders what is already on screen, which is what keeps the ring on the card it was
on.

## 4. Four defects found while building it, each by a specific instrument

- **The infinite scroll cascaded.** Firing one row *early* means a two-row grid has its first
  row one-from-last, so appending leaves the ring still one-from-last and it asks again —
  measured walking to page 3 of a search with no press after the first crossing. It fires on
  the last row. Found by asserting what the last request was.
- **The old `.bs-search__row` rule was still in the stylesheet, below the new one**, so the
  cascade used the old full-width rail and the third card of every row hung off the right of
  the screen. **Found by rendering at 1920x1080**, not by reading: `searchCss.test.ts` had
  read the *first* matching rule and passed. `rule()` now requires a selector to be declared
  exactly once, which is the real guard.
- **The grid walk under-covered.** The test that asserts "every rendered cell is reachable"
  reached 34 of 45 cells while claiming it had reached them all: its serpentine always ended
  a pass in the left pane, so every results row after the first was unreachable, and it got
  stuck on the action row. It is now two sweeps.
- **The typing pause re-ran a search the Search key had already run.** The timer captures
  "this query is worth asking about", which a press 100ms later makes false. It re-asks at
  fire time. Pre-existing; found by a row asserting the last request.

Two classes with no rules at all (`.bs-search__pane--input`, `--results`) were also found —
by the guard that says every `bs-` class a page renders must have one.

## 5. Numbers, and what is not claimed

- `npm run test:tv` **1799 -> 1897**, 10 consecutive identical runs. `npx vitest run` **2858**.
  `npx tsc --noEmit` clean. `npm run build` compiles.
- New suites: `railLineup.test.ts` (30), `panes.test.ts` (27), `searchPaging.test.ts` (16),
  `searchCss.test.ts` (8), `page.lineup.test.tsx` (7).
- Mutation-tested: 5 mutations of `paneMove` and 3 of the home screen's lineup wiring, each
  caught.
- **None of it has run on the television.** The split's geometry is measured from two
  Chromium screenshots at 1920x1080 and from arithmetic the stylesheet test re-checks; the
  set itself has seen neither screen.
- The `new` rail still sends the movie spelling of a date sort to both halves. It is
  inherited from the web table, which `railsDrift.test.ts` pins, so fixing it on one surface
  alone would be a drift — it is named in `railLineup.test.ts` as the one exception.
