import { describe, it, expect } from 'vitest';
import { streamingHref } from './streamingHref';

describe('streamingHref', () => {
  it('links to the stream alone when no file is named', () => {
    expect(streamingHref({ id: 'x' })).toBe('/streaming/x');
  });
  it('names file 0, which is falsy but a real index', () => {
    expect(streamingHref({ id: 'x', file_index: 0 })).toBe('/streaming/x?file=0');
  });
  it('treats a null file_index as no file', () => {
    expect(streamingHref({ id: 'x', file_index: null })).toBe('/streaming/x');
  });
});
