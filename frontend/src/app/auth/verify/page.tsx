'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { authService } from '@/services/auth';
import AuthShell from '@/components/auth/AuthShell';
import AuthSpinner from '@/components/auth/AuthSpinner';
import AuthLinkButton from '@/components/auth/AuthLinkButton';
import { statusOf, takeNextPath } from '@/components/auth/helpers';

type Phase = 'verifying' | 'expired' | 'error';

function VerifyRunner() {
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<Phase>('verifying');
  const started = useRef(false);

  useEffect(() => {
    // The token is single use and burned server-side, so StrictMode's double
    // invoke in dev would consume it on the first pass and 410 on the second.
    if (started.current) return;
    started.current = true;

    const token = searchParams.get('token');
    if (!token) { setPhase('expired'); return; }

    authService.verify(token)
      .then((result) => {
        const remembered = takeNextPath();
        // A freshly claimed instance always lands on the home screen — whatever the
        // operator was looking at before owning the box is no longer where they belong.
        const destination = result.claimed
          ? (result.redirect || '/')
          : (remembered ?? result.redirect ?? '/');
        // A HARD navigation, not router.replace(). SessionProvider lives in the root
        // layout and bootstraps exactly once per document load (its `booted` ref); a soft
        // navigation keeps that tree alive, so `account` would still hold the null this
        // page loaded with and AuthenticatedLayout would bounce the freshly signed-in user
        // straight back to /signin. signOut() does the same thing for the same reason.
        window.location.replace(destination);
      })
      .catch((err) => {
        setPhase(statusOf(err) === 410 ? 'expired' : 'error');
      });
  }, [searchParams]);

  if (phase === 'expired') {
    return (
      <AuthShell
        eyebrow="Link expired"
        title={<>That link is <em>spent</em>.</>}
        intro="Sign-in links last 20 minutes and work once. Ask for a fresh one and it will be in your inbox in a moment."
        footer={<p>Links are single use — an older email in the thread will not work either.</p>}
      >
        <div className="flex justify-center">
          <AuthLinkButton href="/signin">Send a new link</AuthLinkButton>
        </div>
      </AuthShell>
    );
  }

  if (phase === 'error') {
    return (
      <AuthShell
        eyebrow="Something went wrong"
        title={<>We could not <em>finish</em> that.</>}
        intro="The instance did not answer. Try the link again, or request a new one."
      >
        <div className="flex justify-center">
          <AuthLinkButton href="/signin">Back to sign in</AuthLinkButton>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell eyebrow="Signing you in" title={<>One <em>moment</em>.</>}>
      <AuthSpinner label="Signing you in" />
    </AuthShell>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <AuthShell eyebrow="Signing you in" title={<>One <em>moment</em>.</>}>
          <AuthSpinner label="Signing you in" />
        </AuthShell>
      }
    >
      <VerifyRunner />
    </Suspense>
  );
}
