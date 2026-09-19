import * as React from 'react';

import { color, font } from './tokens';

/**
 * One per email. Together with the CTA it is the entire gold budget of the design
 * system — everything else is #F4F1EA on #111113 with #26242A hairlines.
 */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="fre-gold"
      style={{
        margin: '0 0 14px',
        fontFamily: font.ui,
        fontSize: '11px',
        lineHeight: '14px',
        fontWeight: 600,
        letterSpacing: '3.5px',
        textTransform: 'uppercase',
        color: color.gold,
      }}
    >
      {children}
    </p>
  );
}

export default Eyebrow;
