'use client';
import React, { useEffect, useState } from 'react';
import { useUser } from '@/context/UserContext';
import { usersService } from '@/services/users';
import { Wordmark } from '@/components/ui/Wordmark';
import CinematicAtmosphere from '@/components/fx/CinematicAtmosphere';
import PasscodePrompt from './PasscodePrompt';
import { getInitials, handleAvatarError } from '@/utils/avatarHelper';
import { cn } from '@/lib/cn';
import { LockClosedIcon } from '@heroicons/react/24/solid';
import { Modal, Field, Input, Button } from '@/components/ui/fre';

interface Gate { required: boolean; code?: string; }

const ProfileGate: React.FC = () => {
  const { users, selectUser, loadUsers } = useUser();
  const [gates, setGates] = useState<Record<string, Gate>>({});
  const [prompt, setPrompt] = useState<{ id: string; name: string; code: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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
      const slug = display.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 24) || 'profile';
      const user = await usersService.createUser({
        username: `${slug}-${Date.now().toString(36).slice(-4)}`,
        display_name: display,
      });
      await loadUsers();
      const ok = await selectUser(user.id);
      // On success, selectUser sets currentUser → AuthenticatedLayout swaps away from this gate.
      if (!ok) {
        setCreateError('Profile created, but it could not be opened — pick it from the list.');
        setSubmitting(false);
        setCreating(false);
      }
    } catch {
      setCreateError('Could not create the profile. Please try again.');
      setSubmitting(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all(users.map(async u => {
      try {
        const s = await usersService.getUserSettings(u.id);
        return [u.id, { required: !!s.require_passcode, code: s.passcode }] as const;
      } catch {
        return [u.id, { required: false }] as const;
      }
    })).then(entries => { if (!cancelled) setGates(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
  }, [users]);

  const enter = (id: string, name: string) => {
    const gate = gates[id];
    if (gate?.required && gate.code) { setPrompt({ id, name, code: gate.code }); return; }
    void selectUser(id);
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
          {users.map(u => (
            <button
              key={u.id}
              type="button"
              onClick={() => enter(u.id, u.display_name)}
              className="group flex flex-col items-center gap-3 focus:outline-none"
            >
              <span className={cn(
                'relative grid h-[clamp(110px,13vw,150px)] w-[clamp(110px,13vw,150px)] place-items-center overflow-hidden rounded-[22px]',
                'border border-hairline bg-surface-2 font-display text-3xl text-muted transition-transform duration-300',
                'group-hover:-translate-y-2 group-hover:border-gold group-focus-visible:border-gold',
                'group-focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
              )}>
                {u.avatar
                  ? <img src={u.avatar} alt="" onError={handleAvatarError} className="h-full w-full object-cover" />
                  : <span aria-hidden="true">{getInitials(u.display_name)}</span>}
                {gates[u.id]?.required && (
                  <span aria-hidden="true" className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full border border-gold/55 bg-ink/70 text-gold"><LockClosedIcon className="h-4 w-4" /></span>
                )}
              </span>
              <span className="font-ui text-sm tracking-wide text-muted transition-colors group-hover:text-text">{u.display_name}</span>
            </button>
          ))}
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
          expected={prompt.code}
          onClose={() => setPrompt(null)}
          onSuccess={() => { const id = prompt.id; setPrompt(null); void selectUser(id); }}
        />
      )}
    </div>
  );
};

export default ProfileGate;
