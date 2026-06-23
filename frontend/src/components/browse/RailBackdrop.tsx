// frontend/src/components/browse/RailBackdrop.tsx
import React from 'react';
import { FeedTheme } from '@/lib/feedThemes';
import FeedMotif from './FeedMotif';

/** Vertical fade so adjacent themed rows never hard-seam against each other. */
const V_MASK =
  'linear-gradient(to bottom, transparent 0%, #000 18%, #000 82%, transparent 100%)';

export interface RailBackdropProps {
  theme: FeedTheme;
}

/**
 * Decorative layer behind a themed Row/RankedRow. Sits at -z-10 inside the
 * row's <section> (which establishes a stacking context via `relative z-[2]`),
 * so it paints behind the header and track. The band gradient is authored to
 * fade at the left/right edges; this component adds the top/bottom fade.
 */
const RailBackdrop: React.FC<RailBackdropProps> = ({ theme }) => (
  <div
    data-testid="rail-backdrop"
    aria-hidden="true"
    className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    style={{ WebkitMaskImage: V_MASK, maskImage: V_MASK }}
  >
    <div className="absolute inset-0" style={{ background: theme.band }} />
    <FeedMotif motif={theme.motif} color={theme.accent} />
  </div>
);

export default RailBackdrop;
