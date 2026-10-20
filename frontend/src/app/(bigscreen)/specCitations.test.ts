/**
 * THE SPEC'S PYTHON CITATIONS MUST RESOLVE, AND NAME THE FUNCTION THEY POINT AT.
 *
 * WHY THIS EXISTS, measured. `docs/superpowers/specs/2026-09-22-webos-tv-app-design.md` carried
 * `torrent/manager.py:1226-1228` at **two** sites (§4.4 and §7.5) as its authority for "every
 * non-video file gets libtorrent priority 0". That range named no selector at all — it landed in
 * `get_completed_video_file_info`'s docstring — and it survived two spec sites, six recon passes
 * and four competing designs, because **nothing in this repository reads a citation**. §4.2's
 * `manager.py:1389-1401` had drifted out of `stream_file_range` into the SAME function, and
 * §4.5's `main.py:188-191` had drifted off `bare_401`. Stage 9 task 16 re-resolved all four; this
 * file is the instrument that keeps them resolved, and it is the only falsifiable artefact that
 * documentation task produced.
 *
 * WHAT IT ASSERTS, for every citation written as `<path>.py:<line>` or `<path>.py:<a>-<b>` whose
 * path names a file in SOURCES below:
 *   1. the whole cited range sits inside ONE `def`'s block;
 *   2. that `def`'s name appears in the citation's OWN SENTENCE;
 *   3. and no OTHER cited function's name appears in that sentence.
 *
 * (2) + (3) are what make a SWAP fail, and the window is the reason. §4.4 and §7.5 each name both
 * file-priority selectors a few words apart, so reading the surrounding PARAGRAPH instead would
 * read both names for either citation. **Measured, on test 3 alone, with the two §4.4 citations
 * swapped: sentence window RED, paragraph window GREEN** (and green on the honest document too,
 * so the difference is the swap and nothing else). That is the "degenerate tuple that hides an
 * argument swap" shape. Each selector therefore gets its own sentence over there, this file reads
 * sentences, and the fourth test below enforces the precondition that keeps (2) sound — under a
 * paragraph window it is red on the honest spec, which is what "one sentence, one function"
 * costs and buys.
 *
 * WHAT IT DELIBERATELY DOES NOT POLICE. Bare continuations (`:1637-1640`, `:705-709`, `:1864`)
 * carry no path: they are meaningful only against their sentence's own subject, and a resolver
 * that guessed would be a test with an opinion. Module-level citations are out of reach by
 * construction — `config.py:67-69` is a `Settings` field block and `providers/quality.py:12` is a
 * module-level `re.compile`, so "a def whose name the sentence contains" has nothing to say about
 * them. Nor does it police DRIFT WITHIN a function: measured, moving §4.2's `:1778` to `:1800`
 * — 22 lines down, still inside `stream_file_range`'s 100-odd — is green here, so a citation can
 * still rot into the wrong line of the right function. And it polices **this spec only**: the
 * `docs/superpowers/plans/` tree holds **68** more `torrent/manager.py:<line>` citations (98
 * across `docs/`, 46 of the plans' ones below line 1264), many already stale by
 * the line-shift that any backend commit causes, and dragging those into a frontend suite would
 * make a plan's history unmaintainable. The two files below are the ones whose citations were
 * measured stale.
 *
 * WHERE IT RUNS: `npm run test:tv` (this directory is the glob) and `npx vitest run`. In no build
 * and in no CI, like every other guard on this surface.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** `process.cwd()` is `frontend/` under both suites; the spec and the backend sit beside it. */
const REPO = join(process.cwd(), '..');
const SPEC_PATH = join(REPO, 'docs/superpowers/specs/2026-09-22-webos-tv-app-design.md');

/** Citation path -> the file it must resolve in. Matched by suffix, in both directions. */
const SOURCES: Record<string, string> = {
  'torrent/manager.py': 'backend/app/torrent/manager.py',
  'main.py': 'backend/app/main.py',
};

