// frontend/src/components/browse/RailBackdrop.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RailBackdrop from './RailBackdrop';
import { FEED_THEMES } from '@/lib/feedThemes';

describe('RailBackdrop', () => {
  it('renders an aria-hidden backdrop with the band background and the motif', () => {
    const marvel = FEED_THEMES['company:420'];
    const { getByTestId } = render(<RailBackdrop theme={marvel} />);
    const backdrop = getByTestId('rail-backdrop');
    expect(backdrop.getAttribute('aria-hidden')).toBe('true');
    expect(backdrop.className).toContain('pointer-events-none');
    expect(backdrop.className).toContain('-z-10');
    expect((backdrop.querySelector('div') as HTMLElement | null)?.style.background).toBeTruthy();
    // Band layer carries the theme background.
    const band = backdrop.querySelector('div');
    expect(band?.getAttribute('style')).toContain('background');
    // Marvel uses a wordmark motif.
    expect(backdrop.textContent).toContain('MARVEL');
  });
});
