import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { FocusProps } from '../_focus/useFocusGrid';
import { Card, type CardItem } from './Card';

// Card is memoised so that a D-pad move re-renders two cards, not twenty. Whether it
// re-rendered cannot be seen in the DOM (identical output touches nothing), so the link it
// renders is replaced with one that counts how often it is rendered. Card.test.tsx keeps
// the real next/link; this file exists only because vi.mock is per-file.
const linkRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => {
    linkRenders.count += 1;
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));

const base: CardItem = {
  id: 'movie:1',
  href: '/bigscreen/movie/1',
  title: 'Heat',
  subtitle: '1995',
  artUrl: 'https://img.test/heat.jpg',
  progressPct: 42,
  badge: 'Up next',
};

const ref = vi.fn();
const onFocus = vi.fn();
const focus = (over: Partial<FocusProps> = {}): FocusProps => ({ tabIndex: -1, ref, onFocus, ...over });

const mount = () => {
  const view = render(<Card item={base} shape="poster" focusProps={focus()} />);
  linkRenders.count = 0;
  return view;
};

describe('Card memoisation', () => {
  beforeEach(() => {
    linkRenders.count = 0;
  });

  it('counts renders at all', () => {
    // If the stand-in link were not in use, every test below would pass vacuously.
    render(<Card item={base} shape="poster" focusProps={focus()} />);
    expect(linkRenders.count).toBe(1);
  });

  it('skips a re-render for identical props', () => {
    const { rerender } = mount();
    rerender(<Card item={base} shape="poster" focusProps={focus()} />);
    expect(linkRenders.count).toBe(0);
  });

  it('skips a re-render for a CardItem rebuilt inline with the same values', () => {
    // A screen that maps API results to CardItems in its render body hands every card a
    // fresh object on every focus move. Identity comparison would defeat the memo.
    const { rerender } = mount();
    rerender(<Card item={{ ...base }} shape="poster" focusProps={focus()} />);
    expect(linkRenders.count).toBe(0);
  });

  it('skips a re-render for a FocusProps rebuilt with the same fields', () => {
    const { rerender } = mount();
    rerender(<Card item={base} shape="poster" focusProps={{ tabIndex: -1, ref, onFocus }} />);
    expect(linkRenders.count).toBe(0);
  });

  describe('re-renders when anything it shows or depends on changes', () => {
    // Typed as a full record, so a field added to CardItem fails tsc here until it has a
    // changed value to try. `id` is not rendered today, but a comparator that skipped it
    // would go stale the day the card starts to use it.
    const changed: Record<keyof CardItem, string | number> = {
      id: 'movie:2',
      href: '/bigscreen/movie/2',
      title: 'Ronin',
      subtitle: '1998',
      artUrl: 'https://img.test/ronin.jpg',
      progressPct: 80,
      badge: 'New',
    };

    it.each(Object.entries(changed))('item.%s', (field, value) => {
      const { rerender } = mount();
      rerender(<Card item={{ ...base, [field]: value }} shape="poster" focusProps={focus()} />);
      expect(linkRenders.count).toBeGreaterThan(0);
    });

    it('shape', () => {
      const { rerender } = mount();
      rerender(<Card item={base} shape="wide" focusProps={focus()} />);
      expect(linkRenders.count).toBeGreaterThan(0);
    });

    it('focusProps.tabIndex', () => {
      const { rerender } = mount();
      rerender(<Card item={base} shape="poster" focusProps={focus({ tabIndex: 0 })} />);
      expect(linkRenders.count).toBeGreaterThan(0);
    });

    it('focusProps.ref', () => {
      const { rerender } = mount();
      rerender(<Card item={base} shape="poster" focusProps={focus({ ref: vi.fn() })} />);
      expect(linkRenders.count).toBeGreaterThan(0);
    });

    it('focusProps.onFocus', () => {
      const { rerender } = mount();
      rerender(<Card item={base} shape="poster" focusProps={focus({ onFocus: vi.fn() })} />);
      expect(linkRenders.count).toBeGreaterThan(0);
    });

    it('onActivate', () => {
      // Compared by reference, so a screen that rebuilds the handler inline on every render
      // defeats the memo. My List caches one handler per cell for exactly that reason.
      const { rerender } = mount();
      rerender(<Card item={base} shape="poster" focusProps={focus()} onActivate={vi.fn()} />);
      expect(linkRenders.count).toBeGreaterThan(0);
    });
  });

  it('skips a re-render when onActivate is the same function', () => {
    // The whole point of caching the per-cell handlers: in remove mode a D-pad move must
    // still re-render two cards, not two hundred.
    const onActivate = vi.fn();
    const view = render(<Card item={base} shape="poster" focusProps={focus()} onActivate={onActivate} />);
    linkRenders.count = 0;
    view.rerender(<Card item={{ ...base }} shape="poster" focusProps={{ tabIndex: -1, ref, onFocus }} onActivate={onActivate} />);
    expect(linkRenders.count).toBe(0);
  });
});
