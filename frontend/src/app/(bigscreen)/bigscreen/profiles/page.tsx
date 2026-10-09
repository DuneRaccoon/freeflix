'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usersService, type User } from '@/services/users';
import { getInitials, resolveAvatarSrc } from '@/lib/avatars/resolve';
import { useFocusGrid } from '../../_focus/useFocusGrid';
import { useBackKey } from '../../_focus/useBackKey';
import { useTvProfile } from '../../_data/useTvProfile';

/**
 * /bigscreen/profiles — "Who's watching?", and the D-pad passcode keypad for a locked one.
 *
 * Home's Continue Watching and My List call `{user_id}`-scoped endpoints, which answer
 * 403/404/423 until a profile is chosen, so this screen is what makes those rails exist.
 *
 * ONE FOCUS GRID AT A TIME. `useFocusGrid` listens on `window` and whichever instance
 * registered first claims an arrow, so two live grids leave the INCOMING one inert for as
 * long as the outgoing one is mounted. The profile grid and the keypad are therefore
 * separate components and the page renders one or the other, never both.
 *
 * BACK escalates: the keypad gives way to the profile grid, and the grid to home. The remote's
 * Back key and the keypad's own on-screen Back key run the same `leaveKeypad`. The on-screen
 * key stays because the remote key's identity on this device is unverified (see `useBackKey`).
 *
 * There is no "add a profile" here. Creating one needs text entry, which the web already
 * does well; the first place text entry is worth building on this surface is the search
 * keyboard in a later stage.
 */

const HOME = '/bigscreen';

/** Six 240px faces and their 48px gaps are 1680px, which fit the 1728px inside the safe area. */
const PER_ROW = 6;

/**
 * Web's fallback when the length is unknown (a code is 4 to 8 digits). A wrong guess here
 * would auto-submit at the wrong digit and the viewer could never type the real code, so
 * the page re-reads the list after a wrong attempt and adopts a different length.
 */
const FALLBACK_LENGTH = 4;

/**
 * How long "Loading profiles…" may stand before it gives way to the failed screen. `apiClient`
 * sets no timeout, so a hung request would otherwise leave a screen with nothing focusable on
 * it, which a remote cannot recover from.
 */
const LOAD_PATIENCE_MS = 10_000;

const statusOf = (err: unknown): number | undefined =>
  (err as { response?: { status?: number } } | null)?.response?.status;

const chunk = <T,>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

// --- profile grid -----------------------------------------------------------------

/** The avatar, or the monogram when it does not resolve or its image fails to load. */
function Face({ user }: { user: User }) {
  const src = resolveAvatarSrc(user.avatar);
  const [broken, setBroken] = useState(false);
  return (
    // aria-hidden: the visible name labels the button, and a monogram would read twice.
    <span className="bs-profile__face" aria-hidden="true">
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" onError={() => setBroken(true)} />
      ) : (
        getInitials(user.display_name)
      )}
    </span>
  );
}

function ProfileGrid({ users, onOpen }: { users: User[]; onOpen: (u: User) => void }) {
  // One container per row, and `.bs-profiles` does not wrap, so the rows the focus model
  // counts are the rows the viewer sees. (Chunking alone is not enough: a container that
  // wrapped would draw one chunk on two lines on a narrow viewport.)
  const rows = chunk(users, PER_ROW);
  // storageKey: coming back from the keypad (or from home, to switch profile) lands on the
  // profile the viewer was last on instead of the first one.
  const grid = useFocusGrid({ rowCounts: rows.map((r) => r.length), storageKey: 'profiles' });
  return (
    <>
      {rows.map((row, r) => (
        <div key={r} className="bs-profiles">
          {row.map((u, c) => (
            <button
              key={u.id}
              type="button"
              className="bs-profile"
              {...grid.focusProps(r, c)}
              onClick={() => onOpen(u)}
            >
              <Face user={u} />
              {/* A span, not the <p> the stylesheet was drawn for: a button may only hold phrasing content. */}
              <span className="bs-profile__name">{u.display_name}</span>
            </button>
          ))}
        </div>
      ))}
    </>
  );
}

// --- keypad ------------------------------------------------------------------------

/** 'wrong' is only ever 403/423; a throttle and an unreachable server are not a wrong code. */
type Outcome = 'ok' | 'wrong' | 'throttled' | 'error';

