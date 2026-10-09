'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { watchlistService } from '@/services/watchlist';
import { Card } from '../../_components/Card';
import { LoadStatus } from '../../_components/LoadStatus';
import { LOCKED_NOTE, WAYS_OUT } from '../../_components/LockedRedirect';
import { chunk } from '../../_data/chunk';
import { statusOf } from '../../_data/httpStatus';
import { useTvProfile } from '../../_data/useTvProfile';
import { watchlistCards, type WatchlistCard } from '../../_data/watchlistRow';
import { useFocusGrid } from '../../_focus/useFocusGrid';
import { useBackKey } from '../../_focus/useBackKey';

/**
 * /bigscreen/list — My List, the whole of it.
 *
 * WHY IT EXISTS SEPARATELY FROM HOME'S RAIL. `GET /watchlist/{user}` answers at most 200
 * rows, newest first, with no paging, and home's rail shows `RAIL_CAP = 20` of them because
 * 150 anchors in one horizontal track is unusable on a remote. This screen is where the
 * rest of them live, so it applies no cap and wraps them into rows instead — and it is the
 * only place a title can be taken OFF the list from the television.
 *
 * REMOVAL IS A MODE, NOT A PER-CARD CONTROL. A remove button on each card would be a second
 * focus stop per card, so Left/Right would alternate card, remove, card, remove across a
 * row. Instead the action row carries one toggle and a card press means "remove" while it
 * is on. That keeps one focus stop per card either way, so the row counts stay simple — and
 * because a press that deletes when the viewer expected it to open is the worst thing this
 * screen can do, EVERY CARD is marked while the mode is on (the viewer's eye is on the card
 * they are about to press, not on the action row), the mode starts off on every arrival, and
 * a repeated press from a held OK button is dropped.
 *
 * ONE FOCUS GRID AT A TIME, one component per mutually exclusive state: `LoadStatus` (not
 * loaded yet, or failed), `NoProfile` and `ListGrid` each own theirs and the page renders
 * exactly one. `useFocusGrid` listens on `window` and whichever instance registered first
 * claims an arrow, so two live grids leave the INCOMING one inert. BACK is installed once,
 * here, for the same reason.
 *
 * A 423 IS NOT AN EMPTY LIST. The watchlist endpoints run `require_profile`, so a 423 means
 * the profile is passcode-locked: the stored profile is cleared and the viewer is sent to
 * the picker. Telling someone their list is empty when it is merely locked is a lie about
 * their data, and it gives them no reason to go and unlock it.
 */

const HOME = '/bigscreen';
const PROFILES = '/bigscreen/profiles';

/** Six 240px posters and their 24px gaps are 1560px, inside the 1728px the safe area leaves. */
const PER_ROW = 6;
/** Row 0 is the actions; the cards start below them. */
const FIRST_CARD_ROW = 1;
/**
 * `useFocusGrid`'s key, which it namespaces itself (`bs-focus:list`). Back on a detail
 * screen is `router.push('/bigscreen')`, so opening a title from here and coming back is a
 * fresh mount: without this the viewer would be returned to the first cell of a 200-item
 * grid. Every touch of `sessionStorage` is inside that hook, where each read and write is
 * already wrapped — it throws on access on a TV in a restricted mode and comes back empty
 * in a private window, and this screen renders the same either way.
 */
const FOCUS_KEY = 'list';

/** What every card says while the mode is on. */
const REMOVE_BADGE = 'Remove';

/**
 * The longest title this screen will quote back in a message. `.bs-msg` holds exactly one
 * line's height so the rows below it do not move when a message appears — which on a remote
 * reads as the screen shifting under you — and the failure note shares that line with the
 * hint that says what a press does. Worst case at this bound is ~121 characters, about
 * 1390px at the 24px UI face, inside the 1728px the safe area leaves.
 */
const TITLE_IN_MESSAGE = 40;

const clip = (title: string): string =>
  title.length > TITLE_IN_MESSAGE ? `${title.slice(0, TITLE_IN_MESSAGE).trimEnd()}…` : title;

type Load =
  | { phase: 'loading' }
  | { phase: 'failed' }
  | { phase: 'noProfile' }
  | { phase: 'ready'; rows: WatchlistCard[]; userId: string; loadId: number };

// --- there is no list to show -----------------------------------------------------

/**
 * A My List screen with no list behind it: nobody is watching yet, or the profile is locked.
 *
 * Both say something true and then offer the same two ways on, so they share one component.
 * Neither may read as an empty list, and neither offers a retry — there is nothing to retry,
 * and a control that is inert in the only state that renders it is a defect this project has
 * now shipped twice. The locked case in particular replaced a borrowed loading state that
 * said "Loading this list…" of a list it had already given up on, and then grew a `Try again`
 * after ten seconds whose handler the load effect refused.
 */
