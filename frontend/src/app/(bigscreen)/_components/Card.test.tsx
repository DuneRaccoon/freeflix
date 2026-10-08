import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FocusProps } from '../_focus/useFocusGrid';
import { Card, type CardItem } from './Card';

const item = (over: Partial<CardItem> = {}): CardItem => ({
  id: 'movie:1',
  href: '/bigscreen/movie/1',
  title: 'Heat',
  ...over,
});

const focus = (over: Partial<FocusProps> = {}): FocusProps => ({
  tabIndex: -1,
  ref: vi.fn(),
  onFocus: vi.fn(),
  ...over,
});

function renderCard(
  over: Partial<CardItem> = {},
  props: { shape?: 'poster' | 'wide'; focusProps?: FocusProps } = {},
) {
  return render(
    <Card item={item(over)} shape={props.shape ?? 'poster'} focusProps={props.focusProps ?? focus()} />,
  );
}

describe('Card', () => {
  it('is exactly one focusable element, carrying the href', () => {
    // The web PosterCard has four stops pointing at three identical hrefs, which is what
    // makes a 20-item rail ~80 presses to cross. The TV card is one <a>.
    const { container } = renderCard({ progressPct: 42, badge: 'Up next', subtitle: '1995' });
    const stops = container.querySelectorAll('[tabindex]');
    expect(stops).toHaveLength(1);
    expect(stops[0].tagName).toBe('A');
    expect(stops[0]).toHaveAttribute('href', '/bigscreen/movie/1');
    expect(container.querySelectorAll('a, button, input, select, textarea')).toHaveLength(1);
  });

  it('renders the title, as a paragraph and not a heading', () => {
    // bigscreen.css styles h1/h2/h3 as global element rules (gold-lite, weight 600).
    const { container } = renderCard({ artUrl: 'https://img.test/heat.jpg' });
    const label = screen.getByText('Heat');
    expect(label.tagName).toBe('P');
    expect(label).toHaveClass('bs-card__label');
    expect(container.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
  });

  it('puts the shape modifier on the card', () => {
    const { container, rerender } = renderCard({}, { shape: 'poster' });
    expect(container.querySelector('a')).toHaveClass('bs-card', 'bs-card--poster');
    rerender(<Card item={item()} shape="wide" focusProps={focus()} />);
    expect(container.querySelector('a')).toHaveClass('bs-card', 'bs-card--wide');
    expect(container.querySelector('a')).not.toHaveClass('bs-card--poster');
  });

  it('forwards tabIndex, ref and onFocus from focusProps to the anchor', () => {
    const ref = vi.fn();
    const onFocus = vi.fn();
    const { container, rerender } = renderCard({}, { focusProps: focus({ tabIndex: 0, ref, onFocus }) });
    const a = container.querySelector('a') as HTMLAnchorElement;
    expect(a).toHaveAttribute('tabindex', '0');
    expect(ref).toHaveBeenCalledWith(a);
    fireEvent.focus(a);
    expect(onFocus).toHaveBeenCalledTimes(1);

    rerender(<Card item={item()} shape="poster" focusProps={focus({ tabIndex: -1, ref, onFocus })} />);
    expect(container.querySelector('a')).toHaveAttribute('tabindex', '-1');
  });

  it('does not re-render when its props are unchanged', () => {
    // The focus hook hands out memoised per-cell props so that a move re-renders two
    // cards, not twenty. That only holds if the card is itself memoised.
    let reads = 0;
    const counted = item();
    Object.defineProperty(counted, 'href', {
      get() {
        reads += 1;
        return '/bigscreen/movie/1';
      },
    });
    const props = focus();
    const { rerender } = render(<Card item={counted} shape="poster" focusProps={props} />);
    const afterMount = reads;
    expect(afterMount).toBeGreaterThan(0);

    rerender(<Card item={counted} shape="poster" focusProps={props} />);
    expect(reads).toBe(afterMount);

    rerender(<Card item={counted} shape="poster" focusProps={{ ...props, tabIndex: 0 }} />);
    expect(reads).toBeGreaterThan(afterMount);
  });

  describe('progress bar', () => {
    it('draws none at 0 or when absent', () => {
      const { container, rerender } = renderCard({ progressPct: 0 });
      expect(container.querySelector('.bs-card__bar')).toBeNull();
      rerender(<Card item={item({ progressPct: undefined })} shape="poster" focusProps={focus()} />);
      expect(container.querySelector('.bs-card__bar')).toBeNull();
    });

    it('draws one at the given width', () => {
      const { container } = renderCard({ progressPct: 42 });
      const fill = container.querySelector('.bs-card__bar span') as HTMLElement;
      expect(fill).not.toBeNull();
      expect(fill.style.width).toBe('42%');
    });

    it('never draws wider than the track', () => {
      const { container } = renderCard({ progressPct: 140 });
      expect((container.querySelector('.bs-card__bar span') as HTMLElement).style.width).toBe('100%');
    });

    it('is the last thing in the card', () => {
      // A focused card's ring has ~1px of clearance in the track; nothing may sit below the bar.
      const { container } = renderCard({ progressPct: 42, subtitle: '1995' });
      expect(container.querySelector('a')!.lastElementChild).toHaveClass('bs-card__bar');
    });
  });

  describe('artwork', () => {
    it('renders a lazy image and no fallback when there is an artUrl', () => {
      const { container } = renderCard({ artUrl: 'https://img.test/heat.jpg' });
      const img = container.querySelector('img') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img).toHaveAttribute('src', 'https://img.test/heat.jpg');
      expect(img).toHaveAttribute('loading', 'lazy');
      expect(img).toHaveClass('bs-card__art');
      expect(container.querySelector('.bs-card__fallback')).toBeNull();
    });

    it.each([[undefined], [null], ['']])('renders the fallback instead of an <img> for %j', (artUrl) => {
      const { container } = renderCard({ artUrl });
      expect(container.querySelector('img')).toBeNull();
      const fallback = container.querySelector('.bs-card__fallback') as HTMLElement;
      expect(fallback).not.toBeNull();
      expect(fallback).toHaveClass('bs-card__art');
      expect(fallback).toHaveTextContent('Heat');
    });

    it('does not announce the fallback title a second time', () => {
      const { container } = renderCard({});
      expect(container.querySelector('.bs-card__fallback')).toHaveAttribute('aria-hidden', 'true');
    });

    it('swaps to the fallback when the image errors', () => {
      const { container } = renderCard({ artUrl: 'https://img.test/broken.jpg' });
      fireEvent.error(container.querySelector('img') as HTMLImageElement);
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('.bs-card__fallback')).toHaveTextContent('Heat');
    });

    it('tries again when a different image arrives at the same position', () => {
      // Rails key cells by index, so a refetch reuses this instance for another title.
      // A sticky "failed" flag would show the new title as a text card for no reason.
      const { container, rerender } = renderCard({ artUrl: 'https://img.test/broken.jpg' });
      fireEvent.error(container.querySelector('img') as HTMLImageElement);
      expect(container.querySelector('img')).toBeNull();

      rerender(<Card item={item({ artUrl: 'https://img.test/other.jpg' })} shape="poster" focusProps={focus()} />);
      expect(container.querySelector('img')).toHaveAttribute('src', 'https://img.test/other.jpg');
      expect(container.querySelector('.bs-card__fallback')).toBeNull();
    });
  });

  describe('subtitle and badge', () => {
    it('renders the subtitle', () => {
      const { container } = renderCard({ subtitle: '1995' });
      const sub = container.querySelector('.bs-card__sub') as HTMLElement;
      expect(sub).toHaveTextContent('1995');
    });

    it('renders a badge when present, inside the subtitle and not inside the label', () => {
      // .bs-card__label is a -webkit-box with vertical orientation: a badge in there is
      // laid out as a block and drops onto its own line.
      const { container } = renderCard({ subtitle: 'S1 E3', badge: 'Up next' });
      const badge = screen.getByText('Up next');
      expect(badge).toHaveClass('bs-card__badge');
      expect(badge.closest('.bs-card__sub')).not.toBeNull();
      expect(badge.closest('.bs-card__label')).toBeNull();
      expect(container.querySelector('.bs-card__label')).not.toHaveTextContent('Up next');
    });

    it('has no badge when none is given', () => {
      const { container } = renderCard({ subtitle: '1995', badge: null });
      expect(container.querySelector('.bs-card__badge')).toBeNull();
    });

    it('renders no empty subtitle line when there is neither subtitle nor badge', () => {
      const { container } = renderCard({ subtitle: null });
      expect(container.querySelector('.bs-card__sub')).toBeNull();
    });
  });
});