const MESSAGES: Record<Exclude<Outcome, 'ok'>, string> = {
  wrong: 'That code was not right',
  // A throttled sixth attempt is refused before the hash is checked. "Not right" would
  // tell someone their correct code is wrong.
  throttled: 'Too many attempts. Try again in a few minutes.',
  error: 'Could not check that code. Try again.',
};

async function tryUnlock(userId: string, code: string): Promise<Outcome> {
  try {
    await usersService.unlockProfile(userId, code);
    return 'ok';
  } catch (err) {
    const status = statusOf(err);
    if (status === 403 || status === 423) return 'wrong';
    if (status === 429) return 'throttled';
    return 'error';
  }
}

interface KeyDef {
  id: string;
  label: string;
  aria?: string;
}
const digit = (d: string): KeyDef => ({ id: d, label: d });
const BACK: KeyDef = { id: 'back', label: 'Back', aria: 'Back to profiles' };
const DEL: KeyDef = { id: 'del', label: 'Del', aria: 'Delete' };

/**
 * Phone order, with the bottom-left cell a real key rather than the web keypad's blank.
 * The focus model only knows "n items per row", so a blank would shift the bottom row's
 * columns and Down from `8` would land on Delete instead of `0`. A full 3x4 also gives
 * the viewer a way out that does not depend on the remote's own Back key being recognised.
 */
const KEY_ROWS: KeyDef[][] = [
  [digit('1'), digit('2'), digit('3')],
  [digit('4'), digit('5'), digit('6')],
  [digit('7'), digit('8'), digit('9')],
  [BACK, digit('0'), DEL],
];
const KEY_ROW_COUNTS = KEY_ROWS.map((r) => r.length);

function Keypad({
  length,
  attempt,
  onUnlocked,
  onBack,
}: {
  length: number;
  /** Resolves, never rejects. */
  attempt: (code: string) => Promise<Outcome>;
  onUnlocked: () => void;
  onBack: () => void;
}) {
  const grid = useFocusGrid({ rowCounts: KEY_ROW_COUNTS });
  // The digits live in a ref: only their COUNT is ever drawn, and a held-down key can
  // press twice before a re-render, which state read in a closure would drop.
  const entry = useRef('');
  const [filled, setFilled] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const checking = useRef(false);
  // Set in the effect rather than at declaration, so StrictMode's second mount revives it.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const submit = async (code: string) => {
    checking.current = true;
    const outcome = await attempt(code);
    // Back pressed while the request was out: the viewer has left, so do not take them home.
    if (!alive.current) return;
    // Stays frozen on success: the page is about to navigate.
    if (outcome === 'ok') {
      onUnlocked();
      return;
    }
    // Keep the keypad (and the focus on it): a viewer who mistyped wants to retype.
    entry.current = '';
    setFilled(0);
    setMessage(MESSAGES[outcome]);
    checking.current = false;
  };

  const press = (id: string) => {
    if (id === 'back') {
      onBack(); // allowed mid-check: apiClient has no timeout, so a hung request must not trap the viewer
      return;
    }
    // Ignored, not disabled: a disabled button drops DOM focus and a remote cannot get it back.
    if (checking.current) return;
    if (id === 'del') {
      entry.current = entry.current.slice(0, -1);
    } else {
      if (entry.current.length >= length) return;
      entry.current += id;
    }
    setFilled(entry.current.length);
    setMessage(null);
    // A remote has no comfortable "now press Enter", and the length is known.
    if (id !== 'del' && entry.current.length === length) void submit(entry.current);
  };

  return (
    <>
      <p className="bs-note">Enter your passcode</p>
      <div className="bs-dots" aria-hidden="true">
        {Array.from({ length }, (_, i) => (
          <span key={i} className={i < filled ? 'bs-dot bs-dot--on' : 'bs-dot'} />
        ))}
      </div>
      {/* Always mounted, so the live region exists before its text does, and reserving its
          line so the keys below do not jump under a focus ring when it fills. */}
      <p role="alert" className="bs-no bs-msg">{message}</p>
      <div className="bs-keypad">
        {KEY_ROWS.flatMap((row, r) =>
          row.map((k, c) => (
            <button
              key={k.id}
              type="button"
              className="bs-key"
              aria-label={k.aria}
              {...grid.focusProps(r, c)}
              onClick={() => press(k.id)}
            >
              {k.label}
            </button>
          )),
        )}
      </div>
    </>
  );
}

