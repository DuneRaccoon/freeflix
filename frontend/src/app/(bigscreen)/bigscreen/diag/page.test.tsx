import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import DiagPage from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const SRC = readFileSync('src/app/(bigscreen)/bigscreen/diag/page.tsx', 'utf8');

const KEY_LOG_STORAGE = 'bs-diag:keylog';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
  // The key log is persisted now, and sessionStorage outlives a render. Without this one
  // test's presses are the next test's "restored" log.
  sessionStorage.clear();
});

/**
 * The field instrument's own test, and it is about ONE thing: a viewer who reaches this
 * screen from home's nav row with nothing but a remote has to be able to leave again.
 *
 * Everything else here is deliberately untested. This page's job is to report what an engine
 * nobody can attach a debugger to actually does — `navigator.userAgent`, CSS and JS feature
 * probes, the remote's key codes, a real `<video>`, a raw Range request — and a jsdom
 * assertion about any of that would be an assertion about jsdom. It also carries the
 * surface's only `@allow-legacy-probes` marker precisely because it names constructs every
 * other TV file is forbidden to name.
 */
describe('/bigscreen/diag: the way out', () => {
  it('offers an on-screen, focusable way home', async () => {
    // Reachable from NAV_TARGETS, so a remote can get here on its own. Without this control
    // there was no in-app exit at all: Back was handed to the browser, which walks history
    // and can leave `(bigscreen)` — which a remote cannot type its way back from, and which
    // is the hazard five other screens' comments name.
    render(<DiagPage />);
    const home = await screen.findByRole('link', { name: /back to home/i });
    expect(home).toHaveAttribute('href', '/bigscreen');
  });

  it('puts it before the probes, where the ring can reach it without crossing the page', () => {
    // Native focus order is the only navigation on this screen — it mounts no focus grid,
    // because whether the set's D-pad moves native focus at all is one of the things it is
    // here to find out. So the exit goes first, not after six tiles, a key log and a video.
    const { container } = render(<DiagPage />);
    const stops = Array.from(
      container.querySelectorAll<HTMLElement>('a[href], button, [tabindex]'),
    );
    expect(stops.length).toBeGreaterThan(1);
    expect(stops[0]).toHaveAttribute('href', '/bigscreen');
  });

  it('claims no Back key, so the key log can report what the remote actually sends', () => {
    // The one screen on this surface that must NOT claim Back. Reading what Back produces is
    // this page's whole purpose, and a handler that navigated home would take the viewer off
    // the screen before they could read the line it just logged. The on-screen control above
    // is what replaces it — the same answer the profile keypad already gives, whose own
    // comment calls it "a way out that does not depend on the remote's own Back key being
    // recognised".
    //
    // The same assertion now also pins that it uses neither `useMediaKeys` nor
    // `useRevealOnKey` (stage 7, task 7). Both are filters — chords rejected, bails on
    // `defaultPrevented`, acts only on keys already in a recognition list — so routing
    // presses through them would make this page report its own lists back to itself instead
    // of reporting the device. The raw `window` listeners are the measurement.
    // Checked on the IMPORTS, not on the whole file: this page's probe section names both
    // hooks in a comment on purpose, to explain which modifier flags would make the D-pad
    // inert everywhere. `journeys.test.tsx` owns the surface-wide version of this assertion
    // (it classifies every screen's Back three ways and strips comments to check the call).
    const imports = (SRC.match(/^import .*$/gm) ?? []).join('\n');
    expect(imports).not.toMatch(/_focus/);
    expect(imports).toMatch(/next\/link/);
  });

  it('still logs a Back press after the exit was added', async () => {
    render(<DiagPage />);
    await waitFor(() => expect(screen.getByText(/waiting for a key/)).toBeInTheDocument());
    fireEvent.keyDown(window, { key: 'Backspace', keyCode: 8 });
    await waitFor(() => expect(screen.queryByText(/waiting for a key/)).toBeNull());
    expect(document.querySelector('.bs-keylog')?.textContent).toMatch(/Backspace|8/);
  });
});

