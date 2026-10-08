'use client';
import { memo, useState } from 'react';
import Link from 'next/link';
import type { FocusProps } from '../_focus/useFocusGrid';

export interface CardItem {
  /** Stable key and focus identity. */
  id: string;
  /** Where OK navigates. A bigscreen route, never a (web) route. */
  href: string;
  title: string;
  /** Second line — a year, an episode label, whatever the rail wants. */
  subtitle?: string | null;
  /** Absolute URL already; the services layer returns absolute image URLs. */
  artUrl?: string | null;
  /** 0-100. Draws the resume bar when > 0. */
  progressPct?: number;
  /** Short pill, e.g. 'Up next'. */
  badge?: string | null;
}

/**
 * One title in a rail, and ONE focus stop.
 *
 * The web's PosterCard is four focusable elements (poster link, Play, My List, Info),
 * three of them pointing at the same href, which makes a 20-item rail ~80 D-pad presses
 * to cross. This is a single `<a>`: OK opens the detail screen, where Play and My List
 * live. Nothing here depends on hover; the Magic Remote fires real mouse events, which
 * makes hover UI half-work, so everything the viewer needs is reachable by focus alone.
 *
 * Markup traps, each learned from rendering `bigscreen.css`:
 * - the label is a `<p>`: `h1`-`h3` are global element rules there and an `<h3>` would
 *   inherit gold-lite and weight 600;
 * - the badge lives in `.bs-card__sub`: the label is a vertical `-webkit-box`, which
 *   lays children out as blocks and would drop a badge onto its own line;
 * - the subtitle is one line by design and the bar is last: a focused card's ring has
 *   about 1px of clearance inside the rail track, so anything taller gets clipped.
 *
 * `memo` is what makes the focus hook's per-cell `FocusProps` worth having: a move
 * re-renders the grid's owner, and only the two cells whose `tabIndex` flipped should
 * follow it (given items whose identity the owner keeps stable).
 */
export const Card = memo(function Card({
  item,
  shape,
  focusProps,
}: {
  item: CardItem;
  shape: 'poster' | 'wide';
  focusProps: FocusProps;
}) {
  // The URL that failed, not a flag: rails key cells by index, so a refetch can hand
  // this instance a different title, and a sticky "failed" would show it as a text card.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const { title, subtitle, artUrl, badge } = item;
  const showArt = !!artUrl && artUrl !== failedUrl;
  // NaN fails `> 0`, so a bad value draws no bar rather than a broken one.
  const progress = item.progressPct ?? 0;

  return (
    <Link href={item.href} className={`bs-card bs-card--${shape}`} {...focusProps}>
      {showArt ? (
        <img
          className="bs-card__art"
          src={artUrl}
          alt=""
          loading="lazy"
          onError={() => setFailedUrl(artUrl)}
        />
      ) : (
        // The title is already in the label below; do not read it out twice.
        <span className="bs-card__art bs-card__fallback" aria-hidden="true">
          {title}
        </span>
      )}
      <p className="bs-card__label">{title}</p>
      {(subtitle || badge) && (
        <span className="bs-card__sub">
          {subtitle}
          {badge && <span className="bs-card__badge">{badge}</span>}
        </span>
      )}
      {progress > 0 && (
        <span className="bs-card__bar">
          <span style={{ width: `${Math.min(progress, 100)}%` }} />
        </span>
      )}
    </Link>
  );
});
