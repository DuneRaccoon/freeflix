/**
 * VideoPlayer FRÈ re-skin — static rendering tests.
 * jsdom cannot drive a real <video> element so we only assert:
 *   1. The streaming chip renders (and is hidden when fully downloaded)
 *   2. Gated controls carry aria-disabled="true"
 *   3. Scrubber played/buffered bars are rendered in the DOM
 *
 * Real playback + progress-save logic is tested by live browser check (Phase 6 Task 5).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import VideoPlayer from './VideoPlayer';

// Silence video play/load errors in jsdom
beforeAll(() => {
  window.HTMLMediaElement.prototype.load = vi.fn();
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
});

describe('VideoPlayer FRÈ re-skin', () => {
  it('shows the streaming chip when downloadProgress < 100', () => {
    render(<VideoPlayer src="/test.mp4" downloadProgress={64} />);
    const chip = screen.getByTestId('streaming-chip');
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain('64%');
  });

  it('hides the streaming chip when downloadProgress === 100', () => {
    render(<VideoPlayer src="/test.mp4" downloadProgress={100} />);
    expect(screen.queryByTestId('streaming-chip')).toBeNull();
  });

  it('renders gated Audio/CC control with aria-disabled', () => {
    render(<VideoPlayer src="/test.mp4" />);
    const gateds = document.querySelectorAll('[aria-disabled="true"]');
    expect(gateds.length).toBeGreaterThanOrEqual(1);
    // Audio/CC button should be among them
    const audioBtn = document.querySelector('[aria-label="Audio and subtitles (coming soon)"]');
    expect(audioBtn?.getAttribute('aria-disabled')).toBe('true');
  });

  it('renders gated Quality pill with aria-disabled', () => {
    render(<VideoPlayer src="/test.mp4" />);
    const qualityBtn = document.querySelector('[aria-label="Quality 1080p (informational)"]');
    expect(qualityBtn?.getAttribute('aria-disabled')).toBe('true');
  });

  it('renders played and buffered scrubber bars', () => {
    render(<VideoPlayer src="/test.mp4" />);
    const played = document.querySelector('[data-testid="played-bar"]');
    const buffered = document.querySelector('[data-testid="buffered-bar"]');
    expect(played).toBeTruthy();
    expect(buffered).toBeTruthy();
  });

  it('displays the movie title when provided', () => {
    render(<VideoPlayer src="/test.mp4" movieTitle="Dune: Part Two" />);
    expect(screen.getByText('Dune: Part Two')).toBeTruthy();
  });

  it('displays the subtitle when provided', () => {
    render(<VideoPlayer src="/test.mp4" movieTitle="Dune" subtitle="S1 · E3 · The Gathering" />);
    expect(screen.getByText('S1 · E3 · The Gathering')).toBeTruthy();
  });
});
