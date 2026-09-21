'use client';
import React, { useState } from 'react';
import { useUser } from '@/context/UserContext';
import { usersService } from '@/services/users';
import { Wordmark } from '@/components/ui/Wordmark';
import CinematicAtmosphere from '@/components/fx/CinematicAtmosphere';
import PasscodePrompt from './PasscodePrompt';
import Avatar from '@/components/users/Avatar';
import { cn } from '@/lib/cn';
import { LockClosedIcon } from '@heroicons/react/24/solid';
import { Modal, Field, Input, Button } from '@/components/ui/fre';

const ProfileGate: React.FC = () => {
  const { users, selectUser, loadUsers } = useUser();
  const [prompt, setPrompt] = useState<{ id: string; name: string; length: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);

  const closeCreate = () => {
    if (submitting) return;
    setCreating(false);
    setNewName('');
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
      const user = await usersService.createUser({ display_name: display });
      await loadUsers();
      const result = await selectUser(user.id);
      // On success, selectUser sets currentUser → AuthenticatedLayout swaps away from this gate.
      if (result !== 'ok') {
        setCreateError('Profile created, but it could not be opened — pick it from the list.');
        setSubmitting(false);
        setCreating(false);
      }
    } catch {
      setCreateError('Could not create the profile. Please try again.');
      setSubmitting(false);
    }
  };

  // The server decides whether a profile is locked; `require_passcode` only drives the badge.
  const enter = async (id: string, name: string, length: number) => {
    setEntryError(null);
    const result = await selectUser(id);
    if (result === 'locked') setPrompt({ id, name, length });
    // Without this the gate is the only thing on screen and a failed click looks like
    // a dead button.
    else if (result === 'error') setEntryError('Could not open that profile. Please try again.');
  };

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
                onClick={() => { void enter(u.id, u.display_name, u.settings?.passcode_len ?? 4); }}
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
            <p className="font-ui text-sm text-muted">Create a new viewing profile. You can choose an avatar later in Settings.</p>
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
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={closeCreate} disabled={submitting}>Cancel</Button>
            <Button type="submit" variant="primary" isLoading={submitting} disabled={!newName.trim()}>Create profile</Button>
          </div>
        </form>
      </Modal>

      {prompt && (
        <PasscodePrompt
          open
          profileName={prompt.name}
          length={prompt.length}
          onClose={() => setPrompt(null)}
          onSubmit={async (code) => {
            const result = await selectUser(prompt.id, code);
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
