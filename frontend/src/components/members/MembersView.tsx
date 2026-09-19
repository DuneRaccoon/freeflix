'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'react-hot-toast';
import { useSession } from '@/context/SessionContext';
import { instanceService, type Invite, type Member } from '@/services/instance';
import { Badge, Button, Field, Input, Select } from '@/components/ui/fre';
import { cn } from '@/lib/cn';
import ConfirmModal from './ConfirmModal';
import { parseUtc } from '@/lib/parseUtc';

// ---------------------------------------------------------------------------
// Card language, shared with SettingsView
// ---------------------------------------------------------------------------

const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => (
  <div className={cn('rounded-2xl border border-hairline bg-surface-2/60 p-6 space-y-5', className)}>
    {children}
  </div>
);

const SectionHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 className="font-display text-xs font-semibold uppercase tracking-widest text-muted mb-4">
    {children}
  </h2>
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const expiryLabel = (iso: string | null): string => {
  const date = parseUtc(iso);
  if (!date) return 'No expiry';
  return date.getTime() < Date.now()
    ? `Expired ${formatDistanceToNow(date, { addSuffix: true })}`
    : `Expires in ${formatDistanceToNow(date)}`;
};

const memberLabel = (member: Member): string =>
  member.account.display_name || member.account.email || 'Unnamed member';

const STATUS_TONE = {
  active: 'success',
  invited: 'gold',
  pending_email: 'default',
  revoked: 'danger',
} as const;

const STATUS_LABEL = {
  active: 'Active',
  invited: 'Invited',
  pending_email: 'Not invited yet',
  revoked: 'Revoked',
} as const;

const httpStatus = (err: unknown): number | undefined =>
  (err as { response?: { status?: number } } | undefined)?.response?.status;

// ---------------------------------------------------------------------------
// Confirmations
// ---------------------------------------------------------------------------

type Confirm =
  | { kind: 'revoke-invite'; invite: Invite }
  | { kind: 'revoke-member'; member: Member }
  | { kind: 'restore-member'; member: Member }
  | { kind: 'remove-member'; member: Member }
  | { kind: 'transfer'; member: Member };

interface ConfirmCopy {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  destructive: boolean;
}

const confirmCopy = (confirm: Confirm): ConfirmCopy => {
  switch (confirm.kind) {
    case 'revoke-invite':
      return {
        title: 'Revoke this invite?',
        body: (
          <>
            The link sent to <strong className="text-text">{confirm.invite.email}</strong> stops working
            immediately. Nothing else is deleted — you can send a fresh invite at any time.
          </>
        ),
        confirmLabel: 'Revoke invite',
        destructive: true,
      };
    case 'revoke-member':
      return {
        title: `Revoke access for ${memberLabel(confirm.member)}?`,
        body: (
          <>
            They are signed out immediately and cannot sign in again. Their{' '}
            {confirm.member.profile_count} profile{confirm.member.profile_count === 1 ? '' : 's'}, watch
            history and lists are <strong className="text-text">kept</strong>. This is reversible — you can
            restore their access from this page.
          </>
        ),
        confirmLabel: 'Revoke access',
        destructive: true,
      };
    case 'restore-member':
      return {
        title: `Restore access for ${memberLabel(confirm.member)}?`,
        body: <>They can sign in again with a fresh magic link. Their profiles and history are untouched.</>,
        confirmLabel: 'Restore access',
        destructive: false,
      };
    case 'remove-member':
      return {
        title: `Permanently remove ${memberLabel(confirm.member)}?`,
        body: (
          <>
            This permanently deletes their account, their{' '}
            {confirm.member.profile_count} profile{confirm.member.profile_count === 1 ? '' : 's'}
            {confirm.member.profile_names.length > 0 && (
              <> ({confirm.member.profile_names.join(', ')})</>
            )}
            , all of their watch history and all of their lists.{' '}
            <strong className="text-text">This cannot be undone.</strong> To keep their data, revoke access
            instead.
          </>
        ),
        confirmLabel: 'Remove permanently',
        destructive: true,
      };
    case 'transfer':
      return {
        title: `Make ${memberLabel(confirm.member)} the owner?`,
        body: (
          <>
            They take over this instance. You become a member and lose invites, member management and
            instance settings — only the new owner can transfer it back. Your profiles and history are kept.
          </>
        ),
        confirmLabel: 'Transfer ownership',
        destructive: true,
      };
  }
};

