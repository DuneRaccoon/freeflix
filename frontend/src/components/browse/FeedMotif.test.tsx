// frontend/src/components/browse/FeedMotif.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import FeedMotif from './FeedMotif';

describe('FeedMotif', () => {
  it('renders nothing for undefined or "none"', () => {
    const a = render(<FeedMotif color="#fff" />);
    expect(a.container.firstChild).toBeNull();
    const b = render(<FeedMotif motif={{ kind: 'none' }} color="#fff" />);
    expect(b.container.firstChild).toBeNull();
  });

  it('renders the wordmark text', () => {
    const { container } = render(
      <FeedMotif motif={{ kind: 'wordmark', text: 'MARVEL' }} color="#E62429" />,
    );
    expect(container.textContent).toContain('MARVEL');
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('renders an svg for starfield and arcs', () => {
    const stars = render(<FeedMotif motif={{ kind: 'starfield' }} color="#fff" />);
    expect(stars.container.querySelector('svg')).not.toBeNull();
    const arcs = render(<FeedMotif motif={{ kind: 'arcs' }} color="#fff" />);
    expect(arcs.container.querySelector('svg')).not.toBeNull();
  });

  it('applies the configured opacity', () => {
    const { container } = render(
      <FeedMotif motif={{ kind: 'halftone', opacity: 0.08 }} color="#fff" />,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.style.opacity).toBe('0.08');
  });
});
