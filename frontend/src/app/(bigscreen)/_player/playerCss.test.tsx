/**
 * `bigscreen.css`, as the player relies on it.
 *
 * WHY THIS FILE EXISTS: the TV stylesheet is `<link>`ed from `(bigscreen)/layout.tsx`, and
 * **jsdom computes nothing from a linked sheet**. So a class typo'd in the TSX — or a rule
 * renamed in the stylesheet — is invisible to every render test on this surface: the
 * element still renders, still focuses, still clicks, and on the television it has no
 * geometry at all. The two halves are checked here: every `bs-` class the player's
 * components actually render has a rule, and the declarations the player's behaviour depends
 * on say what they must. (It read "the four declarations" until stage 9. The number was wrong
 * by then, and no command could ever have checked it, so it is gone rather than corrected —
 * the rule this file now applies to the stylesheet's comments, applied to its own.)
 *
 * AND ONE MORE THING, ADDED BY STAGE 9: what the stylesheet's own COMMENTS claim. That block
 * opens with an inventory of the band — which component renders which class, in what order —
 * and the inventory went stale the moment the subtitle picker added a third `.bs-player__hint`
 * and a second kind of row without anyone editing it. Prose goes stale silently, so the two
 * inventory rows at the bottom of this file read the SOURCES and compare them with what the
 * block says. One row reads the ROUTE's source on its own — the scrim's `aria-hidden`, which
 * no component here renders — for the same reason the rest of the file reads the sheet's text
 * rather than a computed style: there is no other instrument. The render-time pin for that one
 * belongs in the route's own suite, which is not this file's to edit.
 *
 * Modelled on `bigscreen/profiles/page.test.tsx`'s own `bigscreen.css` block, which pins
 * `.bs-profiles`' `nowrap` for the same reason this pins `.bs-player__row`'s.
 *
 * It is one file rather than a block inside each component's test because the rules span
 * both components and the band they sit in, which the route (task 9) mounts.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import type { ReactElement } from 'react';
import type { FocusProps } from '../_focus/useFocusGrid';
import { SUBTITLE_CELL_STATES, cellLabel } from '../_data/subtitles';
import { TransportBar, type SubtitleCellView } from './TransportBar';
import { ScrubBar } from './ScrubBar';

const css = readFileSync(join(process.cwd(), 'public/bigscreen.css'), 'utf8');
const BIGSCREEN = join(process.cwd(), 'src/app/(bigscreen)');
const ROUTE = join(BIGSCREEN, 'bigscreen/watch/[id]/page.tsx');

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

/**
 * `linear-gradient(<direction>, <stop>, ...)` split into its parts, or `null` when the value
 * is not a gradient at all.
 *
 * It counts parens rather than calling `.split(',')`, and that is measured rather than tidy:
 * the scrim's middle stop is an `rgba()` carrying three commas of its own, so a naive split
 * reports five stops for a three-stop gradient — and a row whose expected list was written
 * from the same naive reader would agree with it.
 */
const gradient = (value: string | null): { direction: string; stops: string[] } | null => {
  const m = value === null ? null : /^linear-gradient\((.*)\)$/.exec(value);
  if (m === null) return null;
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < m[1].length; i++) {
    const c = m[1][i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(m[1].slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(m[1].slice(start).trim());
  return { direction: parts[0], stops: parts.slice(1) };
};

/**
 * Every JSX opening tag in `src`, from its `<` to the `>` that closes it.
 *
 * The brace depth is not decoration either: `onClick={() => f()}` puts a `>` inside a prop,
 * so a regex that stopped at the first `>` would cut the tag in half and an attribute written
 * after that prop would read as absent.
 *
 * NAMED LIMIT, measured rather than claimed: comments are NOT stripped, so a tag written
 * inside one counts as a tag. That covers both the `//` between two props which this directory
 * writes, and a `<p className="..." />` quoted in prose: putting the second into `recovery.ts`
 * reddens both inventory rows at the bottom of this file. It is the CONSERVATIVE direction —
 * it over-reports a renderer, and the failure names the file — which is the safe way round for
 * a guard whose whole job is to notice that prose has gone stale. Stripping `//` is what is
 * refused: a `https://` in a string would take the rest of its line, `className` included.
 */
const openingTags = (src: string): string[] => {
  const tags: string[] = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '<' || !/[A-Za-z]/.test(src[i + 1] ?? '')) continue;
    let depth = 0;
    for (let j = i + 1; j < src.length; j++) {
      const c = src[j];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) {
        tags.push(src.slice(i, j + 1));
        i = j;
        break;
      }
    }
  }
  return tags;
};

