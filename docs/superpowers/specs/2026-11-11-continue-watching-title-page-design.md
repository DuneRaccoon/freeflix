# Continue Watching opens the title page — design

**Date:** 2026-11-11 · **Status:** approved in conversation ("it's all good, move ahead")
**Surfaces:** web `(web)` and the television `(bigscreen)`.

## Intent

Clicking a Continue Watching card today drops the viewer straight into the player, mid-episode or
mid-film, on both surfaces. There they can't pick another episode or see what they're resuming.
The card should open the title's page instead. That page carries one obvious control that resumes
where they left off. On the television the player also gets an on-screen way back to that page.

The owner's words: *"clicking a continue watching card should lead to the pre-video page and
additionally, the video player needs a 'back' button at the top left of the bigscreen video player,
so that we can return to the movie or tv-show page."*

## Goals

1. **Continue Watching never opens the player** when the card's title can be identified.
   - **Web:**
     - A film card opens `/movies/{tmdbId}`.
     - A show card opens `/tv/{showId}?season={S}&episode={E}`, the episode the row is about.
   - **TV:**
     - A film card opens `/bigscreen/movie/{tmdbId}`.
     - A show resume card opens `/bigscreen/show/{showId}?s={S}&e={E}`.
     - The "Up next" card keeps opening `/bigscreen/show/{showId}`.
   - A card whose title cannot be identified keeps going to the player. That means a legacy
     title-string id, or a non-positive tmdb id.
2. **The web show page opens on the asked episode.** Season S is the open tab and the episode its
   main button is about is highlighted. That hero button says:
   - **Resume S01·E03** when the profile has an unfinished row for that episode that still has a
     torrent. It goes to that row's exact torrent and file.
   - **Play S01·E04** when the asked episode is finished. That is the next episode, which may be in
     a later season.
   - **Play S01·E03** when there is no usable row.

   Without a query the page behaves exactly as today ("Play S01·E01").
3. **The web movie page offers Resume.** If the profile has an unfinished row with a torrent for
   `movie:{tmdb}`, and that row passes the web player's own prompt rule (`current_time > 30 &&
   percentage < 98`), the first action is **Resume from 42:10**. It goes to that row's
   torrent and file, and Play drops to the secondary style.
4. **The TV show screen honours `?s=&e=`.**
   - **Season:** the asked season opens if it is a regular season, and the finished-season
     auto-advance never skips an asked season.
   - **Subject:** row 1's subject is the asked episode, unless the episode isn't listed or is
     already watched. Then it falls back to the first unwatched episode. The "Next up" badge
     follows the subject.
   - **Bad values:** an absent, invalid or unknown value falls back to today's behaviour.
5. **The TV player gets a Back control in the top left.**
   - **Label:** the title it returns to, `‹ The Boys`.
   - **Visibility:** it fades with the controls band, on the same flag.
   - **Reaching it:** one Up from the transport row when the scrub row is absent, two when it is
     present.
   - **Destination:** pressing it goes to the title page. For a show that is
     `/bigscreen/show/{id}?s=&e=` for the episode now playing. The remote's final Back rung, Stop,
     the Stop media key, `LoadStatus`'s on-screen Back and `Gone`'s first way out all go to the same
     place. An unknown title goes home, labelled `Home`.
6. **The web player's back arrow returns to the title page.** It goes to `/downloads` only when the
   download doesn't know its title, and its label names where it goes.

## Non-goals

- Changing the web player's own "Resume playback?" modal. A Resume press on a title page still
  meets it. That is an extra click, which is honest, and auto-seeking would lose the click gesture
  that unmuted playback relies on.
- Progress-derived heroes on the web show page without a query.
- Watched marks in the web episode list.
- The web Continue Watching row's unchecked `episode + 1` "Up next" label, and its skipping of
  torrent-less rows.
- The TV's show and movie screens' Back key. It still goes home, so the stack is home → title →
  player.

## Anti-goals (would make this a failure even if it "works")

- A TV screen navigating to a `(web)` route, or the web to a `/bigscreen` route.
- A control whose label lies about where it goes: "Back to downloads" that goes to a show, or
  "Resume" that starts a new download.
- The TV player's ring landing on Back by itself: on arrival, after a recovery removes the scrub
  row, or after the subtitle picker closes. An OK press there would leave the film.
- A season pack resuming the wrong episode because a `?file=` was dropped.

## Decisions taken by the builder (Claude's calls, not discussed)

- **Shared identity:**
  - `@/lib/contentId.ts` gains `titleOfContentId` and `titleOfStream` (pure, import-free; both
    surfaces may import them).
  - Season 0, which is Specials and also the backend's `s0` last-resort fallback, is treated as
    show-level and never sent as an ask.
- **Route builders are per surface:**
  - The web uses `@/lib/titlePageHref.ts`. The TV never imports it.
  - The TV uses `(bigscreen)/_data/titleHref.ts`, a sibling of `watchHref.ts`.
  - Each file owns both the producer and the reader of its query spelling, pinned by a round-trip
    test: `season`/`episode` on the web, `s`/`e` on the TV.
- **Web show page:**
  - The query is parsed on the server page and passed as props, with a `key` so a search-only
    navigation remounts.
  - While the profile's progress is still loading and an episode was asked, the hero is a
    disabled loading button, so a press can't start a download that Resume would have avoided.
  - When the asked episode is finished, "next" comes from `findNextEpisode` (in-season or
    cross-season). If it answers `none` or `unknown`, the hero falls back to Play S01·E01.
- **Web Continue Watching:**
  - Cards switch from `<a>` to `next/link` so the progress context survives the hop.
  - The aria-labels change to say the card opens the title.
- **TV player:**
  - Back is row 0 above the scrub row. The grid takes `initialRow: SCRUB_ROW` when the picker is
    closed, and no `initialRow` when it is open.
  - Back is not rendered while the picker is open. Its key would collide with the picker's Off
    cell.
- **Web player:**
  - The blocked state's "Choose another source" now goes to the title page, which is where the
    source picker lives.
  - The error state's button is labelled for where it goes.

## Constraints

- Every rule in `CLAUDE.md`. In particular the TV stylesheet is hand-authored at
  `frontend/public/bigscreen.css`, with no GPU-expensive CSS and no positional selectors. Also no
  Tailwind, `framer-motion`, `globals.css` or `@/components` under `(bigscreen)`.
- `noDeadExports`: every new `(bigscreen)` export needs a production caller.
- A Next page file may export only framework names.
- `npm run test:tv` is run by hand and looped. One green run proves nothing.

Plan: `docs/superpowers/plans/2026-11-11-continue-watching-title-page.md`.