/**
 * The instrument's own tests, and they are about ONE thing: this page cannot lose a reading.
 *
 * `useBackKey.ts:8-11` records the failure these exist to stop recurring — the key log *was*
 * run on the television and what it showed was never written down, so six merged stages rest
 * on one key number carried as an assumption. Pressing Back is itself a navigation, so the
 * line that press produced used to be destroyed by the press that produced it.
 *
 * What is pinned here is durability and completeness of the *instrument*: a keyup line exists,
 * the log survives a remount, twenty lines are twenty lines, the mediaSession probe cannot
 * throw, and the far-seek probe still refuses to drain a 206. What is NOT pinned, and cannot
 * be, is any device behaviour: every value this page reports comes from the engine it is run
 * on, and in jsdom that engine is jsdom. The readings live in
 * `docs/superpowers/plans/2026-10-10-tv-stage7-device-readings.md`, whose failure mode is a
 * visible blank row and which deliberately has no test.
 */
describe('/bigscreen/diag: the instrument cannot lose its reading', () => {
  const logText = () => document.querySelector('.bs-keylog')?.textContent ?? '';
  const logLines = () => Array.from(document.querySelectorAll('.bs-keylog > div'));

  it('logs keyup as well as keydown, labelled so one can be told from the other', async () => {
    // A transport key that arrives only on keyup read as "the television eats it" — the wrong
    // conclusion to draw from a silent log, and the one most likely to be drawn, because a
    // keydown-only instrument cannot distinguish "not delivered" from "delivered later".
    render(<DiagPage />);
    fireEvent.keyDown(window, { key: 'MediaPlay', keyCode: 415 });
    fireEvent.keyUp(window, { key: 'MediaPlay', keyCode: 415 });
    await waitFor(() => expect(logLines()).toHaveLength(2));
    expect(logText()).toMatch(/\[keydown\][^[]*keyCode=415/);
    expect(logText()).toMatch(/\[keyup\][^[]*keyCode=415/);
  });

  it('records a keyup-only key, which a keydown listener alone reports as silence', async () => {
    render(<DiagPage />);
    fireEvent.keyUp(window, { key: 'MediaFastForward', keyCode: 417 });
    await waitFor(() => expect(logLines()).toHaveLength(1));
    expect(logText()).toMatch(/\[keyup\][^[]*keyCode=417/);
  });

  it('survives an unmount and remount, which is what a Back press does to this page', async () => {
    // THE point of the task. Back is handed to the browser here (deliberately — see above),
    // so it walks history and takes this component with it. The line Back logged must still
    // be on screen when the operator comes back to transcribe it.
    const first = render(<DiagPage />);
    fireEvent.keyDown(window, { key: 'Unidentified', keyCode: 461 });
    await waitFor(() => expect(logText()).toMatch(/keyCode=461/));
    expect(sessionStorage.getItem(KEY_LOG_STORAGE), 'persisted, not just rendered').toMatch(/461/);

    first.unmount();
    expect(document.querySelector('.bs-keylog')).toBeNull();

    render(<DiagPage />);
    await waitFor(() => expect(logText()).toMatch(/keyCode=461/));
    expect(logText()).not.toMatch(/waiting for a key/);
  });

  it('appends to a restored log rather than replacing it', async () => {
    // The restore must not become the log: a second visit's presses go on top of the first
    // visit's, or the operator reads one sitting as two and the earliest press is gone again.
    const first = render(<DiagPage />);
    fireEvent.keyDown(window, { key: 'Unidentified', keyCode: 461 });
    await waitFor(() => expect(logLines()).toHaveLength(1));
    first.unmount();

    render(<DiagPage />);
    await waitFor(() => expect(logLines()).toHaveLength(1));
    fireEvent.keyDown(window, { key: 'Unidentified', keyCode: 415 });
    await waitFor(() => expect(logLines()).toHaveLength(2));
    expect(logText()).toMatch(/keyCode=461/);
    expect(logText()).toMatch(/keyCode=415/);
  });

  it('keeps twenty lines, because twelve dropped the press the sheet needs most', async () => {
    // keydown + keyup for seven buttons plus four arrows is twenty-two lines before a single
    // auto-repeat, and at a cap of 12 the earliest press — usually Back — fell off the end
    // silently, pushed out by the presses that came after it.
    render(<DiagPage />);
    for (let i = 0; i < 20; i += 1) {
      fireEvent.keyDown(window, { key: `K${i}`, keyCode: 900 + i });
    }
    await waitFor(() => expect(logLines()).toHaveLength(20));
    expect(logText(), 'the FIRST press is still readable').toMatch(/keyCode=900\D/);
  });

  it('stamps each line with a time, so a held arrow’s repeat rate is readable', async () => {
    // One of the thirteen readings is the auto-repeat rate, which decides whether ±10s needs
    // acceleration. Without a timestamp it cannot be filled in from this screen at all.
    render(<DiagPage />);
    fireEvent.keyDown(window, { key: 'ArrowRight', keyCode: 39 });
    await waitFor(() => expect(logLines()).toHaveLength(1));
    expect(logText()).toMatch(/\[keydown\] t=\d+ /);
  });

  it('marks an auto-repeat, and marks a fresh press by its absence', async () => {
    render(<DiagPage />);
    fireEvent.keyDown(window, { key: 'ArrowRight', keyCode: 39, repeat: true });
    await waitFor(() => expect(logLines()).toHaveLength(1));
    expect(logText()).toMatch(/REPEAT/);
    expect(logLines()[0].textContent).toMatch(/REPEAT$/);
  });

  it('offers a way to clear the log, which persistence made necessary', async () => {
    // A log that outlives the page also outlives the sitting. Without this the operator
    // cannot tell which lines belong to the press they just made.
    render(<DiagPage />);
    fireEvent.keyDown(window, { key: 'Enter', keyCode: 13 });
    await waitFor(() => expect(logLines()).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: /clear key log/i }));
    await waitFor(() => expect(screen.getByText(/waiting for a key/)).toBeInTheDocument());
    expect(JSON.parse(sessionStorage.getItem(KEY_LOG_STORAGE) ?? 'null')).toEqual([]);
  });

  it('tells the operator to read the keys before loading a title', async () => {
    // `<video controls>` means the television's own control UI may consume the arrows and the
    // transport buttons, so a log taken with a title loaded under-reports — a key that works
    // reads as a key the set eats. The instruction is the only thing standing between the
    // operator and a sheet full of wrong negatives.
    const { container } = render(<DiagPage />);
    const text = container.textContent ?? '';
    expect(text).toMatch(/before you load a title/i);
    expect(text).toMatch(/control UI may consume the arrows/i);
    // And that 461 is not presented as the expected answer.
    expect(text).toMatch(/461 for Back is an assumption/i);
  });

  it('probes for navigator.mediaSession without throwing when it is absent', async () => {
    // Where the transport buttons go if they are not key events. jsdom has no mediaSession,
    // which is the case that must degrade to a readable "no" rather than a blank table.
    render(<DiagPage />);
    const row = (await screen.findByText(/navigator\.mediaSession/)).closest('tr');
    expect(row?.querySelector('td')?.textContent).toBe('no');
    expect(screen.queryByText(/Feature probing failed/)).toBeNull();
  });

  it('reports mediaSession as present when the engine has it', async () => {
    // Non-vacuity for the row above: a hard-coded verdict would pass one of these two.
    Object.defineProperty(navigator, 'mediaSession', {
      value: { setActionHandler() {} },
      configurable: true,
    });
    try {
      render(<DiagPage />);
      const row = (await screen.findByText(/navigator\.mediaSession/)).closest('tr');
      expect(row?.querySelector('td')?.textContent).toBe('yes');
      const handler = (await screen.findByText(/mediaSession\.setActionHandler/)).closest('tr');
      expect(handler?.querySelector('td')?.textContent).toBe('yes');
    } finally {
      Reflect.deleteProperty(navigator, 'mediaSession');
    }
  });

  it('still cancels the far-seek probe’s response body instead of draining it', async () => {
    // `probeFarRange` is the reference implementation and is deliberately unchanged by this
    // task; this is the test it never had. On a 206 the body IS THE REST OF THE FILM, so
    // draining it pulls gigabytes through a television to answer a question already answered
    // by the status line. There is no cheap way to notice that by hand.
    const cancel = vi.fn();
    const body = { cancel, getReader: vi.fn() };
    const text = vi.fn();
    const headers = (h: Record<string, string>) => ({
      get: (k: string) => h[k.toLowerCase()] ?? null,
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/torrents/list')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [{ torrent_id: 't1', movie_title: 'A Film' }] });
      }
      if (init?.method === 'HEAD') {
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', headers: headers({ 'content-length': '2000' }), body: null });
      }
      return Promise.resolve({
        ok: true,
        status: 206,
        statusText: 'Partial Content',
        headers: headers({ 'content-range': 'bytes 1800-1999/2000' }),
        body,
        text,
      });
    }) as unknown as typeof fetch);

    render(<DiagPage />);
    fireEvent.click(screen.getByRole('button', { name: /list torrents/i }));
    fireEvent.click(await screen.findByRole('button', { name: /a film/i }));
    fireEvent.click(screen.getByRole('button', { name: /probe far seek/i }));

    await waitFor(() => expect(document.querySelector('.bs-probe')?.textContent).toMatch(/206/));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.getReader).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
  });
});

