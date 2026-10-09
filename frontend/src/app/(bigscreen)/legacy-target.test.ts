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
  // React's inline-style spelling is camelCase (`style={{ backdropFilter: ... }}`), and
  // the `-webkit-` form is camelCased `Webkit...` with a capital. A kebab-case list
  // matched none of them — demonstrated by running the predicate. Inline styles are an
  // established idiom on this surface (Hero's `backgroundImage`, Card's `width`).
  'backdropFilter',
  'WebkitBackdropFilter',
  'mixBlendMode',
  'backgroundBlendMode',
  // The blunt catch-all. `style={{ filter: 'blur(6px)' }}` defeats 'filter: blur(' because
  // the quote sits between the colon and the value; any blur() is a GPU blur regardless of
  // which property carries it (`filter`, `backdrop-filter`, `-webkit-filter`).
  'blur(',
  'filter: blur(',
  'filter:blur(',
  'feTurbulence',
  'feGaussianBlur',
  'filter: url(',
  'filter:url(',
  'filter="url(',
];

/**
 * KNOWN LIMIT: this is a substring scan, so a name assembled at runtime
 * (`el.style.setProperty('backdrop' + '-filter', ...)`) is invisible to it. Not chased:
 * defeating that needs a real evaluator, and the guard's job is to stop the spellings an
 * author actually writes, not to resist deliberate evasion.
 */
function gpuOffences(src: string): string[] {
  // `blur(` is in the list to catch CSS (`filter: blur(`, `'blur(20px)'`), but the DOM method
  // `el.blur()` spells the same five characters. On a D-pad surface a `previous.blur()` during
  // a focus handover is ordinary code, not a GPU filter. A method call is `.blur(` with a
  // dot in front; no CSS function is ever written that way.
  const code = src.replace(/\.blur\s*\(/g, '.');
  return FORBIDDEN_CSS.filter((f) => code.includes(f));
}

/** Comments legitimately name the banned constructs; only real code counts. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Strip `//` and `/* *\/` comments from TS/TSX so the scan sees code only. The guard exists to
 * catch code; documentation that quotes a rule (`never filter: blur(20px) here`) is a good
 * thing, and a violation hidden in a comment does not render.
 *
 * A small scanner rather than a regex, because `//` also appears inside strings (`'http://x'`)
 * and a regex that stripped from there would delete real code, hiding a violation after it.
 * Quotes `'` and `"` end at a newline, which also contains JSX text (`<p>Can't</p>`, an
 * apostrophe that is not a string): the damage is one line, and in the safe direction (a
 * comment on that line gets scanned, never code skipped). Template literals span lines.
 * Not handled: regex literals and `${}` nesting; neither occurs in this surface.
 *
 * Only the GPU scan uses this. The OPT_OUT marker (it lives in a JSDoc block) and the
 * framer-motion / globals.css checks read the RAW source on purpose.
 */
function stripSourceComments(src: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\' && i + 1 < src.length) {
        out += n;
        i += 2;
        continue;
      }
      if (c === quote || (c === '\n' && quote !== '`')) quote = null;
      i++;
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      out += ' ';
    } else if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else {
      if (c === "'" || c === '"' || c === '`') quote = c;
      out += c;
      i++;
    }
  }
  return out;
}

