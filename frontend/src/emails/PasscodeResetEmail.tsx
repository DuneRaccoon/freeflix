import * as React from 'react';

import { CtaButton } from './components/CtaButton';
import { Divider } from './components/Divider';
import { Accent, EmailLayout, FallbackLink, H1, Inset, Meta, P } from './components/EmailLayout';
import { Eyebrow } from './components/Eyebrow';

/**
 * Sent to a member who forgot a profile's code. The link removes the code from that one
 * profile and nothing else: it mints no session, and the member still has to sign in.
 */
export const subject = 'Reset your FRÈ profile code';

export interface PasscodeResetEmailProps {
  actionUrl: string;
  profileName?: string | null;
  expiresInMinutes?: number | null;
}

export function PasscodeResetEmail({
  actionUrl,
  profileName,
  expiresInMinutes,
}: PasscodeResetEmailProps) {
  // Used only mid-sentence, so the fallback never needs a capital letter.
  const name = profileName ?? 'your profile';
  const minutes =
    typeof expiresInMinutes === 'number' && expiresInMinutes > 0 ? expiresInMinutes : null;
  const expiry = minutes ? `${minutes} minutes` : 'a short while';
  const footerNote = minutes ? `This link expires in ${minutes} minutes.` : null;

  return (
    <EmailLayout preview="Remove a profile code you forgot." footerNote={footerNote}>
      <Eyebrow>Profile code</Eyebrow>

      <H1>
        Remove the <Accent>code</Accent>.
      </H1>
      <P>
        {`Someone asked to clear the code on ${name}. If that was you, the link below is where you do it, and it is good for ${expiry}.`}
      </P>
      <P>
        Opening it doesn’t sign you in. It only removes the code from that profile, and you can
        set a new one afterwards.
      </P>

      <CtaButton href={actionUrl} label="Remove the code" width={250} />
      <FallbackLink href={actionUrl} />

      <Divider />

      <Inset>
        <Meta>
          {`If you didn’t ask for this, ignore this email. The code on ${name} stays exactly as it is.`}
        </Meta>
      </Inset>
    </EmailLayout>
  );
}

export const PreviewProps: PasscodeResetEmailProps = {
  actionUrl: 'https://fre.example.com/auth/reset-passcode?token=preview-passcode-token',
  profileName: 'Kids',
  expiresInMinutes: 20,
};

/** The react-email CLI reads this off the component, not the module export. */
PasscodeResetEmail.PreviewProps = PreviewProps;

export default PasscodeResetEmail;
