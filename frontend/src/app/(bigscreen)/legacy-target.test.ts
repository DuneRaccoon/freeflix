/**
 * The TV surface's guard.
 *
 * ENGINE FLOOR, REASSESSED. This file was written against **Chromium 87**
 * (webOS TV 22). That floor came from an inference, not a measurement: the set is
 * a 75-inch 2022 LG, no 75-inch 2022 LG OLED exists, so it had to be one of the
 * mainstream LCD lines that LG's "Re:New" upgrade programme skipped — therefore
 * webOS 22, therefore Chromium 87. The reasoning was sound; the conclusion was
 * wrong. Reading `navigator.userAgent` on the actual set (the diagnostics page at
 * `/bigscreen/diag`, in the TV's own browser) reported **Chromium 120 = webOS 25**:
 * the set is the one upgrade-eligible exception the spec itself named, a 75-inch
 * QNED99 8K. Every post-87 feature probe answered yes, `oklch()`, `color-mix()`,
 * `:has()`, container queries and `@property` included.
 *
 * So the bans that existed *only* because Chromium 87 cannot parse a construct are
 * gone — `@layer`, `@property`, `oklch()`, `oklab()`, `color-mix()`, `:has()`,
 * `@container`, native nesting, `aspect-ratio`, and the JS entries
 * `Array.prototype.at`, `Object.hasOwn`, `structuredClone`, top-level `await`.
 * Chromium 120 handles all of them.
 *
 * WHAT SURVIVES, AND WHY. The remaining bans were never about the engine. They are
 * about the **silicon**: a 2022 television's GPU and its fill rate, and keeping the
 * pointer-first web component tree off a 10-foot screen. A newer browser engine
 * does not make a TV GPU faster, so none of this is weakened by the reading above.
 * See FORBIDDEN_CSS and the import rules below for the per-rule rationale, and
 * spec §9 (`docs/superpowers/specs/2026-09-22-webos-tv-app-design.md`, "Performance
 * budget") for the authority: `CinematicAtmosphere` alone renders three
 * full-viewport layers including a 60vw `blur(20px)` on a 42s loop plus an
 * `feTurbulence` tile, and the web player stacks eight `backdrop-filter` layers and
 * a second `feTurbulence` over live video. That is the thing this guard keeps out.
 *
 * WHERE IT RUNS: this is an ordinary vitest file. It runs under `npm test`
 * (the whole suite) and `npm run test:tv` (this directory only). It does NOT run
 * during `next build`, and deliberately so — `next build` executes inside the
 * Docker image build, where an unrelated test failure must not be able to break
 * an image. Nothing in CI runs it today either; until something does, running
 * `npm run test:tv` before committing TV work is the enforcement.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * PERFORMANCE-DRIVEN BANS — TV GPU, not browser engine.
 *
 * Every entry here is forbidden because the 2022 TV panel's compositor cannot
 * afford it at 1920x1080 across a full viewport, not because Chromium cannot parse
 * it. Chromium 120 parses all of it happily; the television still drops frames.
 * Authority: spec §9. Do not delete an entry because "the engine supports it now" —
 * that was never the reason it was here.
 *
 * - `backdrop-filter` / `backdrop-blur`: a per-frame readback and blur of whatever
 *   is behind the element. The web player stacks eight of these over live video.
 *   On TV silicon, over a decoding 1080p surface, that is the single most expensive
 *   thing the web app does.
 * - `mix-blend` (`mix-blend-mode`, `background-blend-mode`): forces the element out
 *   of the fast compositing path and makes its whole stacking context blend on the
 *   CPU-ish path. `CinematicAtmosphere` uses it to composite an `feTurbulence` tile.
 * - `filter: blur(` and friends: full-viewport blurs are the §9 line item ("60vw
 *   radial glow with `filter: blur(20px)` on a 42s loop"). Scrims and gradients
 *   achieve the same look for free.
 * - SVG filters (`feTurbulence`, `feGaussianBlur`, `filter="url(`, `filter: url(`):
 *   rasterised off the GPU fast path, per frame if anything animates over them.
 */
const FORBIDDEN_CSS = [
  'backdrop-filter',
  'backdrop-blur',
  'mix-blend',
  'background-blend',
  'filter: blur(',
  'filter:blur(',
  'feTurbulence',
  'feGaussianBlur',
  'filter: url(',
  'filter:url(',
  'filter="url(',
];

/** Comments legitimately name the banned constructs; only real code counts. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * A file may opt out by carrying this marker. Exactly one file may: the
 * diagnostics page, whose whole job is to probe for expensive and post-87 features
 * by name via CSS.supports() and typeof checks. Without the escape hatch the guard
 * would fail on the very page that told us the engine floor was wrong. The test
 * below pins the opted-out SET, so the hatch cannot quietly spread.
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

/**
 * Does this import specifier escape to the web surface's components?
 *
 * Matches a path SEGMENT, not a substring. `spec.includes('components/')` also matched
 * this surface's own `../_components/Rail`, because `_components/` contains
 * `components/` — a false positive that pushed a TV-local import into an absolute
 * `@/app/(bigscreen)/...` spelling to get around the guard. A guard that punishes the
 * idiom it protects teaches people to route around it.
 */
