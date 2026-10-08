import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import BigScreenError from './error';

const settle = () => act(async () => {});
const arrow = (k: string) => act(async () => { fireEvent.keyDown(window, { key: k }); });

const location = vi.hoisted(() => ({ assign: vi.fn(), reload: vi.fn() }));
const realLocation = window.location;

describe('(bigscreen)/error.tsx', () => {
  const reset = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(window, 'location', { configurable: true, value: { ...location } });
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
    vi.restoreAllMocks();
  });

  const renderIt = () => render(<BigScreenError error={new Error('boom')} reset={reset} />);
  const retry = () => screen.getByRole('button', { name: /try again/i });
  const reload = () => screen.getByRole('button', { name: /reload/i });

  it('focuses Reload the page on mount, not Try again', async () => {
    // `reset()` only re-renders the same tree, so a deterministic render fault throws
    // again: the first control a viewer presses must be the one that actually recovers.
    renderIt();
    await settle();
    expect(document.activeElement).toBe(reload());
  });

  it('reaches Try again with Right, and comes back with Left', async () => {
    renderIt();
    await settle();
    await arrow('ArrowRight');
    expect(document.activeElement).toBe(retry());
    await arrow('ArrowLeft');
    expect(document.activeElement).toBe(reload());
  });

  it('wires both buttons to their actions', async () => {
    renderIt();
    await settle();
    fireEvent.click(retry());
    expect(reset).toHaveBeenCalledTimes(1);
    fireEvent.click(reload());
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it('has two buttons, both in the grid, one roving tab stop', async () => {
    const { container } = renderIt();
    await settle();
    expect(container.querySelectorAll('button')).toHaveLength(2);
    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(container.querySelectorAll('[tabindex="-1"]')).toHaveLength(1);
  });

  it.each([
    ['461 with no usable key', { key: 'Unidentified', keyCode: 461 }],
    ['Escape', { key: 'Escape' }],
  ])('Back (%s) does a full load of the TV home', async (_n, init) => {
    renderIt();
    await settle();
    await act(async () => { fireEvent.keyDown(window, init); });
    expect(window.location.assign).toHaveBeenCalledTimes(1);
    expect(window.location.assign).toHaveBeenCalledWith('/bigscreen');
  });

  it('does not claim a key that is not Back or an arrow', async () => {
    renderIt();
    await settle();
    expect(fireEvent.keyDown(window, { key: 'a', keyCode: 65 })).toBe(true);
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it('shows the message and digest', () => {
    render(<BigScreenError error={Object.assign(new Error('boom'), { digest: 'abc' })} reset={reset} />);
    expect(screen.getByText(/boom/)).toBeInTheDocument();
    expect(screen.getByText(/digest: abc/)).toBeInTheDocument();
  });
});