function NoList({ note }: { note: string }) {
  const grid = useFocusGrid({ rowCounts: [WAYS_OUT.length] });
  return (
    <main className="bs-shell">
      <header className="bs-shell__head">
        <h1>My List</h1>
      </header>
      <div className="bs-shell__scroll">
        <p role="status" className="bs-note">
          {note}
        </p>
        <div className="bs-controls bs-inset">
          {WAYS_OUT.map((way, c) => (
            <Link
              key={way.href}
              href={way.href}
              className={way.ghost ? 'bs-btn bs-btn--ghost' : 'bs-btn'}
              draggable={false}
              {...grid.focusProps(0, c)}
            >
              {way.label}
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}

const NO_PROFILE_NOTE = 'Nobody is watching yet. Choose a profile to see its list.';
// --- the list ---------------------------------------------------------------------

/**
 * The action row, derived so its declared count cannot drift from what it renders.
 *
 * The toggle is absent for an empty list: a control that offers to remove something when
 * there is nothing to remove is a focus stop whose press does nothing, which this surface's
 * rules forbid. The way home is always present, so no state here — not even the empty one,
 * and not the moment after the last card is removed — renders without a focus target.
 */
type ActionCell = 'toggle' | 'home';

function actionCellsFor(itemCount: number): ActionCell[] {
  return itemCount > 0 ? ['toggle', 'home'] : ['home'];
}

function ListGrid({
  rows,
  userId,
  onLocked,
}: {
  rows: readonly WatchlistCard[];
  userId: string;
  /** The profile is passcode-locked: clear it and send the viewer to the picker. */
  onLocked: () => void;
}) {
  // Seeded from the load, which is the only thing that replaces the whole list. The page
  // keys this component on its load id, so a fresh load reseeds it by remounting rather
  // than by a second source of truth — and that is also what makes the remove mode below
  // start off on every arrival, with nothing persisted anywhere that could ambush a viewer
  // with a screen where OK deletes.
  const [items, setItems] = useState<readonly WatchlistCard[]>(rows);
  const [removing, setRemoving] = useState(false);
  /** A one-line answer to something that just happened. Replaces the hint while it is set. */
  const [note, setNote] = useState<string | null>(null);

  // Read by the removal handlers, which are cached per cell and therefore outlive the
  // render that created them. Positional, like the cells: the handler for cell 3 removes
  // whatever is at index 3 NOW, which is the card the viewer can see under the ring.
  // A LAYOUT effect so the ref is current before any event can read it; making it passive
  // fails no test, because `remove` is only ever called from an event handler and effects
  // have flushed by then. Reasoned, not proven.
  const itemsRef = useRef(items);
  useLayoutEffect(() => {
    itemsRef.current = items;
  });

  // Set in an effect, not at declaration: StrictMode runs the cleanup once on mount, and a
  // ref initialised to true would then stay false for the real mount.
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * Which key is being held down right now, if any.
   *
   * A held key auto-repeats, and in remove mode every repeat would take another title off
   * the list — a DIFFERENT one each time, because the cards shift up under the ring. There
   * is no undo on this screen and no way to re-add a title from it. `useBackKey` refuses a
   * repeat for the same reason ("Back is an escalation"); this is the same rule for the one
   * press on this surface that destroys something.
   *
   * It identifies the key by `e.key` falling back to `e.keyCode`, the way `useBackKey` reads
   * both, because what this remote sends for OK is no better known than what it sends for
   * Back. The question itself needs no name — "is a key being held down?" — but the RELEASE
   * does: clearing on any `keyup` meant that releasing some unrelated key mid-hold ended the
   * latch and let the next repeat through.
   *
   * THREE THINGS CLEAR IT, because a latch that can only refuse is the safe direction right
   * up until it sticks. A keydown that is not a repeat clears it (so a discrete OK is never
   * refused); the matching keyup clears it; and `blur` / `visibilitychange` clear it, because
   * a keyup that never arrives — focus lost, the app backgrounded, a dropped IR repeat —
   * would otherwise latch it indefinitely. That matters because a magic-remote POINTER press
   * produces a click with no keydown of its own, so it inherits whatever the last keydown
   * left: without these, removal could stop working silently until a reload.
   *
   * The refusal is silent on purpose: the viewer's one intended press was already honoured,
   * and only its echoes are dropped.
   */
  const heldKey = useRef<string | null>(null);
  useEffect(() => {
    const nameOf = (e: KeyboardEvent) => e.key || String(e.keyCode);
    const down = (e: KeyboardEvent) => {
      heldKey.current = e.repeat ? nameOf(e) : null;
    };
    const up = (e: KeyboardEvent) => {
      if (heldKey.current === nameOf(e)) heldKey.current = null;
    };
    const release = () => {
      heldKey.current = null;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', release);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', release);
    };
  }, []);

  /**
   * Take the title at `flat` off the list.
   *
   * OPTIMISTIC, because the alternative on a 10-foot screen is a card that sits there for a
   * round trip looking unpressed. It goes back exactly where it was if the call fails, and
   * the failure is said out loud: silently doing nothing is the failure mode to avoid.
   *
   * A **404 counts as success** — the row is already gone, which is what the viewer asked
   * for — following `bigscreen/movie/[id]/page.tsx`, which treats 409-on-add the same way.
   * A **423** is the profile being locked, so it leaves the screen rather than reporting a
   * failed removal.
   *
   * Every POST-AWAIT mutation is behind the mounted latch, and every `setItems` is
   * functional: `apiClient` sets no timeout, so the window between the press and the answer
   * is unbounded, and two removals can be out at once — reading a captured snapshot of
   * `items` would make the second answer undo the first. The latch's observable half is the
   * locked answer: a 423 landing after the viewer has gone would clear the profile they
   * chose and pull them off whatever screen they went to. (A late `setItems` on an unmounted
   * component is NOT observable in React 19, so no test can prove that half.)
   *
   * There is no in-flight guard, deliberately: the optimistic update unmounts the card on
   * the first press, so there is no element left to press a second time.
   */
  const remove = useCallback(
    async (flat: number) => {
      if (heldKey.current !== null) return;
      const target = itemsRef.current[flat];
      if (!target) return;
      const { contentId } = target;
      setNote(null);
      setItems((prev) => prev.filter((w) => w.contentId !== contentId));

      let outcome: 'gone' | 'locked' | 'failed' = 'gone';
      try {
        await watchlistService.remove(userId, contentId);
      } catch (err) {
        const status = statusOf(err);
        outcome = status === 423 ? 'locked' : status === 404 ? 'gone' : 'failed';
      }
      // The viewer may have pressed Back while this was out. Acting now would pull them off
      // whatever screen they went to and, on a locked answer, forget the profile they had
      // selected — worse than a stray navigation, because it silently loses something.
      if (!alive.current) return;
      if (outcome === 'locked') {
        onLocked();
        return;
      }
      if (outcome === 'failed') {
        setItems((prev) => {
          const next = prev.slice();
          // Back at its own index, so a failed removal does not reorder the list under the
          // viewer. Clamped, because other removals may have landed in the meantime.
          next.splice(Math.min(flat, next.length), 0, target);
          return next;
        });
        setNote(`Couldn’t remove “${clip(target.card.title)}”. Try again.`);
      }
    },
    [userId, onLocked],
  );

  /**
   * One activation handler per cell, cached.
   *
   * `Card` compares `onActivate` by reference, so a handler rebuilt inline would lose the
   * memo for every card on the screen and make a single D-pad move re-render up to 200 of
   * them. Same cache shape as the focus hook's own per-cell props.
   *
   * The invalidation below DEFENDS A CASE NO TEST REACHES, and deleting it fails nothing:
   * `remove` is a `useCallback` over `userId` and `onLocked`, both stable for the life of
   * this component, so a cached handler cannot be holding a stale one today. It is kept
   * because the cache's correctness depends on that staying true, which nothing enforces.
   */
  const activators = useRef<{ fn: typeof remove; byIndex: Map<number, () => void> }>({
    fn: remove,
    byIndex: new Map(),
  });
  if (activators.current.fn !== remove) activators.current = { fn: remove, byIndex: new Map() };
  const activatorFor = (flat: number): (() => void) | undefined => {
    if (!removing) return undefined;
    let fn = activators.current.byIndex.get(flat);
    if (!fn) {
      fn = () => void remove(flat);
      activators.current.byIndex.set(flat, fn);
    }
    return fn;
  };

  const actions = actionCellsFor(items.length);
  const cardRows = chunk(items, PER_ROW);
  // Declared from the same two arrays the render below maps over.
  const { focused, focusProps, setFocus } = useFocusGrid({
    rowCounts: [actions.length, ...cardRows.map((r) => r.length)],
    storageKey: FOCUS_KEY,
  });

  /**
   * Put the ring somewhere real when the list shrinks under it.
   *
   * A removal unmounts the card the viewer was on, and an unmounted focused element drops
   * DOM focus to `<body>` — which on a remote, with no Tab key and no pointer, cannot be
   * recovered from. The target is the slot the ring was on, clamped to what is left: the
   * title that took the removed one's place, or the new last title.
   *
   * WHAT THIS ACTUALLY CHANGES, measured by deleting it rather than reasoned about. Of the
   * three ways the list can shrink under the ring, only ONE answer moves: the last card of
   * the last row, where the row stops existing and `useFocusGrid`'s `clampTarget` falls back
   * to `firstTarget` — so the ring would jump out of the cards and onto the action row.
   * A removal from the middle leaves the row merely shorter, which that same `clampTarget`
   * already handles by clamping the column, and it lands on the same cell this does. So
   * this is one load-bearing case plus a uniform rule, rather than three; what keeps the
   * EMPTY state focusable is not this effect but `actionCellsFor` always offering the way
   * home (deleting a cell from that count fails the empty-list tests).
   *
   * A LAYOUT effect, and declared after `useFocusGrid`: the hook's own layout effect
   * refreshes its row counts first, so `setFocus` is clamped against the NEW shape, and the
   * hook's reconciliation (a passive effect) then finds focus already on a valid cell and
   * leaves it alone. `focused` is still the pre-removal target at this point, which is
   * exactly the slot being asked about. Being a LAYOUT effect rather than a passive one is
   * reasoned, not proven: as a passive effect the hook's reconciliation simply runs first and
   * this corrects it to the same cell, so the destination is identical and only the number of
   * focus moves differs. Making it passive fails no test.
   */
  const cardCount = items.length;
  const previousCardCount = useRef(cardCount);
  useLayoutEffect(() => {
    const was = previousCardCount.current;
    previousCardCount.current = cardCount;
    if (cardCount >= was) return; // only a shrink can strand the ring
    if (cardCount === 0) {
      // The mode goes off with the last card. `actionCellsFor(0)` unmounts the toggle, so a
      // mode left on would have the status line telling the viewer to press a `Done` that is
      // not on the page — with no <button> anywhere for the ring to reach. Off is also the
      // right state if the removal then FAILS and the title comes back: a press opens it
      // rather than deleting it, and the missing badge says which it will be.
      setRemoving(false);
      // The toggle went with the last card, so (0, 0) is the way home: the empty state's
      // own focus target. Removing just this `setFocus` fails NO test — the hook's own
      // fallback reaches the same cell — and it stays for two reasons that are not coverage:
      // it says the target outright instead of inheriting a fallback, and it keeps the
      // arithmetic below away from a `cardCount - 1` of -1, which only happens to work.
      setFocus({ row: 0, col: 0 });
      return;
    }
    // The ring was on the action row, which a card going away cannot strand.
    if (focused.row < FIRST_CARD_ROW) return;
    const flat = (focused.row - FIRST_CARD_ROW) * PER_ROW + focused.col;
    const next = Math.min(flat, cardCount - 1);
    setFocus({ row: FIRST_CARD_ROW + Math.floor(next / PER_ROW), col: next % PER_ROW });
  }, [cardCount, focused, setFocus]);

  // While the mode is on, a failure is ADDED to the hint rather than replacing it: the
  // status line is the one line a viewer is most likely to read, and in remove mode it is the
  // line that says a press DELETES. Both fit on one line because the quoted title is clipped
  // (see TITLE_IN_MESSAGE) — `.bs-msg` holds one line's height so the rows below do not move
  // when a message appears.
  const hint = removing
    ? 'Press a title to remove it. Press Done to finish.'
    : items.length > 0
      ? `${items.length} ${items.length === 1 ? 'title' : 'titles'}. Press one to open it.`
      : '';
  const message = note ? (removing ? `${note} ${hint}` : note) : hint;

  return (
    // .bs-shell, not .bs-page: every group below carries its own safe inset, and html and
    // body cannot scroll, so this needs its own scroller.
    <main className="bs-shell">
      <header className="bs-shell__head">
        <h1>My List</h1>
      </header>
      <div className="bs-shell__scroll">
        {/* Always mounted, above the group it speaks for: .bs-msg holds one line's height so
            the rows below do not jump when a message appears, which on a remote reads as the
            screen moving under you. */}
        <p role="status" className={note ? 'bs-msg bs-list__fail' : 'bs-msg'}>
          {message}
        </p>
        <div className="bs-controls bs-inset">
          {actions.map((cell, c) =>
            cell === 'toggle' ? (
              <button
                key={cell}
                type="button"
                className="bs-btn bs-list__toggle"
                aria-pressed={removing}
                {...focusProps(0, c)}
                onClick={() => {
                  setNote(null);
                  setRemoving((on) => !on);
                }}
              >
                {removing ? 'Done' : 'Remove items'}
              </button>
            ) : (
              <Link key={cell} href={HOME} className="bs-btn bs-btn--ghost" draggable={false} {...focusProps(0, c)}>
                Back to home
              </Link>
            ),
          )}
        </div>
        {items.length === 0 && (
          <p className="bs-note">Nothing in My List yet. Open a title and press “Add to My List”.</p>
        )}
        <div className="bs-list__grid">
          {cardRows.map((row, r) => (
            // One container per row, no wrap: the rows the focus model counts are the rows
            // the viewer sees.
            <div key={r} className="bs-list__row">
              {row.map((entry, c) => (
                <Card
                  // By INDEX, never by content id: a list that re-keyed the focused cell
                  // would unmount it and drop DOM focus to <body>.
                  key={c}
                  item={removing ? { ...entry.card, badge: REMOVE_BADGE } : entry.card}
                  shape="poster"
                  focusProps={focusProps(FIRST_CARD_ROW + r, c)}
                  onActivate={activatorFor(r * PER_ROW + c)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

// --- the screen -------------------------------------------------------------------

export default function MyListPage() {
  const router = useRouter();
  const { profile, loading: profileLoading, clear } = useTvProfile();
  const profileId = profile?.id ?? null;
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // Latched once a lock sends the viewer to the picker. `clear()` changes `profileId`, which
  // would otherwise re-run the load as "nobody" and paint the no-profile screen for a
  // moment before the replace lands.
  const [redirecting, setRedirecting] = useState(false);

  useBackKey(useCallback(() => router.push(HOME), [router]));

  /** A 423 means the profile is passcode-locked: forget it and send the viewer to pick again. */
  const sentToPicker = useCallback(() => {
    setRedirecting(true);
    clear();
    router.replace(PROFILES);
  }, [clear, router]);

  /**
   * Which load is current. A stale answer must never land: `apiClient` sets no timeout, so
   * a load the viewer gave up on and retried can answer long afterwards, and this project
   * has already shipped the other shape once (stage 4's `fetchRail` turned any failure into
   * an empty rail, so a hung request erroring after a successful retry wiped the hero).
   */
  const generation = useRef(0);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    // The stored profile is read asynchronously; asking before it lands would ask as nobody.
    if (profileLoading || redirecting) return;
    if (!profileId) {
      setLoad({ phase: 'noProfile' });
      return;
    }
    const mine = ++generation.current;
    setLoad({ phase: 'loading' });
    void (async () => {
      // `locked` is not a render phase: it is an instruction to leave, and the screen keeps
      // showing the loading state (with its focus target) until the replace lands.
      let next: Load | { phase: 'locked' };
      try {
        const answer = await watchlistService.list(profileId);
        // "Nothing in My List yet" is a claim about the viewer's data, and a body this
        // screen could not read is no evidence for it — so a junk 200 reads as a failure,
        // which is retryable, rather than as an empty list, which is a lie. This cannot be
        // left to `watchlistCards`: a STRING is iterable, so a `"not an array"` body walks
        // its characters and quietly yields nothing. Measured, not assumed — that is what
        // the first version of this did.
        if (!Array.isArray(answer)) throw new Error('watchlist: not an array');
        next = { phase: 'ready', rows: watchlistCards(answer), userId: profileId, loadId: mine };
      } catch (err) {
        next = statusOf(err) === 423 ? { phase: 'locked' } : { phase: 'failed' };
      }
      if (!alive.current || mine !== generation.current) return;
      if (next.phase === 'locked') sentToPicker();
      else setLoad(next);
    })();
  }, [profileId, profileLoading, redirecting, attempt, sentToPicker]);

  const retry = () => {
    setLoad({ phase: 'loading' });
    setAttempt((a) => a + 1);
  };

  // `redirecting` first and on its own: it is the one state that must not borrow any of the
  // others. Reusing `LoadStatus` here claimed to be loading a list this screen had already
  // given up on, and after ten seconds offered a `Try again` that the load effect refuses
  // (it returns early on `redirecting`), so the label cycled forever and nothing was asked.
  if (redirecting) return <NoList note={LOCKED_NOTE} />;
  if (load.phase === 'noProfile') return <NoList note={NO_PROFILE_NOTE} />;
  if (load.phase === 'ready') {
    return (
      <ListGrid key={load.loadId} rows={load.rows} userId={load.userId} onLocked={sentToPicker} />
    );
  }
  return <LoadStatus noun="list" failed={load.phase === 'failed'} onRetry={retry} />;
}
