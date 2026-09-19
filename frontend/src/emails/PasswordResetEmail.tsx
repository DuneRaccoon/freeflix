import * as React from 'react';

import { CtaButton } from './components/CtaButton';
import { Divider } from './components/Divider';
import { Accent, EmailLayout, FallbackLink, H1, Inset, Meta, P } from './components/EmailLayout';
import { Eyebrow } from './components/Eyebrow';

/**
 * The owner-only template. Members never receive it — they sign in by emailed link and
 * have no password to set or lose.
 *
 * `isFirstTime` is not a clause bolted onto one body of copy; it is two different
 * emails. A reset answers a request to *change* something that exists and has to carry
 * the "you didn't do this? then nothing happened" reassurance. A first password is
 * handed to someone who has just been given the instance (an ownership transfer, or an
 * instance claimed before passwords existed) and nothing is wrong — so the word "reset"
 * never appears in that variant, in the subject or anywhere in the body.
 */

/** Default subject. The first-password variant needs its own — see `subjectFor`. */
export const subject = 'Reset your FRÈ password';

/** Nothing is being reset for an owner who has never had a password. */
export const firstTimeSubject = 'Set your FRÈ password';

export function subjectFor(props: { isFirstTime?: boolean } = {}): string {
  return props.isFirstTime ? firstTimeSubject : subject;
}

export interface PasswordResetEmailProps {
  actionUrl: string;
  expiresInMinutes?: number | null;
  /** True when the recipient has no password yet, not when they forgot one. */
  isFirstTime?: boolean;
}

export function PasswordResetEmail({
  actionUrl,
  expiresInMinutes,
  isFirstTime = false,
}: PasswordResetEmailProps) {
  const minutes =
    typeof expiresInMinutes === 'number' && expiresInMinutes > 0 ? expiresInMinutes : null;
  // The expiry is stated in the body as well as the footer: the footer is the part
  // Gmail clips, and an unexplained dead link is the worst way to learn about a TTL.
  const expiry = minutes ? `${minutes} minutes` : 'a short while';
  const footerNote = minutes ? `This link expires in ${minutes} minutes.` : null;

  return (
    <EmailLayout
      preview={
        isFirstTime
          ? 'Choose the password you’ll sign in with.'
          : 'Choose a new password for the instance you own.'
      }
      footerNote={footerNote}
    >
      <Eyebrow>{isFirstTime ? 'Owner password' : 'Password reset'}</Eyebrow>

      {isFirstTime ? (
        <>
          <H1>
            Choose your <Accent>password</Accent>.
          </H1>
          <P>
            {`This FRÈ instance is yours, and the owner signs in with a password rather than an emailed link. You don’t have one yet — the link below is where you pick it, and it is good for ${expiry}.`}
          </P>
        </>
      ) : (
        <>
          <H1>
            Set a <Accent>new</Accent> password.
          </H1>
          <P>
            {`Someone asked to change the password on the FRÈ instance you own. If that was you, the link below is where you do it, and it is good for ${expiry}.`}
          </P>
        </>
      )}

      {/* Said plainly, in both variants: the link is a door to one screen, not a session.
          It is the actual security property of the flow, and it reads as reassurance. */}
      <P>
        {isFirstTime
          ? 'Opening it doesn’t sign you in on its own. It leads to a single screen, and the only thing you can do there is choose your password.'
          : 'Opening it doesn’t sign you in on its own. It leads to a single screen, and the only thing you can do there is choose a new password.'}
      </P>

      <CtaButton
        href={actionUrl}
        label={isFirstTime ? 'Choose your password' : 'Choose a new password'}
        width={250}
      />
      <FallbackLink href={actionUrl} />

      <Divider />

      <Inset>
        {isFirstTime ? (
          <Meta>
            Everyone else in the house carries on signing in by emailed link. The password is
            the owner’s alone, and you can change it whenever you like.
          </Meta>
        ) : (
          <Meta>
            If you didn’t ask for this, ignore this email. Nothing has changed yet, and your
            password stays exactly as it is.
          </Meta>
        )}
      </Inset>
    </EmailLayout>
  );
}

export const PreviewProps: PasswordResetEmailProps = {
  actionUrl: 'https://fre.example.com/auth/reset-password?token=preview-password-token',
  expiresInMinutes: 20,
  isFirstTime: false,
};

/** The react-email CLI reads this off the component, not the module export. */
PasswordResetEmail.PreviewProps = PreviewProps;

export default PasswordResetEmail;
