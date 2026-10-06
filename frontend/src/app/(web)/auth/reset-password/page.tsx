'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { authService } from '@/services/auth';
import { Button, Field, Input } from '@/components/ui/fre';
import AuthShell from '@/components/auth/AuthShell';
import AuthPanel from '@/components/auth/AuthPanel';
import AuthNotice from '@/components/auth/AuthNotice';
import AuthLinkButton from '@/components/auth/AuthLinkButton';
import AuthSpinner from '@/components/auth/AuthSpinner';
import { statusOf, takeNextPath } from '@/components/auth/helpers';

type Phase = 'form' | 'expired';

/** The backend's own wording for a rejected password, when it sent one. */
function detailOf(err: unknown): string | null {
  const detail = (err as { response?: { data?: { detail?: unknown } } } | null | undefined)
    ?.response?.data?.detail;
  return typeof detail === 'string' && detail ? detail : null;
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  // No token means the link was mangled in transit — indistinguishable, from here, from
  // one that has expired, and the remedy is the same.
  const [phase, setPhase] = useState<Phase>(token ? 'form' : 'expired');
  const [minLength, setMinLength] = useState<number | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // A rejected password still burns the token, so the form is dead after a 422.
  const [spent, setSpent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The rule is published, not duplicated: reading it means this screen can never
    // refuse a password the server would take, or accept one it would not.
    authService.capabilities()
      .then((caps) => { if (!cancelled) setMinLength(caps.password_min_length); })
      .catch(() => {
        // Unreachable or unversioned backend. The server enforces the rule either way,
        // so the only cost is that a too-short password is caught a round trip later.
      });
    return () => { cancelled = true; };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Guards a double submit: the token is single use, so a second POST from a
    // double-clicked button would 410 a reset that has already succeeded.
    if (submitting || spent || !token) return;

    if (minLength !== null && password.length < minLength) {
      setError(`Use at least ${minLength} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Those two passwords do not match.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await authService.resetPassword(token, password);
      const remembered = takeNextPath();
      // A HARD navigation, not router.replace(). That response set the session cookie,
      // but SessionProvider bootstrapped (signed out) when this page loaded and only
      // re-reads the cookie on a fresh DOCUMENT load — a soft navigation would bounce
      // the owner back to /signin with their reset link already burned.
      window.location.replace(remembered ?? result.redirect ?? '/');
    } catch (err) {
      const status = statusOf(err);
      if (status === 410) {
        setPhase('expired');
      } else if (status === 422) {
        // Verbatim: the server's message already explains that a new link is needed,
        // because the token was consumed before the password was judged.
        setError(detailOf(err) ?? 'That password was not accepted. Request a new link and try again.');
        setSpent(true);
      } else {
        setError('Could not reach the instance. Please try again.');
      }
      setSubmitting(false);
    }
  };

  if (phase === 'expired') {
    return (
      <AuthShell
        eyebrow="Link expired"
        title={<>That link is <em>spent</em>.</>}
        intro="This link has expired or was already used. Set-a-password links last 20 minutes and work once."
        footer={<p>Links are single use — an older email in the thread will not work either.</p>}
      >
        <div className="flex justify-center">
          <AuthLinkButton href="/signin/owner">Request a new link</AuthLinkButton>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Instance owner"
      title={<>Choose a new <em>password</em>.</>}
      intro="This link works only together with the password you set here, which is why it cannot sign anyone in on its own."
      footer={<p>Setting a password signs you in and ends every other session on this instance.</p>}
    >
      <AuthPanel>
        <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
          <Field
            label="New password"
            htmlFor="reset-password"
            hint={minLength !== null ? `At least ${minLength} characters.` : undefined}
          >
            <Input
              id="reset-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              autoFocus
              disabled={submitting || spent}
            />
          </Field>

          <Field label="Confirm new password" htmlFor="reset-confirm">
            <Input
              id="reset-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              disabled={submitting || spent}
            />
          </Field>

          {error && <AuthNotice tone="danger">{error}</AuthNotice>}

          {spent ? (
            <div className="flex justify-center">
              <AuthLinkButton href="/signin/owner">Request a new link</AuthLinkButton>
            </div>
          ) : (
            <Button
              type="submit"
              variant="primary"
              size="lg"
              isLoading={submitting}
              disabled={!password || !confirm}
            >
              Set password and sign in
            </Button>
          )}
        </form>
      </AuthPanel>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <AuthShell eyebrow="Instance owner" title={<>Choose a new <em>password</em>.</>}>
          <AuthSpinner label="Preparing your reset link" />
        </AuthShell>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
