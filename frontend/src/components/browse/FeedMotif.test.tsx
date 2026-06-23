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

  it('renders an aria-hidden layer for beams and halftone', () => {
    const beams = render(<FeedMotif motif={{ kind: 'beams' }} color="#fff" />);
    expect(beams.container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    const halftone = render(<FeedMotif motif={{ kind: 'halftone' }} color="#fff" />);
    expect(halftone.container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  describe('genre motifs', () => {
    // Every genre motif must render an aria-hidden, non-null layer.
    for (const kind of ['grain', 'grid', 'bokeh', 'sparkle', 'slats'] as const) {
      it(`renders an aria-hidden layer for ${kind}`, () => {
        const { container } = render(<FeedMotif motif={{ kind }} color="#8E2C2C" />);
        expect(container.firstChild).not.toBeNull();
        expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
      });
    }

    it('draws svg shapes for grain and sparkle', () => {
      const grain = render(<FeedMotif motif={{ kind: 'grain' }} color="#fff" />);
      expect(grain.container.querySelector('svg')).not.toBeNull();
      const sparkle = render(<FeedMotif motif={{ kind: 'sparkle' }} color="#fff" />);
      // sparkle draws star paths
      expect(sparkle.container.querySelector('svg path')).not.toBeNull();
    });

    it('tints sparkle stars with the theme colour', () => {
      // jsdom (cssstyle) drops gradient backgrounds from the serialized style,
      // so colour tinting is asserted on the one motif where the DOM exposes it:
      // the sparkle paths carry the accent as an SVG fill attribute.
      const { container } = render(<FeedMotif motif={{ kind: 'sparkle' }} color="#8E7BD6" />);
      const path = container.querySelector('path');
      expect(path?.getAttribute('fill')?.toLowerCase()).toBe('#8e7bd6');
    });

    it('applies configured opacity to a genre motif', () => {
      const { container } = render(
        <FeedMotif motif={{ kind: 'slats', opacity: 0.08 }} color="#fff" />,
      );
      expect((container.firstChild as HTMLElement).style.opacity).toBe('0.08');
    });
  });
});
