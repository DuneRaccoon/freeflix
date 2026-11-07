'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { authService } from '@/services/auth';
import { Button } from '@/components/ui/fre';
import AuthShell from '@/components/auth/AuthShell';
import AuthSpinner from '@/components/auth/AuthSpinner';
import AuthLinkButton from '@/components/auth/AuthLinkButton';
import { statusOf } from '@/components/auth/helpers';

type Phase = 'confirm' | 'working' | 'done' | 'expired' | 'error';

// A confirm button, not an auto-POST on load: a mail scanner that runs page scripts
// would otherwise silently remove the lock, and StrictMode would burn the token twice.
function ResetPasscodeRunner() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [phase, setPhase] = useState<Phase>(token ? 'confirm' : 'expired');

  const confirm = () => {
    if (!token) return;
    setPhase('working');
    authService.resetPasscode(token)
      .then(() => setPhase('done'))
      .catch((err) => setPhase(statusOf(err) === 410 ? 'expired' : 'error'));
  };

  if (phase === 'done') {
    return (
      <AuthShell eyebrow="Done" title={<>The lock is <em>off</em>.</>}>
        <div className="flex justify-center">
          <AuthLinkButton href="/">Open Freeflix</AuthLinkButton>
        </div>
      </AuthShell>
    );
  }

  if (phase === 'expired') {
    return (
      <AuthShell
        eyebrow="Link expired"
        title={<>That link is <em>spent</em>.</>}
        intro="Reset links work once and expire. Ask for a new one with “Forgot code?” on the profile’s keypad."
      />
    );
  }

  if (phase === 'error') {
    return (
      <AuthShell
        eyebrow="Something went wrong"
        title={<>We could not <em>finish</em> that.</>}
        intro="The instance did not answer. Try the link again."
      />
    );
  }

  return (
    <AuthShell
      eyebrow="Profile lock"
      title={<>Remove this profile’s <em>lock</em>.</>}
      intro="This removes the passcode from the profile the email was about. You can set a new one in Settings → Profile lock."
    >
      <div className="flex justify-center">
        <Button variant="primary" size="lg" isLoading={phase === 'working'} onClick={confirm}>
          Remove the lock
        </Button>
      </div>
    </AuthShell>
  );
}

export default function ResetPasscodePage() {
  return (
    <Suspense
      fallback={
        <AuthShell eyebrow="Profile lock" title={<>One <em>moment</em>.</>}>
          <AuthSpinner label="Loading" />
        </AuthShell>
      }
    >
      <ResetPasscodeRunner />
    </Suspense>
  );
}
