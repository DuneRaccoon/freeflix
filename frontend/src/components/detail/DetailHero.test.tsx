/**
 * DetailHero — Vitest + RTL tests
 *
 * Spec (Task 1):
 *  - renders title
 *  - renders rounded rating
 *  - renders overview
 *  - renders genres (up to 3)
 *  - renders children slot
 *  - null backdrop → no broken img (uses placeholder data URI)
 *  - null poster   → no broken img (uses placeholder data URI)
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DetailHero from './DetailHero';

const baseProps = {
  title: 'Dune: Part Two',
  backdropUrl: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
  posterUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
  year: 2024,
  rating: 8.4,
  genres: ['Science Fiction', 'Adventure', 'Action'],
  metaItems: ['166m', 'PG-13'],
  tagline: 'Long live the fighters.',
  overview:
    'Paul Atreides unites with the Fremen to wage war against the conspirators who destroyed his family.',
  eyebrow: 'Feature Film',
};

describe('DetailHero', () => {
  describe('core content', () => {
    it('renders the title as a heading', () => {
      render(<DetailHero {...baseProps} />);
      expect(
        screen.getByRole('heading', { name: 'Dune: Part Two' }),
      ).toBeInTheDocument();
    });

    it('renders the rating rounded to 1 decimal', () => {
      render(<DetailHero {...baseProps} />);
      expect(screen.getByTestId('detail-hero-rating')).toHaveTextContent('8.4');
    });

    it('renders the overview', () => {
      render(<DetailHero {...baseProps} />);
      expect(screen.getByTestId('detail-hero-overview')).toHaveTextContent(
        /Paul Atreides unites with the Fremen/i,
      );
    });

    it('renders up to 3 genres joined', () => {
      render(<DetailHero {...baseProps} />);
      expect(
        screen.getByText('Science Fiction, Adventure, Action'),
      ).toBeInTheDocument();
    });

    it('caps genres at 3 when more are supplied', () => {
      render(
        <DetailHero
          {...baseProps}
          genres={['Drama', 'Comedy', 'Thriller', 'Romance']}
        />,
      );
      expect(screen.getByText('Drama, Comedy, Thriller')).toBeInTheDocument();
      expect(screen.queryByText(/Romance/)).not.toBeInTheDocument();
    });

    it('renders metaItems in the meta row', () => {
      render(<DetailHero {...baseProps} />);
      expect(screen.getByText('166m')).toBeInTheDocument();
      expect(screen.getByText('PG-13')).toBeInTheDocument();
    });

    it('renders the tagline', () => {
      render(<DetailHero {...baseProps} />);
      expect(screen.getByText(/Long live the fighters/i)).toBeInTheDocument();
    });

    it('renders the eyebrow', () => {
      render(<DetailHero {...baseProps} />);
      expect(screen.getByText('Feature Film')).toBeInTheDocument();
    });
  });

  describe('children slot', () => {
    it('renders children inside the hero', () => {
      render(
        <DetailHero {...baseProps}>
          <button data-testid="action-slot">Play</button>
        </DetailHero>,
      );
      expect(screen.getByTestId('action-slot')).toBeInTheDocument();
    });
  });

  describe('null-safe images', () => {
    it('uses a data-URI placeholder when backdropUrl is null (no broken img)', () => {
      render(<DetailHero {...baseProps} backdropUrl={null} />);
      const img = screen.getByTestId('detail-hero-backdrop') as HTMLImageElement;
      expect(img.src).toContain('data:image/svg+xml');
    });

    it('uses a data-URI placeholder when posterUrl is null (no broken img)', () => {
      render(<DetailHero {...baseProps} posterUrl={null} />);
      const img = screen.getByTestId('detail-hero-poster') as HTMLImageElement;
      expect(img.src).toContain('data:image/svg+xml');
    });

    it('still renders the title when backdropUrl is null', () => {
      render(<DetailHero {...baseProps} backdropUrl={null} />);
      expect(
        screen.getByRole('heading', { name: 'Dune: Part Two' }),
      ).toBeInTheDocument();
    });

    it('still renders the title when posterUrl is null', () => {
      render(<DetailHero {...baseProps} posterUrl={null} />);
      expect(
        screen.getByRole('heading', { name: 'Dune: Part Two' }),
      ).toBeInTheDocument();
    });
  });

  describe('optional props', () => {
    it('renders gracefully when tagline is null', () => {
      render(<DetailHero {...baseProps} tagline={null} />);
      expect(
        screen.getByRole('heading', { name: 'Dune: Part Two' }),
      ).toBeInTheDocument();
    });

    it('renders gracefully when overview is null', () => {
      render(<DetailHero {...baseProps} overview={null} />);
      expect(
        screen.getByRole('heading', { name: 'Dune: Part Two' }),
      ).toBeInTheDocument();
    });

    it('renders gracefully when year is null', () => {
      render(<DetailHero {...baseProps} year={null} />);
      expect(
        screen.getByRole('heading', { name: 'Dune: Part Two' }),
      ).toBeInTheDocument();
    });

    it('renders gracefully when genres is empty', () => {
      render(<DetailHero {...baseProps} genres={[]} />);
      expect(
        screen.getByRole('heading', { name: 'Dune: Part Two' }),
      ).toBeInTheDocument();
    });

    it('omits rating row element when rating is 0', () => {
      render(<DetailHero {...baseProps} rating={0} />);
      expect(screen.queryByTestId('detail-hero-rating')).not.toBeInTheDocument();
    });
  });
});