function escapesToComponents(spec: string): boolean {
  return (
    spec.startsWith('@/components/') ||
    spec === '@/components' ||
    (spec.includes('..') && /(^|\/)components\//.test(spec))
  );
}

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

const SRC_DIR = join(process.cwd(), 'src');

/**
 * Source of the module an `@/`-rooted specifier names, or null when it names nothing on
 * disk here (a package, or a path this does not model).
 */
function readAliased(spec: string): string | null {
  if (!spec.startsWith('@/')) return null;
  const rel = spec.slice(2);
  for (const tail of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const file = join(SRC_DIR, rel + tail);
    if (existsSync(file)) return readFileSync(file, 'utf8');
  }
  return null;
}

/**
 * The web-component imports sitting one hop behind `spec`: what the module it names
 * imports that `escapesToComponents` rejects. The reader is injectable so the rule can be
 * exercised against modules that are not on disk.
 *
 * ONE HOP, ON PURPOSE. It catches the trap that exists (a TV file reaching for a `@/lib`
 * helper whose first import is a component) without turning a guard into a module
 * resolver: no graph, no cycle handling, no tsconfig. A longer chain is left to review; this
 * is for the one a future author is most likely to write.
 */
function componentImportsBehind(spec: string, read: (spec: string) => string | null = readAliased): string[] {
  const body = read(spec);
  return body === null ? [] : importSpecifiers(body).filter(escapesToComponents);
}

describe('TV performance budget (spec §9)', () => {
  it('the TV stylesheet uses no GPU-expensive CSS', () => {
    const css = stripCssComments(readFileSync(TV_STYLESHEET, 'utf8'));
    const found = FORBIDDEN_CSS.filter((f) => css.includes(f));
    expect(found, `public/bigscreen.css uses ${found.join(', ')}`).toEqual([]);
  });

  it('the TV components use no GPU-expensive CSS', () => {
    const offences: string[] = [];
    for (const { id, src } of tvSourceFiles()) {
      if (src.includes(OPT_OUT)) continue;
      for (const f of FORBIDDEN_CSS) {
        if (src.includes(f)) offences.push(`${id}: ${f}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('does not import framer-motion or tailwind on the TV surface', () => {
    // No opt-out here, and this one is not about the engine either: framer-motion
    // animates layout properties off the main thread's good intentions, and
    // globals.css would drag the whole web design system — blur stacks, hover
    // states, the atmosphere layer — onto TV silicon. Chromium 120 *would* render
    // Tailwind v4 now; that is not a reason to let it onto the television.
    const offences: string[] = [];
    for (const { id, src } of tvSourceFiles()) {
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
        if (escapesToComponents(spec)) offences.push(`${id}: ${spec}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('judges web-component imports by path segment, not by substring', () => {
    // Exercises the SAME `escapesToComponents` the rule above calls, deliberately: an
    // earlier version of this test redeclared the predicate locally, so loosening the
    // real guard left the test green — a test that could not fail.
    for (const spec of ['@/components', '@/components/browse/BrowseScreen', '../../components/ui/Modal', '../components/Card']) {
      expect(escapesToComponents(spec), `${spec} should be rejected`).toBe(true);
    }
    for (const spec of ['./Card', '../_components/Rail', '../_focus/useFocusGrid', '@/services/movies', '@/lib/contentId', 'next/link']) {
      expect(escapesToComponents(spec), `${spec} should be allowed`).toBe(false);
    }
  });

  it('does not reach the web components through an intermediate module', () => {
    // The import test above only sees specifiers written INSIDE (bigscreen). A TV file may
    // import @/lib/foo, and @/lib/foo may import @/components/... — which lands PosterCard and
    // the Tailwind runtime in the TV bundle with the guard still green. Both
    // @/lib/buildMixedRailsScreen and @/lib/buildRailsScreen do exactly this (they import
    // RowConfig from the browse screen). Test files are not scanned (tvSourceFiles drops
    // them), which is why _data/railsDrift.test.ts may import the first one to pin a copy.
    const offences: string[] = [];
    for (const { id, src } of tvSourceFiles()) {
      for (const spec of importSpecifiers(src)) {
        // A direct component import is the previous test's finding; do not report it twice.
        if (!spec.startsWith('@/') || escapesToComponents(spec)) continue;
        for (const nested of componentImportsBehind(spec)) offences.push(`${id} -> ${spec} -> ${nested}`);
      }
    }
    expect(offences, offences.join('; ')).toEqual([]);
  });

  it('can see through an intermediate module, and is not vacuous', () => {
    // Without this the check above passes whenever it resolves nothing (a wrong SRC_DIR, an
    // alias that stops matching) — a guard that can only ever be green.
    const fake: Record<string, string> = {
      '@/lib/leaky': "import { Row } from '@/components/browse/BrowseScreen';\nexport const a = 1;",
      '@/lib/leaky-relative': "import { Row } from '../components/ui/Modal';",
      '@/lib/clean': "import { x } from '@/services/movies';\nimport y from './sibling';",
    };
    const read = (spec: string) => fake[spec] ?? null;
    expect(componentImportsBehind('@/lib/leaky', read)).toEqual(['@/components/browse/BrowseScreen']);
    expect(componentImportsBehind('@/lib/leaky-relative', read)).toEqual(['../components/ui/Modal']);
    expect(componentImportsBehind('@/lib/clean', read)).toEqual([]);
    expect(componentImportsBehind('@/lib/not-there', read)).toEqual([]);

    // The real resolver must find real files: it follows at least one `@/` import the TV
    // surface actually makes.
    const followed = tvSourceFiles()
      .flatMap(({ src }) => importSpecifiers(src))
      .filter((spec) => spec.startsWith('@/') && readAliased(spec) !== null);
    expect(followed.length).toBeGreaterThan(0);
  });

  it('only the diagnostics page opts out of the checks', () => {
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
