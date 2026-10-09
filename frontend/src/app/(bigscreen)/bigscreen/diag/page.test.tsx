import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DiagPage from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const SRC = readFileSync('src/app/(bigscreen)/bigscreen/diag/page.tsx', 'utf8');

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
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
