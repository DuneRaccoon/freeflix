'use client';

import React, { useEffect, useRef, useState } from 'react';
import { authService, type MailOutcome } from '@/services/auth';
import { Button, Field, Input } from '@/components/ui/fre';
import AuthShell from '@/components/auth/AuthShell';
import AuthPanel from '@/components/auth/AuthPanel';
import AuthNotice from '@/components/auth/AuthNotice';
import ActionLinkNotice from '@/components/auth/ActionLinkNotice';
import AuthLinkButton from '@/components/auth/AuthLinkButton';
import AuthSpinner from '@/components/auth/AuthSpinner';
import { statusOf } from '@/components/auth/helpers';

type Phase = 'checking' | 'form' | 'sent' | 'claimed';

// Only reached when /auth/capabilities cannot be read: the form still needs a number to
// refuse an obviously short password against. The backend remains the authority — if this
// guess is lower than the real floor, its 422 detail is what the viewer is shown.
const FALLBACK_PASSWORD_MIN_LENGTH = 10;

// Mirrors the backend's upper bound, which exists because PBKDF2 cost scales with input
// length and this endpoint is unauthenticated.
const PASSWORD_MAX_LENGTH = 128;

/** The `detail` string FastAPI attaches to an HTTPException, when the rejection has one. */
function detailOf(err: unknown): string | null {
  const detail = (err as { response?: { data?: { detail?: unknown } } } | null | undefined)
    ?.response?.data?.detail;
  return typeof detail === 'string' && detail.trim() ? detail : null;
}

