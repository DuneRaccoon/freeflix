import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useFocusGrid, type FocusProps } from '../_focus/useFocusGrid';
import { Rail, railCellCount, type RailModel } from './Rail';
import type { CardItem } from './Card';

const items = (n: number, prefix = 'm'): CardItem[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    href: `/bigscreen/movie/${i}`,
    title: `Title ${prefix}${i}`,
    // With artwork the title is in the DOM once; the text-card fallback repeats it.
    artUrl: `https://img.test/${prefix}${i}.jpg`,
  }));

const rail = (over: Partial<RailModel> = {}): RailModel => ({
  key: 'trending',
  title: 'Trending',
  shape: 'poster',
  items: items(3),
  ...over,
});

/** A stand-in for the grid: every cell gets distinct, inspectable props. */
const stubFocusPropsFor = () =>
  vi.fn((row: number, col: number): FocusProps => ({
    tabIndex: row === 0 && col === 0 ? 0 : -1,
    ref: () => {},
    onFocus: () => {},
  }));

describe('Rail', () => {
  describe('with items', () => {
    it('renders one focusable element per item', () => {
      const { container } = render(<Rail rail={rail({ items: items(5) })} row={0} focusPropsFor={stubFocusPropsFor()} />);
      expect(container.querySelectorAll('[tabindex]')).toHaveLength(5);
      expect(container.querySelectorAll('a.bs-card')).toHaveLength(5);
    });

    it('asks for focus props with its own row and each column, exactly', () => {
      const focusPropsFor = stubFocusPropsFor();
      render(<Rail rail={rail({ items: items(3) })} row={4} focusPropsFor={focusPropsFor} />);
      expect(focusPropsFor.mock.calls).toEqual([
        [4, 0],
        [4, 1],
        [4, 2],
      ]);
    });

    it('passes each cell its own props through to the card', () => {
      const focusPropsFor = vi.fn((row: number, col: number): FocusProps => ({
        tabIndex: col === 1 ? 0 : -1,
        ref: () => {},
        onFocus: () => {},
      }));
      const { container } = render(<Rail rail={rail()} row={0} focusPropsFor={focusPropsFor} />);
      const tabIndexes = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('tabindex'));
      expect(tabIndexes).toEqual(['-1', '0', '-1']);
    });

    it('gives each card the rail shape and its item', () => {
      const { container } = render(<Rail rail={rail({ shape: 'wide', items: items(2) })} row={0} focusPropsFor={stubFocusPropsFor()} />);
      const links = Array.from(container.querySelectorAll('a'));
      expect(links.every((a) => a.classList.contains('bs-card--wide'))).toBe(true);
      expect(links.map((a) => a.getAttribute('href'))).toEqual(['/bigscreen/movie/0', '/bigscreen/movie/1']);
      expect(screen.getByText('Title m1')).toBeInTheDocument();
    });

    it('renders the title as the rail heading', () => {
      render(<Rail rail={rail({ title: 'Continue watching' })} row={0} focusPropsFor={stubFocusPropsFor()} />);
      const heading = screen.getByRole('heading', { name: 'Continue watching' });
      expect(heading).toHaveClass('bs-rail__title');
    });

    it('renders the eyebrow above the title when there is one', () => {
      const { container } = render(<Rail rail={rail({ eyebrow: 'Because you watched Heat' })} row={0} focusPropsFor={stubFocusPropsFor()} />);
      const eyebrow = screen.getByText('Because you watched Heat');
      expect(eyebrow).toHaveClass('bs-rail__eyebrow');
      // Document order is visual order: the eyebrow sits over the title.
      const head = container.querySelector('.bs-rail__head') as HTMLElement;
      expect(Array.from(head.children).map((c) => c.className)).toEqual(['bs-rail__eyebrow', 'bs-rail__title']);
    });

    it.each([[undefined], [null], ['']])('renders no eyebrow for %j', (eyebrow) => {
      const { container } = render(<Rail rail={rail({ eyebrow })} row={0} focusPropsFor={stubFocusPropsFor()} />);
      expect(container.querySelector('.bs-rail__eyebrow')).toBeNull();
    });

    it('puts the cards in a track that has nothing but its class', () => {
      // Horizontal scroll is driven entirely by scrollIntoView from the focus hook.
      const { container } = render(<Rail rail={rail()} row={0} focusPropsFor={stubFocusPropsFor()} />);
      const track = container.querySelector('.bs-rail__track') as HTMLElement;
      expect(track).not.toBeNull();
      expect(track.getAttributeNames()).toEqual(['class']);
      expect(track.className).toBe('bs-rail__track');
      expect(track.querySelectorAll('a')).toHaveLength(3);
    });
  });

  describe('while loading', () => {
    it('renders three skeletons of the rail shape and nothing focusable', () => {
      const { container } = render(
        <Rail rail={rail({ loading: true, items: [], shape: 'wide' })} row={0} focusPropsFor={stubFocusPropsFor()} />,
      );
      expect(container.querySelectorAll('.bs-skel.bs-skel--wide')).toHaveLength(3);
      expect(container.querySelectorAll('.bs-skel--poster')).toHaveLength(0);
      expect(container.querySelectorAll('[tabindex]')).toHaveLength(0);
      expect(container.querySelectorAll('a, button')).toHaveLength(0);
    });

    it('uses poster skeletons for a poster rail', () => {
      const { container } = render(
        <Rail rail={rail({ loading: true, items: [], shape: 'poster' })} row={0} focusPropsFor={stubFocusPropsFor()} />,
      );
      expect(container.querySelectorAll('.bs-skel.bs-skel--poster')).toHaveLength(3);
    });

    it('never asks the grid for focus props', () => {
      // The grid was told this row has 0 cells. A focusProps call here would hand
      // out a cell the model does not know about.
      const focusPropsFor = stubFocusPropsFor();
      render(<Rail rail={rail({ loading: true, items: [] })} row={2} focusPropsFor={focusPropsFor} />);
      expect(focusPropsFor).not.toHaveBeenCalled();
    });

    it('still skeletons (and stays unfocusable) when stale items are present', () => {
      const focusPropsFor = stubFocusPropsFor();
      const { container } = render(<Rail rail={rail({ loading: true, items: items(4) })} row={0} focusPropsFor={focusPropsFor} />);
      expect(container.querySelectorAll('.bs-skel')).toHaveLength(3);
      expect(container.querySelectorAll('[tabindex]')).toHaveLength(0);
      expect(focusPropsFor).not.toHaveBeenCalled();
    });

    it('shows the title and eyebrow while it waits', () => {
      render(<Rail rail={rail({ loading: true, items: [], title: 'Trending', eyebrow: 'This week' })} row={0} focusPropsFor={stubFocusPropsFor()} />);
      expect(screen.getByRole('heading', { name: 'Trending' })).toBeInTheDocument();
      expect(screen.getByText('This week')).toBeInTheDocument();
    });

    it('hides the placeholders from assistive tech', () => {
      const { container } = render(<Rail rail={rail({ loading: true, items: [] })} row={0} focusPropsFor={stubFocusPropsFor()} />);
      const skeletons = Array.from(container.querySelectorAll('.bs-skel'));
      expect(skeletons.every((s) => s.getAttribute('aria-hidden') === 'true')).toBe(true);
    });
  });

  describe('when empty', () => {
    it('renders nothing at all', () => {
      const focusPropsFor = stubFocusPropsFor();
      const { container } = render(<Rail rail={rail({ items: [] })} row={0} focusPropsFor={focusPropsFor} />);
      expect(container).toBeEmptyDOMElement();
      expect(focusPropsFor).not.toHaveBeenCalled();
    });
  });
});

