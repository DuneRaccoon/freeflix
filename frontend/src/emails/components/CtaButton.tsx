import * as React from 'react';

import { bgAttr, color, font } from './tokens';

export interface CtaButtonProps {
  href: string;
  label: string;
  /** VML has no shrink-to-fit, so the Outlook pill needs an explicit width. */
  width?: number;
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * The one gold moment that is allowed to be clicked.
 *
 * The inner markup is raw rather than JSX because React drops comment nodes, and the
 * `<!--[if !mso]><!-->` wrapper has to sit *between* the VML block and the anchor —
 * it cannot be expressed as a child of either. `bgcolor` plus a solid
 * `background-color` sit under the gradient so Outlook and most Android clients, which
 * discard `background-image`, still get a gold pill instead of a transparent one.
 */
export function CtaButton({ href, label, width = 260 }: CtaButtonProps) {
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);

  const inner = [
    '<!--[if mso]>',
    `<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeHref}" style="height:48px;v-text-anchor:middle;width:${width}px;" arcsize="50%" stroke="f" fillcolor="${color.gold}">`,
    '<w:anchorlock/>',
    `<center style="color:${color.ink};font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;">${safeLabel}</center>`,
    '</v:roundrect>',
    '<![endif]-->',
    '<!--[if !mso]><!-->',
    `<a href="${safeHref}" style="display:inline-block;padding:15px 30px;border-radius:999px;font-family:${font.ui};font-size:15px;line-height:18px;font-weight:600;color:${color.ink};text-decoration:none;">${safeLabel}</a>`,
    '<!--<![endif]-->',
  ].join('');

  return (
    <table
      role="presentation"
      border={0}
      cellPadding="0"
      cellSpacing="0"
      align="left"
      style={{ borderCollapse: 'separate' }}
    >
      <tbody>
        <tr>
          <td
            className="fre-cta"
            align="center"
            {...bgAttr(color.gold)}
            style={{
              borderRadius: '999px',
              backgroundColor: color.gold,
              backgroundImage: `linear-gradient(90deg, ${color.goldLite}, ${color.gold})`,
            }}
            dangerouslySetInnerHTML={{ __html: inner }}
          />
        </tr>
      </tbody>
    </table>
  );
}

export default CtaButton;
