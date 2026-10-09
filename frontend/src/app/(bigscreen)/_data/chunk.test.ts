import { describe, it, expect } from 'vitest';
import { chunk } from './chunk';

describe('chunk', () => {
  it('splits a list into rows of the given size', () => {
    expect(chunk([1, 2, 3, 4, 5, 6], 3)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('leaves the last row SHORT rather than padding it', () => {
    // The focus model declares one row count per chunk. A padded row would declare a cell
    // the render does not produce: the ring lands on a (row, col) no element claims, and a
    // remote has no Tab and no pointer to recover with.
    const rows = chunk([1, 2, 3, 4, 5, 6, 7], 6);
    expect(rows.map((r) => r.length)).toEqual([6, 1]);
    expect(rows[1]).toEqual([7]);
  });

  it('is no rows at all for an empty list', () => {
    expect(chunk([], 6)).toEqual([]);
  });

  it('keeps every item exactly once, in order', () => {
    const items = Array.from({ length: 23 }, (_, i) => i);
    expect(chunk(items, 6).flat()).toEqual(items);
  });
});