/**
 * STAGE 8 — the codec instrument's own tests, and they are about ONE thing: this page cannot
 * report "no picture" without saying WHY there was no picture.
 *
 * A 404 and a codec the panel cannot decode both end with a black rectangle, and
 * `MediaError.code` is the same in both cases. With the four clips not in the repository and
 * not producible from the machine that wrote this code (stage 8 plan, decision 3), **absent is
 * the state this instrument will actually be in on the first sitting** — so "FILE NOT PRESENT"
 * is a tested, rendered state here, not an afterthought.
 *
 * What is NOT pinned, and cannot be: whether this television decodes HEVC, Main10 or DTS. Every
 * value this section prints comes from the engine it runs on, and in a test that engine is
 * jsdom, which decodes nothing. Those readings are rows 16-18 of
 * `docs/superpowers/plans/2026-10-11-tv-stage8-device-readings.md`, and they are untaken.
 */
describe('/bigscreen/diag: the codec instrument cannot report a blank', () => {
  const CODEC_STORAGE = 'bs-diag:codec';
  const row = (id: string) => document.querySelector<HTMLElement>(`[data-clip-row="${id}"]`);
  const rowText = (id: string) => row(id)?.textContent ?? '';
  const player = (id: string) => document.querySelector<HTMLVideoElement>(`[data-clip-player="${id}"]`);
  const stored = () => JSON.parse(sessionStorage.getItem(CODEC_STORAGE) ?? 'null');

  /**
   * The VALUE CELL of one named fact in one clip's row, and the scoping is load-bearing.
   *
   * A row-wide regex is satisfied by any node in the subtree, and each of these rows contains
   * two buttons reading "Sound came out: yes" and "Sound came out: no". **Measured: a row-wide
   * `/yes/` in the remount test below was matching the BUTTON, not the restored answer, so that
   * assertion could not fail** — it survived thirty green runs and the M3 persistence mutation
   * only because a different assertion in the same test reddened first. Same shape as the
   * FILE-NOT-PRESENT cell (see that test). Asserting on the cell is what makes the value pinned.
   *
   * The `toHaveLength(1)` is not decoration: an ambiguous label must be an error here rather
   * than a silently-picked first match.
   */
  const cellText = (id: string, labelPrefix: string) => {
    const r = row(id);
    expect(r, `row ${id} is rendered`).not.toBeNull();
    const matches = Array.from(r!.querySelectorAll('tr')).filter((tr) =>
      (tr.querySelector('th')?.textContent ?? '').startsWith(labelPrefix),
    );
    expect(matches, `exactly one "${labelPrefix}" fact in row ${id}`).toHaveLength(1);
    return matches[0].querySelector('td')?.textContent ?? '';
  };

  /**
   * How many `/samples/` requests this test has issued that have not settled yet.
   *
   * Asserted zero after every test, because a probe that settles after its test has finished
   * **writes to `sessionStorage` after the next test's `beforeEach` has cleared it**, and the
   * next component then restores the poisoned record. Demonstrated deliberately: a test that
   * clicked "Probe all four" against a 60ms mock and returned without awaiting it left
   * `"-> 200 LEAKED"` in the following test's storage. No test here does that — this guard is
   * what keeps it true when someone adds the twelfth one.
   */
  let outstandingProbes = 0;

  beforeEach(() => {
    outstandingProbes = 0;
  });

  afterEach(() => {
    expect(
      outstandingProbes,
      'a /samples/ probe was still in flight when the test ended; it will write sessionStorage during the NEXT test',
    ).toBe(0);
  });

  /** Every `/samples/` HEAD answers with `status`; everything else hangs, as the default does. */
  function mockSamples(status: number) {
    const calls: Array<{ url: string; method?: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith('/samples/')) {
        calls.push({ url: u, method: init?.method });
        outstandingProbes += 1;
        // ON A TIMER, NOT A RESOLVED PROMISE, and that is the point.
        //
        // An instant `Promise.resolve` resolves inside whatever `act` drain comes next, so the
        // four completions coincide with the click and every assertion appears to hold. The
        // device issues four independent requests that land whenever they land. A 0ms timer is
        // a MACROTASK: `await act(...)` does not drain it, so each probe lands during the
        // `waitFor` that waits for it — which is the only reason those `waitFor`s are load
        // bearing. It also makes the leak guard above falsifiable: with an instant mock a
        // probe can never still be outstanding at the end of a test, so the guard could not
        // fail and would have been a test that cannot fail.
        return new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                ok: status >= 200 && status < 300,
                status,
                statusText: status === 404 ? 'Not Found' : 'OK',
                body: null,
              }),
            0,
          );
        }).finally(() => {
          outstandingProbes -= 1;
        });
      }
      return new Promise(() => {});
    }) as unknown as typeof fetch);
    return calls;
  }

  /** The four machine-read fields, forced onto a jsdom element that has none of them. */
  function fakeReadings(v: HTMLVideoElement, readings: {
    code?: number; w: number; h: number; duration: number; readyState: number;
  }) {
    if (readings.code !== undefined) {
      Object.defineProperty(v, 'error', { value: { code: readings.code }, configurable: true });
    }
    Object.defineProperty(v, 'videoWidth', { value: readings.w, configurable: true });
    Object.defineProperty(v, 'videoHeight', { value: readings.h, configurable: true });
    Object.defineProperty(v, 'duration', { value: readings.duration, configurable: true });
    Object.defineProperty(v, 'readyState', { value: readings.readyState, configurable: true });
  }

  /**
   * Press Load and let the HEAD settle INSIDE `act`, so no state update is still in flight
   * when the assertion runs. The `waitFor`s below still wait on the condition each one
   * asserts — this only stops the probe's resolution landing after the render React has
   * already committed, which is the shape that made stage 6's 24% flake pass eight agents.
   */
  const loadClip = async (id: string) => {
    await act(async () => {
      fireEvent.click(within(row(id)!).getByRole('button', { name: /^load clip/i }));
    });
  };

  it('prints the HEAD status for every clip verbatim, with no verdict of its own', async () => {
    // The probe is the ONLY thing that can separate "the file is not here" from "this panel
    // cannot decode it". Four requests, four raw status lines, no interpretation.
    //
    // ALL FOUR ROWS ARE INSIDE THE waitFor, and that is the fix for a real race rather than a
    // style preference. `probeAllClips` is `Promise.all` over four INDEPENDENT fetches, so the
    // four completions are four separate state writes in an order this test does not control.
    // Waiting on c4 and then asserting c1..c3 in a bare loop passed only because the mock
    // resolves every clip in one microtask drain. Measured: with clip 4 resolving immediately
    // and clips 3/2/1 on 5/15/30ms timers, that shape FAILS with
    // `row c1 … HTTP (verbatim) not probed` — a missing wait, reproduced on demand.
    const calls = mockSamples(200);
    render(<DiagPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /probe all four clips/i }));
    });

    await waitFor(() => {
      for (const c of ['clip1', 'clip2', 'clip3', 'clip4']) {
        const id = `c${c.slice(-1)}`;
        expect(cellText(id, 'HTTP'), id).toMatch(
          new RegExp(`^HEAD /samples/${c}-[^ ]+ -> 200 OK$`),
        );
      }
    });
    // Synchronous, unlike the four completions: `Promise.all` issues all four requests before
    // it awaits any of them, so this needs no wait and would hide nothing by having one.
    expect(calls).toHaveLength(4);
    expect(calls.every((c) => c.method === 'HEAD'), 'HEAD, never GET — a GET would pull the clip').toBe(true);
  });

  it('renders an explicit FILE NOT PRESENT state on a 404, and mounts no <video> at all', async () => {
    // THE test for this task. An empty `<video>` over a missing file looks exactly like an
    // unsupported codec on a screen with no devtools, so the absent case must say so in words
    // AND must not put an element on the page that could be mistaken for a decode attempt.
    //
    // Both halves are inside ONE waitFor, deliberately. The words and the absence come from two
    // different state writes (`updateClip` then `setActiveClip`) which React happens to batch
    // into one commit today; asserting the absence outside the wait would make this test depend
    // on that batching rather than on the behaviour. Verified against a 20ms-delayed 404: the
    // conjunction holds, so the assertion is about the instrument and not about React.
    mockSamples(404);
    render(<DiagPage />);
    await loadClip('c1');

    await waitFor(() => {
      expect(cellText('c1', 'File present?')).toBe('FILE NOT PRESENT — nothing was mounted');
      expect(player('c1'), 'no element was mounted, so nothing was asked to decode').toBeNull();
    });
    expect(cellText('c1', 'HTTP'), 'the raw status is the reading').toBe(
      'HEAD /samples/clip1-1080p-hevc-main8-eac3.mkv -> 404 Not Found',
    );
    // The prose below the table, which is what tells the operator this is not a codec result.
    // Measured: with only a row-wide /FILE NOT PRESENT/ match, deleting the words from the CELL
    // and leaving a bare "no" kept this test GREEN, because this paragraph satisfied the same
    // substring — the "a substring the happy path also satisfies" trap, in this task's own test.
    expect(rowText('c1')).toMatch(/not a codec result/i);
    expect(document.querySelector('[data-clip-player]')).toBeNull();
    // And the OTHER paragraph stays off: a 404 is the one answer that IS an absence, so
    // telling the operator "it was not a 404" here would contradict the cell above it.
    expect(rowText('c1'), 'a 404 is an absence').not.toMatch(/AND IT WAS NOT A 404/);
  });

  it('mounts the clip when the HEAD says it is there — non-vacuity for the row above', async () => {
    mockSamples(200);
    render(<DiagPage />);
    await loadClip('c2');

    await waitFor(() => expect(player('c2')).not.toBeNull());
    expect(player('c2')).toHaveAttribute('src', '/samples/clip2-1080p-hevc-main10-eac3.mkv');
    expect(cellText('c2', 'File present?')).toBe('yes');
  });

  it('does not call a thrown HEAD an absent file', async () => {
    // A LAN or server failure reported as "copy the clips over" sends the operator to do the
    // one thing that cannot help. Three values, not two, for exactly this case.
    vi.spyOn(globalThis, 'fetch').mockImplementation((() =>
      Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch);
    render(<DiagPage />);
    await loadClip('c3');

    await waitFor(() => {
      expect(cellText('c3', 'HTTP')).toMatch(/-> fetch failed: TypeError: Failed to fetch$/);
      expect(player('c3'), 'and still nothing mounted').toBeNull();
    });
    expect(cellText('c3', 'File present?'), 'not absence').toBe('unknown');
  });

  it('tells a 500 on a clip from a missing clip, and mounts nothing either way', async () => {
    // THE DEFECT THIS ROW EXISTS FOR, and it was live in this file's instrument while the
    // sidecar half of the same page had been fixed. `probeClip` mapped every non-2xx to `no`,
    // so a 500 printed FILE NOT PRESENT and the paragraph below told the operator to run an
    // ffmpeg line for a file that is already on disk — the one action that cannot help. It was
    // reported by task 18 and left, because stage 8's fixtures are here and this file was not
    // in that task's set. Readings 16-18 are still untaken, so it has never yet been read
    // wrong on the set; it would have been.
    mockSamples(500);
    render(<DiagPage />);
    await loadClip('c1');

    await waitFor(() => {
      expect(cellText('c1', 'File present?')).toBe(
        'THE SERVER ANSWERED 500 — not an absence, and nothing was mounted',
      );
      expect(player('c1'), 'still nothing mounted — a 500 is not a decode attempt').toBeNull();
    });
    expect(cellText('c1', 'HTTP'), 'the raw status is the reading').toMatch(/-> 500 /);
    expect(rowText('c1')).toMatch(/AND IT WAS NOT A 404/);
    // NOT /not a codec result/ for the absent paragraph's absence: the new paragraph says
    // "this is not a codec result either", so that substring is satisfied by BOTH and an
    // assertion using it could not fail. The absent paragraph's own instruction is the
    // discriminator — and it is the instruction that was wrong.
    expect(rowText('c1'), 'the produce-the-file instruction must be gone').not.toMatch(
      /with the sheet’s ffmpeg line/,
    );
  });

  it('reads the status off the response instead of assuming one', async () => {
    // Separates `answeredWith(res.status)` from a hard-coded 500. With only the row above, the
    // status could be a literal and nothing would notice; 403 is also the plausible answer
    // from something sitting in front of Next.js on a LAN.
    mockSamples(403);
    render(<DiagPage />);
    await loadClip('c2');

    await waitFor(() =>
      expect(cellText('c2', 'File present?')).toBe(
        'THE SERVER ANSWERED 403 — not an absence, and nothing was mounted',
      ),
    );
    expect(player('c2')).toBeNull();
  });

  it('brings a persisted answered-status back, and refuses the one spelling it cannot produce', async () => {
    // Two rules in one navigation, because they are one decision. `answered 500` has to survive
    // leaving the page — the operator probes, walks to the set, comes back — so the validator
    // must admit it. `answered 404` is a spelling this page cannot produce (both probes map
    // exactly 404 to `no`), and admitting it would print "THE SERVER ANSWERED 404 — not an
    // absence" beside the rule that a 404 is the one answer that IS one. Reachable only from a
    // stale or poisoned record, which is what this validator is for.
    sessionStorage.setItem(
      CODEC_STORAGE,
      JSON.stringify({
        // Partial on purpose: `readCodecReadings` starts from the blank and overwrites only
        // the fields a record carries, so a fixture that listed all eight would be asserting
        // the spread rather than the validator.
        c1: { http: 'HEAD /samples/x.mkv -> 500 Internal Server Error', present: 'answered 500' },
        c2: { http: 'HEAD /samples/y.mkv -> 404 Not Found', present: 'answered 404' },
      }),
    );
    render(<DiagPage />);

    await waitFor(() =>
      expect(cellText('c1', 'File present?')).toBe(
        'THE SERVER ANSWERED 500 — not an absence, and nothing was mounted',
      ),
    );
    expect(cellText('c2', 'File present?'), 'the forbidden spelling falls back to the blank').toBe(
      'unknown',
    );
  });

  it('surfaces the raw MediaError code, and the three numbers beside it', async () => {
    // `MediaError.code=4` and "unsupported" are not the same reading. Nothing here is mapped
    // to a word: 4 is printed as 4, and the dimensions, duration and readyState are printed as
    // the element reported them — a 0x0 beside a code is how "decoded nothing" is told from
    // "decoded and then failed".
    mockSamples(200);
    render(<DiagPage />);
    await loadClip('c1');
    await waitFor(() => expect(player('c1')).not.toBeNull());

    const v = player('c1')!;
    fakeReadings(v, { code: 4, w: 0, h: 0, duration: NaN, readyState: 0 });
    fireEvent.error(v);

    await waitFor(() => expect(cellText('c1', 'MediaError.code')).toBe('MediaError.code=4'));
    expect(cellText('c1', 'videoWidth')).toBe('0 x 0');
    expect(cellText('c1', 'duration')).toBe('NaN');
    expect(cellText('c1', 'readyState')).toBe('0');
    // Which event produced the sample: `readyState` and `duration` both change over time, so a
    // reading that does not say WHEN it was taken is not a reading. A loose /error/ here would
    // have been satisfied by the "MediaError.code" row header.
    expect(cellText('c1', 'sampled at')).toBe('error');
  });

  it('prints the metadata readings verbatim when the clip does decode', async () => {
    // Non-vacuity for the row above, and the positive half of readings 16-18: a decode that
    // works has to produce transcribable numbers, not the word "ok".
    mockSamples(200);
    render(<DiagPage />);
    await loadClip('c4');
    await waitFor(() => expect(player('c4')).not.toBeNull());

    const v = player('c4')!;
    fakeReadings(v, { w: 1920, h: 1080, duration: 10.24, readyState: 1 });
    fireEvent.loadedMetadata(v);

    await waitFor(() => expect(cellText('c4', 'videoWidth')).toBe('1920 x 1080'));
    expect(cellText('c4', 'duration')).toBe('10.24');
    expect(cellText('c4', 'readyState')).toBe('1');
    expect(cellText('c4', 'MediaError.code')).toBe('video.error === null');
    expect(cellText('c4', 'sampled at')).toBe('loadedmetadata');
  });

  it('makes the operator’s audio answer part of the persisted record', async () => {
    // A DTS track this set cannot decode is a SILENT PICTURE and raises no error, so the
    // machine-read fields alone would log reading 18 as a pass over a silent film. The answer
    // no code can produce has to be stored exactly like the ones that can.
    render(<DiagPage />);
    expect(cellText('c3', 'Did sound come out'), 'unanswered until answered').toBe('not answered');

    fireEvent.click(within(row('c3')!).getByRole('button', { name: /sound came out: no/i }));

    await waitFor(() => expect(stored()?.c3?.audio).toBe('no'));
    expect(cellText('c3', 'Did sound come out')).toBe('no');
    // And it is the operator's answer about THAT clip, not a page-wide flag.
    expect(stored()?.c4?.audio).toBe('not answered');
    expect(cellText('c4', 'Did sound come out')).toBe('not answered');
  });

  it('survives an unmount and remount, machine fields and operator answer together', async () => {
    // THE mutation that pins this project's actual lesson: stage 3 ran the key log on this
    // television and wrote none of it down. Leaving this page is a navigation, and a reading
    // that does not outlive the navigation is a reading that was never taken.
    mockSamples(200);
    const first = render(<DiagPage />);
    await loadClip('c4');
    await waitFor(() => expect(player('c4')).not.toBeNull());

    const v = player('c4')!;
    fakeReadings(v, { code: 3, w: 1920, h: 1080, duration: 10.24, readyState: 1 });
    fireEvent.error(v);
    await waitFor(() => expect(cellText('c4', 'MediaError.code')).toBe('MediaError.code=3'));
    fireEvent.click(within(row('c4')!).getByRole('button', { name: /sound came out: yes/i }));
    await waitFor(() => expect(stored()?.c4?.audio).toBe('yes'));

    first.unmount();
    expect(document.querySelector('[data-clip-row]')).toBeNull();

    render(<DiagPage />);
    await waitFor(() => expect(cellText('c4', 'MediaError.code')).toBe('MediaError.code=3'));
    // ON THE CELL, not on the row. A row-wide /yes/ here matched the "Sound came out: yes"
    // BUTTON and therefore could not fail; this is the assertion that actually pins the
    // operator's answer surviving the navigation.
    expect(cellText('c4', 'Did sound come out'), 'the operator answer came back too').toBe('yes');
    expect(cellText('c4', 'videoWidth')).toBe('1920 x 1080');
    expect(cellText('c4', 'duration')).toBe('10.24');
    expect(cellText('c4', 'HTTP')).toMatch(/-> 200 OK$/);
  });

  it('clears the readings back to “not taken”, never to a blank', async () => {
    // A record that outlives the page also outlives the sitting, exactly as the key log's does.
    // Cleared means "not taken" again — a blank cell is the one state this instrument may not
    // produce, because a blank reads as a pass.
    render(<DiagPage />);
    fireEvent.click(within(row('c3')!).getByRole('button', { name: /sound came out: yes/i }));
    await waitFor(() => expect(stored()?.c3?.audio).toBe('yes'));

    fireEvent.click(screen.getByRole('button', { name: /clear clip readings/i }));
    await waitFor(() => expect(stored()?.c3?.audio).toBe('not answered'));
    expect(cellText('c3', 'Did sound come out')).toBe('not answered');
    // Every machine cell by name, so "not a blank" is checked per cell rather than by a
    // row-wide /not taken/ that any one of them satisfies for all five.
    for (const label of ['MediaError.code', 'videoWidth', 'duration', 'readyState', 'sampled at']) {
      expect(cellText('c3', label), label).toBe('not taken');
    }
    expect(cellText('c3', 'HTTP')).toBe('not probed');
  });

  it('treats canPlayType as advisory: a clip it says nothing about still mounts', async () => {
    // §7.2: "TV implementations under-report". A `""` from this row is not a reading off the
    // panel, so it may not stand in for one and may not gate the only instrument that can take
    // that reading. jsdom's canPlayType returns "" for everything, which is the case that
    // matters — if the row gated the mount, nothing would ever be measurable here.
    mockSamples(200);
    render(<DiagPage />);
    // On the cell and exact: a row-wide /""/ is the same shape as the /yes/ that could not fail.
    await waitFor(() => expect(cellText('c1', 'canPlayType')).toBe('""'));
    expect(rowText('c1')).toMatch(/ADVISORY, GATES NOTHING/);

    await loadClip('c1');
    await waitFor(() => expect(player('c1')).not.toBeNull());
  });

  it('tells the operator which clip is the control, and that silence is the reading', async () => {
    // Both facts are unrecoverable from the numbers. Without the control, a red row on clips
    // 1-3 is unattributable between the panel, the mux and this page; without the sound
    // instruction, reading 18 gets filled in from a MediaError that never fired.
    //
    // Row-wide on purpose, unlike every value assertion above: the question here is whether the
    // page says these things at all, so more than one matching node is a pass, not a hazard.
    const { container } = render(<DiagPage />);
    const text = container.textContent ?? '';
    expect(text).toMatch(/CONTROL/);
    expect(text).toMatch(/read clip 4 first/i);
    expect(text).toMatch(/SILENT PICTURE/);
    expect(text).toMatch(/written-down-but-never-run/);
    // And that a missing clip is expected rather than a defect.
    expect(text).toMatch(/not in the repository/i);
  });
});