/**
 * The SOURCES key a citation's path refers to, or null.
 *
 * Suffix matching in both directions, because this spec writes one file several ways: it holds
 * `api/streaming.py:280` AND `backend/app/api/streaming.py:62-64`, and §7.5 wrote `manager.py:`
 * bare for years. An exact-key lookup would skip the long and the bare spellings **in silence** —
 * the "matcher so specific it misses the live spellings" shape, which has already cost this repo
 * one guard that the whole stage's claim rested on.
 */
function sourceFor(path: string): string | null {
  for (const key of Object.keys(SOURCES)) {
    if (path === key || path.endsWith(`/${key}`) || key.endsWith(`/${path}`)) return key;
  }
  return null;
}

type PyDef = { name: string; start: number; end: number; indent: number };

/**
 * Every `def` in a Python file with the 1-indexed, inclusive line span of its block.
 *
 * A line scan, not a parser: the block ends at the next non-blank line indented no deeper than
 * the `def` itself, and trailing blank lines are not part of it. A comment at the outer indent
 * therefore closes a block, which is the conservative direction — it can only make a citation
 * look OUTSIDE a function, never inside one it has left.
 *
 * The span STARTS at the function's first decorator, not at `def`. Measured: §4.5 cites
 * `main.py:205-208` for the bodiless 401 and `:205` is `@app.exception_handler(...)` — the
 * registration IS the mechanism that section is about, and in a FastAPI codebase almost every
 * handler is cited that way. Without this, the natural citation reads as "inside no def at all".
 */
function pythonDefs(src: string): PyDef[] {
  const lines = src.split('\n');
  const defs: PyDef[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    let afterBlock = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      const ind = lines[j].length - lines[j].trimStart().length;
      if (ind <= indent) {
        afterBlock = j;
        break;
      }
    }
    let last = afterBlock - 1;
    while (last > i && !lines[last].trim()) last--;
    let first = i;
    while (first > 0) {
      const above = lines[first - 1];
      const aboveIndent = above.length - above.trimStart().length;
      if (!above.trim() || aboveIndent !== indent || !above.trimStart().startsWith('@')) break;
      first--;
    }
    defs.push({ name: m[2], start: first + 1, end: last + 1, indent });
  }
  return defs;
}

/** The innermost `def` whose block contains [a, b], or null. */
function enclosingDef(defs: PyDef[], a: number, b: number): PyDef | null {
  let best: PyDef | null = null;
  for (const d of defs) {
    if (d.start <= a && b <= d.end) {
      if (best === null || d.start > best.start) best = d;
    }
  }
  return best;
}

/**
 * Markdown "blocks": a run of lines that belong to one prose unit. A blank line starts a new one,
 * and so does a list item, a table row or a heading — without that, §7.5's bullet list would be
 * one block and a sentence could be read across two bullets.
 */
function blocks(text: string): string[] {
  const out: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length) out.push(current.join(' '));
    current = [];
  };
  for (const line of text.split('\n')) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^\s*(?:[-*+]\s|\d+\.\s|\||#)/.test(line)) flush();
    current.push(line.trim());
  }
  flush();
  return out;
}

/** The sentence of `block` containing `needle`. Sentences end at `.`/`!`/`?` plus whitespace. */
function sentenceWith(block: string, needle: string): string | null {
  for (const s of block.split(/(?<=[.!?])\s+/)) {
    if (s.includes(needle)) return s;
  }
  return null;
}

type Citation = {
  raw: string;
  key: string;
  from: number;
  to: number;
  sentence: string;
  /** True when `sentenceWith` found no sentence and the whole block was used instead. */
  viaFallback: boolean;
};

