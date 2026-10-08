import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
    vi.useRealTimers();
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

    // The boundaries of the chunking: an exact multiple of six must not leave an empty
    // trailing row, and the rows must be what the focus model counts.
    it.each([
      [1, [1]],
      [5, [5]],
      [6, [6]],
      [7, [6, 1]],
      [12, [6, 6]],
      [13, [6, 6, 1]],
    ])('lays %i profiles out as rows of %j, with no empty row', async (count, expected) => {
      getUsers.mockResolvedValue(Array.from({ length: count }, (_, i) => profile(`p${i}`, `Person ${i}`)));
      const { container } = render(<ProfilesPage />);
      await screen.findByRole('button', { name: 'Person 0' });
      await settle();
      const rows = [...container.querySelectorAll('.bs-profiles')];
      expect(rows.map((r) => r.querySelectorAll('.bs-profile').length)).toEqual(expected);
      expect(container.querySelectorAll('.bs-profile')).toHaveLength(count);
    });

    it('navigates an exact row of six: Right stops at the sixth, and Down has nowhere to go', async () => {
      getUsers.mockResolvedValue(Array.from({ length: 6 }, (_, i) => profile(`p${i}`, `Person ${i}`)));
      render(<ProfilesPage />);
      await screen.findByRole('button', { name: 'Person 0' });
      await settle();
      for (let i = 0; i < 8; i++) arrow('ArrowRight');
      expect(document.activeElement).toBe(profileButton('Person 5'));
      arrow('ArrowDown');
      expect(document.activeElement).toBe(profileButton('Person 5'));
    });

    it('navigates two exact rows of six: Down lands under, Right never crosses to the next row', async () => {
      getUsers.mockResolvedValue(Array.from({ length: 12 }, (_, i) => profile(`p${i}`, `Person ${i}`)));
      render(<ProfilesPage />);
      await screen.findByRole('button', { name: 'Person 0' });
      await settle();
      for (let i = 0; i < 3; i++) arrow('ArrowRight');
      arrow('ArrowDown');
      expect(document.activeElement).toBe(profileButton('Person 9')); // row 1, column 3
      for (let i = 0; i < 8; i++) arrow('ArrowRight');
      expect(document.activeElement).toBe(profileButton('Person 11')); // end of the LAST row: no wrap
      arrow('ArrowDown');
      expect(document.activeElement).toBe(profileButton('Person 11'));
      arrow('ArrowUp');
      // The focus model returns to the column row 0 last held, not the one Down left from.
      expect(document.activeElement).toBe(profileButton('Person 3'));
    });

    it('says so when the account has no profiles, with something to press', async () => {
      getUsers.mockResolvedValue([]);
      render(<ProfilesPage />);
      expect(await screen.findByText(/no profiles/i)).toBeInTheDocument();
      // Nothing focusable would leave a remote with no way to act at all.
      const check = screen.getByRole('button', { name: /check again/i });
      expect(document.activeElement).toBe(check);
      expect(check.closest('.bs-controls')).toHaveClass('bs-inset');
    });

    it('checks again when asked, and shows a profile created in the meantime', async () => {
      getUsers.mockResolvedValueOnce([]).mockResolvedValueOnce([ben()]);
      render(<ProfilesPage />);
      fireEvent.click(await screen.findByRole('button', { name: /check again/i }));
      expect(await screen.findByRole('button', { name: 'Ben' })).toBeInTheDocument();
      expect(getUsers).toHaveBeenCalledTimes(2);
    });

    it('does not fetch the profile list twice when a profile is remembered', async () => {
      // The hook's restore would fetch the very list this screen is fetching.
      localStorage.setItem('bs-profile', 'p1');
      getUsers.mockResolvedValue([ben()]);
      render(<ProfilesPage />);
      await screen.findByRole('button', { name: 'Ben' });
      await settle();
      expect(getUsers).toHaveBeenCalledTimes(1);
    });

    describe('a slow server', () => {
      it('gives way to the failed screen after ten seconds, so there is something to press', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        getUsers.mockReturnValue(deferred<User[]>().promise);
        render(<ProfilesPage />);
        expect(screen.getByText(/loading profiles/i)).toBeInTheDocument();
        expect(screen.queryByRole('button')).toBeNull();

        await act(async () => { await vi.advanceTimersByTimeAsync(9_000); });
        expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
        await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });

        const retry = screen.getByRole('button', { name: /try again/i });
        expect(screen.getByRole('alert')).toHaveTextContent(/could not load/i);
        expect(document.activeElement).toBe(retry);
      });

      it('shows the profiles after all if the answer turns up after the failed screen did', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const slow = deferred<User[]>();
        getUsers.mockReturnValue(slow.promise);
        render(<ProfilesPage />);
        await act(async () => { await vi.advanceTimersByTimeAsync(10_500); });
        await screen.findByRole('button', { name: /try again/i });

        await act(async () => { slow.resolve([ben()]); });
        expect(profileButton('Ben')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).toBeNull();
      });

      it('retrying abandons the stuck request, whatever it later says', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const stuck = deferred<User[]>();
        const second = deferred<User[]>();
        getUsers.mockReturnValueOnce(stuck.promise).mockReturnValueOnce(second.promise);
        render(<ProfilesPage />);
        await act(async () => { await vi.advanceTimersByTimeAsync(10_500); });
        fireEvent.click(await screen.findByRole('button', { name: /try again/i }));
        expect(getUsers).toHaveBeenCalledTimes(2);

        await act(async () => { stuck.resolve([ben()]); });
        expect(screen.queryByRole('button', { name: 'Ben' })).toBeNull();
        await act(async () => { second.resolve([mum()]); });
        expect(profileButton('Mum')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Ben' })).toBeNull();
      });

      it('does not give up on a request that is merely taking a while', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const slow = deferred<User[]>();
        getUsers.mockReturnValue(slow.promise);
        render(<ProfilesPage />);
        await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
        await act(async () => { slow.resolve([ben()]); });
        expect(profileButton('Ben')).toBeInTheDocument();
        // The timer was cancelled by the answer: it must not raise the failed screen later.
        await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
        expect(screen.queryByRole('alert')).toBeNull();
        expect(profileButton('Ben')).toBeInTheDocument();
      });
    });

    describe('pressing the retry while the backend hangs', () => {
      const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]';
      const somethingFocused = () => {
        const active = document.activeElement;
        expect(active).not.toBe(document.body);
        expect(active?.matches(FOCUSABLE)).toBe(true);
      };

      it('keeps the same button mounted and focused, relabelled, through the whole cycle', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const hung = deferred<User[]>();
        getUsers.mockRejectedValueOnce(httpError(500)).mockReturnValue(hung.promise);
        render(<ProfilesPage />);
        const retry = await screen.findByRole('button', { name: /try again/i });
        expect(document.activeElement).toBe(retry);

        fireEvent.click(retry);
        // In flight: the very node the viewer pressed, still focused, saying what it is doing.
        expect(screen.getByRole('button')).toBe(retry);
        expect(retry).toHaveTextContent(/trying again/i);
        expect(document.activeElement).toBe(retry);
        somethingFocused();

        // Not dead for the next ten seconds, at any point of them.
        for (let i = 0; i < 4; i++) {
          await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
          somethingFocused();
        }
        // A second press while it is in flight does not issue a second request.
        fireEvent.click(screen.getByRole('button'));
        expect(getUsers).toHaveBeenCalledTimes(2);

        // The patience timer puts the label back, and the button can be pressed again.
        await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });
        somethingFocused();
        expect(screen.getByRole('button', { name: /^try again$/i })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button'));
        expect(getUsers).toHaveBeenCalledTimes(3);
        somethingFocused();
      });

      it('hands focus to the grid when the retry is finally answered', async () => {
        const slow = deferred<User[]>();
        getUsers.mockRejectedValueOnce(httpError(500)).mockReturnValueOnce(slow.promise);
        render(<ProfilesPage />);
        fireEvent.click(await screen.findByRole('button', { name: /try again/i }));
        somethingFocused();
        await act(async () => { slow.resolve([ben()]); });
        await settle();
        expect(document.activeElement).toBe(profileButton('Ben'));
      });

      it('goes back to the offer when the retry fails, with the button still there', async () => {
        const second = deferred<User[]>();
        getUsers.mockRejectedValueOnce(httpError(500)).mockReturnValueOnce(second.promise);
        render(<ProfilesPage />);
        const retry = await screen.findByRole('button', { name: /try again/i });
        fireEvent.click(retry);
        await act(async () => { second.reject(httpError(500)); });
        expect(screen.getByRole('button', { name: /^try again$/i })).toBeInTheDocument();
        somethingFocused();
      });

      it('does the same for Check again on an empty account', async () => {
        getUsers.mockResolvedValueOnce([]).mockReturnValue(deferred<User[]>().promise);
        render(<ProfilesPage />);
        const check = await screen.findByRole('button', { name: /check again/i });
        fireEvent.click(check);
        expect(screen.getByRole('button')).toBe(check);
        expect(check).toHaveTextContent(/checking/i);
        somethingFocused();
      });
    });

    it('offers a retry when the profiles cannot be loaded, and recovers', async () => {
      getUsers.mockRejectedValueOnce(httpError(500)).mockResolvedValueOnce([ben()]);
      render(<ProfilesPage />);
      const retry = await screen.findByRole('button', { name: /try again/i });
      expect(screen.getByRole('alert')).toHaveTextContent(/could not load/i);
      expect(document.activeElement).toBe(retry);
      // .bs-msg would fight .bs-controls for the margin and put the button 8px under the line.
      expect(retry.closest('.bs-controls')).toHaveClass('bs-inset');
      expect(retry.closest('.bs-controls')).not.toHaveClass('bs-msg');
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

    // Below the rows, three rows of tiles are taller than the scroller, so a viewer with focus
    // in the first row never sees it; and mounting it only when it has text would shove the
    // whole grid down under their focus ring.
    it('keeps one status line above every row, mounted and empty until it has something to say', async () => {
      const pending = deferred<UserSettings>();
      getUsers.mockResolvedValue(Array.from({ length: 13 }, (_, i) => profile(`p${i}`, `Person ${i}`)));
      getUserSettings.mockReturnValue(pending.promise);
      const { container } = render(<ProfilesPage />);
      await screen.findByRole('button', { name: 'Person 0' });
      await settle();

      const rows = [...container.querySelectorAll('.bs-profiles')];
      expect(rows).toHaveLength(3);
      const aboveAll = (el: Element) =>
        rows.every((r) => el.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING);

      const line = screen.getByRole('status');
      expect(line).toBeEmptyDOMElement();
      expect(line).toHaveClass('bs-msg');
      expect(aboveAll(line)).toBe(true);

      const person = profileButton('Person 0');
      await act(async () => { person.focus(); fireEvent.click(person); });
      expect(line).toHaveTextContent('Opening…');

      await act(async () => { pending.reject(httpError(500)); });
      const alert = await screen.findByRole('alert');
      // The same element, so nothing below it moved when it filled.
      expect(alert).toBe(line);
      expect(alert).toHaveTextContent(/could not open/i);
      expect(alert).toHaveClass('bs-no', 'bs-msg');
      expect(aboveAll(alert)).toBe(true);
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

    describe('a passcode length that is not the one on screen', () => {
      /**
       * Open Mum's keypad where GET /users answers each call from `lists` in turn (the last
       * one repeats): the page load first, then the re-read after a wrong code.
       */
      async function openKeypadFromLists(lists: Array<User[] | Error>) {
        getUsers.mockReset();
        for (const l of lists) {
          if (l instanceof Error) getUsers.mockRejectedValueOnce(l);
          else getUsers.mockResolvedValueOnce(l);
        }
        const last = lists[lists.length - 1];
        getUsers.mockImplementation(() => (last instanceof Error ? Promise.reject(last) : Promise.resolve(last)));
        getUserSettings.mockRejectedValue(httpError(423));
        unlockProfile.mockRejectedValue(httpError(403));
        const view = render(<ProfilesPage />);
        const button = await screen.findByRole('button', { name: 'Mum' });
        await act(async () => { button.focus(); fireEvent.click(button); });
        await screen.findByRole('button', { name: '1' });
        await settle();
        return view;
      }

      it('adopts the length from the list after a wrong code, so the real code can be typed', async () => {
        // Lengthened on the web while the TV sat on the picker: the page loaded 4, the code is 6.
        const { container } = await openKeypadFromLists([[ben(), mum(4)], [ben(), mum(6)]]);
        expect(dots(container)).toHaveLength(4);

        await pressKeys('1', '2', '3', '4');
        await waitFor(() => expect(dots(container)).toHaveLength(6));
        expect(screen.getByRole('alert')).toHaveTextContent('That code was not right');
        expect(unlockProfile).toHaveBeenCalledTimes(1);

        // Five digits do not submit now; the sixth does, with all six.
        await pressKeys('1', '2', '3', '4', '5');
        expect(unlockProfile).toHaveBeenCalledTimes(1);
        await pressKeys('6');
        await waitFor(() => expect(unlockProfile).toHaveBeenCalledTimes(2));
        expect(unlockProfile).toHaveBeenLastCalledWith('p2', '123456');
      });

      it('replaces the four-dot fallback when the first list did not carry a length', async () => {
        const { container } = await openKeypadFromLists([[ben(), mum(null)], [ben(), mum(8)]]);
        expect(dots(container)).toHaveLength(4);
        await pressKeys('1', '2', '3', '4');
        await waitFor(() => expect(dots(container)).toHaveLength(8));
      });

      it('also shrinks to a shortened code', async () => {
        const { container } = await openKeypadFromLists([[ben(), mum(6)], [ben(), mum(4)]]);
        await pressKeys('1', '2', '3', '4', '5', '6');
        await waitFor(() => expect(dots(container)).toHaveLength(4));
      });

      it('keeps the refreshed list, so Back then OK does not bring the old length back', async () => {
        const { container } = await openKeypadFromLists([[ben(), mum(4)], [ben(), mum(6)]]);
        await pressKeys('1', '2', '3', '4');
        await waitFor(() => expect(dots(container)).toHaveLength(6));

        await pressKeys('Back to profiles');
        const button = profileButton('Mum');
        await act(async () => { button.focus(); fireEvent.click(button); });
        await screen.findByRole('button', { name: '1' });
        expect(dots(container)).toHaveLength(6);
      });

      it('leaves the length alone when the re-read fails, and still reports a wrong code', async () => {
        const { container } = await openKeypadFromLists([[ben(), mum(4)], new Error('offline')]);
        await pressKeys('1', '2', '3', '4');
        expect(await screen.findByRole('alert')).toHaveTextContent('That code was not right');
        await waitFor(() => expect(getUsers).toHaveBeenCalledTimes(2));
        await settle();
        expect(dots(container)).toHaveLength(4);
        expect(key('1')).toBeInTheDocument();
      });

      it('leaves the length alone when the list agrees with the screen', async () => {
        const { container } = await openKeypadFromLists([[ben(), mum(4)], [ben(), mum(4)]]);
        await pressKeys('1', '2', '3', '4');
        await waitFor(() => expect(getUsers).toHaveBeenCalledTimes(2));
        await settle();
        expect(dots(container)).toHaveLength(4);
      });

      it('does not re-read the list for a throttled attempt, which says nothing about the length', async () => {
        const { container } = await openKeypadFromLists([[ben(), mum(4)], [ben(), mum(6)]]);
        unlockProfile.mockRejectedValue(httpError(429));
        await pressKeys('1', '2', '3', '4');
        await screen.findByRole('alert');
        await settle();
        expect(getUsers).toHaveBeenCalledTimes(1);
        expect(dots(container)).toHaveLength(4);
      });

      it('does not pull the viewer back onto the keypad if they pressed Back before the re-read landed', async () => {
        const reread = deferred<User[]>();
        const { container } = await openKeypadFromLists([[ben(), mum(4)], [ben(), mum(6)]]);
        getUsers.mockReset();
        getUsers.mockReturnValue(reread.promise);
        await pressKeys('1', '2', '3', '4');
        await screen.findByRole('alert');
        await pressKeys('Back to profiles');
        await act(async () => { reread.resolve([ben(), mum(6)]); });
        expect(container.querySelector('.bs-keypad')).toBeNull();
        expect(profileButton('Mum')).toBeInTheDocument();
      });
    });
  });

  describe('the remote’s Back key', () => {
    // Fired the way a remote sends it: the key often has no usable name, only a code.
    const back = (init: KeyboardEventInit = { key: 'Unidentified', keyCode: 461 }) =>
      act(async () => { fireEvent.keyDown(window, init); });
    const gone = () => {
      expect(router.replace).not.toHaveBeenCalled();
      expect(router.push).not.toHaveBeenCalled();
    };

    it('a profile still being opened when Back is pressed is never selected', async () => {
      const settingsCall = deferred<UserSettings>();
      await openProfile('Ben', [ben(), mum()], () => settingsCall.promise);
      // router.replace is a transition: the page stays mounted while it resolves.
      await back();
      expect(router.replace).toHaveBeenCalledTimes(1);
      expect(router.replace).toHaveBeenCalledWith('/bigscreen');

      await act(async () => { settingsCall.resolve(OPEN); });
      // The cancelled choice is not persisted, and nothing navigates a second time.
      expect(localStorage.getItem('bs-profile')).toBeNull();
      expect(router.replace).toHaveBeenCalledTimes(1);
    });

    it('a profile whose passcode check is still pending when Back is pressed does not raise a keypad', async () => {
      const settingsCall = deferred<UserSettings>();
      await openProfile('Mum', [ben(), mum()], () => settingsCall.promise);
      await back();
      await act(async () => { settingsCall.reject(httpError(423)); });
      expect(document.querySelector('.bs-keypad')).toBeNull();
    });

    it('closes the keypad and returns to the grid, without navigating', async () => {
      await openKeypad(4);
      await pressKeys('1', '2');
      await back();
      expect(document.querySelector('.bs-keypad')).toBeNull();
      expect(profileButton('Ben')).toBeInTheDocument();
      expect(document.activeElement).toBe(profileButton('Mum'));
      expect(unlockProfile).not.toHaveBeenCalled();
      gone();
    });

    it('goes home from the grid', async () => {
      getUsers.mockResolvedValue([ben(), mum()]);
      render(<ProfilesPage />);
      await screen.findByRole('button', { name: 'Ben' });
      await settle();
      await back({ key: 'XF86Back' });
      // Replace, as choosing a profile does: leaving is not somewhere to come back to.
      expect(router.replace).toHaveBeenCalledTimes(1);
      expect(router.replace).toHaveBeenCalledWith('/bigscreen');
      expect(router.push).not.toHaveBeenCalled();
    });

    it('escalates one step per press: keypad, then grid, then home', async () => {
      await openKeypad(4);
      await back();
      expect(document.querySelector('.bs-keypad')).toBeNull();
      gone();
      await back();
      expect(router.replace).toHaveBeenCalledTimes(1);
      expect(router.replace).toHaveBeenCalledWith('/bigscreen');
    });

    it('does what the keypad’s own Back key does: a result arriving after it is ignored', async () => {
      const pending = deferred<{ ok: boolean }>();
      unlockProfile.mockReturnValue(pending.promise);
      await openKeypad(4);
      await pressKeys('1', '2', '3', '4');
      await waitFor(() => expect(unlockProfile).toHaveBeenCalled());
      await back({ key: 'Escape' });
      expect(document.querySelector('.bs-keypad')).toBeNull();
      await act(async () => { pending.resolve({ ok: true }); });
      gone();
      expect(localStorage.getItem('bs-profile')).toBeNull();
    });

    it('leaves a screen that has nothing to collapse, such as the loading one', async () => {
      getUsers.mockReturnValue(deferred<User[]>().promise);
      render(<ProfilesPage />);
      expect(screen.getByText(/loading profiles/i)).toBeInTheDocument();
      await back({ key: 'Backspace' });
      expect(router.replace).toHaveBeenCalledWith('/bigscreen');
    });

    it('neither acts on nor claims a key that is not Back', async () => {
      getUsers.mockResolvedValue([ben(), mum()]);
      render(<ProfilesPage />);
      await screen.findByRole('button', { name: 'Ben' });
      await settle();
      // fireEvent returns false when the event was cancelled.
      expect(fireEvent.keyDown(window, { key: 'a', keyCode: 65 })).toBe(true);
      gone();
    });

    it('stops listening when the page unmounts', async () => {
      getUsers.mockResolvedValue([ben()]);
      const { unmount } = render(<ProfilesPage />);
      await screen.findByRole('button', { name: 'Ben' });
      unmount();
      expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(true);
      gone();
    });
  });
});