/**
 * The opening tags whose `className` names `cls` — ELEMENT-SCOPED, which is the whole value:
 * a file-wide `/aria-hidden/` is true of a file where the attribute sits on the wrong node.
 * Both quoted and braced spellings, because this surface writes both.
 */
const tagsWithClass = (cls: string, src: string): string[] =>
  openingTags(src).filter((t) =>
    new RegExp(`className=(?:"[^"]*\\b${cls}\\b|\\{[^}]*\\b${cls}\\b)`).test(t),
  );

/** Every non-test source under `(bigscreen)`, by path relative to it. `engineContract`'s idiom. */
const tvSources = (dir = BIGSCREEN): Array<{ id: string; src: string }> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return tvSources(p);
    if (!/\.tsx?$/.test(e.name) || /\.test\.tsx?$/.test(e.name)) return [];
    return [{ id: relative(BIGSCREEN, p), src: readFileSync(p, 'utf8') }];
  });

/** The files that RENDER `cls`, never the ones whose prose mentions it. */
const renderersOf = (cls: string, dir?: string): string[] =>
  tvSources(dir)
    .filter((f) => tagsWithClass(cls, f.src).length > 0)
    .map((f) => f.id)
    .sort();

/** The player block's own inventory comment, which the last two rows keep honest. */
const playerBlock = (): string => {
  const at = css.indexOf('/* Rendered by _player/');
  expect(at, 'the player block opens with its inventory').toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('*/', at));
};

const fp = (): ((row: number, col: number) => FocusProps) => () => ({
  tabIndex: -1,
  ref: () => {},
  onFocus: () => {},
});

/**
 * A Subtitles-cell view. WHICH state it carries is deliberately not this file's business —
 * the rows below are about the CLASS the sub-line wears, not the word in it — so it takes a
 * state off the list and reads that state's own label instead of naming either.
 */
const subtitlesView = (): SubtitleCellView => ({
  stateId: SUBTITLE_CELL_STATES[0],
  note: cellLabel(SUBTITLE_CELL_STATES[0]),
});

