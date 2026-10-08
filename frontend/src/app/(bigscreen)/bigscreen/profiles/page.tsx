'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usersService, type User } from '@/services/users';
import { getInitials, resolveAvatarSrc } from '@/lib/avatars/resolve';
import { useFocusGrid } from '../../_focus/useFocusGrid';
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
 * There is no "add a profile" here. Creating one needs text entry, which the web already
 * does well; the first place text entry is worth building on this surface is the search
 * keyboard in a later stage.
 */

const HOME = '/bigscreen';

/** `.bs-profiles` fits six 240px faces and their 48px gaps in the 1728px inside the safe area. */
const PER_ROW = 6;

/** Web's fallback when the length is unknown (a code is 4 to 8 digits). */
const FALLBACK_LENGTH = 4;

/**
 * `.bs-no`, `.bs-controls` and friends carry no side inset of their own (`.bs-note`,
 * `.bs-dots`, `.bs-keypad` and `.bs-profiles` do), and the screen sits in `.bs-shell`, not
 * the already-inset `.bs-page`, so anything built from them re-applies the safe area.
 */
const INSET = { padding: '0 var(--safe-x)' } as const;

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
  // One container per row, so the focus model's rows are the rendered rows whatever the
  // viewport width. A single wrapping container would let the browser re-flow them.
  const rows = chunk(users, PER_ROW);
  // storageKey: coming back from the keypad (or from home, to switch profile) lands on the
  // profile the viewer was last on instead of the first one.
  const grid = useFocusGrid({ rowCounts: rows.map((r) => r.length), storageKey: 'profiles' });
  return (
    <>
      {rows.map((row, r) => (
        // Padding top and bottom on every row: `.bs-shell__scroll` is a clipping scroller with no
        // top padding of its own, so without it the focused face's scale and ring are cut off
        // along the top edge. Two rows' worth of it is the 48px between them.
        <div key={r} className="bs-profiles" style={{ paddingTop: 24, paddingBottom: 24 }}>
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
              <span className="bs-profile__name" style={{ display: 'block' }}>{u.display_name}</span>
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
 * the viewer a way out: nothing here is bound to the remote's own Back key.
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
      <p role="alert" className="bs-no" style={{ ...INSET, minHeight: '1.45em' }}>{message}</p>
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

export default function ProfilesPage() {
  const router = useRouter();
  const { select } = useTvProfile();

  const [users, setUsers] = useState<User[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloads, setReloads] = useState(0);
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
    usersService
      .getUsers()
      .then((list) => {
        if (!cancelled) setUsers(list);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
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

  const retry = () => {
    setLoadFailed(false);
    setUsers(null);
    setReloads((n) => n + 1);
  };

  let body: React.ReactNode;
  if (locked) {
    body = (
      <Keypad
        key={locked.user.id}
        length={locked.length}
        attempt={(code) => tryUnlock(locked.user.id, code)}
        onUnlocked={() => enter(locked.user)}
        onBack={() => setLocked(null)}
      />
    );
  } else if (loadFailed) {
    body = (
      <>
        <p role="alert" className="bs-no" style={INSET}>Could not load profiles.</p>
        <div className="bs-controls" style={INSET}>
          <button type="button" className="bs-btn" autoFocus onClick={retry}>Try again</button>
        </div>
      </>
    );
  } else if (users === null) {
    body = <p className="bs-note">Loading profiles…</p>;
  } else if (users.length === 0) {
    body = <p className="bs-note">No profiles on this account yet. Create one in the Freeflix web app.</p>;
  } else {
    body = (
      <>
        <ProfileGrid users={users} onOpen={(u) => void open(u)} />
        {opening === 'opening' && (
          <p className="bs-note" role="status" style={{ marginTop: 8 }}>Opening…</p>
        )}
        {opening === 'failed' && (
          <p role="alert" className="bs-no" style={{ ...INSET, marginTop: 8 }}>
            Could not open that profile. Try again.
          </p>
        )}
      </>
    );
  }

  return (
    // .bs-shell, not .bs-page: see INSET. html and body cannot scroll, so the body needs a scroller.
    <main className="bs-shell">
      <header className="bs-shell__head">
        <h1>{locked ? locked.user.display_name : 'Who’s watching?'}</h1>
      </header>
      <div className="bs-shell__scroll">{body}</div>
    </main>
  );
}
