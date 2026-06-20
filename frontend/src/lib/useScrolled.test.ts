import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScrolled } from './useScrolled';

afterEach(() => {
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
});

describe('useScrolled', () => {
  it('starts false and flips true past the threshold on scroll', () => {
    const { result } = renderHook(() => useScrolled(60));
    expect(result.current).toBe(false);
    act(() => {
      Object.defineProperty(window, 'scrollY', { value: 100, configurable: true });
      window.dispatchEvent(new Event('scroll'));
    });
    expect(result.current).toBe(true);
  });

  it('stays false at or below the threshold', () => {
    const { result } = renderHook(() => useScrolled(60));
    act(() => {
      Object.defineProperty(window, 'scrollY', { value: 60, configurable: true });
      window.dispatchEvent(new Event('scroll'));
    });
    expect(result.current).toBe(false);
  });
});
