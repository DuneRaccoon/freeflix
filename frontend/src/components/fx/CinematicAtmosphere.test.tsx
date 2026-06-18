import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import CinematicAtmosphere from './CinematicAtmosphere';

describe('CinematicAtmosphere', () => {
  it('renders the three decorative overlays, hidden from a11y tree', () => {
    const { container } = render(<CinematicAtmosphere />);
    const root = container.querySelector('.ff-atmosphere')!;
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.ff-glow')).not.toBeNull();
    expect(container.querySelector('.ff-vignette')).not.toBeNull();
    expect(container.querySelector('.ff-grain')).not.toBeNull();
  });
});
