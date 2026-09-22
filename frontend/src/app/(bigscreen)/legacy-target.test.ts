/**
 * The TV surface targets Chromium 87 (webOS TV 22). Tailwind v4's own output is
 * already disqualified there — it wraps everything in @layer, which Chromium 87
 * discards wholesale — so this guard exists to stop us reintroducing the same
 * class of problem by hand in the TV stylesheet or its components.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN_CSS = [
  '@layer',
  '@property',
  'oklch(',
  'oklab(',
  'color-mix(',
  ':has(',
  '@container',
  'backdrop-filter',
  'backdrop-blur',
  'mix-blend',
  'aspect-ratio',
];

const FORBIDDEN_JS = [
  '.at(',
  'Object.hasOwn',
  'structuredClone',
];

/** Comments legitimately name the banned constructs; only real code counts. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * A file may opt out by carrying this marker. Exactly one file does: the
 * diagnostics page, whose whole job is to probe for post-87 features by name via
 * CSS.supports() and typeof checks. Without the escape hatch the guard would fail
 * on the very page that tells us whether the guard is needed.
 */
const OPT_OUT = '@allow-legacy-probes';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const BIGSCREEN_DIR = join(process.cwd(), 'src/app/(bigscreen)');
const TV_STYLESHEET = join(process.cwd(), 'public/bigscreen.css');

describe('Chromium 87 target', () => {
  it('the TV stylesheet uses no post-87 CSS', () => {
    const css = stripCssComments(readFileSync(TV_STYLESHEET, 'utf8'));
    const found = FORBIDDEN_CSS.filter((f) => css.includes(f));
    expect(found, `public/bigscreen.css uses ${found.join(', ')}`).toEqual([]);
  });

  it('the TV components use no post-87 CSS or JS', () => {
    const offences: string[] = [];
    for (const file of walk(BIGSCREEN_DIR)) {
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
      const src = readFileSync(file, 'utf8');
      if (src.includes(OPT_OUT)) continue;
      for (const f of [...FORBIDDEN_CSS, ...FORBIDDEN_JS]) {
        if (src.includes(f)) offences.push(`${file}: ${f}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('does not import framer-motion or tailwind on the TV surface', () => {
    const offences: string[] = [];
    for (const file of walk(BIGSCREEN_DIR)) {
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
      const src = readFileSync(file, 'utf8');
      // No opt-out here: nothing on the TV surface may pull in Tailwind or framer-motion.
      if (src.includes('framer-motion')) offences.push(`${file}: framer-motion`);
      if (src.includes('globals.css')) offences.push(`${file}: globals.css`);
    }
    expect(offences).toEqual([]);
  });
});
