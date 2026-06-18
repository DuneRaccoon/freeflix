# FRÈ Phase 6 — Player (re-skin) Implementation Plan

> Spec-level tasks executed implement→verify→commit. Steps use `- [ ]`. **This is a RE-SKIN, not a rewrite** — playback + progress logic is preserved EXACTLY.

**Goal:** Re-skin the video player + streaming page in the FRÈ language (the player mockup) without touching the load-bearing playback/progress/streaming-URL logic. Real controls get FRÈ styling + Picture-in-Picture + a download chip + paused warmth; aspirational controls (subtitles/audio/quality-switch/skip-intro/hover-thumbnail) are rendered gated/disabled ("Soon").

**Architecture:** Keep `streaming/[id]/page.tsx` (lifecycle: poll, `?file=N` multi-file picker, streaming URL, mount), `PatchedVideoPlayer.tsx` (progress: `effectiveMovieId`, save/resume), and `VideoPlayer.tsx`'s control LOGIC (play/pause, seek, buffered/played scrubber, ±10s, volume, speed, fullscreen, buffering/stall, `registerMethods.seekTo`, `onProgress`/`onEnded`/`onError`). Change only the PRESENTATION (JSX/classes/overlays) to FRÈ tokens, matching the mockup. Reuse FRÈ primitives + `ff-*` atmosphere CSS.

**VISUAL TARGET:** `/Users/benjaminherro/github/freeflix/.superpowers/brainstorm/18139-1781740714/content/player-mockup-v3.html` (top overlay: back + title + "Streaming · N% downloaded" chip + settings; center play/pause + 10s skips; bottom bar: scrubber [downloaded vs played + knob], time, volume, speed, audio/CC[gated], quality[info], PiP, fullscreen; Skip-Intro[gated]; Up-Next card; paused warm vignette).

## Global Constraints — LOAD-BEARING (DO NOT BREAK)
- **Progress-save contract** (in `PatchedVideoPlayer`, preserve verbatim): `effectiveMovieId = contentId ?? movieId`; fetch saved via `getProgressByMovie(user, effectiveMovieId)` → fallback `getProgressByTorrent(user, torrentId)`; resume prompt when `current_time > 30 && percentage < 98`; periodic 30s save + on-unmount + `beforeunload` + on-`onEnded`(completed); `saveProgress` payload `{torrent_id, movie_id: effectiveMovieId, current_time, duration, percentage, completed, file_index?, title?}`; `updateProgress` once `progressId` exists; completion = `percentage > 98`; 5s save throttle. **None of this logic may change** — only the resume-prompt's visual (→ FRÈ Modal).
- **Streaming URL + multi-file** (in the page + service, preserve): `getStreamingUrl(torrentId, quality?, fileIndex?)` → `/api/v1/streaming/{id}/video?quality=..&file_index=..`; `?file=N` param drives `effectiveFileIndex`; the file picker rewrites the URL via `router.replace`. Don't change the URL shape or the fileIndex threading.
- **VideoPlayer control logic** (preserve all handlers/refs/state/effects): `togglePlay`, `skip(±10)`, seek/`handleProgressClick`, volume/mute drag, `setPlaybackSpeed`, `toggleFullscreen`, buffering/stall detection (`isTimeBuffered`, `getBufferedAhead`, `checkForStall`), controls show/hide timeout, `registerMethods({seekTo})`, `onProgress`/`onEnded`/`onError`. Only re-skin the JSX/classes.
- Stack/alias/gates as prior phases. Dark-only, gold precious. Conventional Commits. The player route is full-bleed (Phase 2: `/streaming/*` renders with NO TopNav/atmosphere — keep that).
- **Verification reality:** jsdom can't fully drive a real `<video>`, so player tests are limited (assert rendered controls/states/props, the download chip, gated buttons). The real gates are `npx tsc --noEmit`, `npm run build`, and a LIVE playback check (controller does the live check).
- Reuse FRÈ: `Button`/`Pill`/`Badge`/`Progress`/`Ring`/`Modal` (`@/components/ui/fre`), `cn`, the `ff-*` atmosphere CSS, `contentId.ts`.

