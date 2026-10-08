import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { User, UserSettings } from '@/services/users';
import ProfilesPage from './page';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

vi.mock('@/services/users', () => ({
  usersService: { getUsers: vi.fn(), getUserSettings: vi.fn(), unlockProfile: vi.fn() },
}));
import { usersService } from '@/services/users';

const getUsers = usersService.getUsers as ReturnType<typeof vi.fn>;
const getUserSettings = usersService.getUserSettings as ReturnType<typeof vi.fn>;
const unlockProfile = usersService.unlockProfile as ReturnType<typeof vi.fn>;

/** What axios rejects with for a non-2xx answer. */
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

const settings = (over: Partial<UserSettings> = {}): UserSettings => ({
  id: 's',
  user_id: 'u',
  maturity_restriction: 'none',
  require_passcode: false,
  has_passcode: false,
  passcode_len: null,
  theme: 'dark',
  default_quality: '1080p',
  ...over,
});

const profile = (id: string, name: string, over: Partial<User> = {}, s: Partial<UserSettings> = {}): User => ({
  id,
  username: `${id}-handle`,
  display_name: name,
  avatar: 'house:reel',
  account_id: 'acct-1',
  created_at: '2026-01-01T00:00:00Z',
  settings: settings(s),
  ...over,
});

const OPEN = settings();
const LOCKED = { require_passcode: true, has_passcode: true, passcode_len: 4 };

const ben = () => profile('p1', 'Ben');
const mum = (len: number | null = 4) =>
  profile('p2', 'Mum', {}, { ...LOCKED, passcode_len: len });

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const FOCUS_STOPS = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]';

const profileButton = (name: string) => screen.getByRole('button', { name });
const key = (label: string) => screen.getByRole('button', { name: label });
const dots = (c: HTMLElement) => c.querySelectorAll('.bs-dot');
const filledDots = (c: HTMLElement) => c.querySelectorAll('.bs-dot--on');
/**
 * Click keys in order. Async because the last digit starts a request whose answer lands in
 * a microtask; without the act() the update happens outside React's knowledge and warns.
 */
const pressKeys = (...labels: string[]) =>
  act(async () => { labels.forEach((l) => fireEvent.click(key(l))); });
/** Let the grid's mount effect, and the focus it moves, land before asserting on focus. */
const settle = () => act(async () => {});
const arrow = (k: string) => fireEvent.keyDown(window, { key: k });

/** Render, wait for the grid, and open a profile whose settings call is `settleWith`. */
async function openProfile(name: string, users: User[], probe: () => Promise<unknown>) {
  getUsers.mockResolvedValue(users);
  getUserSettings.mockImplementation(probe);
  const view = render(<ProfilesPage />);
  const button = await screen.findByRole('button', { name });
  // A press on a remote or a pointer lands on the profile first, which is what moves the
  // focus model there; fireEvent.click alone would leave it on the first profile.
  await act(async () => { button.focus(); fireEvent.click(button); });
  return view;
}

/** Open Mum's profile, whose settings probe answers 423, and wait for the keypad. */
async function openKeypad(len: number | null = 4) {
  const view = await openProfile('Mum', [ben(), mum(len)], () => Promise.reject(httpError(423)));
  await screen.findByRole('button', { name: '1' });
  await settle();
  return view;
}

