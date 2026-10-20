import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import DiagPage from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const SRC = readFileSync('src/app/(bigscreen)/bigscreen/diag/page.tsx', 'utf8');
const TV_CSS = readFileSync('public/bigscreen.css', 'utf8');
const CUE_PROBE = readFileSync('public/samples/cue-probe.vtt', 'utf8');
const CUE_PROBE_LINE = readFileSync('public/samples/cue-probe-line.vtt', 'utf8');

const SUBTITLE_STORAGE = 'bs-diag:subtitles';

/**
 * STAGE 9 — the subtitle instrument's own tests, and they are about ONE thing: this page
 * cannot report a cue reading it has not taken, and cannot report three different facts in
 * one cell.
 *
 * WHAT IS NOT PINNED HERE, AND CANNOT BE: every value this section prints. jsdom 25.0.1 has no
 * text-track machinery at all — `window.TextTrack` is undefined, `video.textTracks` is a plain
 * zero-length array even with a `<track default>` child present, `trackEl.track` is undefined
 * and `trackEl.readyState` is a hardcoded 0 — so `mode` and `cues.length` read an em dash in
 * every row below and the two zeroes are jsdom's, not a television's. The page is an
 * INSTRUMENT, not an assertion; the readings are rows 27-35 of
 * `docs/superpowers/plans/2026-10-20-tv-stage9-device-readings.md` and they are untaken.
 *
 * What IS pinned is everything the instrument can get wrong on its own: it must not mount a
 * `<track>` before the probe answers (a 404 and an unparseable body fire the same `error`, and
 * the element gets one load), it must keep the status, the cue count and the operator's
 * VISIBLE answer in three separate fields, it must not reach for `apiClient` (whose 401
 * interceptor hard-navigates off the page mid-reading), and it must lose nothing across the
 * navigation that leaving this page is.
 */
