import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { User } from '@/services/users';
import { useTvProfile } from './useTvProfile';

vi.mock('@/services/users', () => ({
  usersService: { getUsers: vi.fn() },
}));
import { usersService } from '@/services/users';

const getUsers = usersService.getUsers as ReturnType<typeof vi.fn>;

const KEY = 'bs-profile';

/** A profile row as `GET /users` returns it: more than the TV hook keeps. */
const user = (id: string, over: Partial<User> = {}): User => ({
  id,
  username: `${id}-handle`,
  display_name: `Profile ${id}`,
  avatar: 'house:reel',
  account_id: 'acct-1',
  created_at: '2026-01-01T00:00:00Z',
  ...over,
});

/** A promise the test settles by hand, to hold `getUsers()` open. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('useTvProfile', () => {
  beforeEach(() => {
    localStorage.clear();
    getUsers.mockReset();
    // The hook keeps the last choice in a module-level variable, so it outlives a test the
    // way it outlives a screen. Clearing is the public way to reset it.
    const { result, unmount } = renderHook(() => useTvProfile({ restore: false }));
    act(() => result.current.clear());
    unmount();
  });

  afterEach(() => {
    // A failing assertion must not leave a throwing Storage behind for the next test.
    vi.restoreAllMocks();
  });

  it('has no profile and stops loading when nothing is stored, without asking the server', async () => {
    const { result } = renderHook(() => useTvProfile());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile).toBeNull();
    // Nothing to resolve, so nothing to fetch: a first launch must not cost a round trip.
    expect(getUsers).not.toHaveBeenCalled();
  });

  it('restores a stored id that still exists, keeping only what the TV needs', async () => {
    localStorage.setItem(KEY, 'b');
    getUsers.mockResolvedValue([user('a'), user('b', { display_name: 'Bea', avatar: null })]);
    const { result } = renderHook(() => useTvProfile());
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Exactly three fields: the row's username, account id and settings do not belong in
    // state that every screen reads.
    expect(result.current.profile).toEqual({ id: 'b', display_name: 'Bea', avatar: null });
  });

  it('is loading until getUsers() settles', async () => {
    localStorage.setItem(KEY, 'a');
    const pending = deferred<User[]>();
    getUsers.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useTvProfile());
    expect(result.current.loading).toBe(true);
    expect(result.current.profile).toBeNull();

    await act(async () => { pending.resolve([user('a')]); });
    expect(result.current.loading).toBe(false);
    expect(result.current.profile?.id).toBe('a');
  });

  it('is loading on the very first render, before any effect has run', () => {
    // Server render and first client render must agree, and storage is unreadable on
    // the server. So "not yet known" is the first answer even when nothing is stored.
    const seen: boolean[] = [];
    renderHook(() => { const s = useTvProfile(); seen.push(s.loading); return s; });
    expect(seen[0]).toBe(true);
  });

  it('clears a stored id that is no longer in the list', async () => {
    // The profile was deleted on another device.
    localStorage.setItem(KEY, 'gone');
    getUsers.mockResolvedValue([user('a')]);
    const { result } = renderHook(() => useTvProfile());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('keeps the stored id when the server cannot be reached', async () => {
    // A blip is not evidence the profile is gone; wiping the choice would re-ask
    // "who is watching?" after every network hiccup.
    localStorage.setItem(KEY, 'a');
    getUsers.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useTvProfile());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile).toBeNull();
    expect(localStorage.getItem(KEY)).toBe('a');
  });

  it('select persists the id in localStorage, and clear removes it', async () => {
    const { result } = renderHook(() => useTvProfile());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.select({ id: 'x', display_name: 'Xi', avatar: 'cached:abcdef0123' }));
    expect(result.current.profile).toEqual({ id: 'x', display_name: 'Xi', avatar: 'cached:abcdef0123' });
    expect(localStorage.getItem(KEY)).toBe('x');
    // Not sessionStorage: a television app restarts whenever the viewer leaves and returns.
    expect(sessionStorage.getItem(KEY)).toBeNull();

    act(() => result.current.clear());
    expect(result.current.profile).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('select stores the id alone, and drops fields a full row carries', async () => {
    const { result } = renderHook(() => useTvProfile());
    await waitFor(() => expect(result.current.loading).toBe(false));
    // The profiles screen hands over the whole row it rendered.
    act(() => result.current.select(user('x')));
    expect(Object.keys(result.current.profile ?? {}).sort()).toEqual(['avatar', 'display_name', 'id']);
  });

  it('gives select and clear a stable identity, so a screen can list them as effect dependencies', async () => {
    const { result, rerender } = renderHook(() => useTvProfile());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const { select, clear } = result.current;
    act(() => result.current.select({ id: 'x', display_name: 'Xi', avatar: null }));
    rerender();
    expect(result.current.select).toBe(select);
    expect(result.current.clear).toBe(clear);
  });

  it('a choice made while the stored one is still resolving wins, and is not erased by it', async () => {
    localStorage.setItem(KEY, 'old');
    const pending = deferred<User[]>();
    getUsers.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useTvProfile());

    act(() => result.current.select({ id: 'new', display_name: 'New', avatar: null }));
    // The list arrives afterwards and does NOT contain 'old'. Clearing the stored value
    // on that basis would delete the id the viewer has just chosen.
    await act(async () => { pending.resolve([user('new')]); });

    expect(result.current.profile?.id).toBe('new');
    expect(localStorage.getItem(KEY)).toBe('new');
    expect(result.current.loading).toBe(false);
  });

  describe('with restore: false (the picker, which only wants select)', () => {
    it('fetches nothing even when an id is stored, and is not loading', () => {
      localStorage.setItem(KEY, 'a');
      getUsers.mockResolvedValue([user('a')]);
      const seen: boolean[] = [];
      const { result } = renderHook(() => {
        const s = useTvProfile({ restore: false });
        seen.push(s.loading);
        return s;
      });
      expect(getUsers).not.toHaveBeenCalled();
      // Nothing to wait for, so not "loading" on any render, the first included.
      expect(seen.every((l) => l === false)).toBe(true);
      expect(result.current.profile).toBeNull();
    });

    it('still persists a choice, for the screen that does restore', async () => {
      const picker = renderHook(() => useTvProfile({ restore: false }));
      act(() => picker.result.current.select({ id: 'x', display_name: 'Xi', avatar: null }));
      expect(localStorage.getItem(KEY)).toBe('x');
      expect(picker.result.current.profile?.id).toBe('x');
    });
  });

  describe('when localStorage throws', () => {
    it('on read: profile null, loading false, and the screen survives', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
      const { result } = renderHook(() => useTvProfile());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.profile).toBeNull();
      expect(getUsers).not.toHaveBeenCalled();
    });

    it('on write: select still takes effect for this session', async () => {
      const { result } = renderHook(() => useTvProfile());
      await waitFor(() => expect(result.current.loading).toBe(false));
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });
      expect(() => act(() => result.current.select({ id: 'x', display_name: 'Xi', avatar: null }))).not.toThrow();
      expect(result.current.profile?.id).toBe('x');
    });

    // The picker selects, then home mounts its OWN hook instance and reads storage. A
    // choice that only lives in the first instance's state sends the viewer straight back
    // to the picker, forever.
    it.each([
      ['a write that fails', ['setItem']],
      ['storage that can be neither read nor written', ['getItem', 'setItem']],
    ] as const)('on %s: a second hook instance still sees the choice', async (_name, broken) => {
      for (const method of broken) {
        vi.spyOn(Storage.prototype, method).mockImplementation(() => {
          throw new DOMException('denied', 'SecurityError');
        });
      }
      const picker = renderHook(() => useTvProfile({ restore: false }));
      act(() => picker.result.current.select({ id: 'x', display_name: 'Xi', avatar: null }));
      picker.unmount();

      getUsers.mockResolvedValue([user('w'), user('x', { display_name: 'Xi' })]);
      const home = renderHook(() => useTvProfile());
      await waitFor(() => expect(home.result.current.loading).toBe(false));
      expect(home.result.current.profile).toEqual({ id: 'x', display_name: 'Xi', avatar: 'house:reel' });
    });

    it('a choice that could not be written beats a stale earlier one left in storage', async () => {
      // Read-only storage still holds last launch's choice; this launch's cannot replace it.
      localStorage.setItem(KEY, 'old');
      const picker = renderHook(() => useTvProfile({ restore: false }));
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('read-only', 'InvalidStateError');
      });
      act(() => picker.result.current.select({ id: 'new', display_name: 'New', avatar: null }));
      picker.unmount();

      getUsers.mockResolvedValue([user('old'), user('new')]);
      const home = renderHook(() => useTvProfile());
      await waitFor(() => expect(home.result.current.loading).toBe(false));
      expect(home.result.current.profile?.id).toBe('new');
    });

    it('on remove: clear still takes effect for this session', async () => {
      const { result } = renderHook(() => useTvProfile());
      await waitFor(() => expect(result.current.loading).toBe(false));
      act(() => result.current.select({ id: 'x', display_name: 'Xi', avatar: null }));
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
      expect(() => act(() => result.current.clear())).not.toThrow();
      expect(result.current.profile).toBeNull();
    });
  });
});