// --- page ---------------------------------------------------------------------------

type Opening = 'idle' | 'opening' | 'failed';

/**
 * The list is still loading. The 10s fall-through to the failed screen bounds how long this
 * lasts, but for those 10s a screen with no ring reads as a frozen television — and this was
 * the one state on the surface without a control. Home is always a valid destination.
 *
 * Its own `useFocusGrid`, the same way ProfileGrid and Keypad have theirs: exactly one of
 * the three is mounted at a time, which is what the hook's ownership rule requires.
 */
function LoadingWithWayOut() {
  const grid = useFocusGrid({ rowCounts: [1] });
  return (
    <>
      <p className="bs-note">Loading profiles…</p>
      <div className="bs-controls bs-inset">
        <Link href={HOME} className="bs-btn bs-btn--ghost" draggable={false} {...grid.focusProps(0, 0)}>
          Back to Home
        </Link>
      </div>
    </>
  );
}

export default function ProfilesPage() {
  const router = useRouter();
  // restore: false, because this screen fetches the profile list itself.
  const { select } = useTvProfile({ restore: false });

  const [users, setUsers] = useState<User[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloads, setReloads] = useState(0);
  // A retry the viewer pressed that has not been answered. The button they pressed STAYS
  // MOUNTED and only changes its label: unmounting the focused control drops DOM focus to
  // <body>, and with a hung backend nothing on screen would be focusable until the patience
  // timer fired (home's retry is the same shape; see its `Retry` type).
  const [retrying, setRetrying] = useState(false);
  const [locked, setLocked] = useState<{ user: User; length: number } | null>(null);
  const [opening, setOpening] = useState<Opening>('idle');
  // Which open() is current. A late answer for an earlier press, or for a screen the
  // viewer has left, is dropped instead of selecting a profile they have moved off.
  const latestOpen = useRef(0);
  useEffect(
    () => () => {
      latestOpen.current += 1;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    // Slow is failed, here: the retry control is the only way off a loading screen.
    const impatience = setTimeout(() => {
      if (cancelled) return;
      setRetrying(false);
      setLoadFailed(true);
    }, LOAD_PATIENCE_MS);
    usersService
      .getUsers()
      .then((list) => {
        if (cancelled) return;
        clearTimeout(impatience);
        // An answer that turns up after the failed screen went up wins over it.
        setLoadFailed(false);
        setRetrying(false);
        setUsers(list);
      })
      .catch(() => {
        if (cancelled) return;
        clearTimeout(impatience);
        setRetrying(false);
        setLoadFailed(true);
      });
    return () => {
      cancelled = true;
      clearTimeout(impatience);
    };
  }, [reloads]);

  const enter = useCallback(
    (user: User) => {
      select(user);
      // replace: Back from home must not land on the picker.
      router.replace(HOME);
    },
    [select, router],
  );

  const open = useCallback(
    async (user: User) => {
      const mine = ++latestOpen.current;
      setOpening('opening');
      // The profile-scoped call IS the lock check. 200 means open (never locked, or this
      // session already entered the code); 423 means locked. Reading `has_passcode` here
      // instead would not do: this very call is behind the lock, so it 423s for exactly
      // the profiles that need a keypad, and a profile with a dormant code (set, lock off)
      // would be asked for it needlessly.
      let outcome: 'open' | 'locked' | 'failed';
      try {
        await usersService.getUserSettings(user.id);
        outcome = 'open';
      } catch (err) {
        outcome = statusOf(err) === 423 ? 'locked' : 'failed';
      }
      if (mine !== latestOpen.current) return;

      if (outcome === 'open') {
        enter(user);
      } else if (outcome === 'locked') {
        setOpening('idle');
        // The 423 carries no settings, but the list this screen already holds does.
        setLocked({ user, length: user.settings?.passcode_len || FALLBACK_LENGTH });
      } else {
        setOpening('failed');
      }
    },
    [enter],
  );

  /**
   * After a wrong code, re-read the list and adopt a changed `passcode_len` for that profile
   * (and keep the refreshed list, so Back then OK does not reuse the stale one). The 423 that
   * opened the keypad has no body, so the length can only come from the list, and the list can
   * be older than the code: it was lengthened on the web while the TV sat on the picker.
   * Without this a six-digit code is auto-submitted at digit four, forever, each attempt
   * spending one of the five the server allows per five minutes.
   *
   * Not awaited by the keypad: a hung request must not freeze the message, and the answer
   * lands a round trip after it, many key presses before the digit that would use it.
   */
  const adoptCurrentLength = useCallback(async (id: string) => {
    let list: User[];
    try {
      list = await usersService.getUsers();
    } catch {
      return; // keep what is on screen
    }
    setUsers(list);
    const fresh = list.find((u) => u.id === id);
    const length = fresh?.settings?.passcode_len;
    if (!fresh || !length || length < 1) return;
    setLocked((cur) => (cur && cur.user.id === id && cur.length !== length ? { user: fresh, length } : cur));
  }, []);

  const retry = () => {
    if (retrying) return; // one request at a time; the button says it is working
    // Neither `loadFailed` nor `users` is cleared: whichever screen holds the button keeps
    // holding it until the answer (or the patience timer) replaces it. A stuck earlier
    // request is abandoned by the load effect's cleanup when `reloads` changes.
    setRetrying(true);
    setReloads((n) => n + 1);
  };

  const leaveKeypad = () => setLocked(null);

  // collapse -> leave: the keypad closes first, and only from the grid (or a loading, failed
  // or empty screen, which has nothing to collapse) does Back go home. `replace`, as in `enter`:
  // leaving is not somewhere to come back to, and home does not act on Back.
  useBackKey(() => {
    if (locked) {
      leaveKeypad();
    } else {
      // `replace` is a transition: this page stays mounted while it resolves, so an open()
      // still in flight would otherwise answer into it, `select()` a profile the viewer just
      // backed out of, and write it to localStorage where it outlives the app.
      latestOpen.current += 1;
      router.replace(HOME);
    }
  });

  let body: React.ReactNode;
  if (locked) {
    body = (
      <Keypad
        key={locked.user.id}
        length={locked.length}
        attempt={async (code) => {
          const outcome = await tryUnlock(locked.user.id, code);
          if (outcome === 'wrong') void adoptCurrentLength(locked.user.id);
          return outcome;
        }}
        onUnlocked={() => enter(locked.user)}
        onBack={leaveKeypad}
      />
    );
  } else if (loadFailed) {
    body = (
      <>
        <p role="alert" className="bs-no bs-msg">Could not load profiles.</p>
        <div className="bs-controls bs-inset">
          <button type="button" className="bs-btn" autoFocus onClick={retry}>
            {retrying ? 'Trying again…' : 'Try again'}
          </button>
        </div>
      </>
    );
  } else if (users === null) {
    body = <LoadingWithWayOut />;
  } else if (users.length === 0) {
    body = (
      <>
        <p className="bs-note">No profiles on this account yet. Create one in the Freeflix web app.</p>
        {/* Something focusable, or the remote has nothing to act on; and the profile may be
            created on a phone while the television waits. */}
        <div className="bs-controls bs-inset">
          <button type="button" className="bs-btn" autoFocus onClick={retry}>
            {retrying ? 'Checking…' : 'Check again'}
          </button>
        </div>
      </>
    );
  } else {
    // ABOVE the rows, and always mounted. Below them it is off the bottom of the scroller
    // once there are a few rows (focus in row 1 hides it), and mounting it only when it has
    // text would shove the whole grid down under the viewer's focus ring.
    // Above is better, not bulletproof: measured, it stays visible for up to 12 profiles
    // (two rows), and scrolls off the top only once focus reaches a third row. An account
    // with 13+ profiles would need this pinned to the scroller instead.
    const failed = opening === 'failed';
    body = (
      <>
        <p className={failed ? 'bs-no bs-msg' : 'bs-note bs-msg'} role={failed ? 'alert' : 'status'}>
          {opening === 'opening' ? 'Opening…' : failed ? 'Could not open that profile. Try again.' : null}
        </p>
        <ProfileGrid users={users} onOpen={(u) => void open(u)} />
      </>
    );
  }

  return (
    // .bs-shell, not .bs-page: every group here carries its own safe inset, and .bs-page
    // would apply it a second time. html and body cannot scroll, so this needs a scroller.
    <main className="bs-shell">
      <header className="bs-shell__head">
        <h1>{locked ? locked.user.display_name : 'Who’s watching?'}</h1>
      </header>
      <div className="bs-shell__scroll">{body}</div>
    </main>
  );
}
