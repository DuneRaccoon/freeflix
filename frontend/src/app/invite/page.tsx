'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { authService, type InvitePreview } from '@/services/auth';
import { Button, Field, Input } from '@/components/ui/fre';
import AuthShell from '@/components/auth/AuthShell';
import AuthPanel from '@/components/auth/AuthPanel';
import AuthNotice from '@/components/auth/AuthNotice';
import AuthSpinner from '@/components/auth/AuthSpinner';
import AuthLinkButton from '@/components/auth/AuthLinkButton';
import AvatarPicker from '@/components/auth/AvatarPicker';
import { statusOf } from '@/components/auth/helpers';
import { getInitials } from '@/utils/avatarHelper';
import { parseUtc } from '@/lib/parseUtc';

type Phase = 'loading' | 'ready' | 'expired' | 'error';

function expiryLabel(raw: string | null): string | null {
  const when = parseUtc(raw);
  if (!when) return null;
  return when.toLocaleString(undefined, {
    weekday: 'long', hour: 'numeric', minute: '2-digit',
  });
}

function InviteFlow() {
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<Phase>('loading');
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = searchParams.get('token');
  const previewed = useRef(false);

  useEffect(() => {
    if (previewed.current) return;
    previewed.current = true;

    if (!token) { setPhase('expired'); return; }

    let cancelled = false;
    authService.invitePreview(token)
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        setPhase('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setPhase(statusOf(err) === 410 ? 'expired' : 'error');
      });
    return () => { cancelled = true; };
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = displayName.trim();
    if (!token || !name) {
      setError('Enter the name you want on your profile.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await authService.inviteAccept(token, name, avatar ?? undefined);
      // A HARD navigation: the backend set the session cookie on that response, but
      // SessionProvider already bootstrapped (signed-out) when this page loaded and will
      // not re-read it across a soft navigation — the brand-new member would be bounced
      // to /signin with their invite already consumed.
      window.location.replace('/');
    } catch (err) {
      const status = statusOf(err);
      if (status === 410) setPhase('expired');
      else if (status === 422) setError('That name was not accepted. Try a different one.');
      else {
        setError('Could not set up your profile. Please try again.');
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
    }
  };

  if (phase === 'loading') {
    return (
      <AuthShell eyebrow="Invitation" title={<>You&rsquo;re <em>invited</em>.</>}>
        <AuthSpinner label="Checking your invitation" />
      </AuthShell>
    );
  }

  if (phase === 'expired') {
    return (
      <AuthShell
        eyebrow="Invitation expired"
        title={<>This invitation is no longer <em>open</em>.</>}
        intro="Invitations last 72 hours and can only be accepted once. This one has run out, been used, or been withdrawn."
        footer={<p>Ask the owner of this instance to send you a fresh invitation — it takes them one click.</p>}
      >
        <div className="flex justify-center">
          <AuthLinkButton href="/signin">Already set up? Sign in</AuthLinkButton>
        </div>
      </AuthShell>
    );
  }

  if (phase === 'error') {
    return (
      <AuthShell
        eyebrow="Something went wrong"
        title={<>We could not read that <em>invitation</em>.</>}
        intro="The instance did not answer. Open the link from your email again in a moment."
      >
        <div className="flex justify-center">
          <AuthLinkButton href="/signin">Go to sign in</AuthLinkButton>
        </div>
      </AuthShell>
    );
  }

  const expires = expiryLabel(preview?.expires_at ?? null);
  const house = preview?.instance_name ?? 'this instance';

  return (
    <AuthShell
      eyebrow="Invitation"
      title={<>You&rsquo;re <em>invited</em>.</>}
      intro={
        preview?.invited_by
          ? <><span className="text-text">{preview.invited_by}</span> invited <span className="text-text">{preview.email}</span> to {house}. Set up your profile and you&rsquo;re in.</>
          : <><span className="text-text">{preview?.email}</span> has been invited to {house}. Set up your profile and you&rsquo;re in.</>
      }
      footer={expires ? <p>This invitation is open until {expires}.</p> : undefined}
    >
      <AuthPanel>
        <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
          <Field
            label="Profile name"
            htmlFor="invite-display-name"
            hint="What everyone in the house sees on your profile. You can change it later."
          >
            <Input
              id="invite-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Ben"
              maxLength={40}
              autoComplete="nickname"
              autoFocus
              disabled={submitting}
            />
          </Field>

          <div className="flex flex-col gap-3">
            <p className="font-ui text-sm font-medium text-text/80">Avatar</p>
            <AvatarPicker
              value={avatar}
              onChange={setAvatar}
              initials={getInitials(displayName.trim())}
              disabled={submitting}
            />
          </div>

          {error && <AuthNotice tone="danger">{error}</AuthNotice>}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            isLoading={submitting}
            disabled={!displayName.trim()}
          >
            Join {house}
          </Button>
        </form>
      </AuthPanel>
    </AuthShell>
  );
}

export default function InvitePage() {
  return (
    <Suspense
      fallback={
        <AuthShell eyebrow="Invitation" title={<>You&rsquo;re <em>invited</em>.</>}>
          <AuthSpinner label="Checking your invitation" />
        </AuthShell>
      }
    >
      <InviteFlow />
    </Suspense>
  );
}
