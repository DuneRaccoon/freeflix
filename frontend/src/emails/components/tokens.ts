/**
 * FRÈ Editorial Noir, as literal values.
 *
 * Nothing here may become a CSS custom property. The app's `--color-*` / `--font-*`
 * tokens are injected by Tailwind's `@theme` and by `next/font` onto `<html>`; an
 * inbox has neither. A template that reaches for `var(--color-gold)` renders
 * perfectly in `npm run email` and arrives unstyled in Gmail, so every value below
 * is written out and inlined at the element.
 */

export const color = {
  ink: '#0A0A0B',
  surface: '#111113',
  surface2: '#16161A',
  text: '#F4F1EA',
  muted: '#8C8884',
  hairline: '#26242A',
  gold: '#C9A86A',
  goldLite: '#E7D6AE',
  danger: '#E5564B',
  success: '#7BDCA0',
} as const;

/**
 * The webfont link is honoured by Apple Mail and ignored by Gmail, so the layout has
 * to hold in Georgia + Arial. Both stacks name the fallback explicitly rather than
 * leaning on `serif` / `sans-serif` defaults, which vary wildly between clients.
 */
export const font = {
  display: "'Fraunces', Georgia, 'Times New Roman', serif",
  ui: "'Inter Tight', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
} as const;

export const GOOGLE_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400&family=Inter+Tight:wght@400;600&display=swap';

/** Container width in px. 600 is the widest every desktop client shows without scaling. */
export const CONTAINER_WIDTH = 600;

/**
 * `bgcolor` is a presentational attribute Outlook and several Android clients still
 * honour when they discard `background-color`, but React's typings declare it only on
 * `<table>`. Spreading a pre-built object skips JSX excess-property checking, so the
 * attribute reaches `<body>` and `<td>` without a cast at every call site.
 */
export function bgAttr(hex: string): { bgcolor: string } {
  return { bgcolor: hex };
}
