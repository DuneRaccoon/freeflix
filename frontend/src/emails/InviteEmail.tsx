import * as React from 'react';

import { CtaButton } from './components/CtaButton';
import { Divider } from './components/Divider';
import { Accent, EmailLayout, FallbackLink, H1, Inset, Meta, P } from './components/EmailLayout';
import { Eyebrow } from './components/Eyebrow';

export const subject = "You're invited to FRÈ";

export interface InviteEmailProps {
  actionUrl: string;
  invitedBy?: string | null;
  expiresInHours?: number | null;
  /**
   * The operator's label for this deployment. Deliberately not rendered: the backend
   * sends `settings.project_name`, and the product is FRÈ in every line of copy.
   */
  instanceName?: string | null;
}

export function InviteEmail({ actionUrl, invitedBy, expiresInHours }: InviteEmailProps) {
  const host = invitedBy?.trim() || 'The owner';
  const footerNote = [
    invitedBy?.trim() ? `Invited by ${invitedBy.trim()}.` : null,
    expiresInHours ? `This invitation expires in ${expiresInHours} hours.` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <EmailLayout
      preview="A seat has been kept for you."
      footerNote={footerNote || null}
    >
      <Eyebrow>An invitation</Eyebrow>
      <H1>
        Someone kept you a <Accent>seat</Accent>.
      </H1>
      <P>
        {`${host} invited you to their FRÈ library — films and shows, streamed at home, on every screen in the house.`}
      </P>
      <P>Pick a name, pick a face, and you’re in.</P>

      <CtaButton href={actionUrl} label="Accept the invitation" width={250} />
      <FallbackLink href={actionUrl} />

      <Divider />

      <Inset>
        <Meta>One · Choose a name and a face.</Meta>
        <Meta>Two · Everything you start is remembered.</Meta>
        <Meta>Three · Change screens, keep your place.</Meta>
      </Inset>
    </EmailLayout>
  );
}

export const PreviewProps: InviteEmailProps = {
  actionUrl: 'https://fre.example.com/invite?token=preview-invite-token',
  invitedBy: 'Ben',
  expiresInHours: 72,
  instanceName: 'FRÈ',
};

InviteEmail.PreviewProps = PreviewProps;

export default InviteEmail;
