/**
 * CastRow — Vitest + RTL tests
 *
 * Spec (Task 3):
 *  - renders a portrait + name + character per member
 *  - null `image` → initial placeholder, no broken img
 *  - empty cast → renders nothing
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CastRow from './CastRow';
import type { CastMember } from '@/types';

const cast: CastMember[] = [
  {
    name: 'Timothée Chalamet',
    character: 'Paul Atreides',
    image: 'https://image.tmdb.org/t/p/w200/timothee.jpg',
  },
  {
    name: 'Zendaya',
    character: 'Chani',
    image: 'https://image.tmdb.org/t/p/w200/zendaya.jpg',
  },
  {
    name: 'Rebecca Ferguson',
    character: 'Lady Jessica',
    image: null,
  },
];

describe('CastRow', () => {
  describe('renders cast members', () => {
    it('renders a portrait element per member', () => {
      render(<CastRow cast={cast} />);
      const members = screen.getAllByTestId('cast-member');
      expect(members).toHaveLength(3);
    });

    it('renders the name for each cast member', () => {
      render(<CastRow cast={cast} />);
      expect(
        screen.getByTestId('cast-name-Timothée Chalamet'),
      ).toHaveTextContent('Timothée Chalamet');
      expect(screen.getByTestId('cast-name-Zendaya')).toHaveTextContent(
        'Zendaya',
      );
      expect(
        screen.getByTestId('cast-name-Rebecca Ferguson'),
      ).toHaveTextContent('Rebecca Ferguson');
    });

    it('renders the character for each cast member', () => {
      render(<CastRow cast={cast} />);
      expect(
        screen.getByTestId('cast-character-Timothée Chalamet'),
      ).toHaveTextContent('Paul Atreides');
      expect(
        screen.getByTestId('cast-character-Zendaya'),
      ).toHaveTextContent('Chani');
      expect(
        screen.getByTestId('cast-character-Rebecca Ferguson'),
      ).toHaveTextContent('Lady Jessica');
    });

    it('renders the section heading "Cast"', () => {
      render(<CastRow cast={cast} />);
      expect(
        screen.getByRole('heading', { name: 'Cast' }),
      ).toBeInTheDocument();
    });
  });

  describe('null image → initial placeholder', () => {
    it('shows an initial placeholder when image is null (no broken img)', () => {
      render(<CastRow cast={[{ name: 'Rebecca Ferguson', character: 'Lady Jessica', image: null }]} />);
      // Should render the initial "R" not an <img>
      const portrait = screen.getByTestId('cast-portrait-Rebecca Ferguson');
      expect(portrait.tagName).not.toBe('IMG');
      expect(portrait).toHaveTextContent('R');
    });

    it('shows an initial placeholder when image load fails', () => {
      render(
        <CastRow
          cast={[
            {
              name: 'Austin Butler',
              character: 'Feyd-Rautha',
              image: 'https://image.tmdb.org/broken.jpg',
            },
          ]}
        />,
      );
      // Trigger onError on the img
      const img = screen.getByTestId('cast-portrait-Austin Butler');
      expect(img.tagName).toBe('IMG');
      fireEvent.error(img);
      // After error the img is replaced with the initial placeholder div
      const placeholder = screen.getByTestId('cast-portrait-Austin Butler');
      expect(placeholder.tagName).not.toBe('IMG');
      expect(placeholder).toHaveTextContent('A');
    });

    it('uses the first character of the name as the initial', () => {
      render(
        <CastRow
          cast={[{ name: 'Florence Pugh', character: 'Princess Irulan', image: null }]}
        />,
      );
      const portrait = screen.getByTestId('cast-portrait-Florence Pugh');
      expect(portrait).toHaveTextContent('F');
    });
  });

  describe('empty cast → renders nothing', () => {
    it('returns null when cast is an empty array', () => {
      const { container } = render(<CastRow cast={[]} />);
      expect(container.firstChild).toBeNull();
    });

    it('does not render a "Cast" heading when cast is empty', () => {
      render(<CastRow cast={[]} />);
      expect(
        screen.queryByRole('heading', { name: 'Cast' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('optional character field', () => {
    it('omits the character element when character is null', () => {
      render(
        <CastRow
          cast={[{ name: 'Javier Bardem', character: null, image: null }]}
        />,
      );
      expect(
        screen.queryByTestId('cast-character-Javier Bardem'),
      ).not.toBeInTheDocument();
    });
  });
});
