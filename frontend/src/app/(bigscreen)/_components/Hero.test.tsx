import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import type { CatalogItem } from '@/types';
import type { FocusProps } from '../_focus/useFocusGrid';
import { Hero, atSize } from './Hero';

/** Everything a remote, a Tab key or a screen reader could stop on. */
const FOCUS_STOPS = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]';

const BACKDROP = 'https://image.tmdb.org/t/p/w1280/hZkgoQYus5vegHoetLkCJzb17zJ.jpg';

const item = (over: Partial<CatalogItem> = {}): CatalogItem => ({
  tmdb_id: 550,
  media_type: 'movie',
  title: 'Fight Club',
  year: 1999,
  overview: 'An insomniac office worker and a soap maker form an underground fight club.',
  poster_url: 'https://image.tmdb.org/t/p/w500/poster.jpg',
  backdrop_url: BACKDROP,
  genre_ids: [],
  genres: [],
  vote_average: 8.4,
  vote_count: 100,
  popularity: 1,
  original_language: 'en',
  ...over,
});

const focus = (over: Partial<FocusProps> = {}): FocusProps => ({
  tabIndex: 0,
  ref: vi.fn(),
  onFocus: vi.fn(),
  ...over,
});

import { backgroundImageFor } from './Hero';

describe('backgroundImageFor', () => {
  // Testable only because the helper is extracted: jsdom normalises an inline
  // background-image, so the same assertion made through a rendered component passes with
  // or without the quoting. A review found the test that claimed to check this could not
  // fail, so it is pinned here at the source instead.
  it('quotes the url', () => {
    expect(backgroundImageFor('https://image.tmdb.org/t/p/w1920/a.jpg')).toBe(
      'url("https://image.tmdb.org/t/p/w1920/a.jpg")',
    );
  });

  it('survives a filename that would otherwise end the declaration early', () => {
    // An unquoted url(...) ends at the first ')' or whitespace.
    expect(backgroundImageFor('/t/p/w1920/a (2).jpg')).toBe('url("/t/p/w1920/a (2).jpg")');
    expect(backgroundImageFor('/t/p/w1920/a b.jpg')).toBe('url("/t/p/w1920/a b.jpg")');
  });

  it('escapes an embedded quote rather than emitting it raw', () => {
    expect(backgroundImageFor('/t/p/w1920/a".jpg')).toBe('url("/t/p/w1920/a\\".jpg")');
  });
});

describe('atSize', () => {
  it('rewrites the size segment of a TMDB image URL to w1920', () => {
    expect(atSize(BACKDROP, 'w1920')).toBe('https://image.tmdb.org/t/p/w1920/hZkgoQYus5vegHoetLkCJzb17zJ.jpg');
  });

  it.each(['w300', 'w780', 'w500', 'w1920', 'h632', 'original'])('recognises the %s rendition', (size) => {
    expect(atSize(`https://image.tmdb.org/t/p/${size}/abc.jpg`, 'w1920')).toBe(
      'https://image.tmdb.org/t/p/w1920/abc.jpg',
    );
  });

  it('touches only the size segment, not a path that happens to look like one', () => {
    expect(atSize('https://image.tmdb.org/t/p/w1280/w1280/w1280.jpg', 'w1920')).toBe(
      'https://image.tmdb.org/t/p/w1920/w1280/w1280.jpg',
    );
  });

  it('leaves a URL that is not a TMDB sized path exactly as it was', () => {
    for (const url of [
      'https://cdn.example.com/backdrops/w1280/x.jpg',
      'https://example.com/t/p/w1280/x.jpg',
      'https://image.tmdb.org/t/p/x.jpg',
      'https://image.tmdb.org/t/p/w1280',
      '/api/v1/avatars/abc.png',
      'not a url',
    ]) {
      expect(atSize(url, 'w1920')).toBe(url);
    }
  });

  it('maps null, undefined and an empty string to null', () => {
    expect(atSize(null, 'w1920')).toBeNull();
    expect(atSize(undefined, 'w1920')).toBeNull();
    expect(atSize('', 'w1920')).toBeNull();
  });

  it('cannot ask for original: an original backdrop is up to 3840x2160 and ~33MB decoded', () => {
    // @ts-expect-error 'original' is not an accepted size; the type is the guard.
    atSize(BACKDROP, 'original');
  });
});

