/**
 * EXACTLY ONE `<track>`, and every attribute on it is a measured decision (D14/D15).
 *
 * WHY THIS IS A COMPONENT AND NOT FOUR LINES INSIDE THE `<video>`. The route cannot reach a
 * CHOSEN sidecar yet: the picker that chooses one is a later task, and the transport cell's
 * press is a committed no-op whose own row pins that the cell's state does not change when it
 * is pressed. So an element written inline in `page.tsx` would ship with every one of its
 * rules unfalsifiable. Here the mount rule, the two `kind` arms, the key and the error prop
 * are all reachable from a props object, and `page.track.test.tsx` pins the composition that
 * is left — that the one mount sits INSIDE the `<video>` and is not mapped over a list.
 *
 * ONE ELEMENT, KEYED ON THE TORRENT'S OWN FILE INDEX. Measured: two `<track default>`
 * elements both reach `mode: 'showing'` — Blink enforces no winner — and a track's mode is
 * not re-derived when its attributes change, so switching language by mutating `src` leaves
 * the old cues showing. The key is what makes a switch a REMOUNT (verified in jsdom through
 * this component boundary: React's single-child reconcile compares keys, so the DOM node
 * identity changes). "Off" is rendering no element at all, which is why every refusal below
 * returns `null` rather than an element in some inert state.
 *
 * UNMOUNTED WHILE THE RECOVERY LADDER IS RELOADING. Measured on Chromium 155: each
 * `video.load()` APPENDS a fresh TextTrack per `<track>` child without discarding the
 * previous one — one element, `textTracks` 1 -> 2 -> 3, every copy `showing`, three identical
 * cue lines stacked on the picture, and React cannot reconcile away a track list it does not
 * own. Reading 35 asks whether Chromium 120 does the same; the guard costs one conjunct
 * either way. The named limit, repeated in the test: a suite here can only prove the ELEMENT
 * is absent. jsdom implements no `textTracks` at all (`window.TextTrack` is undefined,
 * `video.textTracks` is a plain zero-length array, `trackEl.track` is undefined and
 * `trackEl.readyState` is a hardcoded 0) and the route's own suite replaces
 * `HTMLMediaElement.prototype.load` with a `vi.fn()`.
 *
 * `onErrorCapture`, NEVER `onError`. react-dom 19's `listenToNonDelegatedEvent` block covers
 * `embed`/`source`/`link` and `case "track":` falls through without them, and the native
 * `error` does not bubble — so the bubble prop is dead code. Measured in this project's own
 * jsdom: a non-bubbling `error` dispatched at the element fires the capture prop once and the
 * bubble prop zero times. Nothing here branches on `readyState`; the branch is which event
 * fired.
 *
 * NO `crossOrigin`, AND THE REASON MATTERS. The URL is same-origin through `next.config.ts`'s
 * `/api/*` rewrite, so nothing is needed. The attribute would switch the MEDIA element's own
 * range requests to CORS mode on the ladder's next `load()`, against an exact-match
 * `cors_origins` that holds no LAN address. It is NOT that it drops the cookie —
 * `crossorigin="anonymous"` sets credentials mode `same-origin`, which still sends cookies on
 * a same-origin request, and a ban resting on a wrong reason is one the first person to test
 * it deletes. `noCrossOrigin.test.ts` is the guard, because jsdom fetches neither resource
 * and so no behavioural test on this surface can see the attribute at all.
 */
import type { SubtitleTrack } from '@/types';

import { subtitleTrackSrc } from '../_data/subtitles';

export interface SubtitleTrackElementProps {
  /** The torrent, for the URL. Spelled on this side; see `subtitleTrackSrc`. */
  torrentId: string;
  /**
   * The entry the viewer chose, or `null` for Off.
   *
   * ONE ENTRY, NOT A LIST, and that is the shape that forbids the second element rather than
   * a test forbidding it: "render one `<track>` per offerable entry with `default` on the
   * chosen one" cannot be written against this signature without changing it.
   */
  chosen: SubtitleTrack | null;
  /** `recovery.kind === 'reloading'`: a `video.load()` is about to run. */
  reloading: boolean;
  /** The element's own load failure. The cell says `unreadable`; nothing is retried. */
  onUnreadable: () => void;
}

export function SubtitleTrackElement({
  torrentId,
  chosen,
  reloading,
  onUnreadable,
}: SubtitleTrackElementProps) {
  // Four separate refusals rather than one conjunction, so each is its own line to delete.
  if (chosen === null) return null;
  // A failed track load is NEVER retried by the element, so the one load must not be spent
  // on the backend's 503: readiness is measured (the bytes are hash-verified complete AND
  // the file is present in the save path at its declared size) and this is the only gate
  // between a chosen sidecar and a load that can never be taken back.
  if (!chosen.ready) return null;
  // `.ass`/`.ssa` are listed and never converted (D17), so no amount of waiting makes one
  // servable. The route would answer 415 `unsupported-format` for it.
  if (!chosen.convertible) return null;
  if (reloading) return null;

  // TRUTHY, not `!== null`: HTML requires a NON-EMPTY `srclang` for `kind="subtitles"`, so a
  // blank code has to take the same arm as an absent one. A guessed `en` is a lie the viewer
  // cannot see, and `kind="captions"` with no `srclang` is the honest spelling for "the
  // backend resolved no language token".
  const lang = chosen.lang ? chosen.lang : null;

  return (
    <track
      key={chosen.index}
      default
      kind={lang === null ? 'captions' : 'subtitles'}
      srcLang={lang ?? undefined}
      label={chosen.label}
      // BUILT HERE FROM THE TORRENT'S OWN FILE INDEX, never from the row's `url` and never
      // from its position in the list. The wire field carries the same string today, which
      // is exactly why the fixture in the test gives it a different one: a list is filtered
      // and deduplicated, so a position-built URL loads another episode's sidecar, and a
      // `url`-built one makes a backend format string the television cannot validate into
      // the thing that decides which file a one-shot load spends itself on.
      src={subtitleTrackSrc(torrentId, chosen.index)}
      onErrorCapture={onUnreadable}
    />
  );
}
