import * as React from 'react';

import { CtaButton } from './components/CtaButton';
import { Accent, EmailLayout, FallbackLink, H1, Meta, P } from './components/EmailLayout';
import { Eyebrow } from './components/Eyebrow';

export const subject = 'Your FRÈ sign-in link';

export interface MagicLinkEmailProps {
  actionUrl: string;
  expiresInMinutes?: number | null;
}

export function MagicLinkEmail({ actionUrl, expiresInMinutes }: MagicLinkEmailProps) {
  return (
    <EmailLayout
      preview="One link, and you’re back in."
      footerNote={expiresInMinutes ? `This link expires in ${expiresInMinutes} minutes.` : null}
    >
      <Eyebrow>Sign in</Eyebrow>
      <H1>
        Your door is <Accent>open</Accent>.
      </H1>
      <P>
        Use the link below to sign in to FRÈ. It works once, and only from this address —
        there is no password to remember or lose.
      </P>

      <CtaButton href={actionUrl} label="Sign in to FRÈ" width={220} />
      <FallbackLink href={actionUrl} />

      <div style={{ marginTop: '22px' }}>
        <Meta>Didn’t ask to sign in? Nothing has changed, and the link will quietly expire.</Meta>
      </div>
    </EmailLayout>
  );
}

export const PreviewProps: MagicLinkEmailProps = {
  actionUrl: 'https://fre.example.com/auth/verify?token=preview-login-token',
  expiresInMinutes: 20,
};

MagicLinkEmail.PreviewProps = PreviewProps;

export default MagicLinkEmail;
