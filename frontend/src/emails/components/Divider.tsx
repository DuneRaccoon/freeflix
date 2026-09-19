import * as React from 'react';

import { bgAttr, color } from './tokens';

/**
 * A one-pixel row, never `<hr>` — clients restyle `<hr>` with their own borders and
 * margins. The spacer rows carry the vertical rhythm because margins on table
 * elements are ignored by Outlook.
 */
export function Divider({ space = 28 }: { space?: number }) {
  const spacer: React.CSSProperties = { height: `${space}px`, fontSize: '0', lineHeight: '1px' };

  return (
    <table
      role="presentation"
      width="100%"
      border={0}
      cellPadding="0"
      cellSpacing="0"
      style={{ width: '100%', borderCollapse: 'collapse' }}
    >
      <tbody>
        <tr>
          <td style={spacer}>&nbsp;</td>
        </tr>
        <tr>
          <td
            className="fre-rule"
            {...bgAttr(color.hairline)}
            style={{ height: '1px', fontSize: '0', lineHeight: '1px', backgroundColor: color.hairline }}
          >
            &nbsp;
          </td>
        </tr>
        <tr>
          <td style={spacer}>&nbsp;</td>
        </tr>
      </tbody>
    </table>
  );
}

export default Divider;