// ---------------------------------------------------------------------------
// Invite card
// ---------------------------------------------------------------------------

const InviteCard: React.FC<{
  members: Member[];
  onSent: (invite: Invite, actionUrl: string | null) => void;
}> = ({ members, onSent }) => {
  const [email, setEmail] = useState('');
  const [accountId, setAccountId] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Accounts the upgrade migration minted from pre-existing profiles: they own real
  // watch history, so attaching the invite to one is how that person keeps it.
  const unclaimed = useMemo(
    () => members.filter((m) => m.account.status === 'pending_email'),
    [members],
  );

  const options = useMemo(
    () => [
      { value: '', label: 'Start a new profile group' },
      ...unclaimed.map((m) => ({
        value: m.account.id,
        label: m.profile_names.length > 0
          ? `${memberLabel(m)} — ${m.profile_names.join(', ')}`
          : memberLabel(m),
      })),
    ],
    [unclaimed],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address) { setError('Enter an email address.'); return; }
    setError(null);
    setSending(true);
    try {
      const result = await instanceService.createInvite(address, accountId || undefined);
      onSent(result.invite, result.action_url ?? null);
      setEmail('');
      setAccountId('');
      if (result.delivered) toast.success(`Invite sent to ${address}`);
      else toast('Invite created — send the link below yourself.');
    } catch (err) {
      setError(
        httpStatus(err) === 409
          ? 'That address already belongs to someone on this instance.'
          : 'Could not create the invite. Please try again.',
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <SectionHeading>Invite someone</SectionHeading>
      <form onSubmit={submit} className="space-y-5">
        <Field label="Email address" htmlFor="invite-email" error={error ?? undefined}>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="them@example.com"
            disabled={sending}
          />
        </Field>

        {unclaimed.length > 0 && (
          <Field
            label="Attach to an existing profile group"
            hint="Picking a group lets them keep the profiles, watch history and lists that already exist on this instance. Leave it on “Start a new profile group” for someone new."
            htmlFor="invite-account"
          >
            <Select
              id="invite-account"
              options={options}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              disabled={sending}
            />
          </Field>
        )}

        <div className="flex justify-end">
          <Button type="submit" size="sm" isLoading={sending} disabled={!email.trim()}>
            Send invite
          </Button>
        </div>
      </form>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// MembersView
// ---------------------------------------------------------------------------

const MembersView: React.FC = () => {
  const { account, instance, isLoading: sessionLoading, refresh } = useSession();
  const isOwner = account?.role === 'owner';

  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  // Invite links whose email could not be delivered, keyed by invite id, so the owner
  // can still hand the link over by another route.
  const [fallbackLinks, setFallbackLinks] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await instanceService.members();
      setMembers(data.members);
      setInvites(data.invites);
    } catch {
      setError('Could not load members — check that the backend is running.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOwner) return;
    void load();
  }, [isOwner, load]);

  const runConfirmed = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      switch (confirm.kind) {
        case 'revoke-invite':
          await instanceService.revokeInvite(confirm.invite.id);
          toast.success('Invite revoked');
          break;
        case 'revoke-member':
          await instanceService.revokeMember(confirm.member.account.id);
          toast.success('Access revoked');
          break;
        case 'restore-member':
          await instanceService.restoreMember(confirm.member.account.id);
          toast.success('Access restored');
          break;
        case 'remove-member':
          await instanceService.removeMember(confirm.member.account.id);
          toast.success('Member removed');
          break;
        case 'transfer':
          await instanceService.transfer(confirm.member.account.id);
          toast.success('Ownership transferred');
          // This account is no longer the owner; re-read the session so the page re-gates.
          await refresh();
          break;
      }
      setConfirm(null);
      await load();
    } catch {
      toast.error('That action did not go through. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const resend = async (invite: Invite) => {
    try {
      const result = await instanceService.resendInvite(invite.id);
      setFallbackLinks((links) => {
        const next = { ...links };
        delete next[invite.id];
        if (!result.delivered && result.action_url) next[result.invite.id] = result.action_url;
        return next;
      });
      if (result.delivered) toast.success(`Invite resent to ${invite.email}`);
      else toast('Invite refreshed — send the link below yourself.');
      await load();
    } catch {
      toast.error('Could not resend that invite.');
    }
  };

  if (sessionLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-gold border-t-transparent" aria-label="Loading" />
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="mx-auto max-w-2xl px-4 pt-8 pb-16">
        <h1 className="font-display text-2xl font-semibold text-text">Members</h1>
        <p className="mt-3 font-ui text-sm text-muted">
          Not available. Only the owner of this instance can manage members and invites.
        </p>
      </div>
    );
  }

  const pendingInvites = invites.filter((i) => !i.accepted_at && !i.revoked_at);

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 pt-8 pb-16">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-semibold text-text">Members</h1>
        <p className="font-ui text-sm text-muted">
          Who can sign in to {instance?.instance_name || 'this instance'}, and what happens to their data.
        </p>
      </header>

      {error && <p role="alert" className="font-ui text-sm text-danger">{error}</p>}

      <InviteCard
        members={members}
        onSent={(invite, actionUrl) => {
          if (actionUrl) setFallbackLinks((links) => ({ ...links, [invite.id]: actionUrl }));
          void load();
        }}
      />

      <Card>
        <SectionHeading>Pending invites</SectionHeading>
        {loading && <p className="font-ui text-sm text-muted">Loading…</p>}
        {!loading && pendingInvites.length === 0 && (
          <p className="font-ui text-sm text-muted">No invites are waiting to be accepted.</p>
        )}
        <ul className="space-y-3">
          {pendingInvites.map((invite) => (
            <li key={invite.id} className="rounded-xl border border-hairline bg-surface/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-ui text-sm text-text">{invite.email}</p>
                  <p className="font-ui text-xs text-muted">{expiryLabel(invite.expires_at)}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="glass" size="sm" onClick={() => { void resend(invite); }}>Resend</Button>
                  <Button variant="danger" size="sm" onClick={() => setConfirm({ kind: 'revoke-invite', invite })}>
                    Revoke
                  </Button>
                </div>
              </div>
              {fallbackLinks[invite.id] && (
                <div className="mt-3 rounded-lg border border-hairline bg-surface-2 p-3">
                  <p className="font-ui text-xs text-muted">
                    The email could not be sent. Pass this link on yourself — it expires with the invite.
                  </p>
                  <code className="mt-1.5 block break-all font-ui text-xs text-gold-lite">
                    {fallbackLinks[invite.id]}
                  </code>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <SectionHeading>People</SectionHeading>
        {loading && <p className="font-ui text-sm text-muted">Loading…</p>}
        <ul className="space-y-3">
          {members.map((member) => {
            const { account: acct } = member;
            // The owner cannot revoke, remove or demote themselves — the instance would
            // be left with nobody who can manage it.
            const manageable = !member.is_you && acct.role !== 'owner';
            return (
              <li key={acct.id} className="rounded-xl border border-hairline bg-surface/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-ui text-sm text-text">{memberLabel(member)}</span>
                      {member.is_you && <Badge>You</Badge>}
                      <Badge tone={acct.role === 'owner' ? 'gold' : 'default'}>
                        {acct.role === 'owner' ? 'Owner' : 'Member'}
                      </Badge>
                      <Badge tone={STATUS_TONE[acct.status]}>{STATUS_LABEL[acct.status]}</Badge>
                    </div>
                    {acct.email && <p className="truncate font-ui text-xs text-muted">{acct.email}</p>}
                    <p className="font-ui text-xs text-muted">
                      {member.profile_count === 0
                        ? 'No profiles yet'
                        : `${member.profile_count} profile${member.profile_count === 1 ? '' : 's'}: ${member.profile_names.join(', ')}`}
                    </p>
                  </div>

                  {manageable && (
                    <div className="flex flex-wrap justify-end gap-2">
                      {acct.status === 'active' && (
                        <Button variant="glass" size="sm" onClick={() => setConfirm({ kind: 'transfer', member })}>
                          Make owner
                        </Button>
                      )}
                      {acct.status === 'revoked' ? (
                        <Button variant="glass" size="sm" onClick={() => setConfirm({ kind: 'restore-member', member })}>
                          Restore access
                        </Button>
                      ) : (
                        <Button variant="glass" size="sm" onClick={() => setConfirm({ kind: 'revoke-member', member })}>
                          Revoke access
                        </Button>
                      )}
                      <Button variant="danger" size="sm" onClick={() => setConfirm({ kind: 'remove-member', member })}>
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {confirm && (
        <ConfirmModal
          open
          busy={busy}
          onClose={() => { if (!busy) setConfirm(null); }}
          onConfirm={() => { void runConfirmed(); }}
          {...confirmCopy(confirm)}
        />
      )}
    </div>
  );
};

export default MembersView;
