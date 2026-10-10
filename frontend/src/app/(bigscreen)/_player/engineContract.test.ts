/**
 * The drift pin between the two players.
 *
 * It lives HERE, inside the `test:tv` glob (`package.json:13` scopes that command to
 * `src/app/(bigscreen)`), because a test under `@/lib/player/` would sit outside the
 * only guard this surface has. It is allowed to read the web surface: `tvSourceFiles`
 * in `legacy-target.test.ts` drops `*.test.ts(x)`, so a test file ships in no bundle
 * and may look at anything.
 *
 * THREE JOBS, AND EACH ONE FAILS UNDER A DIFFERENT MUTATION:
 *
 * 1. THE TABLE IS ONE TABLE. The constants are value-imported and also pinned to
 *    their literal values here. Change the shared table and this file goes red (so
 *    does the web's own `VideoPlayer.recovery.test.tsx`, which hard-codes the same
 *    ladder — that is the free, pre-existing evidence the web ADOPTED the module
 *    rather than keeping a copy). Re-inline a local copy on the TV and the source
 *    pins below go red instead. Both directions, deliberately.
 *
 * 2. BOTH RECOVERY PATHS STILL CALL `.load()`. The one line whose absence makes the
 *    whole ladder a silent no-op on either surface: once the element carries a
 *    MediaError its `networkState` is NETWORK_NO_SOURCE, and only `load()` re-runs
 *    resource selection. Four attempts that do nothing is what this project shipped
 *    before `VideoPlayer.recovery.test.tsx` existed.
 *
 * 3. EVERY DIVERGENCE IS NAMED. `DELIBERATELY_DIFFERENT` carries one entry per place
 *    the two surfaces disagree, with the reason, and every entry has a predicate that
 *    must actually OBSERVE that divergence in the two sources. So tomorrow's
 *    divergence has to be written down rather than silently added — the shape
 *    `_data/railsDrift.test.ts` uses for the copied rail table.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { vi, afterEach } from 'vitest';
import {
  MAX_RECOVERY_ATTEMPTS,
  RECOVERY_BACKOFF_MS,
  STALL_EPSILON_S,
  STALL_ESCALATE_MS,
  STALL_SPINNER_MS,
} from '@/lib/player/streamRecovery';
import { createRecovery, type RecoveryStatus } from './recovery';
import { STALL_POLL_MS } from './useStallWatch';

const PLAYER_DIR = join(process.cwd(), 'src/app/(bigscreen)/_player');
const BIGSCREEN_DIR = join(process.cwd(), 'src/app/(bigscreen)');
const WEB_PLAYER = join(process.cwd(), 'src/components/player/VideoPlayer.tsx');
const SHARED = join(process.cwd(), 'src/lib/player/streamRecovery.ts');

const read = (p: string) => readFileSync(p, 'utf8');

/** Every non-test source file in `_player`, by name. */
function playerSources(): Array<{ id: string; src: string }> {
  return readdirSync(PLAYER_DIR)
    .filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))
    .map((f) => ({ id: f, src: read(join(PLAYER_DIR, f)) }));
}

/** Every non-test source file anywhere under `(bigscreen)`, recursively. */
function tvSources(dir = BIGSCREEN_DIR): Array<{ id: string; src: string }> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return tvSources(p);
    if (e.name.endsWith('.test.ts') || e.name.endsWith('.test.tsx')) return [];
    return [{ id: e.name, src: read(p) }];
  });
}

