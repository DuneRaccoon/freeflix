// frontend/src/lib/feedThemes/types.ts
//
// Data model for per-feed carousel theming. A FeedTheme is PURE DATA — colours,
// an optional title treatment, and a motif KIND (not a component). Adding a
// brand is a one-entry edit in registry.ts.

export interface FeedIdentity {
  type: 'company' | 'collection' | 'provider' | 'genre';
  /**
   * For company/collection/provider this is the stable TMDB id as a string
   * (e.g. '420'). For `genre` it is a canonical slug (e.g. 'horror') — genres
   * span two TMDB id-spaces (Action is movie 28 / TV 10759), so they're folded
   * to one slug rather than keyed by a single numeric id.
   */
  id: string;
}

export type MotifKind =
  | 'none'
  | 'wordmark'
  | 'beams'
  | 'starfield'
  | 'arcs'
  | 'halftone'
  // genre-flavoured motifs
  | 'grain'
  | 'grid'
  | 'bokeh'
  | 'sparkle'
  | 'slats';

export interface MotifConfig {
  kind: MotifKind;
  /** 0..1, defaults to 0.07 in the renderer. Keep faint. */
  opacity?: number;
  /** Text for the `wordmark` motif, e.g. 'MARVEL'. Ignored by other kinds. */
  text?: string;
}

export interface FeedTitleStyle {
  /** Font family for the row title. Defaults to 'display' (Fraunces). */
  font?: 'display' | 'ui';
  /** Extra Tailwind classes (weight / tracking / transform). */
  className?: string;
}

export interface FeedTheme {
  /** Human slug for debugging/tests, e.g. 'marvel-studios'. */
  id: string;
  /** Replaces gold for this row (drives --rail-accent). */
  accent: string;
  /** Replaces gold-lite for this row (drives --rail-accent-soft). */
  accentSoft: string;
  /** Card hover glow colour (drives --rail-card-glow). */
  glow: string;
  /** CSS `background` value for the tinted band; author it to fade at left/right. */
  band: string;
  title?: FeedTitleStyle;
  motif?: MotifConfig;
  /** Optional eyebrow override (takes precedence over RowConfig.eyebrow). */
  eyebrowOverride?: string;
}
