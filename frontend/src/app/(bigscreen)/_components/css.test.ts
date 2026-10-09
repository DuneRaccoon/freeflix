import { describe, it, expect } from 'vitest';

import { backgroundImageFor } from './css';

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

