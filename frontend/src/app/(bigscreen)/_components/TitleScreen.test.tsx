import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TitleScreen } from './TitleScreen';

const FOCUS_STOPS = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]';
const ART = 'https://image.tmdb.org/t/p/w1920/back.jpg';

describe('TitleScreen', () => {
  it('renders the title, eyebrow and overview', () => {
    render(
      <TitleScreen art={ART} eyebrow="2021 · 2h 35m" title="Dune" overview="A boy and a planet." actions={<button>Go</button>} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Dune' })).toBeInTheDocument();
    expect(screen.getByText('2021 · 2h 35m')).toBeInTheDocument();
    expect(screen.getByText('A boy and a planet.')).toBeInTheDocument();
  });

  it('is null-safe: no overview, no eyebrow, no art', () => {
    const { container } = render(<TitleScreen art={null} title="Dune" overview={null} actions={<button>Go</button>} />);
    expect(screen.getByRole('heading', { name: 'Dune' })).toBeInTheDocument();
    expect(container.querySelector('.bs-title__art')).toBeNull();
    expect(container.querySelector('.bs-title__overview')).toBeNull();
    expect(container.querySelector('.bs-title__eyebrow')).toBeNull();
  });

  it('draws the art as an inline background-image, as given (jsdom normalises quoting, so quoting itself is not asserted) (already w1920)', () => {
    const { container } = render(<TitleScreen art={ART} title="Dune" overview={null} actions={null} />);
    const art = container.querySelector<HTMLElement>('.bs-title__art');
    expect(art).not.toBeNull();
    expect(art!.style.backgroundImage).toBe(`url("${ART}")`);
    expect(art).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders actions before below, in document order', () => {
    render(
      <TitleScreen
        art={null}
        title="Dune"
        overview={null}
        actions={<button>Action</button>}
        below={<button>Below</button>}
      />,
    );
    const a = screen.getByText('Action');
    const b = screen.getByText('Below');
    expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('adds no focus stop of its own', () => {
    const { container } = render(
      <TitleScreen art={ART} eyebrow="x" title="Dune" overview="o" actions={<button>A</button>} below={<a href="/x">B</a>} />,
    );
    expect(container.querySelectorAll(FOCUS_STOPS)).toHaveLength(2);
    const bare = render(<TitleScreen art={ART} title="Dune" overview="o" actions={null} />);
    expect(bare.container.querySelectorAll(FOCUS_STOPS)).toHaveLength(0);
  });
});
