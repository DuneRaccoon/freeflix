import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FocusProps } from '../_focus/useFocusGrid';
import { Card, type CardItem } from './Card';

/** Everything a remote, a Tab key or a screen reader could stop on. */
const FOCUS_STOPS = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]';

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
  describe('one focus stop, in every state', () => {
    // The web PosterCard has four stops pointing at three identical hrefs, which is what
    // makes a 20-item rail ~80 presses to cross. The TV card is one <a>, whatever it is
    // showing: a retry affordance or a Play pill added in only one state must fail here.
    type ArtState = 'art' | 'no art' | 'art after onError';
    const ARTS: ArtState[] = ['art', 'no art', 'art after onError'];
    const matrix = ARTS.flatMap((art) =>
      [false, true].flatMap((badge) => [false, true].map((bar) => ({ art, badge, bar }))),
    );

    it.each(matrix)('$art, badge: $badge, progress bar: $bar', ({ art, badge, bar }) => {
      const { container } = renderCard({
        artUrl: art === 'no art' ? null : 'https://img.test/heat.jpg',
        subtitle: '1995',
        badge: badge ? 'Up next' : null,
        progressPct: bar ? 42 : 0,
      });
      if (art === 'art after onError') {
        fireEvent.error(container.querySelector('img') as HTMLImageElement);
        expect(container.querySelector('img')).toBeNull();
      }
      const stops = container.querySelectorAll(FOCUS_STOPS);
      expect(stops).toHaveLength(1);
      expect(stops[0].tagName).toBe('A');
      expect(stops[0]).toHaveAttribute('href', '/bigscreen/movie/1');
      expect(stops[0]).toBe(container.firstElementChild);
    });
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

    it('keeps the fallback title inside a wrapper the stylesheet can line-clamp', () => {
      // A flex container cannot clamp its own text, so the title needs its own element.
      const { container } = renderCard({ title: 'A very long title '.repeat(10) });
      const fallback = container.querySelector('.bs-card__fallback') as HTMLElement;
      const text = fallback.querySelector('.bs-card__fallback-text') as HTMLElement;
      expect(text).not.toBeNull();
      expect(text.textContent).toBe('A very long title '.repeat(10));
      expect(fallback.children).toHaveLength(1);
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

  describe('dragging', () => {
    // Magic Remote jitter during an OK press can start a native drag, which swallows the
    // click. A link and an image are both draggable by default.
    it('cannot be dragged, by the link or by the image', () => {
      const { container } = renderCard({ artUrl: 'https://img.test/heat.jpg' });
      expect(container.querySelector('a')).toHaveAttribute('draggable', 'false');
      expect(container.querySelector('img')).toHaveAttribute('draggable', 'false');
    });

    it('cannot be dragged in the fallback state either', () => {
      const { container } = renderCard({});
      expect(container.querySelector('a')).toHaveAttribute('draggable', 'false');
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

    it('keeps the subtitle text and the badge as separate siblings, text first', () => {
      // jsdom cannot evaluate the stylesheet, so this pins the structure it relies on:
      // .bs-card__sub is a flex row whose `gap` separates two element children, and the
      // text (not the row) carries the ellipsis so the badge survives truncation.
      const { container } = renderCard({ subtitle: 'S1 E3', badge: 'Up next' });
      const sub = container.querySelector('.bs-card__sub') as HTMLElement;
      expect(Array.from(sub.children).map((c) => c.className)).toEqual(['bs-card__subtext', 'bs-card__badge']);
      const badge = sub.querySelector('.bs-card__badge') as HTMLElement;
      expect(badge.previousElementSibling).toBe(sub.querySelector('.bs-card__subtext'));
      expect(sub.querySelector('.bs-card__subtext')).toHaveTextContent('S1 E3');
      // No bare text node between them to stand in for the gap.
      expect(Array.from(sub.childNodes).every((n) => n.nodeType === Node.ELEMENT_NODE)).toBe(true);
    });

    it('makes a badge with no subtitle the only child, so no gap precedes it', () => {
      const { container } = renderCard({ subtitle: null, badge: 'Up next' });
      const sub = container.querySelector('.bs-card__sub') as HTMLElement;
      expect(sub.children).toHaveLength(1);
      expect(sub.firstElementChild).toHaveClass('bs-card__badge');
      expect(sub.firstElementChild!.previousElementSibling).toBeNull();
      expect(sub.childNodes).toHaveLength(1);
    });

    it('makes a subtitle with no badge the only child', () => {
      const { container } = renderCard({ subtitle: '1995' });
      const sub = container.querySelector('.bs-card__sub') as HTMLElement;
      expect(sub.children).toHaveLength(1);
      expect(sub.firstElementChild).toHaveClass('bs-card__subtext');
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
