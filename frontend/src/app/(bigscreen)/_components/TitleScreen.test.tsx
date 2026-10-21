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

describe('the way back to the menu', () => {
  const props = () => ({ tabIndex: -1 as const, ref: () => {}, onFocus: () => {} });
  const menu = () => [...document.querySelectorAll('.bs-head__item')].map((l) => l.textContent);

  it('carries the top bar when the screen hands it a grid', () => {
    // THE REPORTED DEAD END. The bar went on the browsing screens only, on the reasoning
    // that a title screen is "a flow, not a place" with its own way back. The show screen's
    // "Back to home" is one arm of a ternary and is REPLACED by the primary action as soon
    // as an episode resolves; the movie screen never had one. So on the normal path the only
    // way out was the remote's Back key, whose identity on this set is unverified.
    render(
      <TitleScreen art={null} title="Dune" overview={null} actions={<button>Go</button>} focusPropsFor={props} />,
    );
    expect(menu()).toEqual(['Home', 'Search', 'My List', 'Switch profile', 'Diagnostics']);
  });

  it('puts the bar at row 0 and asks for one cell per menu item', () => {
    // The row the screen must declare as `HEADER_CELLS` before its own actions.
    const asked: Array<[number, number]> = [];
    render(
      <TitleScreen
        art={null}
        title="Dune"
        overview={null}
        actions={<button>Go</button>}
        focusPropsFor={(row, col) => {
          asked.push([row, col]);
          return props();
        }}
      />,
    );
    expect(asked).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
    ]);
  });

  it('marks no section, because a title screen is in none', () => {
    render(
      <TitleScreen art={null} title="Dune" overview={null} actions={<button>Go</button>} focusPropsFor={props} />,
    );
    expect(document.querySelector('[aria-current]')).toBeNull();
  });

  it('carries NO bar for the status frames, which own row 0 themselves', () => {
    // `LoadStatus`, `LockedRedirect` and the player's `Gone` are built from this frame and
    // each renders its own named ways out, starting at row 0. A bar would both take that row
    // and duplicate a control they already have.
    const { container } = render(
      <TitleScreen art={null} title="Couldn’t load this show" overview={null} actions={<button>Try again</button>} />,
    );
    expect(container.querySelector('.bs-head')).toBeNull();
    expect(container.querySelector('.bs-shell__head')).toBeNull();
  });
});
