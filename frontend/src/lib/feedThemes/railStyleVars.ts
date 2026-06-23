// frontend/src/lib/feedThemes/railStyleVars.ts
import type { CSSProperties } from 'react';
import { FeedTheme } from './types';

/**
 * Inline CSS custom properties for a themed Row/RankedRow <section>. These
 * cascade to the header, arrows, numeral stroke, and every PosterCard inside.
 * Returns undefined for neutral rows so they fall through to the gold defaults
 * declared in globals.css.
 */
export function railStyleVars(theme: FeedTheme | null): CSSProperties | undefined {
  if (!theme) return undefined;
  return {
    '--rail-accent': theme.accent,
    '--rail-accent-soft': theme.accentSoft,
    '--rail-card-glow': theme.glow,
  } as CSSProperties;
}
