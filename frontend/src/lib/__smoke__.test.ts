import { describe, it, expect } from 'vitest';

describe('test harness', () => {
  it('runs and resolves toBe', () => {
    expect(1 + 1).toBe(2);
  });
});
