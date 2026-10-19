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

/**
 * A rule's declarations, whitespace-normalised, so a rule can be pinned to EXACTLY what it
 * says rather than to what it contains.
 *
 * Measured, and the reason this exists: `/opacity:\s*0/` — the obvious matcher, and the one
 * the `--hidden` rows were written with — is also true of `opacity: 0.01` and of
 * `opacity: 0.85`. The second is a band (or a scrim) that never actually goes away, which is
 * the whole defect the rule exists to prevent, invisible to its own test.
 *
 * COMMENTS ARE STRIPPED FIRST, and that is measured too rather than defensive: `rule()`
 * hands back the raw body, this stylesheet comments its declarations inline, and a `/* … *\/`
 * between two declarations made `decl` below return `null` for a property that was plainly
 * there (the scrim's own `transition`, found by this row failing).
 */
const noComments = (body: string): string => body.replace(/\/\*[\s\S]*?\*\//g, '');

const declarations = (body: string): string[] =>
  noComments(body)
    .split(';')
    .map((d) => d.trim().replace(/\s+/g, ' '))
    .filter((d) => d !== '');

/**
 * Every index in the stylesheet where `selector` begins a rule OF ITS OWN, in source order.
 *
 * `rule()` above reads the FIRST match and knows nothing about the cascade, so "the rule
 * exists and says `opacity: 0`" is not the same claim as "the declaration wins". Both ways of
 * breaking that were measured green against every row in this file and the route's: a second
 * copy of the modifier later in the sheet, and the modifier written BEFORE the rule it
 * modifies with an `opacity` of its own on the base. Source order is the part of the cascade
 * this file can see, so it is the part it checks.
 */
const ruleStarts = (selector: string): number[] => {
  const escaped = selector.replace(/[.\-]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{`, 'g'))].map((m) => m.index);
};

/** One declaration's value, whitespace-normalised, or `null` when the rule omits it. */
const decl = (body: string, prop: string): string | null => {
  const m = noComments(body).match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`));
  return m === null ? null : m[1].trim().replace(/\s+/g, ' ');
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
      '.bs-player__scrim--hidden',
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
    // `(?![.\d])` is not decoration: the bare `/opacity:\s*0/` this row shipped with is also
    // true of `opacity: 0.85` — a band that stays legible over the picture for the whole
    // film, which is this rule's own defect, passing its own test. Measured.
    expect.soft(body).toMatch(/opacity:\s*0(?![.\d])/);
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

  it('the scrim fades with the band: opacity only, on the band’s own curve', () => {
    // WHY THE SCRIM FADES AT ALL. `.bs-player__video` and `.bs-player__scrim` are both
    // `z-index: -1` with the scrim later in source order, and native text-track cues paint
    // inside the video element's box — so the scrim paints over every cue, and at ~0.82
    // alpha at 45% of its 480px there is no cue position inside that box which clears it.
    // The scrim's only job is to make the BAND legible; with the band hidden it has no job.
    //
    // ONE EXACT-EQUALITY ASSERTION, not the four matchers the `.bs-player__bar--hidden` row
    // above uses, and the difference is deliberate: it subsumes all three of that row's
    // `not.toMatch` rules (nothing else is in the rule at all) and it refuses `opacity: 0.85`
    // without needing the `(?![.\d])` anchor that row now carries. The band's reason for
    // opacity-only is hazard 4 — blurring
    // the focused control; the scrim holds no focus, so its reason is narrower and is the
    // fill rate: a 480px layer that disappears is a repaint where the point was a
    // composited fade.
    expect(declarations(rule('.bs-player__scrim--hidden'))).toEqual(['opacity: 0']);

    // THE VISIBLE STATE, which the pin above cannot see either: the base rule declares no
    // `opacity` at all, so the scrim is the initial 1 while the band is up and the modifier is
    // the only thing that ever fades it. Measured: `opacity: 0` added to the BASE rule — a
    // band with no legibility backing for the whole film, the exact inverse of what this task
    // is for, and the task's own "does not change the visible state's appearance" — left all
    // 83 rows of this file and the route's green.
    expect.soft(
      decl(rule('.bs-player__scrim'), 'opacity'),
      'the base rule declares no opacity of its own',
    ).toBeNull();

    // AND THAT THE MODIFIER WINS. See `ruleStarts`: a rule that exists and says the right
    // thing can still be dead. One copy, declared after the rule it modifies.
    const baseAt = ruleStarts('.bs-player__scrim');
    const modAt = ruleStarts('.bs-player__scrim--hidden');
    expect.soft(baseAt, 'one .bs-player__scrim rule').toHaveLength(1);
    expect.soft(modAt, 'one .bs-player__scrim--hidden rule').toHaveLength(1);
    expect
      .soft(modAt[0] > baseAt[0], 'the modifier is declared after the rule it modifies')
      .toBe(true);

    // ...and the fade itself, which the rule above cannot see: without a transition the
    // 480px gradient snaps on and off under the band it is fading with.
    const scrimT = decl(rule('.bs-player__scrim'), 'transition');
    expect.soft(scrimT, 'the scrim declares a transition').toBe(
      'opacity 180ms cubic-bezier(0.4, 0, 0.2, 1)',
    );
    // THE COUPLING, which the exact pin above cannot see and which is this assertion's own
    // job: the two layers move TOGETHER, so the band's curve changing underneath is a
    // gradient outliving the band it exists for. Mutating `.bs-player__bar`'s own
    // transition reddens this line and nothing else in the suite.
    expect.soft(scrimT, 'the same curve as the band’s').toBe(decl(rule('.bs-player__bar'), 'transition'));
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
