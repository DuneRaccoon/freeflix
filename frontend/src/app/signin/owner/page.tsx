'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { authService, type MailOutcome } from '@/services/auth';
import { Button, Field, Input } from '@/components/ui/fre';
import AuthShell from '@/components/auth/AuthShell';
import AuthPanel from '@/components/auth/AuthPanel';
import AuthNotice from '@/components/auth/AuthNotice';
import ActionLinkNotice from '@/components/auth/ActionLinkNotice';
import AuthSpinner from '@/components/auth/AuthSpinner';
import { rememberNextPath, safeNextPath, statusOf } from '@/components/auth/helpers';

// The backend's single refusal, reproduced verbatim. It covers an unknown address, a
// member's address, an owner with no password set, the wrong password AND a throttled
// attempt — the server deliberately answers 401 for all five, so the screen must not
// add a sixth, more specific message that would say which address is worth attacking.
const BAD_CREDENTIALS = 'Email or password is incorrect.';

const QUIET_LINK =
  'font-ui text-sm text-muted underline underline-offset-4 transition-colors hover:text-text ' +
  'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]';

function OwnerSignInForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<MailOutcome | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const address = email.trim();
    if (!address || !password) {
      setError(BAD_CREDENTIALS);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await authService.passwordSignIn(address, password);
      // No mail hop on this path — the cookie is already set — so ?next= is honoured
      // straight from the URL rather than stashed the way /signin has to.
      const destination = safeNextPath(searchParams.get('next')) ?? result.redirect ?? '/';
      // A HARD navigation, not router.replace(). SessionProvider lives in the root layout
      // and bootstraps once per DOCUMENT load, so a soft navigation would leave `account`
      // null and AuthenticatedLayout would bounce the freshly signed-in owner straight
      // back to /signin. Same reason as /auth/verify.
      window.location.replace(destination);
    } catch (err) {
      const status = statusOf(err);
      // 429 reads as 401 too: the backend folds its rate-limit refusal into the same
      // answer, and a distinguishable message here would undo that on the client.
      setError(status === 401 || status === 429
        ? BAD_CREDENTIALS
        : 'Could not reach the instance. Please try again.');
      setSubmitting(false);
    }
  };

  const requestReset = async () => {
    if (resetting) return;

    const address = email.trim();
    if (!address) {
      setError('Enter your email address first, then ask for a link.');
      return;
    }

    setResetting(true);
    setError(null);
    try {
      // Stashed before the request: the link is opened from a mail client, usually in a
      // fresh tab, and /auth/reset-password reads the destination back from there.
      rememberNextPath(searchParams.get('next'));
      setOutcome(await authService.requestPasswordReset(address));
    } catch {
      setError('Could not reach the instance. Please try again.');
    } finally {
      setResetting(false);
    }
  };

  if (outcome) {
    return (
      <AuthShell
        eyebrow="Link sent"
        title={<>On its <em>way</em>.</>}
        // Constant copy, as on /signin: the backend answers identically whether that
        // address owns the instance, belongs to a member, or exists at all.
        intro={<>If that address owns this instance, a link to set a new password is on its way. It is good for 20 minutes and can be used once.</>}
        footer={
          <>
            <p>The link on its own will not sign you in — it opens a page where you choose the new password.</p>
            <button
              type="button"
              onClick={() => { setOutcome(null); setError(null); setPassword(''); }}
              className={QUIET_LINK}
            >
              Back to sign in
            </button>
          </>
        }
      >
        {outcome.action_url && (
          <ActionLinkNotice url={outcome.action_url} action="set a new password" />
        )}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Instance owner"
      title={<>Sign in with your <em>password</em>.</>}
      intro="Whoever owns this instance signs in with a password rather than an emailed link."
      footer={
        <p>
          Not the owner?{' '}
          <Link href="/signin" className="text-gold-lite underline underline-offset-4 hover:text-gold">
            Get a sign-in link
          </Link>
        </p>
      }
    >
      <AuthPanel>
        <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
          <Field label="Your email" htmlFor="owner-email">
            <Input
              id="owner-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
              disabled={submitting}
            />
          </Field>

          <Field label="Password" htmlFor="owner-password">
            <Input
              id="owner-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={submitting}
            />
          </Field>

          {error && <AuthNotice tone="danger">{error}</AuthNotice>}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            isLoading={submitting}
            disabled={!email.trim() || !password}
          >
            Sign in
          </Button>

          <div className="flex justify-center">
            {/* One entrance for both cases: an owner who has forgotten their password and
                one who has never had it — after an ownership transfer, or on an instance
                claimed before passwords existed. The backend treats them identically. */}
            <button type="button" onClick={requestReset} disabled={resetting} className={QUIET_LINK}>
              {resetting ? 'Sending a link…' : 'Forgot it, or never set one?'}
            </button>
          </div>
        </form>
      </AuthPanel>
    </AuthShell>
  );
}

export default function OwnerSignInPage() {
  return (
    <Suspense
      fallback={
        <AuthShell eyebrow="Instance owner" title={<>Sign in with your <em>password</em>.</>}>
          <AuthSpinner label="Preparing sign in" />
        </AuthShell>
      }
    >
      <OwnerSignInForm />
    </Suspense>
  );
}
