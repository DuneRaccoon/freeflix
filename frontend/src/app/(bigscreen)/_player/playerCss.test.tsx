/**
 * `bigscreen.css`, as the player relies on it.
 *
 * WHY THIS FILE EXISTS: the TV stylesheet is `<link>`ed from `(bigscreen)/layout.tsx`, and
 * **jsdom computes nothing from a linked sheet**. So a class typo'd in the TSX — or a rule
 * renamed in the stylesheet — is invisible to every render test on this surface: the
 * element still renders, still focuses, still clicks, and on the television it has no
 * geometry at all. The two halves are checked here: every `bs-` class the player's
 * components actually render has a rule, and the four declarations the player's behaviour
 * depends on say what they must.
 *
 * Modelled on `bigscreen/profiles/page.test.tsx`'s own `bigscreen.css` block, which pins
 * `.bs-profiles`' `nowrap` for the same reason this pins `.bs-player__row`'s.
 *
 * It is one file rather than a block inside each component's test because the rules span
 * both components and the band they sit in, which the route (task 9) mounts.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FocusProps } from '../_focus/useFocusGrid';
import { TransportBar } from './TransportBar';
import { ScrubBar } from './ScrubBar';

const css = readFileSync(join(process.cwd(), 'public/bigscreen.css'), 'utf8');

/** The declarations of a single-selector rule, exactly as `profiles/page.test.tsx` reads them. */
const rule = (selector: string): string => {
  const escaped = selector.replace(/[.\-]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  expect(m, `${selector} has a rule`).not.toBeNull();
  return m![1];
};

const hasRule = (selector: string): boolean => {
  const escaped = selector.replace(/[.\-]/g, '\\$&');
  return new RegExp(`(?:^|[\\n,])\\s*${escaped}\\s*[,{:]`).test(css);
};

const fp = (): ((row: number, col: number) => FocusProps) => () => ({
  tabIndex: -1,
  ref: () => {},
  onFocus: () => {},
});

describe('bigscreen.css, as the player relies on it', () => {
  it('.bs-player__row does not wrap: one focus row is one visual line', () => {
    // `.bs-controls` (the diag harness's row) is `flex-wrap: wrap` and must NOT be borrowed:
    // a focus row drawn on two visual lines is what the search block forbids — Right lands
    // on a control on the next line and Down skips a line.
    const body = rule('.bs-player__row');
    expect(body).toMatch(/flex-wrap:\s*nowrap/);
    expect(body).not.toMatch(/flex-wrap:\s*wrap/);
    // And the thing it must not have become: .bs-controls, unchanged.
    expect(rule('.bs-controls')).toMatch(/flex-wrap:\s*wrap/);
  });

  it('.bs-player__video is the picture, and it is full-bleed behind everything else', () => {
    // THE ONE CLASS THE CATCH-ALL BELOW CANNOT SEE, because that row renders the two
    // components and the route's band is not a component it can mount (a page file may not
    // export one). Renaming it in the route to `bs-player__vidoe` left `test:tv` at 55/1319
    // and `tsc` clean — while on the television the film loses `position: absolute`,
    // `inset: 0`, `z-index: -1` and `object-fit: contain` and becomes an in-flow child of a
    // `justify-content: flex-end` column: the picture at its intrinsic size, above the band,
    // not behind it. The render side of this pin is in the route's own suite, which has the
    // element in hand (`plays the file the URL named`).
    const body = rule('.bs-player__video');
    expect.soft(body).toMatch(/position:\s*absolute/);
    expect.soft(body).toMatch(/inset:\s*0/);
    expect.soft(body).toMatch(/z-index:\s*-1/);
    // contain, never cover: a TV release is not the panel's aspect ratio and cropping the
    // frame is not this surface's call to make.
    expect.soft(body).toMatch(/object-fit:\s*contain/);
    expect.soft(body).not.toMatch(/object-fit:\s*cover/);
  });

  it('every class the route mounts on the band has a rule, not only the two components', () => {
    // Same reason: the catch-all row renders ScrubBar and TransportBar. These are the names
    // the ROUTE writes, listed once here so a rule renamed in the stylesheet is caught.
    const missing = [
      '.bs-player',
      '.bs-player__video',
      '.bs-player__scrim',
      '.bs-player__bar',
      '.bs-player__bar--hidden',
      '.bs-player__hint',
    ].filter((name) => !hasRule(name));
    expect(missing, `no rule for ${missing.join(', ')}`).toEqual([]);
  });

  it('.bs-player isolates, so its own focus ring is not painted over', () => {
    // Absolutely positioned children paint OVER their parent's outline. That already cost
    // this stylesheet its one full-bleed focus stop (`.bs-hero`, found by rendering at
    // 1920x1080), and the player has two such children: the video and the scrim.
    expect(rule('.bs-player')).toMatch(/isolation:\s*isolate/);
  });

  it('.bs-player__bar--hidden sets opacity and NOTHING else', () => {
    // Hazard 4, and §8.3's ban. `display:none`, `visibility:hidden`, `inert` and unmounting
    // all BLUR the focused control, and with the grid's counts unchanged its reconcile
    // effect never re-runs — so focus is on <body> permanently, on a surface with no Tab
    // key. `pointer-events: none` while a descendant has focus is banned outright by §8.3.
    const body = rule('.bs-player__bar--hidden');
    expect.soft(body).toMatch(/opacity:\s*0/);
    expect.soft(body).not.toMatch(/display:\s*none/);
    expect.soft(body).not.toMatch(/visibility/);
    expect.soft(body).not.toMatch(/pointer-events/);
  });

  it('.bs-player__scrub declares no transform', () => {
    // A full-bleed control cannot scale: the hero rule rejects it for the same reason (at
    // 1728px wide the scaled box crosses the safe inset and shows the page behind it). No
    // `transition: transform` either, which is why this is a bare /transform/ assertion.
    expect.soft(rule('.bs-player__scrub')).not.toMatch(/transform/);
    expect.soft(rule('.bs-player__scrub:focus')).not.toMatch(/transform/);
    // ...and it is still a ≥60px focus target with the house ring (spec §8.5).
    expect.soft(rule('.bs-player__scrub')).toMatch(/min-height:\s*60px/);
    expect.soft(rule('.bs-player__scrub:focus')).toMatch(/outline-offset:\s*2px/);
  });

  it('scopes the scrim to the band, not to the viewport', () => {
    // Fill rate over a decoding 1080p surface is the budget: a full-viewport gradient layer
    // is composited over every frame of video for the whole film.
    const body = rule('.bs-player__scrim');
    expect.soft(body).toMatch(/height:\s*\d+px/);
    expect.soft(body).not.toMatch(/inset:\s*0/);
    expect.soft(body).not.toMatch(/top:\s*0/);
  });

  it('reserves the hint line’s height without the double inset .bs-msg would bring', () => {
    // `.bs-msg` carries `padding: 0 var(--safe-x)` itself, and the band already carries the
    // safe inset, so a `.bs-msg` inside the band would sit 192px from each edge. The hint
    // keeps `.bs-msg`'s actual load-bearing property — a reserved min-height, so a line
    // appearing does not nudge the control the ring is sitting on — and not its padding.
    expect.soft(rule('.bs-msg')).toMatch(/padding:\s*0\s+var\(--safe-x\)/);
    expect.soft(rule('.bs-player__bar')).toMatch(/padding:\s*var\(--safe-y\)\s+var\(--safe-x\)/);
    const hint = rule('.bs-player__hint');
    expect.soft(hint).toMatch(/min-height/);
    expect.soft(hint).not.toMatch(/var\(--safe-x\)/);
  });

  it('leaves .bs-video and .bs-page alone', () => {
    // 1280px: the diag page's video harness depends on it. And `.bs-page` is
    // `overflow-y: auto`, while the focus grid calls `scrollIntoView` on every move with no
    // opt-out — so a player built on it scrolls the film under the viewer.
    expect.soft(rule('.bs-video')).toMatch(/max-width:\s*1280px/);
    expect.soft(rule('.bs-page')).toMatch(/overflow-y:\s*auto/);
  });

  it('every bs- class the player renders has a rule in the stylesheet', () => {
    // The whole point of this file: without it, a typo'd class name renders a geometry-less
    // element that passes every other test on this surface.
    const { container } = render(
      <>
        <ScrubBar row={0} focusProps={fp()} position={10} duration={1000} contiguous={null} onSeek={() => {}} />
        <TransportBar row={1} focusProps={fp()} playing retry onAction={() => {}} />
      </>,
    );
    const used = new Set<string>();
    for (const el of container.querySelectorAll('*')) {
      for (const name of el.classList) if (name.startsWith('bs-')) used.add(name);
    }
    expect(used.size, 'the components render bs- classes at all').toBeGreaterThan(4);
    const missing = [...used].filter((name) => !hasRule(`.${name}`)).sort();
    expect(missing, `no rule for ${missing.join(', ')}`).toEqual([]);
  });

  it('hasRule is not vacuous', () => {
    // A matcher that answered true for everything would make the test above green forever.
    expect.soft(hasRule('.bs-player__row')).toBe(true);
    expect.soft(hasRule('.bs-btn--ghost')).toBe(true);
    expect.soft(hasRule('.bs-player__typo-that-does-not-exist')).toBe(false);
  });
});
