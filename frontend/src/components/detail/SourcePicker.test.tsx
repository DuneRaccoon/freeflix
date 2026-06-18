/**
 * SourcePicker — Vitest + RTL tests
 *
 * Spec (Task 2):
 *  - with hits across 720p/1080p: renders Auto pill + quality pills with seed/size text
 *  - clicking a quality pill calls onChange with that quality
 *  - empty hits + fallbackQualities → renders plain pills (no seed/size)
 *  - humanizeBytes helper converts bytes correctly
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SourcePicker, { humanizeBytes } from './SourcePicker';
import type { TorrentHit } from '@/types';

// ── fixtures ──────────────────────────────────────────────────────────────────

const makeHit = (overrides: Partial<TorrentHit>): TorrentHit => ({
  title: 'Some Movie',
  seeds: 100,
  peers: 10,
  bytes: 1_073_741_824, // 1 GB
  magnet: 'magnet:?xt=...',
  hash: 'abc123',
  source: 'YTS',
  quality: '1080p',
  ...overrides,
});

const hits720p: TorrentHit = makeHit({ quality: '720p', seeds: 640, bytes: 1_181_116_006 }); // ~1.1 GB
const hits1080p: TorrentHit = makeHit({ quality: '1080p', seeds: 1200, bytes: 2_254_857_830 }); // ~2.1 GB

describe('SourcePicker', () => {
  describe('with real hits', () => {
    it('renders the Auto pill', () => {
      render(
        <SourcePicker
          hits={[hits720p, hits1080p]}
          value="auto"
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByTestId('source-pill-auto')).toBeInTheDocument();
    });

    it('renders a pill for each quality present in hits', () => {
      render(
        <SourcePicker
          hits={[hits720p, hits1080p]}
          value="auto"
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByTestId('source-pill-720p')).toBeInTheDocument();
      expect(screen.getByTestId('source-pill-1080p')).toBeInTheDocument();
    });

    it('shows seed count text on the quality pill', () => {
      render(
        <SourcePicker
          hits={[hits1080p]}
          value="auto"
          onChange={vi.fn()}
        />,
      );
      const meta = screen.getByTestId('source-pill-1080p-meta');
      // 1200 seeds → "1.2k seeds"
      expect(meta).toHaveTextContent('1.2k seeds');
    });

    it('shows human-readable size on the quality pill', () => {
      render(
        <SourcePicker
          hits={[hits1080p]}
          value="auto"
          onChange={vi.fn()}
        />,
      );
      const meta = screen.getByTestId('source-pill-1080p-meta');
      // 2_254_857_830 bytes ≈ 2.1 GB
      expect(meta).toHaveTextContent('2.1 GB');
    });

    it('marks the selected pill as pressed and unselected ones as not pressed', () => {
      render(
        <SourcePicker
          hits={[hits720p, hits1080p]}
          value="1080p"
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByTestId('source-pill-1080p')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByTestId('source-pill-720p')).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      expect(screen.getByTestId('source-pill-auto')).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    it('calls onChange with the quality when a quality pill is clicked', async () => {
      const onChange = vi.fn();
      render(
        <SourcePicker
          hits={[hits720p, hits1080p]}
          value="auto"
          onChange={onChange}
        />,
      );
      await userEvent.click(screen.getByTestId('source-pill-720p'));
      expect(onChange).toHaveBeenCalledOnce();
      expect(onChange).toHaveBeenCalledWith('720p');
    });

    it('calls onChange with "auto" when the Auto pill is clicked', async () => {
      const onChange = vi.fn();
      render(
        <SourcePicker
          hits={[hits1080p]}
          value="1080p"
          onChange={onChange}
        />,
      );
      await userEvent.click(screen.getByTestId('source-pill-auto'));
      expect(onChange).toHaveBeenCalledWith('auto');
    });

    it('shows the Auto pill as selected when value is "auto"', () => {
      render(
        <SourcePicker
          hits={[hits720p, hits1080p]}
          value="auto"
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByTestId('source-pill-auto')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('picks the best hit per quality (most seeds)', () => {
      // Two 1080p hits — only the one with more seeds should determine the meta
      const weak1080p = makeHit({ quality: '1080p', seeds: 50, bytes: 900_000_000 });
      const strong1080p = makeHit({ quality: '1080p', seeds: 500, bytes: 2_100_000_000 });
      render(
        <SourcePicker
          hits={[weak1080p, strong1080p]}
          value="auto"
          onChange={vi.fn()}
        />,
      );
      // Only one pill for 1080p
      const pills = screen.getAllByTestId('source-pill-1080p');
      expect(pills).toHaveLength(1);
      // Shows seeds from the stronger hit (500 → "500 seeds")
      expect(screen.getByTestId('source-pill-1080p-meta')).toHaveTextContent('500 seeds');
    });
  });

  describe('empty hits + fallbackQualities', () => {
    it('renders plain pills from fallbackQualities when hits is empty', () => {
      render(
        <SourcePicker
          hits={[]}
          value="auto"
          onChange={vi.fn()}
          fallbackQualities={['720p', '1080p', '2160p']}
        />,
      );
      expect(screen.getByTestId('source-pill-720p')).toBeInTheDocument();
      expect(screen.getByTestId('source-pill-1080p')).toBeInTheDocument();
      expect(screen.getByTestId('source-pill-2160p')).toBeInTheDocument();
    });

    it('does not show seed/size meta text on fallback pills', () => {
      render(
        <SourcePicker
          hits={[]}
          value="auto"
          onChange={vi.fn()}
          fallbackQualities={['1080p']}
        />,
      );
      // The pill should render but have no meta sub-element
      expect(screen.queryByTestId('source-pill-1080p-meta')).not.toBeInTheDocument();
    });

    it('still renders the Auto pill even when hits is empty', () => {
      render(
        <SourcePicker
          hits={[]}
          value="auto"
          onChange={vi.fn()}
          fallbackQualities={['720p']}
        />,
      );
      expect(screen.getByTestId('source-pill-auto')).toBeInTheDocument();
    });

    it('calls onChange with fallback quality when clicked', async () => {
      const onChange = vi.fn();
      render(
        <SourcePicker
          hits={[]}
          value="auto"
          onChange={onChange}
          fallbackQualities={['1080p', '720p']}
        />,
      );
      await userEvent.click(screen.getByTestId('source-pill-1080p'));
      expect(onChange).toHaveBeenCalledWith('1080p');
    });
  });

  describe('humanizeBytes helper', () => {
    it('converts bytes to GB with 1 decimal', () => {
      expect(humanizeBytes(2_254_857_830)).toBe('2.1 GB');
    });

    it('converts bytes to MB', () => {
      // 500 MB
      const result = humanizeBytes(524_288_000);
      expect(result).toBe('500 MB');
    });

    it('converts ~1.1 GB correctly', () => {
      expect(humanizeBytes(1_181_116_006)).toBe('1.1 GB');
    });

    it('returns empty string for 0', () => {
      expect(humanizeBytes(0)).toBe('');
    });

    it('returns empty string for negative', () => {
      expect(humanizeBytes(-1)).toBe('');
    });
  });
});
