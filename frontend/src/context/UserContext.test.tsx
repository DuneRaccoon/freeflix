import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';
import type { User, UserSettings } from '@/services/users';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

vi.mock('@/context/SessionContext', () => ({
  useSession: () => ({ account: { id: 'acct-1' }, isLoading: false }),
}));

const apiClientMock = vi.hoisted(() => ({
  lockedListener: null as ((url: string) => void) | null,
}));
vi.mock('@/services/api-client', () => ({
  onProfileLocked: (l: (url: string) => void) => {
    apiClientMock.lockedListener = l;
    return () => { apiClientMock.lockedListener = null; };
  },
}));

vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/services/users', () => ({
  usersService: {
    getUsers: vi.fn(),
    getUser: vi.fn(),
    getUserSettings: vi.fn(),
    selectProfile: vi.fn(),
    deselectProfile: vi.fn(),
    changePasscode: vi.fn(),
    updateUser: vi.fn(),
    updateUserSettings: vi.fn(),
  },
}));

import { usersService } from '@/services/users';
import { UserProvider, useUser, type PasscodeChangeResult } from './UserContext';

/** What axios rejects with for a non-2xx answer. */
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const SETTINGS: UserSettings = {
  id: 's',
  user_id: 'p1',
  maturity_restriction: 'none',
  require_passcode: false,
  has_passcode: false,
  passcode_len: 4,
  theme: 'dark',
  default_quality: '1080p',
};

const P = (id: string): User => ({
  id,
  username: `${id}-handle`,
  display_name: id.toUpperCase(),
  avatar: 'house:reel',
  account_id: 'acct-1',
  created_at: '2026-01-01T00:00:00Z',
});
const P1 = P('p1');
const P2 = P('p2');

let ctx!: ReturnType<typeof useUser>;
function Probe() {
  ctx = useUser();
  return (
    <div>
      <span data-testid="current">{ctx.currentUser?.id ?? 'none'}</span>
      <span data-testid="locked">{ctx.lockedProfileId ?? 'none'}</span>
      <span data-testid="loading">{String(ctx.isLoading)}</span>
    </div>
  );
}

const renderProvider = () => render(<UserProvider><Probe /></UserProvider>);
const booted = () => waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  vi.mocked(usersService.getUsers).mockResolvedValue([P1, P2]);
  vi.mocked(usersService.getUser).mockImplementation(async (id: string) => P(id));
  vi.mocked(usersService.getUserSettings).mockResolvedValue(SETTINGS);
  vi.mocked(usersService.selectProfile).mockResolvedValue(undefined);
  vi.mocked(usersService.deselectProfile).mockResolvedValue(undefined);
});

