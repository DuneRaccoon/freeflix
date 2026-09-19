import * as React from 'react';

import { Divider } from './components/Divider';
import { Accent, EmailLayout, H1, Inset, Meta, P } from './components/EmailLayout';
import { Eyebrow } from './components/Eyebrow';

export const subject = 'Your FRÈ access has ended';

export interface AccessRevokedEmailProps {
  displayName?: string | null;
  /**
   * The operator's label for this deployment. Deliberately not rendered: the backend
   * sends `settings.project_name`, and the product is FRÈ in every line of copy.
   */
  instanceName?: string | null;
}

/**
 * The one template with no CTA. There is nothing to click — sending a gold button to a
 * door that is now locked would be worse than sending none, and the design system only
 * spends gold on an action that works.
 */
export function AccessRevokedEmail({ displayName }: AccessRevokedEmailProps) {
  const name = displayName?.trim();
  const opener = name ? `${name}, the owner` : 'The owner';

  return (
    <EmailLayout preview="Your access to this library has been turned off.">
      <Eyebrow>Access ended</Eyebrow>
      <H1>
        Your access has <Accent>ended</Accent>.
      </H1>
      <P>
        {`${opener} of this FRÈ instance has turned off access for this address. Signing in from it will no longer work.`}
      </P>
      <P>
        Your profiles and what you were part-way through stay on the instance. Nothing has
        been sent anywhere else.
      </P>

      <Divider />

      <Inset>
        <Meta>
          If this looks like a mistake, ask whoever runs the instance to restore you — it is
          one click on their side, and everything comes back as it was.
        </Meta>
      </Inset>
    </EmailLayout>
  );
}

export const PreviewProps: AccessRevokedEmailProps = {
  displayName: 'Ben',
  instanceName: 'FRÈ',
};

AccessRevokedEmail.PreviewProps = PreviewProps;

export default AccessRevokedEmail;
