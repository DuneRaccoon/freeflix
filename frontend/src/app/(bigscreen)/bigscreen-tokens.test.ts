/**
 * The TV palette is a COPY, so something has to pin it.
 *
 * public/bigscreen.css cannot import from the web stylesheet: it is hand-authored
 * plain CSS, linked directly so it never passes through PostCSS, and globals.css
 * declares its tokens inside Tailwind v4's @theme — an at-rule Chromium 87 throws
 * away along with everything in it. So the ten Editorial-Noir colours exist twice,
 * under two names (`--ink` on the TV, `--color-ink` on the web).
 *
 * Duplication with nothing pinning it drifts silently, and the drift is invisible
 * until somebody walks into the living room and looks at a television. This test
 * parses both files and compares the pairs. Same pattern as
 * backend/tests/test_video_mime_types.py: the coupling is real, so assert it.
 *
 * If a colour is deliberately different on TV, do not delete the pair — move it to
 * INTENTIONALLY_DIFFERENT with a reason.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** [TV custom property, web custom property] */
const TOKEN_PAIRS: Array<[string, string]> = [
  ['--ink', '--color-ink'],
  ['--surface', '--color-surface'],
  ['--surface-2', '--color-surface-2'],
  ['--text', '--color-text'],
  ['--muted', '--color-muted'],
  ['--hairline', '--color-hairline'],
  ['--gold', '--color-gold'],
  ['--gold-lite', '--color-gold-lite'],
  ['--danger', '--color-danger'],
  ['--success', '--color-success'],
];

/** Pairs that are meant to diverge. Empty today; add a reason if you add one. */
const INTENTIONALLY_DIFFERENT: Record<string, string> = {};

const TV_CSS = join(process.cwd(), 'public/bigscreen.css');
const WEB_CSS = join(process.cwd(), 'src/app/(web)/globals.css');

/**
 * First literal declaration of each custom property. Comments are stripped so a
 * commented-out value cannot win, and `var(...)` indirections are skipped so a
 * reference like `--rail-accent: var(--color-gold)` is never mistaken for a
 * definition of a colour.
 */
function declaredVars(path: string): Map<string, string> {
  const css = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Map<string, string>();
  const re = /(--[A-Za-z0-9-]+)\s*:\s*([^;{}]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const name = m[1];
    const value = m[2].trim();
    if (value.indexOf('var(') !== -1) continue;
    if (!out.has(name)) out.set(name, value);
  }
  return out;
}

describe('TV palette is pinned to the web palette', () => {
  const tv = declaredVars(TV_CSS);
  const web = declaredVars(WEB_CSS);

  it('declares every pinned token on both surfaces', () => {
    const missing: string[] = [];
    for (const [tvName, webName] of TOKEN_PAIRS) {
      if (!tv.has(tvName)) missing.push(`public/bigscreen.css: ${tvName}`);
      if (!web.has(webName)) missing.push(`globals.css: ${webName}`);
    }
    expect(missing).toEqual([]);
  });

  it('gives each pair the same value', () => {
    const drifted: string[] = [];
    for (const [tvName, webName] of TOKEN_PAIRS) {
      if (tvName in INTENTIONALLY_DIFFERENT) continue;
      const a = (tv.get(tvName) || '').toLowerCase();
      const b = (web.get(webName) || '').toLowerCase();
      if (a !== b) drifted.push(`${tvName}=${a} but ${webName}=${b}`);
    }
    expect(
      drifted,
      'the TV palette has drifted from the web palette; nobody sees this until ' +
        'they look at a television'
    ).toEqual([]);
  });

  it('pins all ten Editorial-Noir colours, not a subset', () => {
    // Guards against the other failure mode: quietly shrinking the pinned list
    // instead of fixing a drift.
    expect(TOKEN_PAIRS).toHaveLength(10);
  });
});
