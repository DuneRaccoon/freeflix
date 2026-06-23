/**
 * MediaTypeBadge — Vitest + RTL tests
 *
 * - renders "Series" for tv, "Film" for movie
 * - exposes the data-testid hook
 * - the icon is decorative (aria-hidden) so the label carries the meaning
 * - forwards a className for positioning
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MediaTypeBadge from './MediaTypeBadge';

describe('MediaTypeBadge', () => {
  it('labels a tv item "Series"', () => {
    render(<MediaTypeBadge mediaType="tv" />);
    expect(screen.getByTestId('media-type-badge')).toHaveTextContent('Series');
  });

  it('labels a movie item "Film"', () => {
    render(<MediaTypeBadge mediaType="movie" />);
    expect(screen.getByTestId('media-type-badge')).toHaveTextContent('Film');
  });

  it('renders a decorative (aria-hidden) icon, not a second accessible label', () => {
    const { container } = render(<MediaTypeBadge mediaType="tv" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('forwards a className for positioning', () => {
    render(<MediaTypeBadge mediaType="movie" className="absolute top-2 left-2" />);
    expect(screen.getByTestId('media-type-badge')).toHaveClass('absolute', 'top-2', 'left-2');
  });
});