describe('Hero', () => {
  it('renders nothing for a null item', () => {
    const { container } = render(<Hero item={null} focusProps={focus()} href="/bigscreen/movie/550" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the title as a heading, and the year', () => {
    render(<Hero item={item()} />);
    expect(screen.getByRole('heading', { name: 'Fight Club' })).toHaveClass('bs-hero__title');
    expect(screen.getByText('1999')).toBeInTheDocument();
  });

  it('draws no year when the year is unknown, and no empty meta line', () => {
    const { container } = render(<Hero item={item({ year: null })} />);
    expect(container.querySelector('.bs-hero__meta')).toBeNull();
  });

  it('renders the overview in the clamped class', () => {
    render(<Hero item={item()} />);
    const overview = screen.getByText(/insomniac office worker/);
    expect(overview).toHaveClass('bs-hero__overview');
  });

  it('is clamped to three lines by the stylesheet, which is where the clamp lives', () => {
    // jsdom does not lay anything out, so the class is the testable half; this pins the
    // other half, so renaming either side fails here instead of on a television.
    const css = readFileSync(join(process.cwd(), 'public/bigscreen.css'), 'utf8');
    const rule = css.match(/\.bs-hero__overview\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/-webkit-line-clamp:\s*3\b/);
  });

  describe('the stylesheet half of being a link with a focus ring', () => {
    // Both were found by rendering the real page in Chromium, and neither shows in jsdom.
    // Comments stripped, so a declaration that has only been commented out does not count.
    const css = readFileSync(join(process.cwd(), 'public/bigscreen.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = (selector: string) => css.match(new RegExp(`(^|\\n)${selector.replace('.', '\\.')}\\s*\\{[^}]*\\}`))?.[0] ?? '';

    it('takes no link colour or underline: the hero is an <a> and its text inherits both', () => {
      expect(rule('.bs-hero')).toMatch(/color:\s*var\(--text\)/);
      expect(rule('.bs-hero')).toMatch(/text-decoration:\s*none/);
      expect(rule('.bs-btn')).toMatch(/text-decoration:\s*none/);
    });

    it('keeps the art and the scrim behind the focus ring, which an absolute child would paint over', () => {
      expect(rule('.bs-hero')).toMatch(/isolation:\s*isolate/);
      expect(rule('.bs-hero__art')).toMatch(/z-index:\s*-1/);
      expect(rule('.bs-hero__scrim')).toMatch(/z-index:\s*-1/);
    });
  });

  it('draws no overview paragraph when there is none', () => {
    const { container } = render(<Hero item={item({ overview: null })} />);
    expect(container.querySelector('.bs-hero__overview')).toBeNull();
  });

  describe('the backdrop', () => {
    const artOf = (c: HTMLElement) => c.querySelector<HTMLElement>('.bs-hero__art');

    it('is an inline background-image, upgraded to w1920', () => {
      const { container } = render(<Hero item={item()} />);
      const art = artOf(container);
      expect(art?.style.backgroundImage).toContain('/t/p/w1920/hZkgoQYus5vegHoetLkCJzb17zJ.jpg');
      expect(art?.style.backgroundImage).not.toContain('w1280');
    });

    it('never asks for original', () => {
      const { container } = render(<Hero item={item({ backdrop_url: 'https://image.tmdb.org/t/p/original/a.jpg' })} />);
      expect(artOf(container)?.style.backgroundImage).not.toContain('original');
    });

    it('keeps a URL it does not recognise as it was', () => {
      const { container } = render(<Hero item={item({ backdrop_url: 'https://cdn.example.com/b.jpg' })} />);
      expect(artOf(container)?.style.backgroundImage).toContain('https://cdn.example.com/b.jpg');
    });

    it('draws no art element when there is no backdrop, and still draws the scrim and the text', () => {
      const { container } = render(<Hero item={item({ backdrop_url: null })} />);
      expect(artOf(container)).toBeNull();
      expect(container.querySelector('.bs-hero__scrim')).not.toBeNull();
      expect(screen.getByRole('heading', { name: 'Fight Club' })).toBeInTheDocument();
    });

    it('is hidden from assistive tech: the title carries the meaning', () => {
      const { container } = render(<Hero item={item()} />);
      expect(artOf(container)).toHaveAttribute('aria-hidden', 'true');
      expect(container.querySelector('.bs-hero__scrim')).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('focus', () => {
    it('is exactly one focusable element when it is given focus props', () => {
      const { container } = render(<Hero item={item()} focusProps={focus()} href="/bigscreen/movie/550" />);
      const stops = container.querySelectorAll(FOCUS_STOPS);
      expect(stops).toHaveLength(1);
      expect(stops[0]).toHaveClass('bs-hero');
      expect(stops[0]).toHaveAttribute('href', '/bigscreen/movie/550');
    });

    it('hands its focus props straight to that element', () => {
      const props = focus({ tabIndex: -1 });
      const { container } = render(<Hero item={item()} focusProps={props} href="/bigscreen/movie/550" />);
      expect(container.querySelector('.bs-hero')).toHaveAttribute('tabindex', '-1');
      expect(props.ref).toHaveBeenCalledWith(container.querySelector('.bs-hero'));
    });

    it('is still one focus stop with focus props but no href', () => {
      const { container } = render(<Hero item={item()} focusProps={focus()} />);
      expect(container.querySelectorAll(FOCUS_STOPS)).toHaveLength(1);
    });

    it('is not focusable at all without focus props, even when given an href', () => {
      const { container } = render(<Hero item={item()} href="/bigscreen/movie/550" />);
      expect(container.querySelectorAll(FOCUS_STOPS)).toHaveLength(0);
    });

    it('does not make the title a second stop', () => {
      const { container } = render(<Hero item={item()} focusProps={focus()} href="/bigscreen/movie/550" />);
      expect(container.querySelectorAll('.bs-hero :is(a, button, [tabindex])')).toHaveLength(0);
    });
  });
});
