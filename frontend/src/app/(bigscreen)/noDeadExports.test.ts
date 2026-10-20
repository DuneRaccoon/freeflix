/**
 * NOTHING THIS SURFACE EXPORTS IS TESTED, REVIEWED AND NEVER CALLED.
 *
 * THE DEFECT THIS EXISTS FOR, AND IT SHIPPED. Stage 9's main path — press an entry, ask the
 * box for its bytes, report the wait — was built in four tasks and wired in none. `pollSubtitles`
 * (`_data/subtitles.ts`) and `streamingService.fetchSubtitle` (`../../../services/streaming.ts`)
 * reached `0e16737` with ZERO production callers. Every unit was correct and every unit had an
 * adversarial, mutation-driven review that passed it; sixteen reviews in a row missed this,
 * because a task review's blast-radius check asks "did this task touch anything it did not
 * name," and the defect was a thing NO task touched. Every review was scoped to a diff and the
 * defect was the absence of one. A sidecar sits at file priority 0 in every release, so
 * `ready: false` is the normal FIRST answer for every sidecar the lister reports — the cell said
 * "Chosen, admitted, and the bytes are not here yet" of an admission that never happened, and
 * kept saying it for the rest of the film.
 *
 * WHY TWO DETECTORS, MEASURED AND NOT ASSUMED. `pollSubtitles` is a module-level export.
 * `fetchSubtitle` is a PROPERTY OF AN EXPORTED OBJECT LITERAL (`export const streamingService =
 * { … }`), so no scan of `export` declarations can see it at all. Run against the tree at
 * `0e16737`, `deadModuleExports` reports `pollSubtitles` and `deadServiceMembers` reports
 * `fetchSubtitle`; run against this tree, neither reports either, because `60eab3a` wired them.
 * Either detector alone would have called half of C7 healthy. That measurement is this file's
 * real positive control — the synthetic ones below only prove the machinery, not that it catches
 * the thing it was written for.
 *
 * WHY THE SERVICE SCAN LEAVES THE ROUTE GROUP. C7's other half lived in `src/services/`, two
 * directories outside `(bigscreen)`. A guard that stopped at the group boundary — the boundary
 * every other guard here respects — would have shipped the same stage with the same dead wire.
 *
 * WHY COMMENTS ARE STRIPPED, AND IT IS THE WHOLE TRICK. At `0e16737`,
 * `grep -rn 'pollSubtitles' src/ | grep -v '.test.'` returns a hit in the watch route, which
 * reads as wired. It is a COMMENT — prose about the function, in the file that was supposed to
 * call it. A comments-only hit is indistinguishable from a real one in a count, and counting is
 * what a reviewer under time pressure does. Three of the stage's exports scored a non-test hit
 * that way.
 *
 * WHY A MOCK FACTORY IS THE OTHER HALF OF THE DISGUISE. Each of the five service members
 * allowlisted below appears exactly TWICE in the whole frontend: its own declaration, and a
 * `vi.fn()` in a mock factory. A faithful factory must list every member of the object it
 * stands in for or `tsc` rejects the mock, so a method nothing calls stays mocked, typed and
 * green forever — and a hand-grep for its name finds two files and moves on. Test files are
 * therefore not evidence of life here, which is the one rule that makes this guard different
 * from reading an import graph.
 *
 * WHERE IT LIVES. Inside `src/app/(bigscreen)/`, because `npm run test:tv` is
 * `vitest run 'src/app/(bigscreen)'` — a DIRECTORY GLOB — so a guard one directory up would be
 * silently absent from the only suite the TV surface has while still passing under the full
 * `npx vitest run`. Neither suite runs in `next build` or in CI.
 *
 * KNOWN LIMITS, all in the over-reporting direction on purpose: a guard that cries wolf costs
 * an allowlist line a human reads, and one that stays quiet costs a dead feature on a
 * television with no console.
 *  - A symbol reached only through a computed key (`svc[name]()`) reads as dead. None exists
 *    here; the allowlist is where one would be declared.
 *  - `deadServiceMembers` sees two-space-indented keys of a top-level `export const X = { … };`
 *    in `src/services/`. A service written as a class, or nested deeper, is not scanned.
 *  - A default export is exempt only in a Next.js route file, where the framework is the caller.
 *  - A same-named property on an unrelated object counts as a reference, so a dead member can
 *    hide behind a namesake. Both the strict rule used here and a looser whole-word one were
 *    measured against this tree and against `0e16737`: identical answers, 72 members scanned.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep, basename } from 'node:path';

/**
 * The tree to scan. Overridable so the header's central claim can be RE-RUN rather than
 * believed — extract any commit's sources and point this at them:
 *
 *   git archive 0e16737 frontend/src | tar -x -C /tmp/c7 \
 *     && DEAD_EXPORT_ROOT=/tmp/c7/frontend/src \
 *        npx vitest run 'src/app/(bigscreen)/noDeadExports.test.ts'
 *
 * At `0e16737` that run FAILS, naming `pollSubtitles` and `streamingService.fetchSubtitle` —
 * the two halves of C7, one a module export and one an object property. At `60eab3a` and after
 * it passes. The override cannot be used to neuter the guard: the vacuity arm below asserts a
 * minimum file count and the presence of named files, so an empty or wrong root is a failure,
 * not a green run.
 */