describe('railCellCount', () => {
  it('is the number of items for a loaded rail', () => {
    expect(railCellCount(rail({ items: items(4) }))).toBe(4);
  });

  it('is 0 for an empty rail', () => {
    expect(railCellCount(rail({ items: [] }))).toBe(0);
  });

  it('is 0 for a loading rail, even with stale items', () => {
    expect(railCellCount(rail({ loading: true, items: [] }))).toBe(0);
    expect(railCellCount(rail({ loading: true, items: items(4) }))).toBe(0);
  });

  it.each([
    ['loaded', rail({ items: items(4) })],
    ['empty', rail({ items: [] })],
    ['loading', rail({ loading: true, items: [] })],
    ['loading with stale items', rail({ loading: true, items: items(4) })],
  ])('equals the focusable cells a %s rail renders', (_name, model) => {
    // The whole point of exporting it: this number goes to useFocusGrid as the row's
    // count, and a rail that reports N while drawing fewer leaves focus on a cell that
    // does not exist.
    const { container } = render(<Rail rail={model} row={0} focusPropsFor={stubFocusPropsFor()} />);
    expect(container.querySelectorAll('[tabindex]')).toHaveLength(railCellCount(model));
  });
});

/**
 * A rail and the grid that drives it, wired the way a screen wires them: the row counts
 * come from `railCellCount`.
 */
