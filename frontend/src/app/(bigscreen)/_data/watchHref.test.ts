import { describe, it, expect } from 'vitest';
import { watchHref } from './watchHref';

describe('watchHref', () => {
  it('is the bare path with no file', () => {
    expect(watchHref('t1')).toBe('/bigscreen/watch/t1');
    expect(watchHref('t1', null)).toBe('/bigscreen/watch/t1');
    expect(watchHref('t1', undefined)).toBe('/bigscreen/watch/t1');
  });
  it('carries ?file= when an index was chosen', () => {
    expect(watchHref('t1', 7)).toBe('/bigscreen/watch/t1?file=7');
  });
  it('file 0 is a real index (the first file of a pack), not "no file"', () => {
    expect(watchHref('t1', 0)).toBe('/bigscreen/watch/t1?file=0');
  });
});
