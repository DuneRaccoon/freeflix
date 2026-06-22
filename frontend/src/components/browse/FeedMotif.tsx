// frontend/src/components/browse/FeedMotif.tsx
import React from 'react';
import { MotifConfig } from '@/lib/feedThemes';

/**
 * Decorative, reusable motif vocabulary for themed rows. All variants are
 * aria-hidden, pointer-events-none, and faint. The renderer is generic — a
 * theme only chooses a `kind` + colour + opacity.
 *
 * Star coordinates are a FIXED list (viewBox 100x40) so server and client
 * render identically (no Math.random, which is also unavailable here).
 */
const STARS: ReadonlyArray<readonly [number, number, number]> = [
  [6, 8, 0.5], [14, 22, 0.35], [21, 12, 0.45], [29, 31, 0.3], [37, 6, 0.4],
  [44, 19, 0.55], [52, 9, 0.3], [58, 27, 0.45], [64, 14, 0.35], [71, 33, 0.5],
  [77, 7, 0.4], [83, 21, 0.3], [88, 12, 0.5], [92, 29, 0.35], [9, 34, 0.4],
  [34, 24, 0.3], [49, 35, 0.45], [67, 4, 0.3], [80, 37, 0.4], [95, 17, 0.35],
];

export interface FeedMotifProps {
  motif?: MotifConfig;
  /** Drawing colour — the theme accent. */
  color: string;
}

const FeedMotif: React.FC<FeedMotifProps> = ({ motif, color }) => {
  if (!motif || motif.kind === 'none') return null;
  const opacity = motif.opacity ?? 0.07;

  switch (motif.kind) {
    case 'wordmark':
      return (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-[1%] top-1/2 -translate-y-1/2 select-none whitespace-nowrap font-display font-black uppercase leading-none"
          style={{ color, opacity, fontSize: 'clamp(120px, 17vw, 260px)', letterSpacing: '-0.04em' }}
        >
          {motif.text ?? ''}
        </span>
      );

    case 'beams':
      return (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            opacity,
            background: `radial-gradient(60% 120% at 22% 50%, ${color}, transparent 60%), radial-gradient(50% 120% at 74% 50%, ${color}, transparent 62%)`,
          }}
        />
      );

    case 'starfield':
      return (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 100 40"
          preserveAspectRatio="xMidYMid slice"
          style={{ opacity }}
        >
          {STARS.map(([cx, cy, r], i) => (
            <circle key={i} cx={cx} cy={cy} r={r} fill={color} />
          ))}
        </svg>
      );

    case 'arcs':
      return (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 100 40"
          preserveAspectRatio="xMidYMid slice"
          style={{ opacity }}
        >
          <g fill="none" stroke={color} strokeWidth={0.4}>
            <circle cx={90} cy={20} r={10} />
            <circle cx={90} cy={20} r={18} />
            <circle cx={90} cy={20} r={26} />
            <circle cx={90} cy={20} r={34} />
          </g>
        </svg>
      );

    case 'halftone':
      return (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            opacity,
            backgroundImage: `radial-gradient(${color} 1px, transparent 1.4px)`,
            backgroundSize: '13px 13px',
            WebkitMaskImage: 'linear-gradient(115deg, #000 0%, transparent 58%)',
            maskImage: 'linear-gradient(115deg, #000 0%, transparent 58%)',
          }}
        />
      );

    default:
      return null;
  }
};

export default FeedMotif;
