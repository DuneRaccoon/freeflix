'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { devicesService } from '@/services/devices';
import { Button, Field, Input } from '@/components/ui/fre';
import AuthShell from '@/components/auth/AuthShell';
import AuthPanel from '@/components/auth/AuthPanel';
import AuthNotice from '@/components/auth/AuthNotice';
import AuthSpinner from '@/components/auth/AuthSpinner';
import { statusOf } from '@/components/auth/helpers';

function LinkForm() {
  const searchParams = useSearchParams();
  // Passed to the server exactly as typed: it owns the alphabet and accepts the
  // hyphenated and lower-case forms, so normalising here would only drift from it.
  const [code, setCode] = useState(searchParams.get('code') ?? '');
  const [deviceName, setDeviceName] = useState('Television');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairedAs, setPairedAs] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !code.trim()) return;

    const name = deviceName.trim() || 'Television';
    setSubmitting(true);
    setError(null);
    try {
      await devicesService.approve(code, name);
      setPairedAs(name);
    } catch (err) {
      const status = statusOf(err);
      // 404 is deliberately vague: it covers a wrong code and an expired one alike.
      // 429 is the per-account wrong-code budget, and the person can act on it.
      setError(
        status === 404
          ? 'That code is not valid or has expired.'
          : status === 429
            ? 'Too many attempts. Wait a few minutes.'
            : 'Could not approve the device. Please try again.',
      );
      setSubmitting(false);
    }
  };

  if (pairedAs) {
    return (
      <AuthShell
        eyebrow="Approved"
        title={<>{pairedAs} <em>paired</em>.</>}
        intro="The screen will sign in on its own in a moment. You can close this page."
      />
    );
  }

  const shown = code.trim();

  return (
    <AuthShell
      eyebrow="Link a device"
      title={<>Approve this <em>television</em>.</>}
      intro="Only approve a code you can see on the screen in front of you. If you were sent it by someone else, do not."
    >
      <AuthPanel>
        <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
          {/* The code as large text, not only inside the input: a value in a form field
              reads as something to submit, a value displayed big reads as something to
              check against the television. That comparison is the defence against being
              talked into approving a stranger's device. */}
          {shown && (
            <div className="flex flex-col items-center gap-2 py-2 text-center">
              <span className="font-ui text-xs uppercase tracking-widest text-muted">
                The television should show
              </span>
              <p className="font-display text-4xl uppercase tracking-[0.2em] text-gold-lite sm:text-5xl">
                {shown}
              </p>
            </div>
          )}

          <Field label="Code" htmlFor="link-code">
            <Input
              id="link-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="XXXX-XXXX"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={submitting}
            />
          </Field>

          <Field label="Name this device" htmlFor="link-device-name">
            <Input
              id="link-device-name"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              autoComplete="off"
              maxLength={60}
              disabled={submitting}
            />
          </Field>

          {error && <AuthNotice tone="danger">{error}</AuthNotice>}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            isLoading={submitting}
            disabled={!shown}
          >
            Approve
          </Button>
        </form>
      </AuthPanel>
    </AuthShell>
  );
}

export default function LinkPage() {
  return (
    <Suspense
      fallback={
        <AuthShell eyebrow="Link a device" title={<>Approve this <em>television</em>.</>}>
          <AuthSpinner label="Preparing" />
        </AuthShell>
      }
    >
      <LinkForm />
    </Suspense>
  );
}