describe('UserContext profile lock', () => {
  it('boot restore reads the stored profile and does not select it', async () => {
    localStorage.setItem('currentUserId', 'p1');
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('p1'));
    expect(usersService.selectProfile).not.toHaveBeenCalled(); // positive control: next test
  });

  it('selectUser always goes through select first, even with no code', async () => {
    renderProvider();
    await booted();
    await act(async () => { expect(await ctx.selectUser('p2')).toBe('ok'); });
    expect(usersService.selectProfile).toHaveBeenCalledWith('p2', undefined);
    expect(vi.mocked(usersService.selectProfile).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(usersService.getUser).mock.invocationCallOrder[0]);
  });

  it.each([[403, 'locked'], [423, 'locked'], [429, 'throttled'], [500, 'error']] as const)(
    'a %i from select is %s, and nothing is fetched', async (status, result) => {
      vi.mocked(usersService.selectProfile).mockRejectedValue(httpError(status));
      renderProvider();
      await booted();
      await act(async () => { expect(await ctx.selectUser('p2', '0000')).toBe(result); });
      expect(usersService.getUser).not.toHaveBeenCalled();
      expect(screen.getByTestId('current')).toHaveTextContent('none');
    });

  it('a select failure that is not a refusal takes the open-failed path and drops that stored id', async () => {
    // A removed profile now fails at select, the first request, so select's error path is
    // the one that has to stop every reload replaying it.
    localStorage.setItem('currentUserId', 'p1');
    vi.mocked(usersService.getUser).mockRejectedValue(httpError(423));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('locked')).toHaveTextContent('p1'));
    vi.mocked(usersService.selectProfile).mockRejectedValue(httpError(404));
    await act(async () => { expect(await ctx.selectUser('p1', '4821')).toBe('error'); });
    expect(localStorage.getItem('currentUserId')).toBeNull();
    expect(ctx.error).not.toBeNull();
    consoleError.mockRestore();
  });

  it('boot restore that meets a 423 lands on the picker with that profile pending its code', async () => {
    localStorage.setItem('currentUserId', 'p1');
    vi.mocked(usersService.getUser).mockRejectedValue(httpError(423));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('locked')).toHaveTextContent('p1'));
    expect(screen.getByTestId('current')).toHaveTextContent('none');
    expect(usersService.selectProfile).not.toHaveBeenCalled();
    // The stored id is kept: the profile is still this tab's, only its code is pending.
    expect(localStorage.getItem('currentUserId')).toBe('p1');
  });

  it('a successful select clears lockedProfileId', async () => {
    localStorage.setItem('currentUserId', 'p1');
    vi.mocked(usersService.getUser).mockRejectedValue(httpError(423));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('locked')).toHaveTextContent('p1'));
    vi.mocked(usersService.getUser).mockResolvedValue(P1);
    await act(async () => { await ctx.selectUser('p1', '4821'); });
    expect(screen.getByTestId('locked')).toHaveTextContent('none');
    expect(screen.getByTestId('current')).toHaveTextContent('p1');
  });

  it('Switch profile deselects on the server, then clears the profile', async () => {
    localStorage.setItem('currentUserId', 'p1');
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('p1'));
    act(() => { ctx.logout(); });
    expect(usersService.deselectProfile).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('current')).toHaveTextContent('none');
    expect(localStorage.getItem('currentUserId')).toBeNull();
    expect(push).toHaveBeenCalledWith('/');
  });

  it.each([
    ['hangs', () => new Promise<void>(() => {})],
    ['fails', () => Promise.reject(new Error('x'))],
  ] as const)('Switch profile still clears locally when deselect %s', async (_, impl) => {
    vi.mocked(usersService.deselectProfile).mockImplementation(impl);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem('currentUserId', 'p1');
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('p1'));
    act(() => { ctx.logout(); });
    expect(screen.getByTestId('current')).toHaveTextContent('none'); // synchronously, not after the request
    expect(push).toHaveBeenCalledWith('/');
    consoleError.mockRestore();
  });

  it('changePasscode applies the returned settings and refreshes the profile list', async () => {
    const saved = deferred<UserSettings>();
    vi.mocked(usersService.changePasscode).mockReturnValue(saved.promise);
    localStorage.setItem('currentUserId', 'p1');
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('p1'));
    expect(usersService.getUsers).toHaveBeenCalledTimes(1);
    let result!: Promise<PasscodeChangeResult>;
    act(() => { result = ctx.changePasscode('p1', { new_passcode: '12345' }); });
    // Asserted WHILE the request is out: a set-then-reset isLoading is back to false once it settles.
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    await act(async () => {
      saved.resolve({ ...SETTINGS, has_passcode: true, require_passcode: true, passcode_len: 5 });
    });
    expect(await result).toBe('ok');
    expect(ctx.userSettings?.passcode_len).toBe(5);
    await waitFor(() => expect(usersService.getUsers).toHaveBeenCalledTimes(2));
  });

  it.each([[403, 'wrong'], [429, 'throttled'], [423, 'error'], [500, 'error']] as const)(
    'changePasscode maps %i to %s and leaves the settings alone', async (status, result) => {
      vi.mocked(usersService.changePasscode).mockRejectedValue(httpError(status));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      localStorage.setItem('currentUserId', 'p1');
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('p1'));
      await act(async () => {
        expect(await ctx.changePasscode('p1', { current_passcode: '1111', new_passcode: '2222' })).toBe(result);
      });
      expect(ctx.userSettings?.passcode_len).toBe(SETTINGS.passcode_len);
      consoleError.mockRestore();
    });
});

describe('UserContext mid-session relock (423)', () => {
  it('a 423 mid-session drops to the picker with that profile pending its code', async () => {
    localStorage.setItem('currentUserId', 'p1');
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('p1'));

    act(() => { apiClientMock.lockedListener!('/users/p1/progress'); });

    expect(screen.getByTestId('current')).toHaveTextContent('none');
    expect(ctx.userSettings).toBeNull();
    expect(screen.getByTestId('locked')).toHaveTextContent('p1');
    expect(localStorage.getItem('currentUserId')).toBe('p1');
    expect(usersService.deselectProfile).not.toHaveBeenCalled();
  });

  it.each(['/users/p1/select', '/users/p1/unlock'])(
    'a 423 from %s does not trigger the mid-session drop', async (url) => {
      localStorage.setItem('currentUserId', 'p1');
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('p1'));

      act(() => { apiClientMock.lockedListener!(url); });

      expect(screen.getByTestId('current')).toHaveTextContent('p1');
      expect(screen.getByTestId('locked')).toHaveTextContent('none');
    });

  it.each([
    '/users/p1/progress',
    '/users/p1/settings?x=1',
    '/streaming/progress/p1/prog-9',
    '/watchlist/p1/add',
    '/rails?user_id=p1',
  ])('a stale %s 423 for the previous profile leaves the open profile alone', async (url) => {
    // Switch profile -> pick unlocked p2 while a p1 request is in flight: its 423
    // lands after the switch and is about p1, not the profile now open.
    localStorage.setItem('currentUserId', 'p2');
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('p2'));

    act(() => { apiClientMock.lockedListener!(url); });

    expect(screen.getByTestId('current')).toHaveTextContent('p2');
    expect(screen.getByTestId('locked')).toHaveTextContent('none');
  });

  it.each(['/streaming/progress/p2/prog-9', '/watchlist/p2', '/rails'])(
    'a 423 from %s, naming the open profile or none, still drops it', async (url) => {
      localStorage.setItem('currentUserId', 'p2');
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('p2'));

      act(() => { apiClientMock.lockedListener!(url); });

      expect(screen.getByTestId('current')).toHaveTextContent('none');
      expect(screen.getByTestId('locked')).toHaveTextContent('p2');
    });

  it('a 423 with no current profile leaves lockedProfileId alone', async () => {
    renderProvider();
    await booted();
    act(() => { apiClientMock.lockedListener!('/users/p2/settings'); });
    expect(screen.getByTestId('locked')).toHaveTextContent('none');
  });
});
