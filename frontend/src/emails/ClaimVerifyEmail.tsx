import * as React from 'react';

import { CtaButton } from './components/CtaButton';
import { Divider } from './components/Divider';
import { Accent, EmailLayout, FallbackLink, H1, Inset, Meta, P } from './components/EmailLayout';
import { Eyebrow } from './components/Eyebrow';

export const subject = 'Confirm your FRÈ instance';

export interface ClaimVerifyEmailProps {
  actionUrl: string;
  expiresInMinutes?: number | null;
}

export function ClaimVerifyEmail({ actionUrl, expiresInMinutes }: ClaimVerifyEmailProps) {
  return (
    <EmailLayout
      preview="Confirm this address to finish claiming your instance."
      footerNote={expiresInMinutes ? `This link expires in ${expiresInMinutes} minutes.` : null}
    >
      <Eyebrow>Confirm ownership</Eyebrow>
      <H1>
        This instance is <Accent>yours</Accent>.
      </H1>
      <P>
        Confirm this address to finish claiming it. You become the owner — the one account
        that can invite the rest of the house, and take access back again.
      </P>

      <CtaButton href={actionUrl} label="Confirm and claim" width={230} />
      <FallbackLink href={actionUrl} />

      <Divider />

      <Inset>
        <Meta>
          The moment you confirm, the claim code stops working and is wiped from the logs.
          Everyone else joins by invitation from then on.
        </Meta>
      </Inset>
    </EmailLayout>
  );
}

export const PreviewProps: ClaimVerifyEmailProps = {
  actionUrl: 'https://fre.example.com/auth/verify?token=preview-claim-token',
  expiresInMinutes: 20,
};

ClaimVerifyEmail.PreviewProps = PreviewProps;

export default ClaimVerifyEmail;
