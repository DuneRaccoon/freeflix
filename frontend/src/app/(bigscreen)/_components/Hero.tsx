'use client';
import Link from 'next/link';
import { backgroundImageFor } from './css';
import type { CatalogItem } from '@/types';
import type { FocusProps } from '../_focus/useFocusGrid';

/**
 * Upgrade a TMDB image URL to a larger rendition, for the one image on this surface that
 * fills the screen. The catalog hands back `w1280`, which is roughly a 3x upscale on a 4K
 * panel; the hero box is 1920 wide whatever the panel is.
 *
 * Returns the input unchanged when it is not a TMDB sized path (`/t/p/{size}/{file}` on
 * image.tmdb.org), and null for null, undefined or an empty string.
 *
 * `w1920` is the only size on offer, on purpose. An `original` backdrop can be 3840x2160,
 * about 33MB decoded, on a television with very finite memory, and the hero is drawn in a
 * 1920-wide box regardless of what is behind it. Cheaper to delete the footgun than to
 * document it. (TMDB does serve `w1920`: a 1280x720 file becomes 1920x1080.)
 */
export function atSize(url: string | null | undefined, size: 'w1920'): string | null {
  if (!url) return null;
  // Both the host and the `/t/p/` prefix are required, so a URL this does not understand is
  // left alone rather than rewritten into one that may not exist.
  return url.replace(/^(https:\/\/image\.tmdb\.org\/t\/p\/)(?:w\d+|h\d+|original)(\/.+)$/, `$1${size}$2`);
}

/**
 * The home screen's lead title: a full-bleed backdrop, the title, the year and a
 * three-line overview. Static by design (spec §9 drops the web hero's Ken-Burns transform).
 *
 * ONE FOCUS STOP, or none. With `focusProps` the whole banner is the stop and OK opens
 * `href`; nothing inside it is a second one. Without them it is plain markup. The caller
 * decides, because whether the hero is a stop at all is what the screen reports to
 * `useFocusGrid` as that row's count, and the two must agree.
 *
 * The art is an inline `background-image`, not an `<img>`: it has to cover a box whose
 * aspect ratio is the screen's, and `bigscreen.css` positions it (`cover`, top-aligned).
 * It is drawn under a gradient scrim so the text stays legible with no per-frame effect.
 */
export function Hero({
  item,
  focusProps,
  href,
}: {
  item: CatalogItem | null;
  /** Rendered as the hero's single focusable element when present. */
  focusProps?: FocusProps;
  href?: string;
}) {
  if (!item) return null;

  const art = atSize(item.backdrop_url, 'w1920');
  const inner = (
    <>
      {/* backgroundImageFor quotes and escapes the URL, so a stray quote or paren in it cannot end the url(). */}
      {art && <div className="bs-hero__art" style={{ backgroundImage: backgroundImageFor(art) }} aria-hidden="true" />}
      <div className="bs-hero__scrim" aria-hidden="true" />
      <div className="bs-hero__body">
        <h2 className="bs-hero__title">{item.title}</h2>
        {item.year ? (
          <p className="bs-hero__meta">
            <span>{item.year}</span>
          </p>
        ) : null}
        {item.overview ? <p className="bs-hero__overview">{item.overview}</p> : null}
      </div>
    </>
  );

  if (!focusProps) return <div className="bs-hero">{inner}</div>;
  // A stop with nowhere to go is still a stop: the remote must have something to land on.
  if (!href) return <div className="bs-hero" {...focusProps}>{inner}</div>;
  return (
    <Link href={href} className="bs-hero" draggable={false} {...focusProps}>
      {inner}
    </Link>
  );
}