/**
 * Comments and string bodies removed, crudely but adequately: these predicates ask
 * "does the CODE do X", and every header in this directory legitimately quotes the
 * constructs it is explaining (`video.paused` appears three times in prose). A real
 * scanner lives in `legacy-target.test.ts`; nothing in these three files has a `//`
 * inside a string, which is the only case this simpler version would get wrong.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const playerCode = () => playerSources().map(({ src }) => code(src)).join('\n');

/** Import specifiers, so an edge can be reasoned about rather than grepped for. */
function importSpecifiers(src: string): string[] {
  const out: string[] = [];
  const re = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

/** A minimal element: enough for the ladder, with no React and no jsdom media stubs. */
function fakeVideo() {
  const listeners = new Map<string, Set<EventListener>>();
  const el = {
    currentTime: 0,
    loads: 0,
    load() { el.loads += 1; },
    play: () => Promise.resolve(),
    addEventListener(type: string, fn: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn);
    },
    attached: (type: string) => listeners.get(type)?.size ?? 0,
  };
  return el;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('one table, imported by both players', () => {
  it('is the ladder both surfaces were tuned against', () => {
    // An ABSOLUTE anchor, not derived from the import: a test that only compared the
    // TV against the table would move with the table and catch nothing. This row is
    // what makes "break the shared table" red here as well as in the web suite.
    expect(RECOVERY_BACKOFF_MS).toEqual([1000, 2000, 4000, 8000]);
    expect(MAX_RECOVERY_ATTEMPTS).toBe(4);
    expect(STALL_EPSILON_S).toBe(0.25);
    expect(STALL_SPINNER_MS).toBe(2000);
    expect(STALL_ESCALATE_MS).toBe(10000);
    // The TV's own sampling cadence is local (the shared module owns thresholds, not
    // clocks) and must stay the ~1s window the epsilon was tuned for.
    expect(STALL_POLL_MS).toBe(1000);
    expect(STALL_ESCALATE_MS).toBeGreaterThan(STALL_SPINNER_MS);
    expect(STALL_SPINNER_MS).toBeGreaterThan(STALL_POLL_MS);
  });

  it('the TV engine walks exactly that ladder, and stops at its length', () => {
    vi.useFakeTimers();
    const el = fakeVideo();
    const statuses: RecoveryStatus[] = [];
    const engine = createRecovery({
      getVideo: () => el as unknown as HTMLVideoElement,
      onStatus: (s) => statuses.push(s),
    });

    RECOVERY_BACKOFF_MS.forEach((delay, i) => {
      engine.attempt();
      vi.advanceTimersByTime(delay - 1);
      expect(el.loads, `rung ${i} fired early`).toBe(i);
      vi.advanceTimersByTime(1);
      expect(el.loads, `rung ${i} did not fire`).toBe(i + 1);
    });

    engine.attempt();
    vi.advanceTimersByTime(60_000);
    expect(el.loads).toBe(MAX_RECOVERY_ATTEMPTS);
    expect(statuses.filter((s) => s.kind === 'exhausted')).toEqual([
      { kind: 'exhausted', attempts: MAX_RECOVERY_ATTEMPTS },
    ]);
    engine.dispose();
    expect(el.attached('loadedmetadata')).toBe(0);
  });

  it('the TV engine declares no ladder of its own', () => {
    // The re-inlining mutation. Nothing in `_player` may carry a multi-number table
    // of milliseconds, and nothing may re-declare a shared constant's name.
    for (const { id, src } of playerSources()) {
      expect(code(src), `${id} declares a numeric table`).not.toMatch(/\[\s*\d{3,}\s*,\s*\d{3,}/);
      for (const name of [
        'RECOVERY_BACKOFF_MS',
        'MAX_RECOVERY_ATTEMPTS',
        'STALL_EPSILON_S',
        'STALL_SPINNER_MS',
        'STALL_ESCALATE_MS',
      ]) {
        expect(code(src), `${id} re-declares ${name}`).not.toMatch(
          new RegExp(`(const|let|var|function)\\s+${name}\\b`),
        );
      }
    }
  });

  it('imports the shared module by name, in both engine files', () => {
    const recovery = read(join(PLAYER_DIR, 'recovery.ts'));
    const stall = read(join(PLAYER_DIR, 'useStallWatch.ts'));
    expect(importSpecifiers(recovery)).toContain('@/lib/player/streamRecovery');
    expect(importSpecifiers(stall)).toContain('@/lib/player/streamRecovery');
    expect(recovery).toMatch(/recoveryStep/);
    expect(stall).toMatch(/stallStep/);
    expect(stall).toMatch(/resetStallSample/);
  });

  it('the shared module stays TV-importable: it reaches only @/types', () => {
    // The import guard checks one hop deep, and this is the first `@/lib/player/*`
    // edge on the surface — so it is the first time that check resolves anything
    // here. A second import added to the shared module is how the web design system
    // would arrive on the television through a module nobody thinks of as UI.
    expect(importSpecifiers(read(SHARED))).toEqual(['@/types']);
  });
});

describe('both recovery paths still reload the element', () => {
  it('calls .load() on the TV and on the web', () => {
    expect(code(read(join(PLAYER_DIR, 'recovery.ts')))).toContain('.load()');
    expect(code(read(WEB_PLAYER))).toContain('.load()');
  });
});

describe('the probe is HEAD-only, structurally', () => {
  it('names HEAD and no Range, anywhere in the player sources', () => {
    // Pinned structurally because no behavioural assertion can observe what a GET
    // does to libtorrent's deadline queue or to the torrents table.
    const classify = code(read(join(PLAYER_DIR, 'classify.ts')));
    expect(classify).toContain("method: 'HEAD'");
    const all = playerCode();
    expect(all).not.toMatch(/method:\s*'GET'/);
    expect(all).not.toMatch(/\bRange\b\s*:/);
    expect(all.toLowerCase()).not.toContain('bytes=');
  });

  it('never routes a probe through apiClient', () => {
    // Hazard 7: the rejection interceptor hard-navigates to /bigscreen/pair from
    // inside the handler, before any caller sees the error.
    for (const { id, src } of playerSources()) {
      expect(importSpecifiers(src), `${id}`).not.toContain('@/services/api-client');
      expect(importSpecifiers(src), `${id}`).not.toContain('@/services/streaming');
    }
  });
});

/**
 * Every place the two players deliberately disagree, with the reason. An entry here
 * is a promise that the divergence is intended; the predicate beside it is the proof
 * that it is still real.
 */
const DELIBERATELY_DIFFERENT: Record<string, string> = {
  preload:
    'the TV element asks for metadata only; the web keeps `auto`, and a 1080p stream '
    + 'pre-buffered aggressively on TV silicon competes with the decode',
  'audio-intent machine':
    'four refs and ~120 lines for a Chrome autoplay policy nobody has measured on this '
    + 'panel; the TV owns volume and spec §8.3 deletes the slider',
  'status before MediaError.code':
    'the TV classifies on the HTTP status from a HEAD probe; the web branches on '
    + 'video.error.code and so cannot tell a 401 from a dead swarm',
  'exhaustion latch':
    'the web returns from its exhausted branch without a flag and re-fires on every '
    + 'further error; there it opens a source switcher, here there is nothing after it',
  'expectingPlayback never reads video.paused':
    'load() sets paused with no pause event, so the web can have its escalation '
    + 'released by the recovery that triggered it; the TV tracks intent from events',
  'no source switcher':
    'one stream per title on this surface; sources/currentSourceId/onSelectSource are '
    + 'a pointer-era affordance and there is no second URL to switch to',
};

/** Each divergence, as something observable in the two sources. */
const DIVERGENCE_CHECKS: Record<string, (web: string, tv: string, tvAll: string) => boolean> = {
  preload: (web, _tv, tvAll) => web.includes('preload="auto"') && !tvAll.includes('preload="auto"'),
  'audio-intent machine': (web, tv) =>
    web.includes('audioIntentRef') && !tv.includes('audioIntentRef') && !tv.includes('showUnmuteButton'),
  'status before MediaError.code': (web, tv) =>
    web.includes('video.error?.code')
    && !tv.includes('MediaError')
    && !tv.includes('error?.code')
    && tv.includes('status === 401'),
  'exhaustion latch': (web, tv) =>
    !/exhausted\s*=\s*true/.test(web) && /exhausted\s*=\s*true/.test(tv),
  'expectingPlayback never reads video.paused': (web, tv) =>
    web.includes('!video.paused') && !tv.includes('.paused'),
  'no source switcher': (web, tv) =>
    web.includes('onSelectSource') && !tv.includes('onSelectSource') && !tv.includes('currentSourceId'),
};

describe('DELIBERATELY_DIFFERENT', () => {
  const web = code(read(WEB_PLAYER));
  const tv = playerCode();
  const tvAll = tvSources().map(({ src }) => src).join('\n');

  it('is not empty, and names a reason for each divergence', () => {
    // Empty the map and this row fails: a drift pin whose exception list can be
    // deleted is not a pin. (The self-check `railsDrift.test.ts` uses for TV_OMITS.)
    const keys = Object.keys(DELIBERATELY_DIFFERENT);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(DELIBERATELY_DIFFERENT[k].length).toBeGreaterThan(30);
  });

  it('names exactly the divergences that have a check', () => {
    expect(Object.keys(DELIBERATELY_DIFFERENT).sort()).toEqual(Object.keys(DIVERGENCE_CHECKS).sort());
  });

  it.each(Object.keys(DIVERGENCE_CHECKS))('%s is still a real divergence', (key) => {
    expect(DIVERGENCE_CHECKS[key](web, tv, tvAll), DELIBERATELY_DIFFERENT[key]).toBe(true);
  });
});