describe('bigscreen.css, as this screen relies on it', () => {
  const css = readFileSync(join(process.cwd(), 'public/bigscreen.css'), 'utf8');
  const rule = (selector: string): string => {
    const escaped = selector.replace(/[.\-]/g, '\\$&');
    const m = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    expect(m, `${selector} has a rule`).not.toBeNull();
    return m![1];
  };

  it('.bs-profiles does not wrap: its rows are the focus model\'s rows', () => {
    // The page chunks into rows of six and gives each its own container. A container that
    // re-flowed would draw one row on two lines on a narrow viewport, so Right would land
    // on a tile on the next line and Down would skip a visual line.
    const body = rule('.bs-profiles');
    expect(body).toMatch(/flex-wrap:\s*nowrap/);
    expect(body).not.toMatch(/flex-wrap:\s*wrap/);
  });

  it('.bs-inset is the safe inset and no margin, so it cannot fight .bs-controls', () => {
    const body = rule('.bs-inset');
    expect(body).toMatch(/padding:\s*0\s+var\(--safe-x\)/);
    expect(body).not.toMatch(/margin/);
  });
});

describe('/bigscreen/profiles: every state keeps a focus target', () => {
  it('offers a way home while the list is still loading', async () => {
    // The 10s fall-through bounds how long this lasts, but a screen with no ring reads as
    // a frozen television, and this was the one state on the surface without a control.
    getUsers.mockReturnValue(new Promise(() => {}));
    render(<ProfilesPage />);
    await act(async () => {});
    expect(screen.getByText('Loading profiles…')).toBeInTheDocument();
    const home = screen.getByRole('link', { name: /back to home/i });
    expect(home).toHaveAttribute('href', '/bigscreen');
    expect(document.activeElement).toBe(home);
  });
});
