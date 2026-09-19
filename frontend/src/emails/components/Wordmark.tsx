import * as React from 'react';

import { color, font } from './tokens';

/**
 * Flat gold, deliberately.
 *
 * The app's `ui/Wordmark.tsx` paints itself with `background-clip:text` +
 * `text-transparent`. Outlook drops `background-clip`, keeps the transparent fill and
 * renders the mark invisible — an email whose masthead is a blank gap. Email gets a
 * single opaque colour and no gradient.
 */
export function Wordmark() {
  return (
    <span
      className="fre-wordmark"
      style={{
        fontFamily: font.display,
        fontSize: '26px',
        lineHeight: '30px',
        fontWeight: 600,
        letterSpacing: '3px',
        color: color.goldLite,
      }}
    >
      FR&Egrave;
    </span>
  );
}

export default Wordmark;
