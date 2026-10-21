import type { ReactElement } from 'react';
import type { TransportCellId } from './TransportBar';

/**
 * The transport row's icons. Inline SVG paths, and nothing else.
 *
 * WHY THEY ARE DRAWN HERE RATHER THAN FETCHED, LINKED OR FONT-LOADED. Everything on this
 * surface that is not in the HTML is a request the television has to make and may not get:
 * `noCrossOrigin.test.ts` keeps `crossOrigin` off this surface entirely, no webfont is loaded
 * (`bigscreen.css`: "no next/font, no @font-face — both stacks name only faces the TV already
 * has"), and `@heroicons/react` lives under the web app's dependency tree, which
 * `legacy-target.test.ts` forbids this surface from reaching into. A `<path>` costs one shape
 * in the document and no round trip.
 *
 * NO `<text>` IN ANY GLYPH, and that is a hard rule rather than a style. The glyph sits inside
 * the `<button>` that `getByRole('button', { name: … })` finds all over this directory, and
 * SVG text IS text: `aria-hidden` keeps it out of the accessible NAME, but it would still land
 * in `textContent`, which `TransportBar.test.tsx` asserts is exactly the cell's label ("nothing
 * said, and nothing CLAIMED either"). So "Back 10s" is a replay arc with no 10 in it, and the
 * number lives in the label the cell reveals on focus.
 *
 * NO FILTER, NO BLUR, NO GRADIENT. `legacy-target.test.ts` bans `feTurbulence`,
 * `feGaussianBlur` and `filter="url(` by name on this surface: an SVG filter is rasterised off
 * the GPU fast path, per frame if anything animates over it, and these sit over a decoding
 * 1080p surface. Flat `currentColor` fills and strokes only, so the primary cell's gold circle
 * inverts its glyph to ink with no second asset.
 *
 * ±60s ARE THE REWIND AND FAST-FORWARD TWINS, so they wear ⏪ and ⏩ — the shapes on the
 * remote's own keys, which is what `MEDIA_TWINS` makes them structurally. Back 10s is the
 * replay ARC instead, so the two are not two pairs of chevrons that differ only in count.
 */

/** 24x24, so every path below is written in one coordinate space. */
const BOX = '0 0 24 24';

/** A filled shape: the solid transport glyphs (play, pause, stop, skip). */
function Filled({ d }: { d: string }): ReactElement {
  return (
    <svg viewBox={BOX} aria-hidden="true" focusable="false">
      <path d={d} fill="currentColor" />
    </svg>
  );
}

/** A stroked shape: the outlined glyphs (the arcs, the subtitle plate). */
function Stroked({ d }: { d: string }): ReactElement {
  return (
    <svg viewBox={BOX} aria-hidden="true" focusable="false">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const PLAY = <Filled d="M8 4.5L20 12L8 19.5z" />;
const PAUSE = <Filled d="M7.5 4.5h4v15h-4zM12.5 4.5h4v15h-4z" />;
const STOP = <Filled d="M5.5 5.5h13v13h-13z" />;
/** ⏭ — one triangle against a bar. Unmistakable beside ⏩, which is two triangles. */
const NEXT = <Filled d="M5 4.5L16 12L5 19.5zM17.5 4.5h3v15h-3z" />;
const REWIND = <Filled d="M21.5 5.5L13 12L21.5 18.5zM12 5.5L3.5 12L12 18.5z" />;
const FORWARD = <Filled d="M2.5 5.5L11 12L2.5 18.5zM12 5.5L20.5 12L12 18.5z" />;

/**
 * The replay arc: three quarters of a circle, opening at the top, with an arrowhead on the
 * end that points anticlockwise. "Try again" is the same arc the other way round, which is
 * the only pair here that could be confused — and they never carry the same meaning in the
 * same place (Retry is the gold primary cell and appears only after a failure).
 */
const BACK_ARC = <Stroked d="M12 4A8 8 0 1 0 20 12M15 1L12 4L15 7" />;
const RETRY_ARC = <Stroked d="M12 4A8 8 0 1 1 4 12M9 1L12 4L9 7" />;
/** The subtitle plate: a frame with two cue lines in its lower half. */
const SUBTITLES = <Stroked d="M3 5.5h18v13H3zM6.5 14.5h5M14.5 14.5h3" />;

/**
 * Which glyph a cell wears. A `Record` over the cell ids, so a cell added to
 * `TRANSPORT_CELLS` fails `tsc` here until it has been drawn — the same device
 * `MEDIA_TWINS` and `TWIN_CELL` use, and the reason a new control cannot ship as an empty
 * circle.
 *
 * `playPause` holds the PAUSE shape, because the row's resting label is `Pause`: the cell is
 * relabelled, never swapped (`TransportBar`'s header), and `glyphFor` applies the same rule
 * to the picture.
 */
const GLYPHS: Record<TransportCellId, ReactElement> = {
  playPause: PAUSE,
  back10: BACK_ARC,
  back60: REWIND,
  forward60: FORWARD,
  nextEpisode: NEXT,
  subtitles: SUBTITLES,
  stop: STOP,
  retry: RETRY_ARC,
};

/**
 * The glyph a cell shows right now. Only Play/Pause's depends on anything, exactly as
 * `labelFor` does — the two are the same decision about the same cell, so they are written
 * the same way and a reader can see that they agree.
 */
export function glyphFor(id: TransportCellId, state: { playing: boolean }): ReactElement {
  if (id === 'playPause') return state.playing ? PAUSE : PLAY;
  return GLYPHS[id];
}
