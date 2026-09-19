import * as React from 'react';

import { CtaButton } from './components/CtaButton';
import { Divider } from './components/Divider';
import { Accent, EmailLayout, FallbackLink, H1, Inset, Meta, P } from './components/EmailLayout';
import { Eyebrow } from './components/Eyebrow';

export const subject = 'Welcome to FRÈ';

export interface WelcomeEmailProps {
  actionUrl: string;
  displayName?: string | null;
}

export function WelcomeEmail({ actionUrl, displayName }: WelcomeEmailProps) {
  const name = displayName?.trim();

  return (
    <EmailLayout preview="Your profile is ready.">
      <Eyebrow>Welcome</Eyebrow>
      <H1>
        {name ? (
          <>
            Come in, <Accent>{name}</Accent>.
          </>
        ) : (
          <>
            You’re <Accent>in</Accent>.
          </>
        )}
      </H1>
      <P>
        Your profile is ready. Everything you start is remembered, so a film left in the
        kitchen is waiting exactly where you left it in bed.
      </P>

      <CtaButton href={actionUrl} label="Open FRÈ" width={190} />
      <FallbackLink href={actionUrl} />

      <Divider />

      <Inset>
        <Meta>Keep a list of what’s next.</Meta>
        <Meta>Download for the road.</Meta>
        <Meta>Lock your profile with a passcode in Settings.</Meta>
      </Inset>
    </EmailLayout>
  );
}

export const PreviewProps: WelcomeEmailProps = {
  actionUrl: 'https://fre.example.com/',
  displayName: 'Ben',
};

WelcomeEmail.PreviewProps = PreviewProps;

export default WelcomeEmail;