/** What the TV-source GPU scan runs: comments removed, then the same predicate as the CSS. */
function tvGpuOffences(src: string): string[] {
  return gpuOffences(stripSourceComments(src));
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
const PUBLIC_DIR = join(process.cwd(), 'public');
const TV_STYLESHEET = join(PUBLIC_DIR, 'bigscreen.css');

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
 * An `@/`-form for a relative specifier that climbs out of `(bigscreen)`, or null when it
 * stays inside (those are TV-local files, which this surface owns) or resolves outside `src`.
 * `id` is the importing file's `(bigscreen)`-relative path.
 */
function relativeToAlias(id: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const fromDir = join(BIGSCREEN_DIR, id, '..');
  const target = join(fromDir, spec);
  if (target.startsWith(BIGSCREEN_DIR)) return null;
  if (!target.startsWith(SRC_DIR)) return null;
  return `@/${relative(SRC_DIR, target).split(sep).join('/')}`;
}

/**
 * Everything the TV surface may not import, in one predicate, so the direct and the
 * one-hop checks cannot drift apart again (the one-hop check used `escapesToComponents`
 * alone and so let `@/lib/x` -> `framer-motion` / `globals.css` through).
 * Specifier-based: depth-0 files are scanned as text, but a helper's comments or strings
 * naming `framer-motion` are not an import.
 */
function isBannedImport(spec: string): boolean {
  return escapesToComponents(spec) || spec.includes('framer-motion') || spec.includes('globals.css');
}

/**
 * The banned imports sitting one hop behind `spec`: what the module it names
 * imports that `escapesToComponents` rejects. The reader is injectable so the rule can be
 * exercised against modules that are not on disk.
 *
 * ONE HOP, ON PURPOSE. It catches the trap that exists (a TV file reaching for a `@/lib`
 * helper whose first import is a component) without turning a guard into a module
 * resolver: no graph, no cycle handling, no tsconfig. A longer chain is left to review; this
 * is for the one a future author is most likely to write.
 *
 * THE EDGE IT GUARDS IS LATENT, NOT LIVE — checked, because an earlier version of this
 * comment claimed otherwise. In both `@/lib/buildMixedRailsScreen` and
 * `@/lib/buildRailsScreen`, `RowConfig` is an interface used only in type positions, so the
 * binding is unused after type erasure and SWC drops the import: importing either module
 * does not put `PosterCard` or the Tailwind runtime in a TV bundle as things stand. The
 * guard still rejects them, deliberately. A type-only edge becomes a value edge in one
 * character — use `RowConfig` as a value, or add any second import — and nothing else here
 * would notice. Being conservative about an edge that cannot be seen is the point.
 *
 * And the elision itself is a setting, not a law: `tsconfig.json` has `isolatedModules`
 * without `verbatimModuleSyntax`, which is why the binding is dropped. Turning
 * `verbatimModuleSyntax` on — a routine modernisation someone will propose — would make
 * every one of these edges live with no change to any import anywhere.
 */
function componentImportsBehind(spec: string, read: (spec: string) => string | null = readAliased): string[] {
  const body = read(spec);
  return body === null ? [] : importSpecifiers(body).filter(isBannedImport);
}

/** hrefs of every `<link rel="stylesheet">` in a source file, whatever the attribute order. */
function linkedStylesheets(src: string): string[] {
  const out: string[] = [];
  for (const tag of src.match(/<link\b[^>]*>/g) ?? []) {
    if (!/rel\s*=\s*["']stylesheet["']/.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/.exec(tag);
    out.push(href ? href[1] : '(dynamic href)');
  }
  return out;
}

describe('TV performance budget (spec §9)', () => {
  it('the TV stylesheet uses no GPU-expensive CSS', () => {
    const css = stripCssComments(readFileSync(TV_STYLESHEET, 'utf8'));
    const found = gpuOffences(css);
    expect(found, `public/bigscreen.css uses ${found.join(', ')}`).toEqual([]);
  });

  // The hole an author actually falls into: a second stylesheet dropped in public/ and
  // linked beside the first. (A .css placed UNDER (bigscreen)/ is already scanned by the
  // components test below, since tvSourceFiles walks every non-test file there — but it
  // would be processed by PostCSS, itself what this surface's premise forbids, so
  // public/ is the place it goes.)
  it('every stylesheet in public/ uses no GPU-expensive CSS', () => {
    const offences: string[] = [];
    for (const file of walk(PUBLIC_DIR).filter((f) => f.endsWith('.css'))) {
      const found = gpuOffences(stripCssComments(readFileSync(file, 'utf8')));
      if (found.length) offences.push(`${relative(PUBLIC_DIR, file)}: ${found.join(', ')}`);
    }
    expect(offences).toEqual([]);
  });

  it('the layout links exactly one stylesheet, /bigscreen.css, and imports none', () => {
    const src = readFileSync(join(BIGSCREEN_DIR, 'layout.tsx'), 'utf8');
    expect(linkedStylesheets(src)).toEqual(['/bigscreen.css']);
    expect(importSpecifiers(src).filter((s) => /\.css$/.test(s))).toEqual([]);
  });

  it('linkedStylesheets sees every stylesheet link, in either attribute order', () => {
    expect(linkedStylesheets('<link rel="stylesheet" href="/a.css" />')).toEqual(['/a.css']);
    expect(linkedStylesheets('<link href="/b.css" rel="stylesheet"/>')).toEqual(['/b.css']);
    expect(linkedStylesheets('<link rel="stylesheet" href="/a.css" />\n<link rel="stylesheet" href="/b.css" />')).toEqual(['/a.css', '/b.css']);
    expect(linkedStylesheets('<link rel="icon" href="/x.ico" />')).toEqual([]);
  });

  it('flags every spelling of every banned GPU construct', () => {
    // One case per spelling, so the list cannot be narrowed back without a failure here.
    // Each runs the REAL gpuOffences. The runtime-concatenation evasion is documented on
    // gpuOffences as out of reach and is intentionally absent.
    const cases: Array<[string, string]> = [
      ['kebab backdrop-filter', '.x { backdrop-filter: blur(10px); }'],
      ['tailwind backdrop-blur', 'className="backdrop-blur-md"'],
      ['kebab -webkit-backdrop-filter', '.x { -webkit-backdrop-filter: saturate(2); }'],
      ['camel backdropFilter', "style={{ backdropFilter: 'saturate(2)' }}"],
      ['camel WebkitBackdropFilter', "style={{ WebkitBackdropFilter: 'saturate(2)' }}"],
      ['kebab mix-blend-mode', '.x { mix-blend-mode: overlay; }'],
      ['camel mixBlendMode', "style={{ mixBlendMode: 'overlay' }}"],
      ['kebab background-blend-mode', '.x { background-blend-mode: screen; }'],
      ['camel backgroundBlendMode', "style={{ backgroundBlendMode: 'screen' }}"],
      ['css filter: blur(', '.x { filter: blur(4px); }'],
      ['css filter:blur(', '.x{filter:blur(4px)}'],
      ['quoted inline filter blur', "style={{ filter: 'blur(20px)' }}"],
      ['bare blur( in -webkit-filter', '.x { -webkit-filter: blur(2px); }'],
      ['feTurbulence', '<feTurbulence baseFrequency="0.8" />'],
      ['feGaussianBlur', '<feGaussianBlur stdDeviation="4" />'],
      ['css filter: url(', '.x { filter: url(#f); }'],
      ['css filter:url(', '.x{filter:url(#f)}'],
      ['attribute filter="url(', '<rect filter="url(#f)" />'],
    ];
    for (const [name, src] of cases) {
      expect(gpuOffences(src), `${name} should be flagged: ${src}`).not.toEqual([]);
    }
    // Specific entries pinned individually, since a case above could be satisfied by a
    // different entry (the catch-all `blur(`) and so not prove the named one exists.
    for (const entry of ['backdropFilter', 'WebkitBackdropFilter', 'mixBlendMode', 'backgroundBlendMode', 'blur(']) {
      expect(FORBIDDEN_CSS, `${entry} must stay in the list`).toContain(entry);
    }
    expect(gpuOffences('.x { color: red; opacity: .5; }')).toEqual([]);
  });

  it('allows the DOM method el.blur(), which is not a CSS blur', () => {
    for (const src of ['el.blur();', 'previous?.blur()', 'document.activeElement.blur ()', 'a.b.blur(  )']) {
      expect(tvGpuOffences(src), src).toEqual([]);
    }
    // ...without opening a hole: the CSS spellings still fail beside it.
    expect(tvGpuOffences("el.blur(); const s = { filter: 'blur(20px)' };")).not.toEqual([]);
    expect(tvGpuOffences('.x { -webkit-filter: blur(2px); }')).not.toEqual([]);
  });

  it('does not count a banned construct that a comment merely quotes', () => {
    const quoted = [
      '/* never filter: blur(20px) here */',
      '// never filter: blur(20px) here',
      '/**\n * No backdrop-filter, no mix-blend-mode, no feTurbulence.\n */\nexport const a = 1;',
      'const a = 1; // not backdropFilter',
    ];
    for (const src of quoted) expect(tvGpuOffences(src), src).toEqual([]);
  });

  it('still fails real code, including code sharing a line or a string with comment syntax', () => {
    const real = [
      "<div style={{ filter: 'blur(20px)' }} />",
      "const s = { filter: 'blur(20px)' }; // trailing note",
      "/* note */ const s = { backdropFilter: 'x' };",
      "const u = 'http://x.test'; const s = { filter: 'blur(4px)' };",
      "const u = \"//\"; const s = { mixBlendMode: 'screen' };",
      'const t = `// not a comment ${1}`; const s = { filter: "blur(2px)" };',
    ];
    for (const src of real) expect(tvGpuOffences(src), src).not.toEqual([]);
    // A block comment that never closes swallows the rest rather than hanging.
    expect(tvGpuOffences('/* unterminated filter: blur(1px)')).toEqual([]);
  });

  it('the opt-out marker and the import checks still read raw source, comments included', () => {
    // The marker lives in a JSDoc block; stripping would make the diag page lose its exemption.
    const diag = tvSourceFiles().find(({ id }) => id === 'bigscreen/diag/page.tsx');
    expect(diag, 'diag page present').toBeDefined();
    expect(diag!.src.includes(OPT_OUT)).toBe(true);
    expect(stripSourceComments(diag!.src).includes(OPT_OUT)).toBe(false);
  });

  it('the TV components use no GPU-expensive CSS', () => {
    const offences: string[] = [];
    for (const { id, src } of tvSourceFiles()) {
      if (src.includes(OPT_OUT)) continue;
      for (const f of tvGpuOffences(src)) offences.push(`${id}: ${f}`);
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
        if (escapesToComponents(spec)) continue;
        // A relative specifier that climbs out of (bigscreen) reaches the same modules under
        // a different spelling, and neither check saw it: verified, `../../../lib/...` in a
        // TV file passed every test. Resolve it so one hop behind it is followed too.
        const aliased = spec.startsWith('@/') ? spec : relativeToAlias(id, spec);
        if (!aliased) continue;
        for (const nested of componentImportsBehind(aliased)) offences.push(`${id} -> ${spec} -> ${nested}`);
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

    // Pin the extension forms. Trimming this list leaves the guard green while quietly
    // ceasing to follow whole classes of module — verified: narrowing it to ['.ts'] alone
    // kept all of these tests passing before this assertion existed.
    expect(readAliased('@/types'), '/index.ts form').not.toBeNull();
    expect(readAliased('@/components/browse/BrowseScreen'), '.tsx form').not.toBeNull();
    expect(readAliased('@/services/movies'), '.ts form').not.toBeNull();
    expect(readAliased('@/lib/nothing-here-at-all')).toBeNull();

    // The real resolver must find real files: it follows at least one `@/` import the TV
    // surface actually makes.
    const followed = tvSourceFiles()
      .flatMap(({ src }) => importSpecifiers(src))
      .filter((spec) => spec.startsWith('@/') && readAliased(spec) !== null);
    expect(followed.length).toBeGreaterThan(0);
  });

  it('one-hop check applies the same rules as the direct one, not a narrower set', () => {
    // The direct rules ban web components, framer-motion and globals.css; the one-hop check
    // once filtered by components alone, so a TV file importing a helper that imported
    // framer-motion or globals.css passed everything. One case per rule.
    const fake: Record<string, string> = {
      '@/lib/motion': "import { motion } from 'framer-motion';",
      '@/lib/styles': "import '@/app/(web)/globals.css';",
      '@/lib/styles-rel': "import '../app/(web)/globals.css';",
      '@/lib/comp': "import { X } from '@/components/ui/Modal';",
      '@/lib/ok': "import { twMerge } from 'tailwind-merge';\n// mentions framer-motion in a comment only",
    };
    const read = (spec: string) => fake[spec] ?? null;
    expect(componentImportsBehind('@/lib/motion', read)).toEqual(['framer-motion']);
    expect(componentImportsBehind('@/lib/styles', read)).toEqual(['@/app/(web)/globals.css']);
    expect(componentImportsBehind('@/lib/styles-rel', read)).toEqual(['../app/(web)/globals.css']);
    expect(componentImportsBehind('@/lib/comp', read)).toEqual(['@/components/ui/Modal']);
    expect(componentImportsBehind('@/lib/ok', read)).toEqual([]);
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
