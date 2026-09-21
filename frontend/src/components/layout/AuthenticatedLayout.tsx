'use client';
import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useUser } from '@/context/UserContext';
import { useSession } from '@/context/SessionContext';
import { usersService } from '@/services/users';
import TopNav from '@/components/shell/TopNav';
import BottomTabBar from '@/components/shell/BottomTabBar';
import ProfileGate from '@/components/shell/ProfileGate';
import CinematicAtmosphere from '@/components/fx/CinematicAtmosphere';
import AuthShell from '@/components/auth/AuthShell';
import AuthPanel from '@/components/auth/AuthPanel';
import AuthNotice from '@/components/auth/AuthNotice';
import AvatarPicker from '@/components/users/AvatarPicker';
import { Button, Field, Input } from '@/components/ui/fre';
import { getInitials } from '@/lib/avatars/resolve';

interface AuthenticatedLayoutProps { children: React.ReactNode; }

// Screens that render without a session — they are the sign-in affordance itself, so
// the gate below must never get a chance to replace them with "Who's watching?".
const PUBLIC_PREFIXES = ['/claim', '/signin', '/invite', '/auth'];

const Spinner: React.FC = () => (
  <div className="flex min-h-screen items-center justify-center bg-ink">
    <div
      role="status"
      aria-label="Loading"
      className="h-12 w-12 animate-spin rounded-full border-4 border-hairline border-t-gold"
    />
  </div>
);

/**
 * An account with no profiles yet — a fresh claim, or a member whose only profile was
 * removed. ProfileGate would show an empty "Who's watching?" wall, so ask for the one
 * thing that is actually missing.
 */
const FirstProfile: React.FC = () => {
  const { loadUsers, selectUser } = useUser();
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const display = name.trim();
    if (!display) { setError('Please enter a name.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      // The username is minted server-side; a client-side slug could collide on the
      // instance-global UNIQUE constraint.
      const user = await usersService.createUser({
        display_name: display,
        avatar: avatar ?? undefined,
      });
      await loadUsers();
      const result = await selectUser(user.id);
      // On success selectUser sets currentUser and this whole screen is replaced.
      if (result !== 'ok') {
        setError('Profile created, but it could not be opened. Try reloading.');
        setSubmitting(false);
      }
    } catch {
      setError('Could not create the profile. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Almost there"
      title={<>Set up your <em>profile</em>.</>}
      intro="Profiles keep watch history, resume points and lists separate. You can add more for the rest of the household later."
    >
      <AuthPanel>
        <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
          <Field label="Profile name" htmlFor="first-profile-name">
            <Input
              id="first-profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ben"
              maxLength={40}
              autoComplete="nickname"
              disabled={submitting}
            />
          </Field>

          <div className="flex flex-col gap-3">
            <p className="font-ui text-sm font-medium text-text/80">Avatar</p>
            <AvatarPicker
              value={avatar}
              onChange={setAvatar}
              initials={getInitials(name || 'You')}
              disabled={submitting}
            />
          </div>

          {error && <AuthNotice tone="danger">{error}</AuthNotice>}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            isLoading={submitting}
            disabled={!name.trim()}
          >
            Start watching
          </Button>
        </form>
      </AuthPanel>
    </AuthShell>
  );
};

const AuthenticatedLayout: React.FC<AuthenticatedLayoutProps> = ({ children }) => {
  const pathname = usePathname();
  const router = useRouter();
  const { account, instance, isLoading: sessionLoading } = useSession();
  const { currentUser, users, isLoading } = useUser();

  const isPublic = PUBLIC_PREFIXES.some((p) => pathname?.startsWith(p));
  const isStreaming = pathname?.startsWith('/streaming');
  const needsClaim = !!instance?.needs_claim;

  // A render-time router call would mutate the router while React is rendering; the
  // branches below show the spinner until the navigation lands.
  useEffect(() => {
    if (isPublic || sessionLoading) return;
    if (needsClaim) {
      router.replace('/claim');
      return;
    }
    if (!account) {
      const next = `${pathname ?? '/'}${typeof window === 'undefined' ? '' : window.location.search}`;
      router.replace(`/signin?next=${encodeURIComponent(next)}`);
    }
  }, [isPublic, sessionLoading, needsClaim, account, pathname, router]);

  if (isPublic) return <>{children}</>;

  if (isLoading) return <Spinner />;

  // Redirect in flight — anything else here would flash the wrong screen.
  if (needsClaim || !account) return <Spinner />;

  if (users.length === 0) return <FirstProfile />;

  if (!currentUser) return <ProfileGate />;

  // Player route: full-bleed, no chrome.
  if (isStreaming) {
    return <main className="h-screen w-screen bg-ink">{children}</main>;
  }

  return (
    <>
      <CinematicAtmosphere />
      <TopNav />
      <main className="relative z-[2] min-h-screen pt-[72px] pb-16 md:pb-0">{children}</main>
      <BottomTabBar />
    </>
  );
};

export default AuthenticatedLayout;
