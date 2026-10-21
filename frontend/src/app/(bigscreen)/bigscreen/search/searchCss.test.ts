/**
 * The split's geometry, pinned where it can be checked.
 *
 * jsdom computes nothing from a linked stylesheet, so none of the search screen's tests can
 * see whether the layout it declares actually exists — a class typo'd in the page renders an
 * element that focuses and clicks and has no geometry at all on the television. This file is
 * the arithmetic and the drift, read out of the stylesheet as text, the way
 * `playerCss.test.tsx` and `bigscreen-tokens.test.ts` already do.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KEYBOARD_ROW_COUNTS } from '../../_components/Keyboard';
import { RESULT_COLUMNS } from '../../_data/searchPaging';

const css = readFileSync(join(process.cwd(), 'public/bigscreen.css'), 'utf8');
const page = readFileSync(
  join(process.cwd(), 'src/app/(bigscreen)/bigscreen/search/page.tsx'),
  'utf8',
);

/**
 * Every rule in the sheet, as {selector list, body}, with comments stripped first so a
 * `{` inside one cannot be mistaken for a rule.
 */
const RULES = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
  (m) => ({ selectors: m[1].split(',').map((x) => x.trim().replace(/\s+/g, ' ')), body: m[2] }),
);

/**
 * The body of the rule declaring `selector` — and there must be EXACTLY ONE.
 *
 * Reading the FIRST match is what let the split ship with its results row overridden: the
 * old full-width rail's `.bs-search__row` was still in the file BELOW the new grid one, so
 * the cascade used the old rule and the third card of every row hung off the screen, while
 * this file read the new one and passed. A duplicate selector is now the failure itself.
 */
function rule(selector: string): string {
  const hits = RULES.filter((r) => r.selectors.includes(selector));
  expect(hits.length, `rules declaring exactly "${selector}"`).toBe(1);
  return hits[0].body;
}

const px = (body: string, prop: string): number => {
  const m = new RegExp(`${prop}:\\s*(\\d+)px`).exec(body);
  expect(m, `${prop} in ${body}`).not.toBeNull();
  return Number(m![1]);
};

describe('the search screen is a two-column grid', () => {
  it('declares two columns, the first measured by its content', () => {
    // `max-content` rather than a number: the left column is exactly as wide as the
    // keyboard's widest row, and writing a px value here would be a second copy of an
    // arithmetic the key size already decides.
    const body = rule('.bs-search');
    expect(body).toMatch(/grid-template-columns:\s*max-content\s+1fr/);
    expect(body).toMatch(/display:\s*grid/);
  });

  it('draws RESULT_COLUMNS columns of results, which is the count the focus model is told', () => {
    // THE DRIFT THAT MATTERS. `rowCounts` says RESULT_COLUMNS cells per results row; a
    // stylesheet drawing four would put a card where the model has no cell, and the ring
    // would stop at the third.
    const body = rule('.bs-search__row');
    const m = /grid-template-columns:\s*repeat\((\d+),\s*1fr\)/.exec(body);
    expect(m, 'results row is a repeat() grid').not.toBeNull();
    expect(Number(m![1])).toBe(RESULT_COLUMNS);
    // ...and the page chunks by the same constant rather than by a literal.
    expect(page).toMatch(/chunk\(items,\s*RESULT_COLUMNS\)/);
  });

  it('fits both panes inside the safe area, by arithmetic', () => {
    // 1920 wide, less the 96px safe inset on each side, is 1728px. The left column is the
    // keyboard's widest row; the gap and the results take the rest. If this stops holding,
    // the right pane is off the screen on the television and nothing in jsdom would say so.
    const SAFE_WIDTH = 1920 - 2 * 96;
    const key = rule('.bs-search .bs-kb__key');
    const row = rule('.bs-search .bs-kb__row');
    const keyW = px(key, 'width');
    const keyGap = px(row, 'gap');
    const widest = Math.max(...KEYBOARD_ROW_COUNTS);
    const leftW = widest * keyW + (widest - 1) * keyGap;
    // `gap: 0 48px` — no row gap, and the column gap is the space between the panes.
    const gapMatch = /gap:\s*0\s+(\d+)px/.exec(rule('.bs-search'));
    expect(gapMatch, 'the grid declares a column gap').not.toBeNull();
    const gridGap = Number(gapMatch![1]);
    const rightW = SAFE_WIDTH - leftW - gridGap;
    expect(leftW).toBeLessThan(SAFE_WIDTH);
    // Enough room for the results to be worth having: three posters and their gaps.
    const resultGap = px(rule('.bs-search__row'), 'gap');
    const cardW = (rightW - (RESULT_COLUMNS - 1) * resultGap) / RESULT_COLUMNS;
    expect(rightW).toBeGreaterThan(400);
    expect(cardW).toBeGreaterThan(180);
  });

  it('keeps every key a focus target a remote can hit', () => {
    // The split shrank the keys to make room for a second column; 64px is the floor this
    // surface holds every control to.
    const key = rule('.bs-search .bs-kb__key');
    expect(px(key, 'width')).toBeGreaterThanOrEqual(64);
    expect(px(key, 'min-height')).toBeGreaterThanOrEqual(64);
  });

  it('lets the result cards size themselves to the column', () => {
    // The base rule is a fixed 240x360. The right column's width is whatever the keyboard
    // leaves, so a fixed card would either overflow it or leave a gutter, and a fixed art
    // height would distort the poster.
    expect(rule('.bs-search__row .bs-card--poster')).toMatch(/width:\s*auto/);
    const art = rule('.bs-search__row .bs-card--poster .bs-card__art');
    expect(art).toMatch(/height:\s*auto/);
    expect(art).toMatch(/aspect-ratio:\s*2\s*\/\s*3/);
  });

  it('cancels the safe inset its children carry, and applies it once itself', () => {
    // `.bs-kb`, `.bs-search__field` and `.bs-search__actions` are shared with the
    // single-column screens and pad themselves by `--safe-x`. Inside the grid that would be
    // a 96px gutter in the middle of the screen.
    expect(rule('.bs-search')).toMatch(/padding:\s*0 var\(--safe-x\)/);
    expect(rule('.bs-search .bs-kb')).toMatch(/padding:\s*\d+px 0/);
    expect(rule('.bs-search .bs-search__field')).toMatch(/margin:\s*\d+px 0/);
    expect(rule('.bs-search .bs-search__actions')).toMatch(/padding:\s*\d+px 0 0/);
  });

  it('stacks the recent searches, because the right pane is a column', () => {
    const body = rule('.bs-search .bs-search__recents');
    expect(body).toMatch(/flex-direction:\s*column/);
  });

  it('has a rule for every bs- class the page renders', () => {
    // A class typo'd in the page is an element with no geometry at all on the television,
    // and jsdom computes nothing from a linked sheet.
    const used = new Set<string>();
    for (const m of page.matchAll(/className="([^"]*)"/g)) {
      for (const name of m[1].split(/\s+/)) if (name.startsWith('bs-')) used.add(name);
    }
    expect(used.size).toBeGreaterThan(8);
    for (const name of used) {
      expect(css.includes(`.${name}`), `${name} has a rule`).toBe(true);
    }
  });
});