export default function ClaimPage() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [claimCode, setClaimCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [minLength, setMinLength] = useState(FALLBACK_PASSWORD_MIN_LENGTH);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<MailOutcome | null>(null);
  const checked = useRef(false);

  // An instance can only be claimed once, so say so up front rather than
  // letting someone fill the form and collect a 409.
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    let cancelled = false;
    authService.instanceStatus()
      .then((status) => { if (!cancelled) setPhase(status.claimed ? 'claimed' : 'form'); })
      .catch(() => { if (!cancelled) setPhase('form'); });
    // The password floor is published by the backend so the rule lives in one place. It is
    // fetched beside the status rather than awaited before rendering: a failure here must
    // not keep an operator out of the only screen that can claim the instance.
    authService.capabilities()
      .then((caps) => {
        if (!cancelled && caps.password_min_length > 0) setMinLength(caps.password_min_length);
      })
      .catch(() => { /* keep the fallback floor — the server still rejects a weak password */ });
    return () => { cancelled = true; };
  }, []);

  // Both halves typed and identical. Guarding the button on this (rather than only on
  // submit) is why the mismatch never costs a round trip.
  const passwordsMatch = password.length > 0 && password === confirm;
  const mismatch = confirm.length > 0 && password !== confirm;
  const ready = Boolean(claimCode.trim() && email.trim() && passwordsMatch);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = claimCode.trim().toUpperCase().replace(/\s+/g, '');
    const address = email.trim();
    if (!code || !address) {
      setError('Enter the claim code and the email address you want to own this instance.');
      return;
    }
    // The three rules worth checking twice, to spare a round trip. They mirror the
    // backend's; anything else it objects to arrives as a 422 and is shown verbatim.
    if (password.length < minLength) {
      setError(`Use at least ${minLength} characters for your password.`);
      return;
    }
    if (password !== confirm) {
      setError('Those passwords do not match.');
      return;
    }
    if (password.toLowerCase() === address.toLowerCase()) {
      setError('Choose a password that is not your email address.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await authService.claim(code, address, password);
      setOutcome(result);
      setPhase('sent');
    } catch (err) {
      const status = statusOf(err);
      if (status === 409) setPhase('claimed');
      else if (status === 429) setError('Too many attempts. Wait a few minutes and try again.');
      else if (status === 422) {
        // The password and address rules are the backend's, so quote it rather than
        // paraphrase a rule this page may not know about.
        setError(detailOf(err) ?? 'That email address or password was rejected.');
      } else if (status === 400 || status === 403 || status === 404) {
        setError('That claim code was not recognised. Check the banner in the backend logs — the code changes on every restart.');
      } else {
        setError('Could not reach the instance. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (phase === 'checking') {
    return (
      <AuthShell eyebrow="First run" title={<>Claim your <em>instance</em>.</>}>
        <AuthSpinner label="Checking this instance" />
      </AuthShell>
    );
  }

  if (phase === 'claimed') {
    return (
      <AuthShell
        eyebrow="Already claimed"
        title={<>This instance has an <em>owner</em>.</>}
        intro="Ownership is set once and cannot be claimed again. Sign in with an address that has access."
        footer={<p>If that is not you, ask the owner to invite you.</p>}
      >
        <div className="flex justify-center">
          <AuthLinkButton href="/signin">Go to sign in</AuthLinkButton>
        </div>
      </AuthShell>
    );
  }

  if (phase === 'sent') {
    return (
      <AuthShell
        eyebrow="One more step"
        title={<>Check your <em>inbox</em>.</>}
        // Someone who has just chosen a password and is then sent to their inbox will
        // assume the password step failed unless this says otherwise.
        intro={<>We sent a confirmation link to <span className="text-text">{email.trim()}</span>. Open it to finish claiming this instance and become its owner. Your password is saved but does not work until that link is opened.</>}
        footer={
          <button
            type="button"
            onClick={() => { setPhase('form'); setOutcome(null); }}
            className="font-ui text-sm text-muted underline underline-offset-4 transition-colors hover:text-text focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]"
          >
            Wrong address? Start again
          </button>
        }
      >
        {outcome?.action_url && (
          <ActionLinkNotice url={outcome.action_url} action="finish claiming this instance" />
        )}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="First run"
      title={<>Claim your <em>instance</em>.</>}
      intro="Nobody owns this instance yet. Enter the code it printed at startup, the email address you want to own it, and the password you will sign in with."
      footer={<p>Already claimed this instance? <a href="/signin" className="text-gold-lite underline underline-offset-4 hover:text-gold">Sign in</a></p>}
    >
      <AuthPanel>
        <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
          <AuthNotice>
            <span className="text-text">Where the code comes from.</span> The backend prints it in a boxed
            banner every time it starts and writes it to <code className="rounded bg-ink/60 px-1 py-0.5 font-mono text-[12px] text-gold-lite">claim_code.txt</code> in
            its logs volume. Run <code className="rounded bg-ink/60 px-1 py-0.5 font-mono text-[12px] text-gold-lite">make logs s=backend</code> to
            read it. A new code is generated on every restart until the instance is claimed, so a lost code
            just needs a restart.
          </AuthNotice>

          <Field label="Claim code" htmlFor="claim-code">
            <Input
              id="claim-code"
              value={claimCode}
              onChange={(e) => setClaimCode(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX-XXXX"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={20}
              disabled={submitting}
              className="font-mono tracking-[0.2em]"
            />
          </Field>

          <Field label="Your email" htmlFor="claim-email" hint="This becomes the owner account for this instance.">
            <Input
              id="claim-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              disabled={submitting}
            />
          </Field>

          <Field
            label="Choose a password"
            htmlFor="claim-password"
            // The only password in the product, so the asymmetry has to be said out loud.
            hint={`The owner signs in with a password; everyone you invite signs in with an emailed link instead. At least ${minLength} characters.`}
          >
            <Input
              id="claim-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              maxLength={PASSWORD_MAX_LENGTH}
              disabled={submitting}
            />
          </Field>

          <Field
            label="Confirm password"
            htmlFor="claim-password-confirm"
            error={mismatch ? 'Does not match the password above.' : undefined}
          >
            <Input
              id="claim-password-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              maxLength={PASSWORD_MAX_LENGTH}
              disabled={submitting}
            />
          </Field>

          {error && <AuthNotice tone="danger">{error}</AuthNotice>}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            isLoading={submitting}
            disabled={!ready}
          >
            Claim this instance
          </Button>
        </form>
      </AuthPanel>
    </AuthShell>
  );
}
