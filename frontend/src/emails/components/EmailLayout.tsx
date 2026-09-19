import * as React from 'react';
import { Body, Container, Head, Html, Preview } from '@react-email/components';

import { bgAttr, color, CONTAINER_WIDTH, font, GOOGLE_FONTS_HREF } from './tokens';
import { Wordmark } from './Wordmark';

/**
 * Every rule here is a defence, not a style: the inline styles below are the design.
 *
 * `[data-ogsc]` / `[data-ogsb]` are the attributes Outlook.com stamps on elements whose
 * inline colours it has rewritten for its own dark mode; restating the palette under
 * them puts FRÈ back. The `prefers-color-scheme: light` block restates the *same* dark
 * values on purpose — the palette is dark by design and a light-mode client inverting
 * it would produce grey-on-cream, not a light theme.
 */
const DEFENCES = `
:root { color-scheme: dark light; supported-color-schemes: dark light; }
body { margin:0 !important; padding:0 !important; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
a { color:#F4F1EA; }

[data-ogsc] .fre-body, [data-ogsb] .fre-body,
[data-ogsc] .fre-canvas, [data-ogsb] .fre-canvas { background-color:#0A0A0B !important; }
[data-ogsc] .fre-card, [data-ogsb] .fre-card { background-color:#111113 !important; border-color:#26242A !important; }
[data-ogsc] .fre-inset, [data-ogsb] .fre-inset { background-color:#16161A !important; border-color:#26242A !important; }
[data-ogsc] .fre-rule, [data-ogsb] .fre-rule { background-color:#26242A !important; }
[data-ogsc] .fre-cta, [data-ogsb] .fre-cta { background-color:#C9A86A !important; }
[data-ogsc] .fre-text, [data-ogsc] .fre-h1 { color:#F4F1EA !important; }
[data-ogsc] .fre-meta { color:#8C8884 !important; }
[data-ogsc] .fre-gold { color:#C9A86A !important; }
[data-ogsc] .fre-accent, [data-ogsc] .fre-wordmark { color:#E7D6AE !important; }

@media (prefers-color-scheme: light) {
  .fre-body, .fre-canvas { background-color:#0A0A0B !important; }
  .fre-card { background-color:#111113 !important; border-color:#26242A !important; }
  .fre-inset { background-color:#16161A !important; border-color:#26242A !important; }
  .fre-rule { background-color:#26242A !important; }
  .fre-cta { background-color:#C9A86A !important; }
  .fre-text, .fre-h1 { color:#F4F1EA !important; }
  .fre-meta { color:#8C8884 !important; }
  .fre-gold { color:#C9A86A !important; }
  .fre-accent, .fre-wordmark { color:#E7D6AE !important; }
}

@media only screen and (max-width:480px) {
  .fre-card { padding:24px !important; }
  .fre-h1 { font-size:28px !important; line-height:34px !important; letter-spacing:-0.5px !important; }
}
`;

export interface EmailLayoutProps {
  /** Inbox preheader. Say the thing the subject line could not fit. */
  preview: string;
  /** One line above the boilerplate — who invited them, when the link dies. */
  footerNote?: string | null;
  children: React.ReactNode;
}