## File Structure
| File | Change |
| --- | --- |
| `src/components/player/VideoPlayer.tsx` | **re-skin** controls/overlays in FRÈ; add PiP, download chip, paused warmth, gated controls (logic unchanged) |
| `src/components/player/PatchedVideoPlayer.tsx` | re-skin the resume prompt → FRÈ `Modal` (progress logic unchanged) |
| `src/app/streaming/[id]/page.tsx` | re-skin loading/error/file-picker chrome in FRÈ (lifecycle unchanged) |
| `src/components/player/UpNextCard.tsx` (+test) | **new** — next-episode card for multi-file season packs |
| `src/components/streaming/BasicPreStream.tsx` / `BufferingAnimation.tsx` | retint to FRÈ gold-on-ink (keep PreStreamingAnimation's theater animation; just FRÈ-tint) |
| `src/app/globals.css` | add any `#ff-player`/`.ffp-*` styles needed by the re-skinned player + the paused-warmth keyframe(s) (reduced-motion already gated) |

---

### Task 1: VideoPlayer FRÈ re-skin
**Files:** `src/components/player/VideoPlayer.tsx` (+ a light test if feasible).
Re-skin the player UI to match the mockup using FRÈ tokens, **preserving every handler/ref/state/effect/callback** (see Global Constraints). Concretely:
- **Bottom control bar** (glass, gradient up): the **scrubber** keeps the buffered(light)/played(gold)/knob structure and `handleProgressClick`/keyboard; FRÈ-styled. Time display, volume (mute + slider, existing logic), playback-speed menu (existing 0.5×–2×), fullscreen (existing). Add a **Picture-in-Picture** button (new: `videoRef.current.requestPictureInPicture()` with a feature check + a `leavepictureinpicture` reset). Add GATED controls as disabled FRÈ pills/buttons with a "Soon" affordance: **Audio/CC**, **Quality** (show `downloadProgress`/quality as info), **Subtitles** — `aria-disabled`, non-interactive (these have no backend).
- **Top overlay**: title (Fraunces) + subtitle, and a **"Streaming · N% downloaded"** chip driven by `downloadProgress` (gold, shown when `downloadProgress < 100`). (The back button is owned by the page, not the player — leave page nav as-is, or add a back affordance only if the current player has one.)
- **Center transport**: the big play/pause + ±10s skip buttons, FRÈ-styled, existing handlers.
- **Paused warmth**: when not playing, render a warm-gold vignette + gentle dim overlay (the `is-paused` look from the mockup) BELOW the controls (z-index under controls). Gate the transition on reduced-motion (use the global guard / a `ff-*` keyframe).
- Keep the buffering spinner/stall messages (existing), re-skinned.
**Test/verify:** `npx tsc --noEmit` clean + `npm run build`. If feasible, an RTL test asserting the download chip shows at `downloadProgress<100`, the gated controls are `aria-disabled`, and the scrubber renders played/buffered widths from props — but DO NOT assert real video playback (jsdom limitation). Commit.

### Task 2: Resume prompt → FRÈ Modal
**Files:** `src/components/player/PatchedVideoPlayer.tsx`.
Replace ONLY the resume-prompt overlay JSX (the "Resume Playback / Start from Beginning" dialog) with the FRÈ `Modal` (`@/components/ui/fre`), styled gold-on-ink, preserving `handleResume` (calls `playerRef.current.seekTo(resumeTime)`) and `handleStartFromBeginning`, the `showResumePrompt` state, and ALL the surrounding progress logic untouched. The resume time label stays.
**Verify:** `npx tsc --noEmit` + `npm run build`. Commit.

### Task 3: Streaming page chrome FRÈ
**Files:** `src/app/streaming/[id]/page.tsx`; retint `src/components/streaming/BasicPreStream.tsx` + `BufferingAnimation.tsx`.
Re-skin the page's NON-player chrome in FRÈ, lifecycle unchanged: the loading spinner, the error screen (Try Again / Back as FRÈ `Button`s), and the **multi-file episode picker** pills (→ FRÈ `Pill`s, keeping `handleFileSelect`/`router.replace(?file=N)`). Retint `BasicPreStream`/`BufferingAnimation` to gold-on-ink (FRÈ `Progress`, FRÈ `Button`s). Keep `PreStreamingAnimation`'s theater animation but ensure its palette reads FRÈ (gold accents) — minimal retint, don't rebuild it.
**Verify:** `npx tsc --noEmit` + `npm run build`. Commit.

### Task 4: Up-Next card (multi-file season packs)
**Files:** `src/components/player/UpNextCard.tsx` (+test); wire it into the player/page.
A FRÈ "Up Next" card shown near the end of an episode WHEN the current torrent is a multi-file season pack and a next file exists. Props `{ nextLabel: string; thumbnailUrl?: string|null; onPlayNext: () => void; onDismiss: () => void; countdownSeconds?: number }`. Shows the next episode label (e.g. "S1·E4"), an optional thumbnail, a countdown ring (FRÈ `Ring`), Play-next, and a dismiss (×). Wire it minimally: in the streaming page (which already has `videoFiles` + `effectiveFileIndex`), when there's a `videoFiles[effectiveFileIndex+1]`, render `<UpNextCard nextLabel onPlayNext={() => router.replace('/streaming/'+torrentId+'?file='+(effectiveFileIndex+1))} ...>` near playback end (a simple time-based trigger via the player's `onProgress`, OR a manual visible state — keep it simple and correct; do NOT add autoplay that fights the progress save). For single-file movies it never shows.
**Tests:** render the card with a next label + countdown ring + buttons; clicking Play-next calls `onPlayNext`; dismiss calls `onDismiss`. Commit.

### Task 5: Phase gate
`npm run test` (green), `npx tsc --noEmit` (clean), `npm run build` (succeeds; `/streaming/[id]` builds). Tag `fre-phase6-player`. (Controller also does a LIVE playback check in a browser.)

---

## Notes for implementers
- This is the highest-risk phase: **re-skin, don't rewrite.** Read the existing `VideoPlayer.tsx`/`PatchedVideoPlayer.tsx`/`streaming/[id]/page.tsx` carefully; change presentation only; keep every handler/ref/effect/callback and the exact prop threading. If a change would alter playback or the progress-save contract, STOP and flag it.
- Match the player mockup; use FRÈ tokens + primitives. Gold strictly on the played scrubber + the active control + the download chip.
- Aspirational controls (subtitles/audio/quality-switch/skip-intro/hover-thumbnail) are rendered DISABLED with a "Soon" affordance — never wire them to nonexistent backends.
- Keep `/streaming/*` full-bleed (no TopNav/atmosphere) — that's handled by `AuthenticatedLayout`; don't add the shell here.
- Verify with tsc + build (jsdom can't run a real `<video>`); the controller will do a live playback check.
