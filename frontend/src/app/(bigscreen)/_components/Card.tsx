'use client';
import { memo, useState } from 'react';
import Link from 'next/link';
import type { FocusProps } from '../_focus/useFocusGrid';

export interface CardItem {
  /**
   * The title's identity, for the screen's own bookkeeping (resume lookups, de-duping).
   * `Rail` deliberately does NOT key cards by it: it keys by column index, because a
   * refetch that re-keys the focused card while the row count is unchanged unmounts the
   * focused node and DOM focus falls to `<body>`, which a remote cannot recover from.
   * Do not "fix" the rail to `key={item.id}`.
   */
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
 *   only about one text line of spare height inside the rail track, so anything taller gets clipped.
 *
 * `memo` is what makes the focus hook's per-cell `FocusProps` worth having: a move
 * re-renders the grid's owner, and only the two cells whose `tabIndex` flipped should
 * follow it. It compares by value (`sameProps`), so a screen that rebuilds its
 * `CardItem`s inline on every render still gets the saving.
 */
interface CardProps {
  item: CardItem;
  shape: 'poster' | 'wide';
  focusProps: FocusProps;
}

/**
 * Every field of `CardItem`, as a record so that adding a field to the interface is a
 * type error here until the comparison below knows about it. A field the comparator
 * forgets would make the card silently stop updating when only that field changed.
 */
const ITEM_FIELDS: Record<keyof CardItem, true> = {
  id: true,
  href: true,
  title: true,
  subtitle: true,
  artUrl: true,
  progressPct: true,
  badge: true,
};
const ITEM_KEYS = Object.keys(ITEM_FIELDS) as Array<keyof CardItem>;
// Same trick for FocusProps: a fourth field added there would otherwise be compared by
// nobody, and the memo would start skipping renders it should do.
const FOCUS_FIELDS: Record<keyof FocusProps, true> = { tabIndex: true, ref: true, onFocus: true };
const FOCUS_KEYS = Object.keys(FOCUS_FIELDS) as Array<keyof FocusProps>;

function sameProps(a: CardProps, b: CardProps): boolean {
  if (a.shape !== b.shape) return false;
  const [fa, fb] = [a.focusProps, b.focusProps];
  if (fa !== fb && !FOCUS_KEYS.every((k) => fa[k] === fb[k])) return false;
  return a.item === b.item || ITEM_KEYS.every((k) => a.item[k] === b.item[k]);
}

export const Card = memo(function Card({ item, shape, focusProps }: CardProps) {
  // The URL that failed, not a flag: rails key cells by index, so a refetch can hand
  // this instance a different title, and a sticky "failed" would show it as a text card.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const { title, subtitle, artUrl, badge } = item;
  const showArt = !!artUrl && artUrl !== failedUrl;
  // NaN fails `> 0`, so a bad value draws no bar rather than a broken one.
  const progress = item.progressPct ?? 0;

  return (
    // Both the link and its image are natively draggable. Magic Remote jitter during an
    // OK press can start a drag, and a drag swallows the click. Turning it off on the
    // image alone is not enough, because the drag can then fall back to the enclosing link.
    <Link
      href={item.href}
      className={`bs-card bs-card--${shape}`}
      draggable={false}
      {...focusProps}
    >
      {showArt ? (
        <img
          className="bs-card__art"
          src={artUrl}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailedUrl(artUrl)}
        />
      ) : (
        // The title is already in the label below; do not read it out twice. The text is
        // wrapped because a flex container cannot line-clamp its own text (see the CSS).
        <span className="bs-card__art bs-card__fallback" aria-hidden="true">
          <span className="bs-card__fallback-text">{title}</span>
        </span>
      )}
      <p className="bs-card__label">{title}</p>
      {(subtitle || badge) && (
        // A flex row of up to two element children: the subtitle text, which takes the
        // ellipsis, and the badge, which must survive it. The subtitle is its own element
        // so the CSS can truncate it without touching the badge.
        <span className="bs-card__sub">
          {subtitle && <span className="bs-card__subtext">{subtitle}</span>}
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
}, sameProps);
