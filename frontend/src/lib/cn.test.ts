import { describe, it, expect } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins truthy classes and drops falsy ones', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c');
  });
  it('lets later tailwind classes win conflicts', () => {
    expect(cn('px-2 text-text', 'px-4')).toBe('text-text px-4');
  });
});
