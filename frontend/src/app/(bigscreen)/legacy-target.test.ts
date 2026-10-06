/**
 * The TV surface targets Chromium 87 (webOS TV 22). Tailwind v4's own output is
 * already disqualified there — it wraps everything in @layer, which Chromium 87
 * discards wholesale — so this guard exists to stop us reintroducing the same
 * class of problem by hand in the TV stylesheet or its components.
 *
 * WHERE IT RUNS: this is an ordinary vitest file. It runs under `npm test`
 * (the whole suite) and `npm run test:tv` (this directory only). It does NOT run
 * during `next build`, and deliberately so — `next build` executes inside the
 * Docker image build, where an unrelated test failure must not be able to break
 * an image. Nothing in CI runs it today either; until something does, running
 * `npm run test:tv` before committing TV work is the enforcement.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

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
 * A file may opt out by carrying this marker. Exactly one file may: the
 * diagnostics page, whose whole job is to probe for post-87 features by name via
 * CSS.supports() and typeof checks. Without the escape hatch the guard would fail
 * on the very page that tells us whether the guard is needed. The test below pins
 * the opted-out SET, so the hatch cannot quietly spread.
 */
const OPT_OUT = '@allow-legacy-probes';

/** The only file allowed to carry OPT_OUT, as a path relative to (bigscreen). */
const OPT_OUT_ALLOWED = ['bigscreen/diag/page.tsx'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const BIGSCREEN_DIR = join(process.cwd(), 'src/app/(bigscreen)');
const TV_STYLESHEET = join(process.cwd(), 'public/bigscreen.css');

/** Every non-test source file on the TV surface, with its (bigscreen)-relative id. */
function tvSourceFiles(): Array<{ id: string; src: string }> {
  return walk(BIGSCREEN_DIR)
    .filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))
    .map((f) => ({
      id: relative(BIGSCREEN_DIR, f).split(sep).join('/'),
      src: readFileSync(f, 'utf8'),
    }));
}

/** Import/require specifiers, so the guard can reason about edges, not just text. */
function importSpecifiers(src: string): string[] {
  const out: string[] = [];
  const re = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

describe('Chromium 87 target', () => {
  it('the TV stylesheet uses no post-87 CSS', () => {
    const css = stripCssComments(readFileSync(TV_STYLESHEET, 'utf8'));
    const found = FORBIDDEN_CSS.filter((f) => css.includes(f));
    expect(found, `public/bigscreen.css uses ${found.join(', ')}`).toEqual([]);
  });

  it('the TV components use no post-87 CSS or JS', () => {
    const offences: string[] = [];
    for (const { id, src } of tvSourceFiles()) {
      if (src.includes(OPT_OUT)) continue;
      for (const f of [...FORBIDDEN_CSS, ...FORBIDDEN_JS]) {
        if (src.includes(f)) offences.push(`${id}: ${f}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('does not import framer-motion or tailwind on the TV surface', () => {
    const offences: string[] = [];
    for (const { id, src } of tvSourceFiles()) {
      // No opt-out here: nothing on the TV surface may pull in Tailwind or framer-motion.
      if (src.includes('framer-motion')) offences.push(`${id}: framer-motion`);
      if (src.includes('globals.css')) offences.push(`${id}: globals.css`);
    }
    expect(offences).toEqual([]);
  });

  it('does not import the web surface components', () => {
    // The two tests above are directory-scoped, so they only see what is written
    // HERE. One `import { Foo } from '@/components/...'` is enough to defeat them:
    // almost everything under components/ sits beneath a tree that ultimately
    // imports globals.css, so Tailwind would land on the TV with the guard still
    // green. Spec §4.1 requires every TV component to be rebuilt anyway — rails,
    // cards, the app shell and the player control surface are all pointer-first and
    // none of them is focusable by a remote.
    const offences: string[] = [];
    for (const { id, src } of tvSourceFiles()) {
      for (const spec of importSpecifiers(src)) {
        const escapesToComponents =
          spec.startsWith('@/components') ||
          (spec.includes('..') && spec.includes('components/'));
        if (escapesToComponents) offences.push(`${id}: ${spec}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('only the diagnostics page opts out of the legacy checks', () => {
    // @allow-legacy-probes is an unbounded escape hatch: any file carrying it is
    // exempt from every rule above. Pinning the set means adding a second one is a
    // deliberate, reviewed act rather than a comment someone copied.
    const optedOut = tvSourceFiles()
      .filter(({ src }) => src.includes(OPT_OUT))
      .map(({ id }) => id)
      .sort();
    expect(optedOut).toEqual(OPT_OUT_ALLOWED);
  });
});
