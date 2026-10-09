import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { LoadStatus, LOAD_PATIENCE_MS } from './LoadStatus';

afterEach(() => {
  vi.useRealTimers();
});

describe('LoadStatus', () => {
  it('every state has a focus target (Back at least), so a remote is never stranded', () => {
    vi.useFakeTimers();
    const { rerender } = render(<LoadStatus failed={false} onRetry={() => {}} noun="show" />);
    // loading: Back only
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('tabindex', '0');
    // patience elapsed: retry appears, and is the grid's first cell
    act(() => {
      vi.advanceTimersByTime(LOAD_PATIENCE_MS);
    });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    // failed
    rerender(<LoadStatus failed onRetry={() => {}} noun="show" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Couldn’t load this show');
  });

  it('a press while retrying is refused, and the label says so', () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    const { rerender } = render(<LoadStatus failed onRetry={onRetry} noun="movie" />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    // the parent moves from failed back to loading; the control stays and says what it is doing
    rerender(<LoadStatus failed={false} onRetry={onRetry} noun="movie" />);
    const btn = screen.getByRole('button', { name: 'Trying again…' });
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
    // and a retry that itself hangs can be retried once the patience timer restarts
    act(() => {
      vi.advanceTimersByTime(LOAD_PATIENCE_MS);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(2);
  });
});