/** The `bs-` class names a tree actually renders, sorted. */
const classesOf = (node: ReactElement): string[] => {
  const { container } = render(node);
  const used = new Set<string>();
  for (const el of container.querySelectorAll('*')) {
    for (const name of el.classList) if (name.startsWith('bs-')) used.add(name);
  }
  return [...used].sort();
};

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
    // 480px EXACTLY, not `/height:\s*\d+px/`, which is the matcher this row shipped with and
    // is green at `height: 1px`. Three comments do arithmetic on this number — the next row's,
    // the stylesheet's own `~334px` bullet, and the route's — so it is the one height any of
    // them can be read against.
    expect.soft(decl(body, 'height'), 'the scrim is 480px of band, not a viewport').toBe('480px');
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

  it('the scrim is a GRADUATED wash, never a black band across the bottom 480px', () => {
    // MEASURED GREEN BEFORE THIS ROW EXISTED, at this branch tip and not quoted from anywhere:
    // flattening `background` to a flat opaque `var(--ink)` left `npm run test:tv` at
    // 1526/1526 passed, 62 files. With this row it is 1533 passed, 1 failed, and the one is
    // here. What is on the screen under that mutation is a hard black band over the bottom
    // fifth of every frame of the film,
    // for the ~5 s the band is up after each press — and THREE comments do arithmetic on the
    // stops it no longer has ("~0.82 alpha at 45% of 480px": the fade row above, the
    // stylesheet's own scrim comment, and the route's suite). The scrim's OPACITY is pinned
    // twice over. Its shape was not pinned at all, which is the half the viewer looks at.
    const g = gradient(decl(rule('.bs-player__scrim'), 'background'));
    expect(g, 'the scrim is a gradient, not a flat colour').not.toBeNull();
    // Upwards, away from the band: `to bottom` with these stops is opaque at the TOP, i.e.
    // the wash over the picture and the clear part over the controls.
    expect.soft(g!.direction, 'it fades upwards, away from the band').toBe('to top');
    // The stops the arithmetic is done on: opaque where the band sits, ~0.82 at 45%, and fully
    // TRANSPARENT at 100% — the last is what keeps the top ~146px off the picture entirely.
    expect.soft(g!.stops).toEqual([
      'var(--ink) 0%',
      'rgba(10, 10, 11, 0.82) 45%',
      'rgba(10, 10, 11, 0) 100%',
    ]);
  });

  it('the gradient reader is not vacuous', () => {
    // A reader that returned a shape for everything would make the row above green forever,
    // and one that split on every comma would agree with a wrong expectation written from it.
    expect.soft(gradient('var(--ink)'), 'a flat colour is not a gradient').toBeNull();
    expect.soft(gradient(null), 'and a missing declaration is not one either').toBeNull();
    expect.soft(gradient('linear-gradient(to top, #000 0%, #fff 100%)')).toEqual({
      direction: 'to top',
      stops: ['#000 0%', '#fff 100%'],
    });
    expect
      .soft(
        gradient('linear-gradient(to top, rgba(1, 2, 3, 0.5) 45%, #fff 100%)')?.stops,
        'the commas inside rgba() are not stop separators',
      )
      .toEqual(['rgba(1, 2, 3, 0.5) 45%', '#fff 100%']);
  });

  it('the scrim is aria-hidden: it is a wash, and the band it backs is the content', () => {
    // MEASURED GREEN BEFORE THIS ROW EXISTED, re-measured here rather than inherited: dropping
    // `aria-hidden="true"` from the scrim left `npm run test:tv` at 1526/1526 passed, 62 files
    // (the plan recorded 1391 when task 10 ran, which is that date's suite, not this one). With
    // this row it is 1533 passed, 1 failed. The scrim holds no focus, has no text and is never
    // queried, so nothing behavioural on this surface can see it — and an announced 480px
    // decorative <div> over the picture is one edit away. The stylesheet's COMBINING note
    // makes the claim ("a wash, not content"); this is the only thing that checks it.
    //
    // IT READS THE ROUTE'S SOURCE rather than rendering: the scrim is a page file's own
    // markup, a page may not export the band, and the render-time pin belongs in the route's
    // suite, which this round's task does not own. Source text is the instrument the file that
    // owns the claim actually has.
    const tags = tagsWithClass('bs-player__scrim', readFileSync(ROUTE, 'utf8'));
    expect(tags, 'exactly one element writes the scrim class').toHaveLength(1);
    expect.soft(tags[0], 'and it is hidden from the accessibility tree').toMatch(
      /aria-hidden=(?:"true"|\{true\})/,
    );
  });

  it('the opening-tag reader is element-scoped, and a `>` inside a prop does not end a tag', () => {
    const src = [
      '<div className="wash" aria-hidden="true" />',
      '<div className={on ? "band" : "band band--hidden"}>',
      '<p className="plain">x</p>',
    ].join('\n');
    expect.soft(tagsWithClass('band', src), 'the braced spelling is found too').toHaveLength(1);
    // THE NEGATIVE CONTROL, and it is the point: a file-wide `/aria-hidden/` is true of this
    // fixture, so the row above would pass with the attribute on the WRONG element.
    expect.soft(tagsWithClass('band', src)[0]).not.toMatch(/aria-hidden/);
    expect.soft(tagsWithClass('wash', src)[0]).toMatch(/aria-hidden/);
    expect.soft(tagsWithClass('nope', src), 'and it is not true of everything').toEqual([]);
    // And the brace depth: the arrow's `>` sits inside a prop, so the tag runs past it.
    expect
      .soft(tagsWithClass('c', '<div className="c" onClick={() => f()} aria-hidden="true" />')[0])
      .toMatch(/aria-hidden/);
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
    //
    // THE `subtitles` VIEW IS NOT OPTIONAL HERE. Without it the Subtitles cell renders no
    // sub-line, so nothing this row sees comes from the cell's own state — see the next row
    // for what that did and did not cost.
    const used = classesOf(
      <>
        <ScrubBar row={0} focusProps={fp()} position={10} duration={1000} contiguous={null} onSeek={() => {}} />
        <TransportBar row={1} focusProps={fp()} playing retry subtitles={subtitlesView()} onAction={() => {}} />
      </>,
    );
    expect(used.length, 'the components render bs- classes at all').toBeGreaterThan(4);
    const missing = used.filter((name) => !hasRule(`.${name}`)).sort();
    expect(missing, `no rule for ${missing.join(', ')}`).toEqual([]);
  });

  it('the Subtitles cell’s sub-line is covered on the cell’s OWN render', () => {
    // THE FINDING, AND IT IS NOT THE ONE THE BRIEF PREDICTED. The row above was written with
    // no `subtitles` view, so the sub-line never appeared in it — but renaming
    // `.bs-player__commit`'s rule in the stylesheet reddened that row anyway. MEASURED, with
    // no view passed: `missing` came back as `["bs-player__commit"]`. The witness is
    // `<ScrubBar>`, which renders the same class (`ScrubBar.tsx:172`) because the fixture
    // above hands it `duration={1000}`.
    //
    // So the gap was never a class without a rule. It is that the ONLY witness is a sibling
    // component that returns `null` unless the duration is finite (`ScrubBar.tsx:62`, and the
    // early return above the markup) — and a finite duration has never been reported for an
    // in-progress stream on this television, which is why `scrubRowCount` can be 0 and why
    // D13 says the transport row is usually the only row. In that state, the state the SET is
    // actually in, the catch-all saw the cell's sub-line through nothing at all.
    const withView = classesOf(
      <TransportBar row={0} focusProps={fp()} playing subtitles={subtitlesView()} onAction={() => {}} />,
    );
    const without = classesOf(<TransportBar row={0} focusProps={fp()} playing onAction={() => {}} />);
    // POSITIVE AND NEGATIVE CONTROL: the view is what puts the class there, so neither the
    // claim below nor this row is green on an empty set, and an unconditionally-rendered
    // sub-line — which would make "no state yet" and a state indistinguishable in the DOM —
    // reddens the second of them.
    expect.soft(withView, 'the view renders the sub-line').toContain('bs-player__commit');
    expect.soft(without, 'and nothing renders it without one').not.toContain('bs-player__commit');
    const missing = withView.filter((name) => !hasRule(`.${name}`)).sort();
    expect(missing, `no rule for ${missing.join(', ')}`).toEqual([]);
  });

  // =================================================================================
  // The transport controls (`.bs-tp*`)
  // =================================================================================

  it('the transport row’s cells have a rule each, including the modifier', () => {
    const missing = ['.bs-tp', '.bs-tp--primary', '.bs-tp__glyph', '.bs-tp__label'].filter(
      (name) => !hasRule(name),
    );
    expect(missing, `no rule for ${missing.join(', ')}`).toEqual([]);
  });

  it('the ring moved to the circle, and BOTH halves of that are present', () => {
    // THE ONE PLACE THIS SURFACE DRAWS THE RING ON A CHILD. The button is 88px wide and
    // ~146px tall (circle, gap, caption), so a ring on IT would be a tall rectangle around a
    // round control. `.bs-tp:focus` therefore suppresses its own outline and the glyph
    // carries the house ring. Either half alone is a defect: the first on its own is a
    // control with NO ring at all on a surface where the ring is the whole navigation model,
    // and the second on its own is two rings.
    expect.soft(decl(rule('.bs-tp:focus'), 'outline'), 'the button suppresses its own').toBe('none');
    const glyph = rule('.bs-tp:focus .bs-tp__glyph');
    expect.soft(glyph, 'and the circle carries one').toMatch(/outline:\s*var\(--focus-ring\)\s*solid/);
    expect.soft(glyph, 'offset outside the circle').toMatch(/outline-offset:\s*4px/);
  });

  it('the cell’s NAME is hidden by opacity, never by display or visibility', () => {
    // The label element IS the button's accessible name (the glyph is `aria-hidden` and
    // carries no text by design). `display: none` and `visibility: hidden` both take a node
    // out of the accessibility tree, so either one would delete the name of every control in
    // the row — and with it every `getByRole('button', { name })` in this directory and
    // anything that reads the screen aloud. Same shape of rule as
    // `.bs-player__bar--hidden`'s, for a different reason.
    const resting = rule('.bs-tp__label');
    expect.soft(resting).toMatch(/opacity:\s*0(?![.\d])/);
    expect.soft(resting).not.toMatch(/display:\s*none/);
    expect.soft(resting).not.toMatch(/visibility/);
    // ...and focus brings it back, which is the half that makes it a reveal and not a
    // permanently invisible label.
    expect.soft(decl(rule('.bs-tp:focus .bs-tp__label'), 'opacity')).toBe('1');
  });

  it('the label and the state share one line, and neither reaches into the next cell', () => {
    // ONE LINE: both are absolutely positioned at the foot of the cell, so the row's height
    // does not depend on which cells have something to say — two reserved lines would cost
    // 34px of band over the picture for every frame the band is up.
    // AS WIDE AS THE CELL: `left: 0; right: 0` is what stops a caption ("none in this
    // release" is the longest) from overlapping the caption of the cell beside it. A
    // `max-content` width would.
    const caption = rule('.bs-tp__label, .bs-tp .bs-player__commit');
    expect.soft(decl(caption, 'position')).toBe('absolute');
    expect.soft(decl(caption, 'left')).toBe('0');
    expect.soft(decl(caption, 'right')).toBe('0');
    expect.soft(decl(caption, 'bottom')).toBe('0');
    expect.soft(caption, 'clipped rather than allowed to grow the cell').toMatch(/-webkit-line-clamp:\s*2/);
    // And focusing a cell swaps the two, so they are never drawn on top of each other.
    expect.soft(decl(rule('.bs-tp:focus .bs-player__commit'), 'opacity')).toBe('0');
  });

  it('the row still fits the safe area, and this time the arithmetic is checkable', () => {
    // The player block's own comment used to record the row's width as UNKNOWN, because the
    // cells were pills sized to their prose. They are fixed-width circles now, so: eight
    // cells (six base, plus Next episode and Try again) at the declared width, with
    // `.bs-player__row`'s own gap, against the 1728px the safe area leaves.
    const width = Number(/width:\s*(\d+)px/.exec(rule('.bs-tp'))?.[1]);
    const gap = Number(/gap:\s*(\d+)px/.exec(rule('.bs-player__row'))?.[1]);
    expect.soft(width, 'the cell declares a fixed width').toBeGreaterThan(0);
    expect.soft(gap, 'the row declares a gap').toBeGreaterThan(0);
    const cells = 8;
    expect.soft(cells * width + (cells - 1) * gap).toBeLessThanOrEqual(1920 - 2 * 96);
    // ...and the circle is a focus target well above the §8.5 floor of 60px.
    expect.soft(Number(/height:\s*(\d+)px/.exec(rule('.bs-tp__glyph'))?.[1])).toBeGreaterThanOrEqual(60);
  });

  it('the band still fits inside the scrim it is lit by', () => {
    // The transport row got taller (a circle, a gap and a caption line instead of a 60px
    // pill), and the scrim is pinned at 480px by the row above. The closed band is the safe
    // inset twice, a reserved hint line, the scrub row, this row, and the gaps between them.
    const scrim = Number(/(\d+)px/.exec(decl(rule('.bs-player__scrim'), 'height') ?? '')?.[1]);
    const cell = Number(/min-height:\s*(\d+)px/.exec(rule('.bs-tp'))?.[1]);
    const scrub = Number(/min-height:\s*(\d+)px/.exec(rule('.bs-player__scrub'))?.[1]);
    const gap = Number(/gap:\s*(\d+)px/.exec(rule('.bs-player__bar'))?.[1]);
    const safeY = 54;
    // Two hint lines (the stream's and the scrub cell's) at 24px x 1.45, rounded up.
    const hints = 2 * 35;
    const band = 2 * safeY + hints + scrub + cell + 3 * gap;
    expect.soft(cell, 'the cell declares a min-height').toBeGreaterThan(0);
    expect.soft(band, `the closed band is ~${band}px`).toBeLessThanOrEqual(scrim);
  });

  it('hasRule is not vacuous', () => {
    // A matcher that answered true for everything would make the test above green forever.
    expect.soft(hasRule('.bs-player__row')).toBe(true);
    expect.soft(hasRule('.bs-btn--ghost')).toBe(true);
    expect.soft(hasRule('.bs-player__typo-that-does-not-exist')).toBe(false);
  });

  it('the block’s inventory names every _player component that renders a band class', () => {
    // THE DEFECT THIS ROW IS BUILT FROM, and it would have reddened on it: the inventory's
    // first line read "Rendered by _player/TransportBar and _player/ScrubBar" for the whole of
    // stage 9, while `SubtitlePicker` rendered a third `.bs-player__hint` and a second kind of
    // row into the same band. D16 made updating exactly this class of comment a requirement
    // "or it becomes a lie", and nothing could tell that it had become one.
    //
    // A SET, not a count: a hand-maintained total reddens on arithmetic, this reddens on the
    // file, and the failure names which component is missing from the prose.
    const components = tvSources(join(BIGSCREEN, '_player'))
      .filter((f) => /className=(?:"[^"]*bs-player__|\{[^}]*bs-player__)/.test(f.src))
      .map((f) => basename(f.id, '.tsx'))
      .sort();
    expect(components.length, 'some _player component renders a band class').toBeGreaterThan(1);
    const block = playerBlock();
    const unnamed = components.filter((c) => !block.includes(c));
    expect(unnamed, `the inventory does not name ${unnamed.join(', ')}`).toEqual([]);
  });

  it('three components render a hint line, which is what the inventory now says', () => {
    // The other half of the same staleness: the block said "TWO hint lines, not one" and went
    // on to reassure that the line "only exists while there is something to say, which is also
    // when the auto-hide is suppressed". That is true of the route's line and FALSE of the
    // picker's, which is rendered unconditionally and whose auto-hide is held off by
    // `!pickerOpen` in `mayHide` instead — a different guard, on a different flag.
    //
    // A fourth renderer reddens this row, and the repair is to edit the inventory above the
    // rules, which is the thing that did not happen last time. The route is in the list, which
    // is why this scans all of `(bigscreen)` and not just `_player`.
    expect(renderersOf('bs-player__hint')).toEqual([
      '_player/ScrubBar.tsx',
      '_player/SubtitlePicker.tsx',
      'bigscreen/watch/[id]/page.tsx',
    ]);
  });

  it('the two --hidden modifiers are the only modifiers in the player block', () => {
    // The COMBINING note's "except TWO modifiers driven by the SAME flag" had no instrument.
    // A third `.bs-player__*--*` is a visual state of the band that something has to toggle,
    // on a surface where the band's states are counted by hand in two places; the controls in
    // this block wear `.bs-btn` unchanged precisely so that there is nothing else to toggle.
    const modifiers = [...new Set(noComments(css).match(/\.bs-player[\w-]*--[\w-]+/g) ?? [])].sort();
    expect(modifiers).toEqual(['.bs-player__bar--hidden', '.bs-player__scrim--hidden']);
  });
});
