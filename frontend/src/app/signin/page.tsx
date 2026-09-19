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
import { rememberNextPath, safeNextPath } from '@/components/auth/helpers';

/** One quiet line, shown on both states, so the owner is never stuck waiting for a
 *  link that is never sent — without naming which address that is. */
function OwnerEntrance({ next }: { next: string | null }) {
  // Filtered here as well as on the destination, so an off-origin ?next= is never even
  // carried across the hop.
  const safe = safeNextPath(next);
  const href = safe ? `/signin/owner?next=${encodeURIComponent(safe)}` : '/signin/owner';
  return (
    <p>
      Instance owner?{' '}
      <Link href={href} className="text-gold-lite underline underline-offset-4 hover:text-gold">
        Sign in with a password
      </Link>
    </p>
  );
}

function SignInForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<MailOutcome | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address) {
      setError('Enter the email address your access was granted to.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      // Stashed before the request because the link is usually opened in a new tab
      // from a mail client, which /auth/verify then reads it back from.
      rememberNextPath(searchParams.get('next'));
      setOutcome(await authService.requestLink(address));
    } catch {
      setError('Could not reach the instance. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (outcome) {
    return (
      <AuthShell
        eyebrow="Link sent"
        title={<>On its <em>way</em>.</>}
        // The backend answers identically for a known, unknown, revoked and
        // rate-limited address, so this copy must not confirm the address exists. It
        // also must not promise a link to everyone: the owner's address now silently
        // gets nothing, so the second sentence points them at the password entrance
        // without saying which address is which.
        intro={<>If that address has access, a sign-in link is on its way. It is good for 20 minutes and can be used once. Members get a link by email — if you own this instance, sign in with your password instead.</>}
        footer={
          <>
            <OwnerEntrance next={searchParams.get('next')} />
            <button
              type="button"
              onClick={() => { setOutcome(null); setError(null); }}
              className="font-ui text-sm text-muted underline underline-offset-4 transition-colors hover:text-text focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]"
            >
              Use a different address
            </button>
          </>
        }
      >
        {outcome.action_url && (
          <ActionLinkNotice url={outcome.action_url} action="sign in" />
        )}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Welcome back"
      title={<>Your seat is <em>waiting</em>.</>}
      intro="Give us your email address and we will send you a link that signs you straight in — no password to remember."
      footer={
        <>
          <p>No access yet? Ask whoever runs this instance to invite you.</p>
          <OwnerEntrance next={searchParams.get('next')} />
        </>
      }
    >
      <AuthPanel>
        <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
          <Field label="Your email" htmlFor="signin-email">
            <Input
              id="signin-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
              disabled={submitting}
            />
          </Field>

          {error && <AuthNotice tone="danger">{error}</AuthNotice>}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            isLoading={submitting}
            disabled={!email.trim()}
          >
            Email me a sign-in link
          </Button>
        </form>
      </AuthPanel>
    </AuthShell>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <AuthShell eyebrow="Welcome back" title={<>Your seat is <em>waiting</em>.</>}>
          <AuthSpinner label="Preparing sign in" />
        </AuthShell>
      }
    >
      <SignInForm />
    </Suspense>
  );
}