function Screen({ rails }: { rails: RailModel[] }) {
  const grid = useFocusGrid({ rowCounts: rails.map(railCellCount) });
  return (
    <div>
      {rails.map((r, row) => (
        <Rail key={r.key} rail={r} row={row} focusPropsFor={grid.focusProps} />
      ))}
    </div>
  );
}

const press = (key: string) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });

describe('Rail inside a focus grid', () => {
  beforeEach(() => {
    sessionStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('lands on the first card of the first populated rail, skipping a loading one', () => {
    render(
      <Screen
        rails={[
          rail({ key: 'a', title: 'A', loading: true, items: [] }),
          rail({ key: 'b', title: 'B', items: items(3, 'b') }),
        ]}
      />,
    );
    expect(document.activeElement).toBe(screen.getByText('Title b0').closest('a'));
  });

  it('moves along a rail and down into the next one with the D-pad', () => {
    render(
      <Screen
        rails={[
          rail({ key: 'a', title: 'A', items: items(3, 'a') }),
          rail({ key: 'b', title: 'B', items: items(2, 'b') }),
        ]}
      />,
    );
    press('ArrowRight');
    expect(document.activeElement).toBe(screen.getByText('Title a1').closest('a'));
    press('ArrowDown');
    expect(document.activeElement).toBe(screen.getByText('Title b1').closest('a'));
  });

  it('is exactly one tab stop across every rail', () => {
    const { container } = render(
      <Screen
        rails={[
          rail({ key: 'a', title: 'A', items: items(4, 'a') }),
          rail({ key: 'b', title: 'B', loading: true, items: [] }),
          rail({ key: 'c', title: 'C', items: items(4, 'c') }),
        ]}
      />,
    );
    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(container.querySelectorAll('[tabindex="-1"]')).toHaveLength(7);
  });

  it('keeps DOM focus on the same node when a refetch re-keys every item', () => {
    // Cells are keyed by index. Keyed by item id, a refetch with the same row shape would
    // unmount the focused node, DOM focus would fall to <body>, and a remote has no way back.
    const { rerender } = render(<Screen rails={[rail({ key: 'a', items: items(3, 'old') })]} />);
    press('ArrowRight');
    const focused = document.activeElement;
    expect(focused).toBe(screen.getByText('Title old1').closest('a'));

    rerender(<Screen rails={[rail({ key: 'a', items: items(3, 'new') })]} />);
    expect(document.activeElement).toBe(focused);
    expect(focused).toHaveTextContent('Title new1');
  });

  it('survives a rail resolving to nothing', () => {
    const { rerender } = render(
      <Screen
        rails={[
          rail({ key: 'a', title: 'A', items: items(2, 'a') }),
          rail({ key: 'b', title: 'B', items: items(2, 'b') }),
        ]}
      />,
    );
    press('ArrowDown');
    expect(document.activeElement).toBe(screen.getByText('Title b0').closest('a'));

    rerender(
      <Screen
        rails={[
          rail({ key: 'a', title: 'A', items: items(2, 'a') }),
          rail({ key: 'b', title: 'B', items: [] }),
        ]}
      />,
    );
    expect(document.activeElement).toBe(screen.getByText('Title a0').closest('a'));
  });

  describe('loading transitions', () => {
    it('focuses the first card when the only rail goes from loading to loaded', () => {
      // The real first-paint path on the TV: rails resolve one at a time, so the grid
      // starts with nothing focusable and must pick up the first card the moment it exists.
      const { container, rerender } = render(
        <Screen rails={[rail({ key: 'a', loading: true, items: [] })]} />,
      );
      expect(container.querySelectorAll('[tabindex]')).toHaveLength(0);
      expect(document.activeElement).toBe(document.body);

      rerender(<Screen rails={[rail({ key: 'a', items: items(3, 'a') })]} />);
      expect(container.querySelectorAll('[tabindex]')).toHaveLength(3);
      expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
      expect(document.activeElement).toBe(screen.getByText('Title a0').closest('a'));
    });

    it('does not steal focus when a later rail finishes loading, and can then be entered', () => {
      const { container, rerender } = render(
        <Screen
          rails={[
            rail({ key: 'a', title: 'A', items: items(3, 'a') }),
            rail({ key: 'b', title: 'B', loading: true, items: [] }),
          ]}
        />,
      );
      press('ArrowRight');
      const focused = document.activeElement;
      expect(focused).toBe(screen.getByText('Title a1').closest('a'));
      // Down into a skeleton row goes nowhere, and does not lose focus.
      press('ArrowDown');
      expect(document.activeElement).toBe(focused);

      rerender(
        <Screen
          rails={[
            rail({ key: 'a', title: 'A', items: items(3, 'a') }),
            rail({ key: 'b', title: 'B', items: items(3, 'b') }),
          ]}
        />,
      );
      expect(document.activeElement).toBe(focused);
      expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
      press('ArrowDown');
      expect(document.activeElement).toBe(screen.getByText('Title b1').closest('a'));
    });

    it('hands focus to the next populated rail when the focused rail starts loading', () => {
      // "Loading wins over stale items" means the focused rail's cards are replaced by
      // skeletons while the viewer is on one of them. DOM focus must not fall to <body>.
      const { container, rerender } = render(
        <Screen
          rails={[
            rail({ key: 'a', title: 'A', items: items(3, 'a') }),
            rail({ key: 'b', title: 'B', items: items(3, 'b') }),
          ]}
        />,
      );
      press('ArrowRight');
      expect(document.activeElement).toBe(screen.getByText('Title a1').closest('a'));

      rerender(
        <Screen
          rails={[
            rail({ key: 'a', title: 'A', loading: true, items: items(3, 'a') }),
            rail({ key: 'b', title: 'B', items: items(3, 'b') }),
          ]}
        />,
      );
      expect(container.querySelectorAll('.bs-skel')).toHaveLength(3);
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toBe(screen.getByText('Title b0').closest('a'));
      expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    });

    it('hands focus back and forth cleanly when the only rail reloads', () => {
      const { container, rerender } = render(<Screen rails={[rail({ key: 'a', items: items(3, 'a') })]} />);
      press('ArrowRight');
      rerender(<Screen rails={[rail({ key: 'a', loading: true, items: items(3, 'a') })]} />);
      expect(container.querySelectorAll('[tabindex]')).toHaveLength(0);

      rerender(<Screen rails={[rail({ key: 'a', items: items(3, 'new') })]} />);
      expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
      expect(document.activeElement).toBe(screen.getByText('Title new0').closest('a'));
    });
  });
});