const SRC_DIR = process.env.DEAD_EXPORT_ROOT
  ? resolve(process.env.DEAD_EXPORT_ROOT)
  : join(process.cwd(), 'src');
const BIGSCREEN_DIR = join(SRC_DIR, 'app/(bigscreen)');
const SERVICES_DIR = join(SRC_DIR, 'services');

/** A scanned file: `id` is its `src/`-relative path, `src` its text with comments removed. */
interface SourceFile {
  id: string;
  src: string;
  isTest: boolean;
}

/**
 * Comments removed, quote-aware. Copied from `noCrossOrigin.test.ts`, which copied the compact
 * form from `legacy-target.test.ts` — three copies rather than a shared helper because a
 * `_test-utils` module under this directory glob would itself be a source file these scans then
 * have to special-case, and because each guard's limits are stated beside the guard that has
 * them.
 *
 * Inherited limits: a single- or double-quoted string is ended by a newline too (which is also
 * how JSX text and an apostrophe are handled), and regex literals and nested `${}` are not
 * modelled. Both errors are in the safe direction — a comment gets scanned, never code skipped.
 */
function stripComments(src: string): string {
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

/**
 * `declare module '…' { … }` blocks removed, brace-matched.
 *
 * WHY. An ambient augmentation's `export interface` is not an export of the enclosing file —
 * it merges into somebody else's type, and its consumer is the COMPILER, so no name reference
 * to it exists anywhere by design. `services/api-client.ts` augments axios's
 * `AxiosRequestConfig` to add `__allow401`, the flag every subtitle call passes; the field is
 * read in the interceptor and the type is reached through `import type … from 'axios'`, never
 * through api-client. Scanned naively it is the one symbol on this tree that looks dead and is
 * load-bearing — found by this guard's first full run, and fixed here rather than allowlisted,
 * because an allowlist entry would have recorded a detector bug as a property of the code.
 */
function stripAmbientModules(src: string): string {
  let out = '';
  let i = 0;
  const open = /declare\s+(?:global|module\s*['"][^'"]*['"])\s*\{/g;
  for (;;) {
    open.lastIndex = i;
    const m = open.exec(src);
    if (!m) return out + src.slice(i);
    out += src.slice(i, m.index);
    let depth = 1;
    let j = m.index + m[0].length;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    i = j;
  }
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const isTestPath = (f: string) => f.endsWith('.test.ts') || f.endsWith('.test.tsx');

function read(dir: string): SourceFile[] {
  return walk(dir)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .map((f) => ({
      id: relative(SRC_DIR, f).split(sep).join('/'),
      src: stripAmbientModules(stripComments(readFileSync(f, 'utf8'))),
      isTest: isTestPath(f),
    }));
}

/** The files a Next.js route group hands to the framework, where the framework is the caller. */
const ROUTE_FILES = new Set([
  'page.tsx', 'layout.tsx', 'not-found.tsx', 'loading.tsx',
  'error.tsx', 'template.tsx', 'route.ts', 'route.tsx',
]);

const word = (name: string) => new RegExp(`(?<![\\w$])${name}(?![\\w$])`, 'g');
const count = (src: string, re: RegExp) => src.match(re)?.length ?? 0;

const EXPORT_DECL = [
  /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+class\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+enum\s+([A-Za-z_$][\w$]*)/g,
];

/**
 * The names a file exports, each with the number of times that name occurs inside the
 * declaration itself — which is what has to be discounted before an occurrence count can mean
 * "something here uses it".
 *
 * `export { formatTime as formatResumeTime }` introduces `formatResumeTime` only: the local
 * name on the left is a reference to something else in scope, not an export of this module.
 */
function exportedNames(src: string): Map<string, number> {
  const out = new Map<string, number>();
  const bump = (n: string) => out.set(n, (out.get(n) ?? 0) + 1);
  for (const re of EXPORT_DECL) {
    for (const m of src.matchAll(re)) bump(m[1]);
  }
  for (const m of src.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const raw of m[1].split(',')) {
      const part = raw.trim();
      if (!part) continue;
      const [local, alias] = part.split(/\s+as\s+/).map((x) => x.trim());
      const outward = alias ?? local;
      if (!/^[A-Za-z_$][\w$]*$/.test(outward)) continue;
      bump(outward);
      // An aliased re-export spends one occurrence on the local name too, which is a
      // reference to the import above and must not be credited to the outward name.
      if (alias && outward === local) bump(outward);
    }
  }
  return out;
}

export interface DeadSymbol {
  name: string;
  file: string;
}

/**
 * Every symbol declared in `declIn` that has neither a use inside its own module nor a
 * reference from any non-test file anywhere in `src/`.
 *
 * THE TWO SCOPES ARE DIFFERENT ON PURPOSE. Declarations are scanned narrowly — the TV surface
 * and the services — while references are counted across the WHOLE source tree. Scanning
 * references narrowly instead reported 51 dead symbols on this repository, every one of them a
 * web-app service that `src/components/` calls: a guard that answers "unused by the files I
 * bothered to read" is worse than none, because its first green run teaches everyone to widen
 * the allowlist.
 *
 * "A use inside its own module" counts as alive on purpose: an export whose module consumes it
 * is a visibility choice, not a dead feature, and `SUBTITLE_CELL_STATES` is the case that
 * matters — the runtime array is iterated only by tests, but `SubtitleCellState` is
 * `(typeof SUBTITLE_CELL_STATES)[number]` in the same file, so deleting the array breaks the
 * type every caller uses. A hand-grep for a production caller reported it dead; it is not.
 */
export function deadModuleExports(declIn: SourceFile[], refFiles: SourceFile[] = declIn): DeadSymbol[] {
  const prod = refFiles.filter((x) => !x.isTest);
  const dead: DeadSymbol[] = [];
  for (const file of declIn.filter((x) => !x.isTest)) {
    for (const [name, declCount] of exportedNames(file.src)) {
      const internal = count(file.src, word(name)) - declCount;
      if (internal > 0) continue;
      const external = prod
        .filter((o) => o.id !== file.id)
        .reduce((acc, o) => acc + count(o.src, word(name)), 0);
      if (external === 0) dead.push({ name, file: file.id });
    }
  }
  return dead;
}

/**
 * Every default export outside a Next.js route file that no non-test file imports.
 *
 * Separate from the named scan because a default export's local name at the import site is
 * arbitrary, so the only honest signal is "does any production file import this module at all".
 */
export function deadDefaultExports(declIn: SourceFile[], refFiles: SourceFile[] = declIn): DeadSymbol[] {
  const prod = refFiles.filter((x) => !x.isTest);
  const dead: DeadSymbol[] = [];
  for (const file of declIn.filter((x) => !x.isTest)) {
    if (!/\bexport\s+default\b/.test(file.src)) continue;
    if (ROUTE_FILES.has(basename(file.id))) continue;
    const moduleName = basename(file.id).replace(/\.tsx?$/, '');
    const importsIt = prod.some(
      (o) =>
        o.id !== file.id &&
        new RegExp(`import\\s+[A-Za-z_$][\\w$]*[^;]*from\\s+['"][^'"]*${moduleName}['"]`).test(o.src),
    );
    if (!importsIt) dead.push({ name: '<default>', file: file.id });
  }
  return dead;
}

/**
 * Every two-space-indented key of a top-level `export const X = { … };` in `src/services/`
 * that no non-test file reaches by `.name`, `['name']`, or a destructure of that name.
 *
 * Test files are deliberately not evidence: see the mock-factory note in the header.
 */
export function deadServiceMembers(declIn: SourceFile[], refFiles: SourceFile[] = declIn): DeadSymbol[] {
  const prod = refFiles.filter((x) => !x.isTest);
  const dead: DeadSymbol[] = [];
  for (const file of declIn.filter((x) => !x.isTest && x.id.startsWith('services/'))) {
    // `[\s\S]` rather than `.` with the `s` flag: this repository's `tsc` target predates
      // es2018 and rejects the flag (TS1501), while esbuild accepts it — so the version that
      // only ran under vitest typechecked nowhere.
      for (const obj of file.src.matchAll(/export const (\w+)\s*=\s*\{([\s\S]*?)\n\};/g)) {
      const [, objName, body] = obj;
      for (const pm of body.matchAll(/^ {2}(\w+)\s*:/gm)) {
        const prop = pm[1];
        const refs = prod.reduce(
          (acc, o) =>
            acc +
            count(o.src, new RegExp(`\\.${prop}(?![\\w$])`, 'g')) +
            count(o.src, new RegExp(`\\[\\s*['"]${prop}['"]\\s*\\]`, 'g')) +
            count(o.src, new RegExp(`\\{[^{}\\n]*(?<![\\w$])${prop}(?![\\w$])[^{}\\n]*\\}\\s*=`, 'g')),
          0,
        );
        if (refs === 0) dead.push({ name: `${objName}.${prop}`, file: file.id });
      }
    }
  }
  return dead;
}

/**
 * DECLARED TEST-ONLY SYMBOLS. Not "ignore these" — "these are known to have no production
 * caller, and here is why that is the intended shape." Every entry is asserted below to STILL
 * be dead, so an entry that acquires a caller fails this file until it is removed: a stale
 * allowlist line is the exact rot this branch keeps finding, and an allowlist nobody prunes is
 * a second place for a dead symbol to hide.
 */
const DECLARED_TEST_ONLY: Record<string, string> = {
  'TWIN_CELL': // _player/TransportBar.tsx
    'A Record<TransportAction, TransportCellId> production never reads: the watch route\'s '
    + '`act` switch handles each action directly, and the single `playPause` cell in '
    + '`TRANSPORT_CELLS` is what actually makes ▶/⏸/toggle one control. Its value is `tsc` '
    + 'exhaustiveness (a seventh action cannot be added without declaring its cell) plus '
    + '`TransportBar.test.tsx`\'s twin walk. Changing an entry reddens tests only.',
  'formatResumeTime': // _components/PrimaryAction.tsx
    'A documented re-export alias (`export { formatTime as formatResumeTime }`) kept so '
    + '`PrimaryAction.test.tsx` runs its original table unedited after the function moved to '
    + '`_player/formatTime.ts`. The real symbol is `formatTime`, which is alive.',
  'streamingService.checkStreamingReady':
    'Pre-existing, outside this branch. Declared once, mocked once in `journeys.test.tsx`, '
    + 'called nowhere. Readiness is decided by `getStreamingInfo` + the first-chunk precheck.',
  'tvService.getEpisodeTorrents':
    'Pre-existing, outside this branch. Torrent choice goes through `torrentsService`; this '
    + 'and its season twin are the shape the mock factory keeps alive.',
  'tvService.getSeasonTorrents':
    'Pre-existing, outside this branch. The season twin of `getEpisodeTorrents`, dead the same '
    + 'way and for the same reason: season-pack choice goes through `torrentsService`, and both '
    + 'are kept alive-looking by one `vi.fn()` in `journeys.test.tsx`\'s factory.',
  'usersService.deleteUser':
    'Pre-existing, outside this branch. No surface deletes a profile: the TV has no destructive '
    + 'profile control by design, and the web app\'s profile screen never grew one. Declared once, '
    + 'mocked once, called nowhere.',
  'instanceService.updateSettings':
    'Pre-existing, outside this branch. `MembersView` mocks it; no caller renames an instance.',
};

const key = (d: DeadSymbol) => d.name;

/** Where declarations are looked for: the TV surface, plus the services it exists to call. */
function declScope(): SourceFile[] {
  return [...read(BIGSCREEN_DIR), ...read(SERVICES_DIR)];
}

/** Where references are counted: the whole source tree, web app included. */
function refScope(): SourceFile[] {
  return read(SRC_DIR);
}

function allDead(declIn: SourceFile[], refFiles: SourceFile[]): DeadSymbol[] {
  return [
    ...deadModuleExports(declIn, refFiles),
    ...deadDefaultExports(declIn, refFiles),
    ...deadServiceMembers(declIn, refFiles),
  ];
}

/** A synthetic file set, so the controls below test the detector and not this repository. */
const f = (id: string, src: string): SourceFile =>
  ({ id, src: stripAmbientModules(stripComments(src)), isTest: isTestPath(id) });

describe('the dead-export scan itself', () => {
  it('finds an export that nothing calls', () => {
    const dead = deadModuleExports([
      f('app/(bigscreen)/_data/x.ts', 'export function wired() { return 1; }\nexport function orphan() { return 2; }'),
      f('app/(bigscreen)/p.tsx', "import { wired } from './_data/x';\nconst a = wired();"),
    ]);
    expect(dead.map(key)).toEqual(['orphan']);
  });

  it('is not fooled by a reference that is only a comment — the C7 disguise', () => {
    // This is the arm that matters. At `0e16737` the watch route mentioned `pollSubtitles` in
    // prose, in the very file that was supposed to call it, and a `grep | grep -v .test.`
    // returned that line. Without the strip, this set reads as fully wired.
    const dead = deadModuleExports([
      f('app/(bigscreen)/_data/x.ts', 'export function orphan() { return 2; }'),
      f('app/(bigscreen)/p.tsx', '// the poll is handed to `orphan`, which does the reading\n/** see `orphan` */\nconst a = 1;'),
    ]);
    expect(dead.map(key), 'prose about a function is not a caller').toEqual(['orphan']);
  });

  it('is not fooled by a test file, however thoroughly it exercises the symbol', () => {
    const dead = deadModuleExports([
      f('app/(bigscreen)/_data/x.ts', 'export function orphan() { return 2; }'),
      f('app/(bigscreen)/_data/x.test.ts', "import { orphan } from './x';\northan(); orphan(); orphan();"),
    ]);
    expect(dead.map(key)).toEqual(['orphan']);
  });

  it('counts a use inside the declaring module as alive', () => {
    const dead = deadModuleExports([
      f('app/(bigscreen)/_data/x.ts', 'export const STATES = [1, 2] as const;\nexport type S = (typeof STATES)[number];'),
    ]);
    expect(dead.map(key), 'STATES is consumed by its own type').not.toContain('STATES');
  });

  it('counts a reference from another production file as alive', () => {
    // `z` is itself uncalled in this two-file set and is REPORTED, which is the detector being
    // right rather than a flaw in the fixture: the assertion is about `TABLE`, and asserting
    // `[]` here would have meant quietly accepting whichever answer came back.
    const dead = deadModuleExports([
      f('app/(bigscreen)/_data/x.ts', 'export const TABLE = { a: 1 };'),
      f('app/(bigscreen)/_player/y.tsx', "import { TABLE } from '../_data/x';\nexport const z = TABLE.a;"),
    ]);
    expect.soft(dead.map(key), 'TABLE has a caller').not.toContain('TABLE');
    expect.soft(dead.map(key), 'and z has none').toEqual(['z']);
  });

  it('counts a reference from a file outside the declaration scope', () => {
    // The split scope, which is the error this file shipped with for one run: declarations come
    // from the TV surface and the services, references from the whole tree. Counted narrowly,
    // every web-app-only service read as dead — 51 of them.
    const declIn = [f('services/thing.ts', 'export const svc = { used: async () => 1 };')];
    const refs = [...declIn, f('components/Web.tsx', "import { svc } from '@/services/thing';\nvoid svc.used();")];
    expect.soft(deadModuleExports(declIn, declIn).map(key), 'alone, it looks dead').toEqual(['svc']);
    expect.soft(deadModuleExports(declIn, refs).map(key), 'with the web app, it is alive').toEqual([]);
  });

  it('finds a service member nothing calls, and the mock factory does not save it', () => {
    const svc = 'export const svc = {\n  used: async () => 1,\n  orphan: async () => 2,\n};';
    const dead = deadServiceMembers([
      f('services/thing.ts', svc),
      f('app/(bigscreen)/p.tsx', "import { svc } from '../../services/thing';\nvoid svc.used();"),
      f('app/(bigscreen)/p.test.tsx', 'vi.mock({ used: vi.fn(), orphan: vi.fn() });'),
    ]);
    expect(dead.map(key)).toEqual(['svc.orphan']);
  });

  it('reaches a service member through a bracket key or a destructure', () => {
    const svc = 'export const svc = {\n  byIndex: async () => 1,\n  byPattern: async () => 2,\n};';
    const dead = deadServiceMembers([
      f('services/thing.ts', svc),
      f('app/(bigscreen)/a.tsx', "const r = svc['byIndex']();"),
      f('app/(bigscreen)/b.tsx', 'const { byPattern } = svc;'),
    ]);
    expect(dead.map(key)).toEqual([]);
  });

  it('does not read a module augmentation as an export of the file it sits in', () => {
    // The live case: api-client.ts augments axios to add `__allow401`. Nothing imports
    // `AxiosRequestConfig` from api-client, and nothing can — declaration merging has no
    // call site. Without the strip this is a false positive on load-bearing code.
    const src = [
      "import axios from 'axios';",
      "declare module 'axios' {",
      '  export interface AxiosRequestConfig<D = any> {',
      '    __allow401?: boolean;',
      '  }',
      '}',
      'export const client = axios.create();',
    ].join('\n');
    const dead = deadModuleExports([f('services/api-client.ts', src)]);
    expect.soft(dead.map(key), 'the augmentation is not this file\'s export').not.toContain('AxiosRequestConfig');
    expect.soft(dead.map(key), 'and the real export is still judged').toEqual(['client']);
  });

  it('exempts a route file default export and flags one elsewhere', () => {
    const dead = deadDefaultExports([
      f('app/(bigscreen)/bigscreen/watch/[id]/page.tsx', 'export default function Watch() { return null; }'),
      f('app/(bigscreen)/_components/Orphan.tsx', 'export default function Orphan() { return null; }'),
    ]);
    expect(dead.map((d) => d.file)).toEqual(['app/(bigscreen)/_components/Orphan.tsx']);
  });

  it('is pointed at a file set with the right files in it', () => {
    // A `walk` that returned nothing, or that missed the services directory, would make every
    // ban below vacuous — and this file runs under a DIRECTORY glob, so an empty answer is a
    // real failure mode rather than a hypothetical one.
    const files = declScope();
    const ids = files.map((x) => x.id);
    expect.soft(files.filter((x) => !x.isTest).length, 'non-test sources scanned').toBeGreaterThan(55);
    expect.soft(ids, 'the wire C7 was missing').toContain('app/(bigscreen)/_data/subtitles.ts');
    expect.soft(ids, 'the service half of C7, outside the route group').toContain('services/streaming.ts');
    expect.soft(
      files.filter((x) => !x.isTest && x.id.startsWith('services/')).length,
      'service modules',
    ).toBeGreaterThan(5);
  });
});

describe('the TV surface and the services it calls', () => {
  it('export nothing that has no production caller', () => {
    const undeclared = allDead(declScope(), refScope())
      .filter((d) => !(key(d) in DECLARED_TEST_ONLY))
      .map((d) => `${key(d)}  (${d.file})`);
    expect(
      undeclared,
      'An exported, tested, uncalled symbol is this branch\'s signature defect: stage 9 shipped '
        + 'its whole main path that way and sixteen reviews passed it. If one of these is '
        + 'deliberately test-only, add it to DECLARED_TEST_ONLY with the reason.',
    ).toEqual([]);
  });

  it('declare nothing test-only that now has a caller', () => {
    // The allowlist prunes itself. Without this, the first entry to acquire a real caller stays
    // listed for ever and the list stops describing the code — which is how a guard becomes
    // decoration.
    const stillDead = new Set(allDead(declScope(), refScope()).map(key));
    const stale = Object.keys(DECLARED_TEST_ONLY).filter((n) => !stillDead.has(n));
    expect(stale, 'these now have a production caller; delete the allowlist entry').toEqual([]);
  });

  it('give a reason for every declared test-only symbol', () => {
    for (const [name, why] of Object.entries(DECLARED_TEST_ONLY)) {
      expect.soft(why.length, `${name} needs a reason, not a line`).toBeGreaterThan(80);
    }
  });
});
