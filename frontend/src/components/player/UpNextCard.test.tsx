/**
 * UpNextCard — unit tests.
 *
 * Exercises render/click/countdown behaviour WITHOUT touching real video
 * playback (jsdom limitation — see Global Constraints in plan).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import UpNextCard from './UpNextCard';

describe('UpNextCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the next episode label', () => {
    render(
      <UpNextCard
        nextLabel="S01·E04"
        onPlayNext={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByTestId('upnext-label').textContent).toBe('S01·E04');
  });

  it('calls onPlayNext when Play Next button is clicked', () => {
    const onPlayNext = vi.fn();
    render(
      <UpNextCard
        nextLabel="S01·E04"
        onPlayNext={onPlayNext}
        onDismiss={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('upnext-play'));
    expect(onPlayNext).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss when the dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(
      <UpNextCard
        nextLabel="S01·E04"
        onPlayNext={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByTestId('upnext-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders the countdown ring when countdownSeconds is provided', () => {
    render(
      <UpNextCard
        nextLabel="S01·E04"
        onPlayNext={vi.fn()}
        onDismiss={vi.fn()}
        countdownSeconds={10}
      />,
    );
    expect(screen.getByTestId('upnext-ring')).toBeTruthy();
  });

  it('does NOT render the countdown ring when countdownSeconds is absent', () => {
    render(
      <UpNextCard
        nextLabel="S01·E04"
        onPlayNext={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('upnext-ring')).toBeNull();
  });

  it('auto-advances (calls onPlayNext) when countdown reaches zero', async () => {
    const onPlayNext = vi.fn();
    render(
      <UpNextCard
        nextLabel="S01·E04"
        onPlayNext={onPlayNext}
        onDismiss={vi.fn()}
        countdownSeconds={3}
      />,
    );

    // Tick the interval 3 times (one per second) then flush the deferred setTimeout(0).
    await act(async () => {
      vi.advanceTimersByTime(1000); // 2 remaining
    });
    await act(async () => {
      vi.advanceTimersByTime(1000); // 1 remaining
    });
    await act(async () => {
      vi.advanceTimersByTime(1000); // 0 — fires the internal setTimeout(0)
    });
    // Run any pending macrotasks (the setTimeout(0) deferred call)
    await act(async () => {
      vi.runAllTimers();
    });

    expect(onPlayNext).toHaveBeenCalledTimes(1);
  });

  it('shows a thumbnail image when thumbnailUrl is provided', () => {
    render(
      <UpNextCard
        nextLabel="S01·E04"
        thumbnailUrl="https://example.com/thumb.jpg"
        onPlayNext={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const img = document.querySelector('img[alt="Thumbnail for S01·E04"]');
    expect(img).toBeTruthy();
    expect((img as HTMLImageElement).src).toContain('thumb.jpg');
  });
});