describe('/bigscreen/profiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    // jsdom does not implement scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
    getUserSettings.mockResolvedValue(OPEN);
    unlockProfile.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('the profile grid', () => {
    it('renders one focusable element per profile, and nothing else focusable', async () => {
      getUsers.mockResolvedValue([ben(), mum(), profile('p3', 'Kid')]);
      const { container } = render(<ProfilesPage />);
      await screen.findByRole('button', { name: 'Ben' });
      await settle();

      const stops = container.querySelectorAll(FOCUS_STOPS);
      expect(stops).toHaveLength(3);
      stops.forEach((s) => {
        expect(s.tagName).toBe('BUTTON');
        expect(s).toHaveClass('bs-profile');
      });
      // A roving tabindex: exactly one stop is in the tab order, and the remote's first
      // press must find DOM focus already on it.
      const tabbable = [...stops].filter((s) => (s as HTMLElement).tabIndex === 0);
      expect(tabbable).toHaveLength(1);
      expect(document.activeElement).toBe(tabbable[0]);
      expect(document.activeElement).toBe(profileButton('Ben'));
    });

    it('says it is loading, then shows the grid', async () => {
      const pending = deferred<User[]>();
      getUsers.mockReturnValue(pending.promise);
      render(<ProfilesPage />);
      expect(screen.getByText(/loading profiles/i)).toBeInTheDocument();
      await act(async () => { pending.resolve([ben()]); });
      expect(screen.queryByText(/loading profiles/i)).toBeNull();
      expect(profileButton('Ben')).toBeInTheDocument();
    });

    it('offers no way to add a profile', async () => {
      getUsers.mockResolvedValue([ben()]);
      render(<ProfilesPage />);
      await screen.findByRole('button', { name: 'Ben' });
      expect(screen.queryByText(/add/i)).toBeNull();
      expect(screen.queryByText('+')).toBeNull();
    });

    it('draws a known avatar from its resolved source', async () => {
      getUsers.mockResolvedValue([profile('p1', 'Ben', { avatar: 'house:reel' })]);
      const { container } = render(<ProfilesPage />);
      await screen.findByRole('button', { name: 'Ben' });
      const img = container.querySelector('.bs-profile__face img');
      expect(img).toHaveAttribute('src', '/avatars/house/reel.svg');
      // The visible name labels the button; an alt would make it read twice.
      expect(img).toHaveAttribute('alt', '');
    });

    it('falls back to a monogram when the avatar does not resolve', async () => {
      // resolveAvatarSrc returns null for anything that is not a known house: id or a
      // cached: hash. A remote URL must never reach <img src>.
      getUsers.mockResolvedValue([
        profile('p1', 'Ben Herro', { avatar: 'https://evil.example/a.png' }),
        profile('p2', 'Mum', { avatar: null }),
      ]);
      const { container } = render(<ProfilesPage />);
      await screen.findByRole('button', { name: 'Ben Herro' });
      expect(container.querySelector('img')).toBeNull();
      const faces = container.querySelectorAll('.bs-profile__face');
      expect(faces[0]).toHaveTextContent('BH');
      expect(faces[1]).toHaveTextContent('M');
    });

    it('falls back to the monogram when an avatar image fails to load', async () => {
      getUsers.mockResolvedValue([profile('p1', 'Ben', { avatar: 'cached:abcdef0123456789' })]);
      const { container } = render(<ProfilesPage />);
      await screen.findByRole('button', { name: 'Ben' });
      fireEvent.error(container.querySelector('img') as HTMLImageElement);
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('.bs-profile__face')).toHaveTextContent('B');
    });

    it('moves focus with the arrows', async () => {
      getUsers.mockResolvedValue([ben(), mum()]);
      render(<ProfilesPage />);
      await screen.findByRole('button', { name: 'Ben' });
      await settle();
      arrow('ArrowRight');
      expect(document.activeElement).toBe(profileButton('Mum'));
    });

    it('wraps a long list into rows of six, and Down moves between them', async () => {
      const many = Array.from({ length: 7 }, (_, i) => profile(`p${i}`, `Person ${i}`));
      getUsers.mockResolvedValue(many);
      const { container } = render(<ProfilesPage />);
      await screen.findByRole('button', { name: 'Person 0' });
      await settle();
      const rows = container.querySelectorAll('.bs-profiles');
      expect(rows).toHaveLength(2);
      expect(rows[0].querySelectorAll('.bs-profile')).toHaveLength(6);
      expect(rows[1].querySelectorAll('.bs-profile')).toHaveLength(1);

      // rowCounts must equal what is rendered, or focus lands on a node that is not there.
      arrow('ArrowRight');
      arrow('ArrowRight');
      arrow('ArrowDown');
      expect(document.activeElement).toBe(profileButton('Person 6'));
    });

    it('says so when the account has no profiles, rather than showing an empty screen', async () => {
      getUsers.mockResolvedValue([]);
      render(<ProfilesPage />);
      expect(await screen.findByText(/no profiles/i)).toBeInTheDocument();
    });

    it('offers a retry when the profiles cannot be loaded, and recovers', async () => {
      getUsers.mockRejectedValueOnce(httpError(500)).mockResolvedValueOnce([ben()]);
      render(<ProfilesPage />);
      const retry = await screen.findByRole('button', { name: /try again/i });
      expect(screen.getByRole('alert')).toHaveTextContent(/could not load/i);
      expect(document.activeElement).toBe(retry);
      fireEvent.click(retry);
      expect(await screen.findByRole('button', { name: 'Ben' })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  describe('choosing a profile', () => {
    it('an open profile is selected at once, and the viewer goes home', async () => {
      await openProfile('Ben', [ben(), mum()], () => Promise.resolve(OPEN));
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/bigscreen'));
      expect(getUserSettings).toHaveBeenCalledWith('p1');
      // select() persists the choice where home will look for it.
      expect(localStorage.getItem('bs-profile')).toBe('p1');
      expect(document.querySelector('.bs-keypad')).toBeNull();
      // Replace, not push: Back from home must not land on the picker.
      expect(router.push).not.toHaveBeenCalled();
    });

    it('opens the profile when the server says its passcode was already entered this session', async () => {
      // A locked profile that this session already unlocked answers its scoped calls 200.
      // Asking for the code again would be stricter than the web, and pointless.
      const locked = mum();
      await openProfile('Mum', [ben(), locked], () => Promise.resolve(settings(LOCKED)));
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/bigscreen'));
      expect(localStorage.getItem('bs-profile')).toBe('p2');
      expect(document.querySelector('.bs-keypad')).toBeNull();
    });

    it('a locked profile (423) shows the keypad and not the grid', async () => {
      const { container } = await openKeypad(4);
      expect(container.querySelector('.bs-keypad')).toBeInTheDocument();
      expect(container.querySelector('.bs-profile')).toBeNull();
      expect(container.querySelector('.bs-profiles')).toBeNull();
      expect(router.replace).not.toHaveBeenCalled();
      expect(localStorage.getItem('bs-profile')).toBeNull();
      expect(screen.getByRole('heading', { name: 'Mum' })).toBeInTheDocument();
    });

    it('draws exactly passcode_len dots, none of them filled', async () => {
      const { container } = await openKeypad(6);
      expect(dots(container)).toHaveLength(6);
      expect(filledDots(container)).toHaveLength(0);
    });

    it('falls back to four dots when the length is not known', async () => {
      const { container } = await openKeypad(null);
      expect(dots(container)).toHaveLength(4);
    });

    it('stays on the grid and says so when the profile cannot be opened', async () => {
      await openProfile('Ben', [ben()], () => Promise.reject(httpError(500)));
      expect(await screen.findByRole('alert')).toHaveTextContent(/could not open/i);
      expect(profileButton('Ben')).toBeInTheDocument();
      expect(router.replace).not.toHaveBeenCalled();
      expect(localStorage.getItem('bs-profile')).toBeNull();
    });

    it('does not treat a 403 (not your profile) as a locked profile', async () => {
      // 423 is "locked"; every other failure is a failure. Offering a keypad for a
      // profile the server will never unlock would be a dead end.
      await openProfile('Ben', [ben()], () => Promise.reject(httpError(403)));
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(document.querySelector('.bs-keypad')).toBeNull();
    });

    it('only the profile chosen last is acted on when two opens overlap', async () => {
      const first = deferred<UserSettings>();
      const second = deferred<UserSettings>();
      getUsers.mockResolvedValue([ben(), mum()]);
      getUserSettings.mockImplementation((id: string) => (id === 'p1' ? first.promise : second.promise));
      render(<ProfilesPage />);
      await screen.findByRole('button', { name: 'Ben' });

      fireEvent.click(profileButton('Ben'));
      fireEvent.click(profileButton('Mum'));
      await act(async () => { second.resolve(OPEN); });
      await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
      // Ben's answer arrives late and must not select him over the top.
      await act(async () => { first.resolve(OPEN); });
      expect(router.replace).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('bs-profile')).toBe('p2');
    });
  });

  describe('the keypad', () => {
    it('is a 3 by 4 grid of keys in phone order, digits first', async () => {
      const { container } = await openKeypad();
      const labels = [...container.querySelectorAll('.bs-key')].map((k) => k.textContent);
      expect(labels).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Back', '0', 'Del']);
      // The grid sits on the focus model's columns: every row has three keys, so Down
      // from a key lands on the key visually below it.
      expect(container.querySelectorAll('.bs-keypad > .bs-key')).toHaveLength(12);
    });

    it('puts focus on a key as it appears, and the arrows move between keys', async () => {
      await openKeypad();
      // The incoming grid must not be inert: the profile grid unmounted first, so there
      // is only ever one window listener.
      expect(document.activeElement).toBe(key('1'));
      arrow('ArrowRight');
      expect(document.activeElement).toBe(key('2'));
      arrow('ArrowDown');
      expect(document.activeElement).toBe(key('5'));
      arrow('ArrowDown');
      arrow('ArrowDown');
      expect(document.activeElement).toBe(key('0'));
    });

    it('fills a dot per digit and empties one on delete', async () => {
      const { container } = await openKeypad(4);
      await pressKeys('3', '7');
      expect(filledDots(container)).toHaveLength(2);
      await pressKeys('Delete');
      expect(filledDots(container)).toHaveLength(1);
      await pressKeys('Delete', 'Delete'); // one more than there is: harmless
      expect(filledDots(container)).toHaveLength(0);
      expect(unlockProfile).not.toHaveBeenCalled();
    });

    it('submits by itself on the last digit, with the digits in the order pressed', async () => {
      await openKeypad(4);
      await pressKeys('4', '2', '0');
      expect(unlockProfile).not.toHaveBeenCalled();
      await pressKeys('9');
      await waitFor(() => expect(unlockProfile).toHaveBeenCalledTimes(1));
      expect(unlockProfile).toHaveBeenCalledWith('p2', '4209');
    });

    it('waits for all six when the passcode is six digits', async () => {
      await openKeypad(6);
      await pressKeys('1', '2', '3', '4', '5');
      expect(unlockProfile).not.toHaveBeenCalled();
      await pressKeys('6');
      await waitFor(() => expect(unlockProfile).toHaveBeenCalledWith('p2', '123456'));
    });

    it('a correct code selects the profile and goes home', async () => {
      await openKeypad(4);
      await pressKeys('1', '2', '3', '4');
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/bigscreen'));
      expect(localStorage.getItem('bs-profile')).toBe('p2');
    });

    it('ignores every key while a code is being checked, and does not disable any', async () => {
      const pending = deferred<{ ok: boolean }>();
      unlockProfile.mockReturnValue(pending.promise);
      const { container } = await openKeypad(4);
      await pressKeys('1', '2', '3', '4');
      await waitFor(() => expect(unlockProfile).toHaveBeenCalledTimes(1));

      await pressKeys('5', 'Delete');
      expect(unlockProfile).toHaveBeenCalledTimes(1);
      expect(filledDots(container)).toHaveLength(4);
      // A disabled button drops DOM focus, and a remote has no pointer to take it back.
      container.querySelectorAll('.bs-key').forEach((k) => expect(k).not.toBeDisabled());
      expect(document.activeElement).toBe(key('1'));

      await act(async () => { pending.resolve({ ok: true }); });
      await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    });

    describe.each([423, 403])('a wrong code (%i)', (status) => {
      it('clears the dots, says so in the danger colour, and does not navigate', async () => {
        unlockProfile.mockRejectedValue(httpError(status));
        const { container } = await openKeypad(4);
        await pressKeys('9', '9', '9', '9');

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('That code was not right');
        // .bs-no is the danger colour; .bs-note is muted and would not read as an error.
        expect(alert).toHaveClass('bs-no');
        expect(alert).not.toHaveClass('bs-note');
        expect(dots(container)).toHaveLength(4);
        expect(filledDots(container)).toHaveLength(0);
        expect(router.replace).not.toHaveBeenCalled();
        expect(localStorage.getItem('bs-profile')).toBeNull();
      });

      it('keeps the keypad up, with focus still on a key, ready to retype', async () => {
        unlockProfile.mockRejectedValue(httpError(status));
        await openKeypad(4);
        arrow('ArrowDown');
        const before = document.activeElement;
        expect(before).toBe(key('4'));
        await pressKeys('9', '9', '9', '9');
        await screen.findByRole('alert');

        expect(key('1')).toBeInTheDocument();
        expect(document.querySelector('.bs-profile')).toBeNull();
        expect(document.activeElement).toBe(before);
        expect(document.activeElement).toHaveClass('bs-key');
      });

      it('accepts a second attempt', async () => {
        unlockProfile.mockRejectedValueOnce(httpError(status)).mockResolvedValueOnce({ ok: true });
        await openKeypad(4);
        await pressKeys('9', '9', '9', '9');
        await screen.findByRole('alert');
        await pressKeys('1', '2', '3', '4');
        await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/bigscreen'));
        expect(unlockProfile).toHaveBeenLastCalledWith('p2', '1234');
      });
    });

    it('clears the message as soon as the viewer starts again', async () => {
      unlockProfile.mockRejectedValue(httpError(423));
      await openKeypad(4);
      await pressKeys('9', '9', '9', '9');
      await screen.findByText('That code was not right');
      await pressKeys('1');
      expect(screen.queryByText('That code was not right')).toBeNull();
    });

    it('does not call a throttled attempt a wrong code', async () => {
      // After five misses the sixth is refused before the hash is checked. "That code was
      // not right" would tell someone their correct code is wrong.
      unlockProfile.mockRejectedValue(httpError(429));
      await openKeypad(4);
      await pressKeys('1', '2', '3', '4');
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/too many/i);
      expect(alert).not.toHaveTextContent('not right');
      expect(router.replace).not.toHaveBeenCalled();
    });

    it('does not call an unreachable server a wrong code either', async () => {
      unlockProfile.mockRejectedValue(new Error('Network Error'));
      const { container } = await openKeypad(4);
      await pressKeys('1', '2', '3', '4');
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/could not check/i);
      expect(alert).not.toHaveTextContent('not right');
      expect(filledDots(container)).toHaveLength(0);
      expect(key('1')).toBeInTheDocument();
    });

    it('Back returns to the grid with focus on the profile that was opened', async () => {
      await openKeypad(4);
      await pressKeys('1', '2');
      await pressKeys('Back to profiles');
      expect(document.querySelector('.bs-keypad')).toBeNull();
      expect(profileButton('Ben')).toBeInTheDocument();
      expect(document.activeElement).toBe(profileButton('Mum'));
      expect(unlockProfile).not.toHaveBeenCalled();
      // A different profile can now be chosen, and starts from an empty entry.
      expect(screen.getByRole('heading', { name: /who.s watching/i })).toBeInTheDocument();
    });

    it('a result that arrives after Back is ignored', async () => {
      const pending = deferred<{ ok: boolean }>();
      unlockProfile.mockReturnValue(pending.promise);
      await openKeypad(4);
      await pressKeys('1', '2', '3', '4');
      await waitFor(() => expect(unlockProfile).toHaveBeenCalled());
      // A request with no timeout can hang; Back must still get the viewer out.
      await pressKeys('Back to profiles');
      await act(async () => { pending.resolve({ ok: true }); });
      expect(router.replace).not.toHaveBeenCalled();
      expect(localStorage.getItem('bs-profile')).toBeNull();
    });

    it('starts empty on every visit', async () => {
      const first = await openKeypad(4);
      await pressKeys('1', '2');
      await pressKeys('Back to profiles');
      fireEvent.click(profileButton('Mum'));
      await screen.findByRole('button', { name: '1' });
      expect(filledDots(first.container)).toHaveLength(0);
    });
  });
});
