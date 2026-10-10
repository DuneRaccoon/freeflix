import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