function citationsIn(text: string): Citation[] {
  const found: Citation[] = [];
  const re = /([A-Za-z0-9_./-]*[A-Za-z0-9_-]\.py):(\d+)(?:-(\d+))?/g;
  for (const block of blocks(text)) {
    for (const m of block.matchAll(re)) {
      const key = sourceFor(m[1]);
      if (key === null) continue;
      const sentence = sentenceWith(block, m[0]);
      found.push({
        raw: m[0],
        key,
        from: Number(m[2]),
        to: Number(m[3] ?? m[2]),
        sentence: sentence ?? block,
        viaFallback: sentence === null,
      });
    }
  }
  return found;
}

const SPEC = readFileSync(SPEC_PATH, 'utf8');
const SOURCE_DEFS: Record<string, PyDef[]> = Object.fromEntries(
  Object.entries(SOURCES).map(([key, rel]) => [
    key,
    pythonDefs(readFileSync(join(REPO, rel), 'utf8')),
  ]),
);

const defFor = (c: Citation) => enclosingDef(SOURCE_DEFS[c.key], c.from, c.to);

describe('the TV spec cites Python by line, so the lines have to be real', () => {
  it('parses the two cited sources, and tells adjacent functions apart', () => {
    // The parser's positive control. Without it, a resolver that found nothing would make every
    // assertion below vacuous rather than red.
    const managerDefs = SOURCE_DEFS['torrent/manager.py'];
    expect(managerDefs.length).toBeGreaterThan(50);
    expect(SOURCE_DEFS['main.py'].map((d) => d.name)).toContain('bare_401');

    const skip = managerDefs.find((d) => d.name === 'skip_non_video_files');
    const prio = managerDefs.find((d) => d.name === 'prioritize_video_files');
    expect(skip, 'skip_non_video_files not found').toBeDefined();
    expect(prio, 'prioritize_video_files not found').toBeDefined();
    // They are adjacent in the file, which is exactly the pair the spec used to conflate.
    expect(skip!.end).toBeLessThan(prio!.start);
    expect(enclosingDef(managerDefs, skip!.start, skip!.end)!.name).toBe('skip_non_video_files');
    expect(enclosingDef(managerDefs, prio!.end, prio!.end)!.name).toBe('prioritize_video_files');
    // One line past a block is OUTSIDE it: the property every citation below leans on.
    expect(enclosingDef(managerDefs, skip!.start, skip!.end + 1)).not.toBe(skip);

    // THE TWO RULES ABOVE THAT NO REAL CITATION REACHES, on fixtures. Measured: with the
    // trailing-blank trim deleted, and with `enclosingDef` taking the OUTERMOST containing def
    // instead of the innermost, every assertion in this file stayed green — the spec happens to
    // cite only methods with no nested `def` and no citation happens to land in the blank lines
    // under one. Both rules are load-bearing for the next citation, so both get a control.
    const nested = pythonDefs(
      ['def outer():', '    x = 1', '    def inner():', '        pass', '    return x', ''].join('\n'),
    );
    expect(nested.map((d) => d.name)).toEqual(['outer', 'inner']);
    expect(enclosingDef(nested, 4, 4)!.name).toBe('inner');
    const trailing = pythonDefs(['def a():', '    pass', '', '', 'def b():', '    pass', ''].join('\n'));
    // `a`'s block is lines 1-2; the two blank lines under it are not part of it.
    expect([trailing[0].start, trailing[0].end]).toEqual([1, 2]);
  });

  it('finds the citations it is supposed to be policing, in every spelling', () => {
    const found = citationsIn(SPEC);
    // Six in the spec today: §4.2's stream_file_range, §4.4's two selectors, §7.5's two, and
    // §4.5's bare_401. A regex that stopped matching would otherwise pass this file in silence —
    // the "recorder asserted == [] with no positive control" shape.
    expect(found.length).toBeGreaterThanOrEqual(5);
    expect(new Set(found.map((c) => c.raw)).size).toBeGreaterThanOrEqual(4);
    // Every citation got a SENTENCE, not the whole block as a fallback. The obvious
    // spelling of this — `c.sentence.includes(c.raw)` — is true BY CONSTRUCTION, because
    // `sentenceWith` returns only a sentence that contains the needle and the fallback is the
    // block that contains it too: measured, with `sentenceWith` stubbed to return null for
    // every citation, that assertion stayed green while every sentence was a whole block. The
    // flag is the instrument; the `includes` check is kept as the weaker one it always was.
    expect(found.filter((c) => c.viaFallback).map((c) => c.raw)).toEqual([]);
    expect(found.every((c) => c.sentence.includes(c.raw))).toBe(true);

    // The path matcher's own control, on a fixture rather than on the spec: one file, three
    // spellings, all of which this document has used at one time or another.
    const spellings = citationsIn(
      'A (`torrent/manager.py:1646`) one.\nB (`backend/app/torrent/manager.py:1646`) two.\n' +
        'C (`manager.py:1646`) three.\nD (`providers/quality.py:12`) is not policed.',
    );
    expect(spellings.map((c) => c.key)).toEqual([
      'torrent/manager.py',
      'torrent/manager.py',
      'torrent/manager.py',
    ]);

    // THE RANGE'S END, which every "leaks one line past the block" mutation depends on and
    // which no assertion here read: measured, dropping `(?:-(\d+))?` from the regex collapsed
    // every ranged citation to its first line and all four tests stayed green — the guard would
    // have gone on policing starts in silence.
    const ranged = citationsIn('One (`torrent/manager.py:1629-1644`) range.');
    expect([ranged.length, ranged[0].from, ranged[0].to]).toEqual([1, 1629, 1644]);

    // THE BLOCK SPLITTER. Its own comment argues that without it a sentence could be read
    // across two bullets; measured, collapsing the whole document into one block left all four
    // tests green, because this spec's bullets happen to end in full stops. A bullet that does
    // not is the case the rule is for, so the rule gets the fixture its comment claims.
    const bullets = citationsIn(
      '- Alpha cites `torrent/manager.py:1629-1644` with no full stop\n' +
        '- Beta cites `torrent/manager.py:1646` instead.',
    );
    expect(bullets.length).toBe(2);
    expect(bullets[0].sentence).not.toContain('1646');
    expect(bullets[1].sentence).not.toContain('1629');
  });

  it('resolves every citation into a def its own sentence names', () => {
    const found = citationsIn(SPEC);
    const offences: string[] = [];
    for (const c of found) {
      const def = defFor(c);
      if (def === null) {
        offences.push(`${c.raw}: inside no def of ${SOURCES[c.key]} at all`);
        continue;
      }
      if (!c.sentence.includes(def.name)) {
        offences.push(
          `${c.raw}: resolves into ${def.name}() (${def.start}-${def.end}), which its own ` +
            `sentence does not name — "${c.sentence.slice(0, 120)}"`,
        );
      }
    }
    expect(offences, offences.join('\n')).toEqual([]);

    // At least three DIFFERENT functions, or a resolver stuck on one name would satisfy the loop.
    const names = new Set(found.map((c) => defFor(c)?.name).filter(Boolean));
    expect(names.size).toBeGreaterThanOrEqual(3);
  });

  it('never lets two cited functions share one sentence, so a swap cannot hide', () => {
    const found = citationsIn(SPEC);
    const cited = new Set(
      found.map((c) => defFor(c)?.name).filter((n): n is string => Boolean(n)),
    );
    expect(cited.size).toBeGreaterThanOrEqual(3);

    const offences: string[] = [];
    for (const c of found) {
      const mine = defFor(c)?.name;
      for (const other of cited) {
        if (other === mine) continue;
        if (c.sentence.includes(other)) {
          offences.push(
            `${c.raw} resolves into ${mine}() but its sentence also names ${other}() — swap the ` +
              `two citations and nothing would redden`,
          );
        }
      }
    }
    expect(offences, offences.join('\n')).toEqual([]);
  });
});
