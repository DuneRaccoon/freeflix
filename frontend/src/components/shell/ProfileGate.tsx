'use client';
import React, { useState } from 'react';
import { useUser } from '@/context/UserContext';
import { useSession } from '@/context/SessionContext';
import { usersService, type User } from '@/services/users';
import { Wordmark } from '@/components/ui/Wordmark';
import CinematicAtmosphere from '@/components/fx/CinematicAtmosphere';
import PasscodePrompt from './PasscodePrompt';
import Avatar from '@/components/users/Avatar';
import AvatarPicker from '@/components/users/AvatarPicker';
import { getInitials } from '@/lib/avatars/resolve';
import { cn } from '@/lib/cn';
import { LockClosedIcon } from '@heroicons/react/24/solid';
import { Modal, Field, Input, Button } from '@/components/ui/fre';

const ProfileGate: React.FC = () => {
  const { users, selectUser, loadUsers, lockedProfileId } = useUser();
  const { account } = useSession();
  const accountRole = account?.role ?? null;
  // The gate mounts only after boot finishes (or after a mid-session relock), so an
  // initialiser is enough to open the numpad for the profile that was found locked.
  const [prompt, setPrompt] = useState<{ id: string } | null>(() => (lockedProfileId ? { id: lockedProfileId } : null));
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAvatar, setNewAvatar] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);

  const closeCreate = () => {
    if (submitting) return;
    setCreating(false);
    setNewName('');
    setNewAvatar(null);
    setCreateError(null);
  };

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const display = newName.trim();
    if (!display) { setCreateError('Please enter a name.'); return; }
    setSubmitting(true);
    setCreateError(null);
    try {
      // The username is minted server-side; a client-side slug could collide on the
      // instance-global UNIQUE constraint.
      const user = await usersService.createUser({ display_name: display, avatar: newAvatar ?? undefined });
      await loadUsers();
      const result = await selectUser(user.id);
      // On success, selectUser sets currentUser → AuthenticatedLayout swaps away from this gate.
      if (result !== 'ok') {
        // The modal is about to close, and createError renders only inside it — so
        // that message would never be seen. Route it to entryError's role="alert"
        // slot outside the modal instead, and reset the create form's state by
        // hand (NOT via closeCreate, which also clears createError and would
        // preserve the silence).
        setEntryError('Profile created, but it could not be opened — pick it from the list.');
        setSubmitting(false);
        setCreating(false);
        setNewName('');
        setNewAvatar(null);
        setCreateError(null);
      }
    } catch {
      setCreateError('Could not create the profile. Please try again.');
      setSubmitting(false);
    }
  };

  // Every pick of a locked profile asks for its code. A codeless select is sent only for
  // a profile the list shows as open: on a locked one the server counts it as a wrong code.
  const enter = async (u: User) => {
    setEntryError(null);
    if (u.settings?.require_passcode) { setPrompt({ id: u.id }); return; }
    const result = await selectUser(u.id);
    if (result === 'locked') {
      // The list was stale: the lock was set elsewhere after it loaded. The refresh
      // corrects the badge and the code length.
      setPrompt({ id: u.id });
      void loadUsers();
    }
    // Without this the gate is the only thing on screen and a failed click looks like
    // a dead button.
    else if (result === 'error' || result === 'throttled') setEntryError('Could not open that profile. Please try again.');
  };

  const closePrompt = () => {
    setPrompt(null);
    // The code may have been removed elsewhere while the prompt was up (a member's
    // emailed link opened on a phone); without a fresh list the next pick reopens the
    // numpad for a lock that no longer exists.
    void loadUsers();
  };

  const afterReset = async (id: string) => {
    setPrompt(null);
    await loadUsers();
    // selectUser directly, not enter(): enter would read the stale require_passcode
    // and reopen the prompt.
    const result = await selectUser(id);
    if (result !== 'ok') setEntryError('Could not open that profile. Please try again.');
  };

  // A stored id for a deleted profile matches no row, and then there is no prompt.
  const promptUser = prompt ? users.find(u => u.id === prompt.id) : undefined;
  const promptLength = promptUser?.settings?.passcode_len || 4;

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-12 bg-ink px-6 py-16 text-text">
      <CinematicAtmosphere />
      <div className="relative z-[2] flex flex-col items-center gap-8">
        <Wordmark className="text-3xl" />
        <h1 className="text-center font-display text-[clamp(2.5rem,7vw,5rem)] leading-[0.98] tracking-tight">
          Who&rsquo;s <em className="italic text-gold-lite">watching?</em>
        </h1>

        <div className="flex flex-wrap items-start justify-center gap-8">
          {users.map(u => {
            const locked = !!u.settings?.require_passcode;
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => { void enter(u); }}
                className="group flex flex-col items-center gap-3 focus:outline-none"
              >
                {/* aria-hidden: the visible name label below already supplies this button's
                    accessible name — Avatar's own <img alt> would otherwise double it. */}
                <span className="relative" aria-hidden="true">
                  <Avatar
                    value={u.avatar}
                    name={u.display_name}
                    size="xl"
                    shape="squircle"
                    className={cn(
                      'h-[clamp(110px,13vw,150px)] w-[clamp(110px,13vw,150px)] text-3xl transition-transform duration-300',
                      'group-hover:-translate-y-2 group-hover:border-gold group-focus-visible:border-gold',
                      'group-focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
                    )}
                  />
                  {locked && (
                    <span aria-hidden="true" className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full border border-gold/55 bg-ink/70 text-gold"><LockClosedIcon className="h-4 w-4" /></span>
                  )}
                </span>
                <span className="font-ui text-sm tracking-wide text-muted transition-colors group-hover:text-text">{u.display_name}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="group flex flex-col items-center gap-3 focus:outline-none"
            aria-label="Add profile"
          >
            <span className="grid h-[clamp(110px,13vw,150px)] w-[clamp(110px,13vw,150px)] place-items-center rounded-[22px] border border-dashed border-hairline text-4xl text-muted transition-colors duration-300 group-hover:border-gold group-hover:text-gold group-focus-visible:border-gold group-focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]">
              <span aria-hidden="true">+</span>
            </span>
            <span className="font-ui text-sm tracking-wide text-muted transition-colors group-hover:text-text">Add Profile</span>
          </button>
        </div>

        {entryError && <p role="alert" className="font-ui text-sm text-danger">{entryError}</p>}
      </div>

      <Modal open={creating} onClose={closeCreate} label="Add a profile">
        <form onSubmit={submitCreate} className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <h2 className="font-display text-2xl leading-tight text-text">Add a profile</h2>
            <p className="font-ui text-sm text-muted">Create a new viewing profile.</p>
          </div>
          <Field label="Profile name" htmlFor="new-profile-name" error={createError ?? undefined}>
            <Input
              id="new-profile-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Ben"
              maxLength={40}
              disabled={submitting}
            />
          </Field>
          <AvatarPicker
            value={newAvatar}
            onChange={setNewAvatar}
            initials={getInitials(newName)}
            disabled={submitting}
            name="new-profile-avatar"
          />
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={closeCreate} disabled={submitting}>Cancel</Button>
            <Button type="submit" variant="primary" isLoading={submitting} disabled={!newName.trim()}>Create profile</Button>
          </div>
        </form>
      </Modal>

      {promptUser && (
        <PasscodePrompt
          // A length that changes after a list refresh remounts the numpad.
          key={`${promptUser.id}:${promptLength}`}
          open
          profileId={promptUser.id}
          profileName={promptUser.display_name}
          length={promptLength}
          accountRole={accountRole}
          onClose={closePrompt}
          onReset={() => { void afterReset(promptUser.id); }}
          onSubmit={async (code) => {
            const result = await selectUser(promptUser.id, code);
            if (result === 'ok') { setPrompt(null); return true; }
            // A throttled attempt is not a wrong code — saying so would convince
            // someone they had forgotten their own passcode.
            return result === 'throttled'
              ? 'Too many attempts. Try again in a few minutes.'
              : false;
          }}
        />
      )}
    </div>
  );
};

export default ProfileGate;
