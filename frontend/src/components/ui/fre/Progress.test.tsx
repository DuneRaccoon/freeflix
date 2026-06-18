import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Progress, Ring } from './Progress';

describe('Progress', () => {
  it('exposes the clamped value via the progressbar role', () => {
    render(<Progress value={150} label="Watched" />);
    const bar = screen.getByRole('progressbar', { name: 'Watched' });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });
  it('clamps negative values to 0', () => {
    render(<Progress value={-10} label="Download" />);
    expect(screen.getByRole('progressbar', { name: 'Download' })).toHaveAttribute('aria-valuenow', '0');
  });
});

describe('Ring', () => {
  it('records the value on a data attribute', () => {
    render(<Ring value={64} />);
    expect(screen.getByTestId('fre-ring').dataset.value).toBe('64');
  });

  it('is decorative (aria-hidden) when no label is provided', () => {
    render(<Ring value={50} />);
    const ring = screen.getByTestId('fre-ring');
    expect(ring).toHaveAttribute('aria-hidden', 'true');
    expect(ring).not.toHaveAttribute('role');
  });

  it('has role=img and aria-label when label is provided', () => {
    render(<Ring value={75} label="Loading 75%" />);
    const ring = screen.getByRole('img', { name: 'Loading 75%' });
    expect(ring).toBeInTheDocument();
    expect(ring).not.toHaveAttribute('aria-hidden');
  });
});
