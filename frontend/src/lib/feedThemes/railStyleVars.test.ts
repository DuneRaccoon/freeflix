import { describe, it, expect } from 'vitest';
import { railStyleVars } from './railStyleVars';
import { FEED_THEMES } from './registry';

describe('railStyleVars', () => {
  it('returns undefined for a neutral (null) theme', () => {
    expect(railStyleVars(null)).toBeUndefined();
  });

  it('maps a theme to the three inheriting CSS custom properties', () => {
    const marvel = FEED_THEMES['company:420'];
    const vars = railStyleVars(marvel) as Record<string, string>;
    expect(vars['--rail-accent']).toBe(marvel.accent);
    expect(vars['--rail-accent-soft']).toBe(marvel.accentSoft);
    expect(vars['--rail-card-glow']).toBe(marvel.glow);
  });
});
