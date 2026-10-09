import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, act } from '@testing-library/react';
import NotBuiltYetPage from './page';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const params = vi.hoisted(() => ({ current: { rest: ['movie', '123'] } as { rest?: string | string[] } }));
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => params.current }));

const FOCUS_STOPS = 'a[href], button, input, select, textarea, summary, [tabindex="0"], [contenteditable]';
const settle = () => act(async () => {});

describe('/bigscreen/[...rest]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
    params.current = { rest: ['movie', '123'] };
  });

  it('is honest that the screen is not built yet, and does not call it an error', async () => {
    render(<NotBuiltYetPage />);
    await settle();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/not built yet/i);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/retry|try again|error/i)).toBeNull();
  });

  it('has exactly one focusable control, a link home, and it is focused on mount', async () => {
    const { container } = render(<NotBuiltYetPage />);
    await settle();
    const stops = container.querySelectorAll(FOCUS_STOPS);
    expect(stops).toHaveLength(1);
    const home = screen.getByRole('link', { name: /home/i });
    expect(home).toHaveAttribute('href', '/bigscreen');
    expect(stops[0]).toBe(home);
    expect(document.activeElement).toBe(home);
  });

  it('keeps focus on the link when the arrows are pressed', async () => {
    render(<NotBuiltYetPage />);
    await settle();
    const home = screen.getByRole('link', { name: /home/i });
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      await act(async () => { fireEvent.keyDown(window, { key: k }); });
      expect(document.activeElement).toBe(home);
    }
  });

  it.each([
    ['461', { key: 'Unidentified', keyCode: 461 }],
    ['Escape', { key: 'Escape' }],
    ['XF86Back', { key: 'XF86Back' }],
  ])('Back (%s) goes home with replace, not history', async (_n, init) => {
    render(<NotBuiltYetPage />);
    await settle();
    await act(async () => { fireEvent.keyDown(window, init); });
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/bigscreen');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('does not claim a key that is not Back or an arrow', async () => {
    render(<NotBuiltYetPage />);
    await settle();
    expect(fireEvent.keyDown(window, { key: 'a', keyCode: 65 })).toBe(true);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('leaves the three sibling routes in place (a static segment beats the catch-all)', () => {
    const dir = join(__dirname, '..');
    for (const route of ['pair', 'diag', 'profiles']) {
      expect(existsSync(join(dir, route, 'page.tsx')), route).toBe(true);
    }
    expect(existsSync(join(dir, 'page.tsx'))).toBe(true);
  });

  it.each([
    [['profile'], '/bigscreen/profile'],
    [['movie', '123'], '/bigscreen/movie/123'],
    [['a%20b', 'c'], '/bigscreen/a b/c'],
    [['bad%E0%A4%A'], '/bigscreen/bad%E0%A4%A'],
    [undefined, '/bigscreen'],
  ])('shows the path that was attempted (%j)', async (rest, shown) => {
    params.current = { rest };
    const { container } = render(<NotBuiltYetPage />);
    await settle();
    expect(container.textContent).toContain(`Looked for ${shown}`);
    // Still honest and calm, and still exactly one focus stop.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.querySelectorAll(FOCUS_STOPS)).toHaveLength(1);
  });

  it('renders the path as text, not markup', async () => {
    params.current = { rest: ['<img src=x>'] };
    const { container } = render(<NotBuiltYetPage />);
    await settle();
    expect(container.querySelector('img')).toBeNull();
  });
});
