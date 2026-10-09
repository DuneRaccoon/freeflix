/**
 * Small CSS-value helpers. Deliberately a plain module with no `'use client'` and no
 * imports: `TitleScreen.tsx` needs this and should not have to depend on a client
 * component to get one string.
 */

/**
 * The inline `background-image` value for a URL.
 *
 * Extracted and exported ONLY so the quoting is testable. jsdom normalises an inline
 * background-image, so an assertion made through a rendered component passes whether or not
 * the value is quoted — a review found the test that claimed to check this could not fail.
 * The quoting matters: an unquoted `url(...)` ends at the first `)` or whitespace, so a
 * filename containing either would break out of the declaration.
 */
export function backgroundImageFor(url: string): string {
  return `url(${JSON.stringify(url)})`;
}