export function EmailLayout({ preview, footerNote, children }: EmailLayoutProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark light" />
        <meta name="supported-color-schemes" content="dark light" />
        <link rel="stylesheet" href={GOOGLE_FONTS_HREF} />
        <style dangerouslySetInnerHTML={{ __html: DEFENCES }} />
      </Head>
      <Preview>{preview}</Preview>
      <Body
        className="fre-body"
        {...bgAttr(color.ink)}
        style={{ backgroundColor: color.ink, margin: 0, padding: 0 }}
      >
        <table
          className="fre-canvas"
          role="presentation"
          width="100%"
          border={0}
          cellPadding="0"
          cellSpacing="0"
          {...bgAttr(color.ink)}
          style={{ width: '100%', backgroundColor: color.ink, borderCollapse: 'collapse' }}
        >
          <tbody>
            <tr>
              <td align="center" style={{ padding: '32px 12px 40px' }}>
                <Container style={{ width: '100%', maxWidth: `${CONTAINER_WIDTH}px` }}>
                  <table
                    role="presentation"
                    width="100%"
                    border={0}
                    cellPadding="0"
                    cellSpacing="0"
                    style={{ width: '100%', borderCollapse: 'separate' }}
                  >
                    <tbody>
                      <tr>
                        <td
                          className="fre-card"
                          {...bgAttr(color.surface)}
                          style={{
                            backgroundColor: color.surface,
                            border: `1px solid ${color.hairline}`,
                            borderRadius: '16px',
                            padding: '32px',
                          }}
                        >
                          <div style={{ marginBottom: '28px' }}>
                            <Wordmark />
                          </div>
                          {children}
                        </td>
                      </tr>
                    </tbody>
                  </table>

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
                        <td
                          className="fre-meta"
                          align="center"
                          style={{
                            padding: '24px 16px 0',
                            fontFamily: font.ui,
                            fontSize: '12px',
                            lineHeight: '18px',
                            color: color.muted,
                            textAlign: 'center',
                          }}
                        >
                          {footerNote ? <div style={{ margin: 0 }}>{footerNote}</div> : null}
                          <div style={{ margin: 0 }}>
                            If you weren’t expecting this, you can ignore this email.
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td
                          className="fre-meta"
                          align="center"
                          style={{
                            padding: '12px 16px 0',
                            fontFamily: font.display,
                            fontStyle: 'italic',
                            fontSize: '13px',
                            lineHeight: '18px',
                            color: color.muted,
                            textAlign: 'center',
                          }}
                        >
                          <div style={{ margin: 0 }}>Cinema, kept close.</div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </Container>
              </td>
            </tr>
          </tbody>
        </table>
      </Body>
    </Html>
  );
}

/**
 * 40px leading rather than the app's 0.92 ratio: the Georgia fallback has a taller
 * x-height than Fraunces and collides with itself at display leading.
 */
export function H1({ children }: { children: React.ReactNode }) {
  return (
    <h1
      className="fre-h1"
      style={{
        margin: '0 0 18px',
        fontFamily: font.display,
        fontSize: '34px',
        lineHeight: '40px',
        fontWeight: 400,
        letterSpacing: '-0.7px',
        color: color.text,
      }}
    >
      {children}
    </h1>
  );
}

/** The `Who's <em>watching?</em>` motif — one word, gold-lite, italic. */
export function Accent({ children }: { children: React.ReactNode }) {
  return (
    <em className="fre-accent" style={{ fontStyle: 'italic', color: color.goldLite }}>
      {children}
    </em>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="fre-text"
      style={{
        margin: '0 0 18px',
        fontFamily: font.ui,
        fontSize: '16px',
        lineHeight: '26px',
        fontWeight: 400,
        color: color.text,
      }}
    >
      {children}
    </p>
  );
}

export function Meta({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="fre-meta"
      style={{
        margin: '0 0 8px',
        fontFamily: font.ui,
        fontSize: '13px',
        lineHeight: '20px',
        color: color.muted,
      }}
    >
      {children}
    </p>
  );
}

export function Inset({ children }: { children: React.ReactNode }) {
  return (
    <table
      role="presentation"
      width="100%"
      border={0}
      cellPadding="0"
      cellSpacing="0"
      style={{ width: '100%', borderCollapse: 'separate' }}
    >
      <tbody>
        <tr>
          <td
            className="fre-inset"
            {...bgAttr(color.surface2)}
            style={{
              backgroundColor: color.surface2,
              border: `1px solid ${color.hairline}`,
              borderRadius: '10px',
              padding: '16px 20px',
            }}
          >
            {children}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/**
 * Sits immediately after the CTA, never in the footer: Gmail clips a message past
 * ~102KB and the fallback is the only thing standing between a clipped email and a
 * recipient who cannot sign in.
 */
export function FallbackLink({ href }: { href: string }) {
  return (
    <div style={{ marginTop: '22px' }}>
      <Meta>Or paste this into your browser:</Meta>
      <a
        className="fre-text"
        href={href}
        style={{
          fontFamily: font.ui,
          fontSize: '13px',
          lineHeight: '20px',
          color: color.text,
          textDecoration: 'underline',
          wordBreak: 'break-all',
        }}
      >
        {href}
      </a>
    </div>
  );
}

export default EmailLayout;