describe('/bigscreen/diag: the subtitle instrument', () => {
  const VTT = '/samples/cue-probe.vtt';
  const VTT_LINE = '/samples/cue-probe-line.vtt';
  const CLIP = '/samples/clip4-1080p-h264-eac3.mkv';

  const arm = (id: string) => document.querySelector<HTMLElement>(`[data-subtitle-arm="${id}"]`);
  const armText = (id: string) => arm(id)?.textContent ?? '';
  const player = (id: string) => document.querySelector<HTMLVideoElement>(`[data-subtitle-player="${id}"]`);
  const trackEl = (id: string) => document.querySelector<HTMLTrackElement>(`[data-subtitle-track="${id}"]`);
  const stored = () => JSON.parse(sessionStorage.getItem(SUBTITLE_STORAGE) ?? 'null');

  /**
   * The VALUE CELL of one named fact in one arm's row, and the scoping is load-bearing for the
   * reason the codec section measured: each of these rows carries buttons reading "Cue text
   * visible: yes" and "Cue text visible: no", so a row-wide `/yes/` matches the BUTTON and
   * cannot fail. Asserting on the cell is what pins the value.
   *
   * The `toHaveLength(1)` is also the instrument for mutation (c): collapsing the status, the
   * cue count and VISIBLE into one ok/failed field removes two of these labels, and a missing
   * label fails here rather than silently matching something else.
   */
  const cellText = (id: string, labelPrefix: string) => {
    const r = arm(id);
    expect(r, `arm ${id} is rendered`).not.toBeNull();
    const matches = Array.from(r!.querySelectorAll('tr')).filter((tr) =>
      (tr.querySelector('th')?.textContent ?? '').startsWith(labelPrefix),
    );
    expect(matches, `exactly one "${labelPrefix}" fact in arm ${id}`).toHaveLength(1);
    return matches[0].querySelector('td')?.textContent ?? '';
  };

  /** Labels present in an arm's table, for the per-arm rows that are additions not branches. */
  const labels = (id: string) =>
    Array.from(arm(id)?.querySelectorAll('tr') ?? []).map((tr) => tr.querySelector('th')?.textContent ?? '');

  /**
   * How many `/samples/` requests are still in flight. Asserted zero after every test, because
   * a probe that settles after its test has finished writes `sessionStorage` AFTER the next
   * test's `beforeEach` cleared it, and the next component then restores the poisoned record.
   * The codec section demonstrated that leak deliberately; this is the same guard, and the 0ms
   * timer below is what makes it falsifiable (an instantly-resolved mock can never be
   * outstanding at the end of a test, so the guard could not fail).
   */
  let outstanding = 0;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
    sessionStorage.clear();
    outstanding = 0;
  });

  afterEach(() => {
    expect(
      outstanding,
      'a /samples/ probe was still in flight when the test ended; it will write sessionStorage during the NEXT test',
    ).toBe(0);
  });

  /**
   * Every `/samples/` HEAD answers with the status this map gives its URL (default 200);
   * everything else hangs, as the page-wide default mock does.
   *
   * ON A TIMER, NOT A RESOLVED PROMISE: the device issues independent requests that land
   * whenever they land, and a 0ms timer is a macrotask that `await act(...)` does not drain,
   * so each probe lands during the `waitFor` that waits for it.
   */
  function mockSamples(statuses: Record<string, number> = {}) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith('/samples/')) {
        calls.push({ url: u, init });
        outstanding += 1;
        const status = statuses[u] ?? 200;
        return new Promise((resolve) => {
          setTimeout(
            () => resolve({
              ok: status >= 200 && status < 300,
              status,
              statusText: status === 404 ? 'Not Found' : 'OK',
              body: null,
            }),
            0,
          );
        }).finally(() => {
          outstanding -= 1;
        });
      }
      return new Promise(() => {});
    }) as unknown as typeof fetch);
    return calls;
  }

  /** Press an arm's Load and let the HEADs settle inside `act`, so no write is in flight. */
  const loadArm = async (id: string) => {
    await act(async () => {
      fireEvent.click(within(arm(id)!).getByRole('button', { name: /^load /i }));
    });
  };

  /** The list jsdom cannot produce, forced onto the element the page samples. */
  function fakeTextTracks(v: HTMLVideoElement, tracks: Array<{ mode?: string; cues?: { length: number } | null }>) {
    const list = Object.assign([...tracks], { length: tracks.length });
    Object.defineProperty(v, 'textTracks', { value: list, configurable: true });
  }

  it('renders one row per reading, and every cell starts at “not taken”', async () => {
    // Non-vacuity for everything below — and the plan's mutation (a) first half: the section
    // renders its rows at all. Five arms, because reading 27a is the gate, 27b is its
    // tie-breaker over a real frame, and 30/32/35 are the three questions that need the same
    // `<track>` mounted with one variable changed each time.
    render(<DiagPage />);
    // Each arm prints its own sheet row number, which is the only thing standing between a
    // transcribed cell and the wrong row: 27a is a gate, 30 and 32 are not, and a reading
    // filed under the wrong number is a gate answered by a question nobody asked.
    for (const [id, reading] of [['s27a', '27a'], ['s27b', '27b'], ['s30', '30'], ['s32', '32'], ['s35', '35']] as const) {
      expect(arm(id), id).not.toBeNull();
      expect(armText(id), id).toMatch(new RegExp(`Reading ${reading}\\.`));
    }
    expect(cellText('s27a', 'HTTP — the .vtt')).toBe('not probed');
    expect(cellText('s27a', 'Subtitle file present?')).toBe('unknown');
    for (const label of ['textTracks.length', 'textTracks[0].mode', 'cues.length', 'trackEl.readyState', 'which of load/error fired', 'sampled at']) {
      expect(cellText('s27a', label), label).toBe('not taken');
    }
    expect(cellText('s27a', 'Cue text VISIBLE')).toBe('not answered');
    // And nothing is mounted until something is loaded: the rows are a record, not a probe.
    expect(document.querySelector('[data-subtitle-player]')).toBeNull();
    expect(document.querySelector('[data-subtitle-track]')).toBeNull();
  });

  it('gives each arm only its own extra fields, so no cell can read a reading it cannot take', () => {
    // A row that could never be filled is a blank cell with extra steps, and a blank reads as
    // a pass. The clip rows belong to 27b, the load() sequence to 35, and the two extra
    // operator questions to 30 and 32.
    render(<DiagPage />);
    expect(labels('s27b')).toContain('HTTP — the clip (verbatim)');
    expect(labels('s27a')).not.toContain('HTTP — the clip (verbatim)');
    expect(labels('s35')).toContain('after each video.load(), textTracks.length');
    expect(labels('s27a')).not.toContain('after each video.load(), textTracks.length');
    expect(labels('s30')).toContain('Cue text was GOLD? (operator)');
    expect(labels('s32')).toContain('Cue sat HIGHER than arm 27a’s? (operator)');
    expect(labels('s27a').filter((l) => l.includes('(operator)'))).toHaveLength(1);
  });

  it('renders FILE NOT PRESENT on a 404 and mounts no <track> at all', async () => {
    // THE test for this task, and the plan's mutation (a). A `<track>` whose src 404s fires
    // exactly the same `error` as one whose body no parser accepts, and the element gets ONE
    // load — nothing retries it. Mounting before the probe answers would have the operator
    // transcribe "this set does not paint cues" for a file nobody copied over.
    mockSamples({ [VTT]: 404 });
    render(<DiagPage />);
    await loadArm('s27a');

    await waitFor(() => {
      expect(cellText('s27a', 'Subtitle file present?')).toBe('FILE NOT PRESENT — nothing was mounted');
      expect(trackEl('s27a'), 'no element, so nothing was asked to parse a cue').toBeNull();
    });
    expect(player('s27a'), 'and no media element either').toBeNull();
    expect(cellText('s27a', 'HTTP — the .vtt'), 'the raw status is the reading').toBe(
      'HEAD /samples/cue-probe.vtt -> 404 Not Found',
    );
    // The prose under the table, which is what stops the cell being transcribed as a cue
    // result. Row-scoped rather than page-wide for the reason the codec section measured: a
    // page-wide /FILE NOT PRESENT/ is satisfied by the paragraph that explains the state.
    expect(armText('s27a')).toMatch(/not a text-track result/i);
    expect(document.querySelector('[data-subtitle-track]')).toBeNull();
  });

  it('mounts exactly one <track>, default, at the committed file — non-vacuity for the row above', async () => {
    mockSamples();
    render(<DiagPage />);
    await loadArm('s27a');

    await waitFor(() => expect(trackEl('s27a')).not.toBeNull());
    const el = trackEl('s27a')!;
    // `getAttribute`, the house idiom, because jsdom absolutises `trackEl.src`.
    expect(el.getAttribute('src')).toBe(VTT);
    expect(el.hasAttribute('default'), 'a track without `default` never reaches showing').toBe(true);
    expect(el.getAttribute('kind')).toBe('subtitles');
    // HTML requires a non-empty srclang for kind="subtitles", and the probe file is English.
    expect(el.getAttribute('srclang')).toBe('en');
    expect(document.querySelectorAll('[data-subtitle-track]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-subtitle-player]')).toHaveLength(1);
    // A CHILD of the media element. A `<track>` that is a sibling is inert — no TextTrack is
    // created for it at all — and on a screen with no devtools that is indistinguishable from
    // a television that parses no WebVTT, which is the reading this arm is the gate for.
    expect(el.parentElement).toBe(player('s27a'));
    expect(cellText('s27a', 'Subtitle file present?')).toBe('yes');
    // ARM 27a'S MEDIA SRC IS DELIBERATELY UNRESOLVABLE, and it is the arm's whole design: the
    // measured fact is that a late `<track default>` reaches `showing` with its cues parsed
    // EVEN WITH THE ELEMENT IN THE ERROR STATE, which is what makes this arm need no clip. A
    // src that worked would make the gate depend on an artefact nobody has produced, and a
    // backend src would put libtorrent, FastAPI, the session gate and the ARM download cap
    // back in the one path that was built to have none of them.
    expect(player('s27a')!.getAttribute('src')).toMatch(/^\/samples\//);
    expect(player('s27a')!.getAttribute('src')).not.toBe(VTT);
    expect(player('s27a')!.getAttribute('src')).not.toMatch(/^\/api/);
  });

  it('mounts nothing at all while the probe is still in flight', async () => {
    // The 404 row below proves the ANSWERED-404 state; this one proves the window before any
    // answer, which is a different state and the one a slow television actually sits in. The
    // page-wide mock hangs for ever, so this is that window held open.
    render(<DiagPage />);
    fireEvent.click(within(arm('s27a')!).getByRole('button', { name: /^load /i }));
    await act(async () => {});
    expect(trackEl('s27a'), 'no element until the probe answers').toBeNull();
    expect(player('s27a')).toBeNull();
    expect(cellText('s27a', 'HTTP — the .vtt'), 'and no status yet either').toBe('not probed');
  });

  it('mounts the control clip on arm 27b, not the unresolvable src', async () => {
    // 27b's entire difference from 27a is that there is a real decoded frame behind the cue,
    // so an arm pointed at the bogus src would answer 27a's question twice and reading 27b
    // would stay untaken while looking taken.
    mockSamples();
    render(<DiagPage />);
    await loadArm('s27b');
    await waitFor(() => expect(player('s27b')).not.toBeNull());
    expect(player('s27b')!.getAttribute('src')).toBe(CLIP);
    expect(trackEl('s27b')!.getAttribute('src')).toBe(VTT);
  });

  it('mounts the line:-4 file on arm 32 and the plain one on arm 27a — one variable, two arms', async () => {
    // The two files differ by exactly one thing, so an arm pointed at the wrong one would
    // answer reading 32 with reading 27a's file and nothing would say so.
    mockSamples();
    render(<DiagPage />);
    await loadArm('s32');
    await waitFor(() => expect(trackEl('s32')).not.toBeNull());
    expect(trackEl('s32')!.getAttribute('src')).toBe(VTT_LINE);

    await loadArm('s27a');
    await waitFor(() => expect(trackEl('s27a')).not.toBeNull());
    expect(trackEl('s27a')!.getAttribute('src')).toBe(VTT);
    expect(trackEl('s32'), 'one arm at a time').toBeNull();
  });

  it('probes with a plain HEAD, no-store and same-origin, and touches no backend path', async () => {
    // The `classify.ts` init. `no-store` because a cached 404 from before the file was copied
    // over is the one answer this probe may never give; HEAD because a GET of a 4MB sidecar
    // over a television's wifi to learn a status is the same mistake the far-seek probe's
    // `body.cancel()` exists to prevent. And arm 27a's whole premise is that nothing it needs
    // comes from FastAPI, so a request to `/api` here would destroy the gate.
    const calls = mockSamples();
    render(<DiagPage />);
    await loadArm('s27a');
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));

    expect(calls[0].url).toBe(VTT);
    expect(calls[0].init?.method).toBe('HEAD');
    expect(calls[0].init?.cache).toBe('no-store');
    expect(calls[0].init?.credentials).toBe('same-origin');
    expect(calls.every((c) => !c.url.startsWith('/api')), 'no backend in arm 27a').toBe(true);
  });

  it('probes every arm’s files from one press, each as its own reading', async () => {
    // Six requests, not two: each arm's cell is its own transcribed line, and an arm whose
    // status was inherited from a sibling is an arm whose reading is a copy. Parallel, so one
    // request that never settles cannot stop the others.
    const calls = mockSamples();
    render(<DiagPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /probe every arm/i }));
    });
    await waitFor(() => {
      expect(cellText('s27a', 'HTTP — the .vtt')).toBe('HEAD /samples/cue-probe.vtt -> 200 OK');
      expect(cellText('s32', 'HTTP — the .vtt')).toBe('HEAD /samples/cue-probe-line.vtt -> 200 OK');
      expect(cellText('s27b', 'HTTP — the clip')).toBe(`HEAD ${CLIP} -> 200 OK`);
    });
    expect(calls.map((c) => c.url)).toContain(VTT_LINE);
    expect(calls.every((c) => c.init?.method === 'HEAD'), 'HEAD, never GET').toBe(true);
    // Nothing was mounted by probing: this press is the one that tells an operator the files
    // are there without asking the panel to decode or parse anything.
    expect(document.querySelector('[data-subtitle-track]')).toBeNull();
  });

  it('keeps the clip’s absence in its own field, and mounts nothing when only the clip is missing', async () => {
    // 27b's two artefacts fail in two different ways and only one of them is this stage's: the
    // `.vtt` is committed, the clip is a gitignored binary nobody has produced. One `present`
    // field for both would send the operator to produce a file that is already there.
    mockSamples({ [CLIP]: 404 });
    render(<DiagPage />);
    await loadArm('s27b');

    await waitFor(() => {
      expect(cellText('s27b', 'Clip present?')).toBe('FILE NOT PRESENT — nothing was mounted');
      expect(player('s27b')).toBeNull();
    });
    expect(cellText('s27b', 'Subtitle file present?'), 'the .vtt is there').toBe('yes');
    expect(cellText('s27b', 'HTTP — the clip')).toBe(`HEAD ${CLIP} -> 404 Not Found`);
    expect(cellText('s27b', 'HTTP — the .vtt')).toBe('HEAD /samples/cue-probe.vtt -> 200 OK');
  });

  it('does not call a thrown HEAD an absent file', async () => {
    // FOUND BY RUNNING A MUTATION NOBODY PRESCRIBED: with `present: 'unknown'` changed to
    // `'no'` on the throw path, all 24 rows here stayed GREEN — three values, and no row could
    // tell two of them apart. A LAN or server failure reported as FILE NOT PRESENT sends the
    // operator to copy over a file that is already committed, and for arm 27a — the gate —
    // that is the difference between "this build is serving another tree" and "the television
    // paints no cues".
    vi.spyOn(globalThis, 'fetch').mockImplementation((() =>
      Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch);
    render(<DiagPage />);
    await loadArm('s27a');

    await waitFor(() => {
      expect(cellText('s27a', 'HTTP — the .vtt')).toMatch(/-> fetch failed: TypeError: Failed to fetch$/);
      expect(trackEl('s27a'), 'and still nothing mounted').toBeNull();
    });
    expect(cellText('s27a', 'Subtitle file present?'), 'not absence').toBe('unknown');
    // And the FILE NOT PRESENT paragraph, which names the action to take, stays off the page.
    expect(armText('s27a')).not.toMatch(/not a text-track result/i);
  });

  it('keeps the status, the cue count and VISIBLE as three separate fields', async () => {
    // The plan's mutation (c), and the hazard is specific: on the subtitle routes a 401 is
    // BODILESS by design, a signature-valid body with no cues in it loads at readyState 2 and
    // fires NO EVENT AT ALL, and a cue that parses but paints behind the scrim is a third
    // thing. One ok/failed cell makes all three the same reading. Three labels, three values,
    // none of which a collapsed field could carry.
    mockSamples();
    render(<DiagPage />);
    await loadArm('s27a');
    await waitFor(() => expect(player('s27a')).not.toBeNull());

    fakeTextTracks(player('s27a')!, [{ mode: 'showing', cues: { length: 0 } }]);
    fireEvent.click(within(arm('s27a')!).getByRole('button', { name: /sample this arm now/i }));
    fireEvent.click(within(arm('s27a')!).getByRole('button', { name: /cue text visible: no/i }));

    await waitFor(() => expect(cellText('s27a', 'cues.length')).toBe('0'));
    expect(cellText('s27a', 'HTTP — the .vtt')).toBe('HEAD /samples/cue-probe.vtt -> 200 OK');
    expect(cellText('s27a', 'textTracks[0].mode'), 'the track loaded and is showing').toBe('showing');
    expect(cellText('s27a', 'Cue text VISIBLE'), 'and the operator saw nothing').toBe('no');
  });

  it('prints every machine field verbatim, including values jsdom cannot produce', async () => {
    // The positive control for all four machine fields at once. Without it a sampler that
    // wrote the em dash unconditionally would satisfy every other row here, which is the
    // "recorder with no positive control" shape this branch keeps finding.
    mockSamples();
    render(<DiagPage />);
    await loadArm('s27a');
    await waitFor(() => expect(player('s27a')).not.toBeNull());

    fakeTextTracks(player('s27a')!, [{ mode: 'showing', cues: { length: 4 } }]);
    Object.defineProperty(trackEl('s27a')!, 'readyState', { value: 2, configurable: true });
    fireEvent.click(within(arm('s27a')!).getByRole('button', { name: /sample this arm now/i }));

    await waitFor(() => expect(cellText('s27a', 'textTracks.length')).toBe('1'));
    expect(cellText('s27a', 'textTracks[0].mode')).toBe('showing');
    expect(cellText('s27a', 'cues.length')).toBe('4');
    expect(cellText('s27a', 'trackEl.readyState')).toBe('2');
    // WHEN the row was taken. `mode`, `cues.length` and `readyState` all change over time, so
    // a row that does not say when it was sampled is not a reading.
    expect(cellText('s27a', 'sampled at')).toBe('operator pressed Sample this arm');
  });

  it('tells an exposed zero from a field the engine does not expose at all', async () => {
    // Three states, not two, and this is the arm that proves the distinction is live: in this
    // suite `textTracks.length` really is 0 (jsdom puts a plain zero-length array where the
    // list should be) and `readyState` really is 0 (hardcoded), while `mode` and `cues.length`
    // have no value to print. A field that printed "0" for all four would make the suite's own
    // output look like a reading off a television.
    mockSamples();
    render(<DiagPage />);
    await loadArm('s27a');
    await waitFor(() => expect(player('s27a')).not.toBeNull());

    fireEvent.click(within(arm('s27a')!).getByRole('button', { name: /sample this arm now/i }));
    await waitFor(() => expect(cellText('s27a', 'sampled at')).toBe('operator pressed Sample this arm'));
    expect(cellText('s27a', 'textTracks.length'), 'jsdom: a zero-length array').toBe('0');
    expect(cellText('s27a', 'trackEl.readyState'), 'jsdom: hardcoded 0').toBe('0');
    expect(cellText('s27a', 'textTracks[0].mode'), 'no list, no mode').toBe('—');
    expect(cellText('s27a', 'cues.length'), 'no track, no cues').toBe('—');
  });

  it('records which of load/error fired, in order, from a non-bubbling dispatch', async () => {
    // The element's own `readyState` is a hardcoded 0 in every suite here and `trackEl.track`
    // is undefined, so WHICH EVENT FIRED is the only instrument — and both props must be
    // CAPTURE props: react-dom 19's `listenToNonDelegatedEvent` block covers
    // `embed`/`source`/`link`, `case "track":` falls through without them, and the native
    // events do not bubble, so `onLoad`/`onError` on a `<track>` are dead code.
    //
    // THE DISPATCH MUST BE NON-BUBBLING, and that is a caution not a detail: a bubbling one
    // reaches the `<video>`'s own `onError` too, which re-samples the arm — so it would fire
    // both props at once and the bubble-prop mutation could not be discriminated from it.
    mockSamples();
    render(<DiagPage />);
    await loadArm('s27a');
    await waitFor(() => expect(trackEl('s27a')).not.toBeNull());

    const el = trackEl('s27a')!;
    act(() => {
      el.dispatchEvent(new Event('error', { bubbles: false }));
    });
    await waitFor(() => expect(cellText('s27a', 'which of load/error fired')).toBe('error'));
    // APPENDED, not replaced: a track that errors and then loads is a different reading from
    // one that only errors, and a recorder that overwrote would print the last event as if it
    // were the only one.
    act(() => {
      el.dispatchEvent(new Event('load', { bubbles: false }));
    });
    await waitFor(() => expect(cellText('s27a', 'which of load/error fired')).toBe('error, load'));
  });

  it('records textTracks.length after each video.load(), as a sequence', async () => {
    // Reading 35. One element, `textTracks` 1 -> 2 -> 3 on Chromium 155, every copy showing
    // and painting; the sequence IS the reading, so a single number would answer "how many
    // now" and not "does load() duplicate". jsdom's `load` is not implemented, so it is
    // stubbed, and the lengths are forced — the engine is the thing that duplicates and no
    // suite here can make it.
    const load = vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    mockSamples();
    render(<DiagPage />);
    await loadArm('s35');
    await waitFor(() => expect(player('s35')).not.toBeNull());

    const v = player('s35')!;
    fakeTextTracks(v, [{ mode: 'showing', cues: { length: 4 } }]);
    fireEvent.click(within(arm('s35')!).getByRole('button', { name: /call video\.load\(\) again/i }));
    await waitFor(() => expect(cellText('s35', 'after each video.load()')).toBe('1'));
    expect(load).toHaveBeenCalledTimes(1);

    fakeTextTracks(v, [{ mode: 'showing', cues: { length: 4 } }, { mode: 'showing', cues: { length: 4 } }]);
    fireEvent.click(within(arm('s35')!).getByRole('button', { name: /call video\.load\(\) again/i }));
    await waitFor(() => expect(cellText('s35', 'after each video.load()')).toBe('1 -> 2'));

    // THREE presses, not two, and the third is not decoration: the measured shape is 1 -> 2 ->
    // 3, and with only two entries a recorder that keeps the LAST TWO is indistinguishable
    // from one that keeps them all. Measured — that mutation stayed green on a two-press
    // fixture, which is this plan's "a fixture too small to reach the boundary" shape in a
    // test I wrote myself.
    fakeTextTracks(v, [
      { mode: 'showing', cues: { length: 4 } },
      { mode: 'showing', cues: { length: 4 } },
      { mode: 'showing', cues: { length: 4 } },
    ]);
    fireEvent.click(within(arm('s35')!).getByRole('button', { name: /call video\.load\(\) again/i }));
    await waitFor(() => expect(cellText('s35', 'after each video.load()')).toBe('1 -> 2 -> 3'));
  });

  it('unmounts the <track> while keeping the <video>, which is the guard the player ships', async () => {
    // The player unmounts the element while `recovery.kind === 'reloading'` — the `<video>`
    // stays, because it is the film. An arm that could only unmount both would be measuring a
    // remount, which is a different thing and the one the operator can already do with Load.
    mockSamples();
    render(<DiagPage />);
    await loadArm('s35');
    await waitFor(() => expect(trackEl('s35')).not.toBeNull());

    fireEvent.click(within(arm('s35')!).getByRole('button', { name: /unmount the <track>/i }));
    await waitFor(() => expect(trackEl('s35')).toBeNull());
    expect(player('s35'), 'the film stays').not.toBeNull();

    fireEvent.click(within(arm('s35')!).getByRole('button', { name: /mount the <track> again/i }));
    await waitFor(() => expect(trackEl('s35')).not.toBeNull());
  });

  it('renders the ::cue rule only on its own arm, and the TV stylesheet still carries none', async () => {
    // Reading 30's instrument, and the reason it is inline: `bigscreen.css` ships no `::cue`
    // rule on purpose (its own comment says so) because no reading from the set has scoped
    // one, and a probe must not become a production rule by being left behind. Comments
    // stripped before the stylesheet is scanned — it names `::cue` in prose to explain the
    // absence, which a raw scan would read as a rule.
    mockSamples();
    render(<DiagPage />);
    expect(document.querySelector('style')).toBeNull();

    await loadArm('s30');
    await waitFor(() => expect(player('s30')).not.toBeNull());
    expect(arm('s30')!.querySelector('style')?.textContent).toBe('::cue { color: var(--gold); }');

    await loadArm('s27a');
    await waitFor(() => expect(player('s27a')).not.toBeNull());
    expect(document.querySelector('style'), 'only the ::cue arm carries it').toBeNull();

    expect(TV_CSS.replace(/\/\*[\s\S]*?\*\//g, ' ')).not.toMatch(/::cue/);
  });

  it('makes the operator’s answers part of the persisted record, per arm and per question', async () => {
    // The answers no code can produce — whether text was VISIBLE, whether it was GOLD, whether
    // `line:-4` moved it — have to be stored exactly like the machine fields, and this project
    // has lost a device sitting to exactly that: the key log was run on the television and
    // nothing was written down.
    render(<DiagPage />);
    fireEvent.click(within(arm('s27a')!).getByRole('button', { name: /cue text visible: yes/i }));
    fireEvent.click(within(arm('s30')!).getByRole('button', { name: /cue text was gold: no/i }));
    fireEvent.click(within(arm('s32')!).getByRole('button', { name: /cue sat higher: yes/i }));

    await waitFor(() => expect(stored()?.s27a?.visible).toBe('yes'));
    expect(cellText('s27a', 'Cue text VISIBLE')).toBe('yes');
    expect(cellText('s30', 'Cue text was GOLD')).toBe('no');
    expect(cellText('s32', 'Cue sat HIGHER')).toBe('yes');
    // Per arm, not a page-wide flag: 27a and 27b ask the same question of two different
    // pictures and one answer for both would hide the disagreement that makes 27b worth taking.
    expect(cellText('s27b', 'Cue text VISIBLE')).toBe('not answered');
    expect(stored()?.s30?.visible).toBe('not answered');
  });

  it('survives the unmount and remount that leaving this page is', async () => {
    mockSamples();
    const first = render(<DiagPage />);
    await loadArm('s27a');
    await waitFor(() => expect(player('s27a')).not.toBeNull());
    fakeTextTracks(player('s27a')!, [{ mode: 'showing', cues: { length: 4 } }]);
    fireEvent.click(within(arm('s27a')!).getByRole('button', { name: /sample this arm now/i }));
    fireEvent.click(within(arm('s27a')!).getByRole('button', { name: /cue text visible: yes/i }));
    await waitFor(() => expect(stored()?.s27a?.visible).toBe('yes'));

    first.unmount();
    expect(document.querySelector('[data-subtitle-arm]')).toBeNull();

    render(<DiagPage />);
    // ON THE CELL, never row-wide: a row-wide /yes/ matches the "Cue text visible: yes" BUTTON
    // and therefore cannot fail — measured in the codec section, where it survived thirty
    // green runs.
    await waitFor(() => expect(cellText('s27a', 'Cue text VISIBLE')).toBe('yes'));
    expect(cellText('s27a', 'cues.length')).toBe('4');
    expect(cellText('s27a', 'textTracks[0].mode')).toBe('showing');
    expect(cellText('s27a', 'HTTP — the .vtt')).toMatch(/-> 200 OK$/);
  });

  it('clears back to “not taken”, never to a blank', async () => {
    render(<DiagPage />);
    fireEvent.click(within(arm('s27a')!).getByRole('button', { name: /cue text visible: yes/i }));
    await waitFor(() => expect(stored()?.s27a?.visible).toBe('yes'));

    fireEvent.click(screen.getByRole('button', { name: /clear subtitle readings/i }));
    await waitFor(() => expect(stored()?.s27a?.visible).toBe('not answered'));
    // Every machine cell by name, so "not a blank" is checked per cell rather than by a
    // row-wide /not taken/ that any one of them satisfies for all six.
    for (const label of ['textTracks.length', 'textTracks[0].mode', 'cues.length', 'trackEl.readyState', 'which of load/error fired', 'sampled at']) {
      expect(cellText('s27a', label), label).toBe('not taken');
    }
    expect(cellText('s27a', 'HTTP — the .vtt')).toBe('not probed');
    expect(cellText('s27a', 'Subtitle file present?')).toBe('unknown');
  });

  it('adds no focus stop to the readout, and leaves the way out first', async () => {
    // The rows are read-only text. The only focus stops this section adds are plain buttons —
    // the stage-8 instrument's own idiom, and the only way a remote can answer a question it
    // cannot type — and the exit stays the first stop on a page that mounts no focus grid,
    // which is the invariant `journeys.test.tsx` checks for every screen at once.
    const { container } = render(<DiagPage />);
    for (const id of ['s27a', 's27b', 's30', 's32', 's35']) {
      expect(arm(id)!.querySelectorAll('[tabindex]'), id).toHaveLength(0);
      expect(arm(id)!.querySelectorAll('a[href]'), id).toHaveLength(0);
    }
    const stops = Array.from(container.querySelectorAll<HTMLElement>('a[href], button, [tabindex]'));
    expect(stops[0]).toHaveAttribute('href', '/bigscreen');
  });

  it('says what it cannot measure, and does not claim the band geometry', async () => {
    // Prose rather than values, and the question is whether the page says these things at all.
    // SCOPED TO THE SECTION'S OWN PREAMBLE, because two of these sentences are deliberately
    // repeated in an arm's note — an operator reads the arm they are loading, not the preamble
    // — and a page-wide match would make either copy satisfy the claim, so deleting one would
    // be green. Measured: before the container existed, deleting "may not share a cell" from
    // the preamble left this row passing on arm 27a's note.
    render(<DiagPage />);
    const intro = document.querySelector('[data-subtitle-intro]');
    expect(intro, 'the section preamble').not.toBeNull();
    const text = intro!.textContent ?? '';
    expect(text, 'the suite cannot answer this').toMatch(/No suite in this project can answer/i);
    expect(text, 'and says so as a posture, not an excuse').toMatch(/asserts nothing and claims nothing/i);
    expect(text, '27a’s whole design').toMatch(/one.{0,3} candidate\s*\n?\s*cause/i);
    expect(text, 'the sheet’s rule').toMatch(/Transcribe every cell verbatim/i);
    expect(text, 'a zero-cue reading and an invisible-cue reading are different facts').toMatch(
      /may not share a cell/i,
    );
    // And the operator's own instruction on the arm they will actually load.
    expect(armText('s27a')).toMatch(/answer the VISIBLE question by hand/i);
    // Reading 32's limit. This page's video box is not the player's geometry, so a 480px guide
    // drawn here would be a fabricated measurement; the arm asks the question it can answer.
    expect(armText('s32')).toMatch(/NOT the player.{0,3}s geometry/i);
    // Reading 30's refusal: a CSS.supports/cssRules probe answers yes for properties Blink
    // retains and ignores, so it may not stand in for the panel.
    expect(armText('s30')).toMatch(/DO NOT substitute a CSS\.supports/i);
    // And that a missing clip is expected rather than a defect, while a missing .vtt is not.
    expect(armText('s27b')).toMatch(/not in the repository/i);
  });
});

/**
 * The instrument's source and its two committed probe files, for the rules no render can show.
 *
 * `apiClient`'s interceptor never fires in jsdom — there is no 401 and no navigation to
 * observe — so routing a probe through it is invisible to every behavioural test on this
 * surface and visible only here. And the `.vtt` files are data: nothing that renders this page
 * parses them, because no parser exists in this suite, so their shape is only checkable as
 * text.
 */
describe('/bigscreen/diag: the subtitle instrument’s source and samples', () => {
  /** Comments stripped, crudely and adequately — the file's own header names every rule. */
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  it('strips comments and nothing else', () => {
    // THE POSITIVE CONTROL FOR THE SCANNER. Without it a `code()` that returned the empty
    // string would make the two rows below pass against any source at all.
    expect.soft(code('/* apiClient */ const a = 1;')).toBe('  const a = 1;');
    expect.soft(code('// @/services/streaming\nconst b = 2;')).toBe(' \nconst b = 2;');
    expect.soft(code(SRC), 'the real file still has code in it').toContain('SUBTITLE_ARMS');
  });

  /**
   * Import SPECIFIERS, the `legacy-target.test.ts` / `journeys.test.tsx` helper, rather than a
   * regex over the import lines: the thing being judged is an edge, and a specifier is what
   * names it.
   */
  const importSpecifiers = (src: string): string[] => {
    const out: string[] = [];
    const re = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) out.push(m[1]);
    return out;
  };

  /** Anything that would put the axios client, or any service module, behind this probe. */
  const FORBIDDEN_EDGE = /(^|\/)services\//;

  it('finds every spelling of the import it forbids', () => {
    // THE POSITIVE CONTROL FOR THE MATCHER, and it is here because the first version of the
    // row below could not fail against a live spelling: it scanned the import LINES for
    // `@/services` and for the identifier `apiClient`, so
    // `import apiThing from '../../../../services/api-client'` — a relative specifier that
    // escapes `(bigscreen)` and binds the client under another name — passed it. Measured
    // green. That is this plan's "a matcher so specific it misses the live spellings" shape, in
    // a guard I wrote myself, and it is the exact trap a trailing `(` set for this branch's
    // banned-name scan.
    for (const spec of [
      '@/services/api-client',
      '@/services/streaming',
      '../../../../services/api-client',
      './services/foo',
    ]) {
      expect.soft(FORBIDDEN_EDGE.test(spec), `${spec} must be rejected`).toBe(true);
    }
    for (const spec of ['react', 'next/link', './page', '@/types']) {
      expect.soft(FORBIDDEN_EDGE.test(spec), `${spec} must be allowed`).toBe(false);
    }
  });

  it('imports no service module and calls fetch itself', () => {
    // The plan's mutation (b). `apiClient`'s response interceptor hard-navigates to the
    // sign-in page on a 401, which would take the operator off the instrument mid-reading and
    // lose the line it had just produced — the failure this whole page exists because of. The
    // check is on the SPECIFIERS, because this page's prose names the client in order to forbid
    // it, and on the path rather than the binding, because the binding can be renamed.
    const specs = importSpecifiers(SRC);
    expect.soft(specs.length, 'the scan found this file’s imports').toBeGreaterThan(1);
    expect.soft(specs.filter((s) => FORBIDDEN_EDGE.test(s)), 'no service module, by any spelling').toEqual([]);
    expect.soft(specs.filter((s) => /axios|api-client/.test(s)), 'and no axios client').toEqual([]);
    expect.soft(code(SRC), 'the probe is a plain fetch').toMatch(/fetch\(/);
    // NO `cache: 'no-store'` / `credentials: 'same-origin'` TEXT PIN HERE, deliberately. The
    // behavioural row above reads the init the probe actually passes, which is strictly
    // stronger than a text match, and a second copy of one rule is a rule where deleting
    // either copy stays green — the shape this branch keeps finding, and the reason
    // `noCrossOrigin.test.ts` refuses its own second copy by name.
  });

  it('keeps the probe files in the converter’s own output grammar', () => {
    // A probe written in a laxer form would measure one of the five leniencies Chromium 155
    // allows and Chromium 120 may not — no blank line after the magic, no spaces around the
    // arrow, 1-digit hours, CR-only endings, an absent hours field — which is a different
    // question from the one reading 27a asks. The grammar here is the backend emitter's:
    // `WEBVTT`, a blank line, no cue identifiers, HH:MM:SS.mmm with one space each side, LF.
    for (const [name, src] of [['cue-probe.vtt', CUE_PROBE], ['cue-probe-line.vtt', CUE_PROBE_LINE]] as const) {
      expect.soft(src.startsWith('WEBVTT\n\n'), `${name}: magic + blank line`).toBe(true);
      expect.soft(src, `${name}: LF endings`).not.toMatch(/\r/);
      expect.soft(src, `${name}: no NOTE block — its support would be a second candidate cause`)
        .not.toMatch(/^NOTE/m);
      const timings = src.match(/^\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}.*$/gm) ?? [];
      expect.soft(timings, `${name}: four cues`).toHaveLength(4);
      // No cue identifiers, which the emitter does not produce either: a line of digits before
      // a timing line is a cue id, and one before a cue the probe did not mean to identify
      // would be a shape difference from the converter's output.
      expect.soft(src, `${name}: no cue identifiers`).not.toMatch(/^\d+$/m);
      // The first cue must start at zero and run long: an element in the error state has a
      // clock that never advances, so a cue starting later can never paint in arm 27a — the
      // one arm that needs no clip.
      expect.soft(timings[0], `${name}: the first cue starts at 0`).toMatch(/^00:00:00\.000 --> 00:10:00\.000/);
      expect.soft(src.endsWith('\n'), `${name}: trailing newline`).toBe(true);
    }
  });

  it('differs between the two probe files by exactly one variable', () => {
    // Stage 8's lesson about clips 1 and 2, applied to a text file: reading 32 compares the
    // two, so anything that differs other than the cue setting is a second variable and the
    // reading becomes unattributable. CUE 1's text is the one deliberate exception, because an
    // operator who cannot tell which file is on screen transcribes the wrong arm.
    const strip = (s: string) => s.replace(/ line:-4$/gm, '');
    const [plain, lined] = [CUE_PROBE.split('\n\n'), strip(CUE_PROBE_LINE).split('\n\n')];
    expect.soft(lined.length).toBe(plain.length);
    // Every block but the first is identical once the setting is removed.
    expect.soft(lined.slice(2)).toEqual(plain.slice(2));
    expect.soft(lined[1].split('\n')[0], 'the timing lines match').toBe(plain[1].split('\n')[0]);
    // And the setting really is on every timing line, not just the first.
    expect.soft((CUE_PROBE_LINE.match(/ line:-4$/gm) ?? []).length).toBe(4);
    expect.soft(CUE_PROBE, 'the plain file carries no cue setting at all').not.toMatch(/line:/);
    // The one deliberate text difference, named here so it is not "tidied" away.
    expect.soft(CUE_PROBE_LINE).toMatch(/cue-probe-line\.vtt/);
  });
});
