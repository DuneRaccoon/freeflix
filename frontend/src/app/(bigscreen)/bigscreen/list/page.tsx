'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { watchlistService } from '@/services/watchlist';
import { Card } from '../../_components/Card';
import { LoadStatus } from '../../_components/LoadStatus';
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

type Load =
  | { phase: 'loading' }
  | { phase: 'failed' }
  | { phase: 'noProfile' }
  | { phase: 'ready'; rows: WatchlistCard[]; userId: string; loadId: number };

// --- nobody is watching -----------------------------------------------------------

/**
 * No profile is selected, which is not the same as an empty list and must not read like
 * one. `useTvProfile` only remembers a choice; it is the profiles screen that makes one.
 */
function NoProfile() {
  const grid = useFocusGrid({ rowCounts: [2] });
  return (
    <main className="bs-shell">
      <header className="bs-shell__head">
        <h1>My List</h1>
      </header>
      <div className="bs-shell__scroll">
        <p className="bs-note">Nobody is watching yet. Choose a profile to see its list.</p>
        <div className="bs-controls bs-inset">
          <Link href={PROFILES} className="bs-btn" draggable={false} {...grid.focusProps(0, 0)}>
            Who’s watching?
          </Link>
          <Link href={HOME} className="bs-btn bs-btn--ghost" draggable={false} {...grid.focusProps(0, 1)}>
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}

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
   * Was the most recent key press a repeat?
   *
   * A held key auto-repeats, and in remove mode every repeat would take another title off
   * the list — a DIFFERENT one each time, because the cards shift up under the ring. There
   * is no undo on this screen and no way to re-add a title from it. `useBackKey` refuses a
   * repeat for the same reason ("Back is an escalation"); this is the same rule for the one
   * press on this surface that destroys something.
   *
   * It latches the latest keydown rather than one named key: what this remote sends for OK
   * is no better known than what it sends for Back, and the question asked here — "is a key
   * being held down right now?" — needs no name. `keyup` clears it so a pointer press that
   * follows a held arrow is not refused. The refusal is silent on purpose: the viewer's one
   * intended press was already honoured, and only its echoes are dropped.
   */
  const heldKey = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      heldKey.current = e.repeat;
    };
    const up = () => {
      heldKey.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
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
      if (heldKey.current) return;
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
        setNote(`Couldn’t remove “${target.card.title}”. Try again.`);
      }
    },
    [userId, onLocked],
  );

  /**
   * One activation handler per cell, cached.
   *
   * `Card` compares `onActivate` by reference, so a handler rebuilt inline would lose the
   * memo for every card on the screen and make a single D-pad move re-render up to 200 of
   * them. Same cache shape as the focus hook's own per-cell props, invalidated only if
   * `remove`'s identity changes.
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
   * exactly the slot being asked about.
   */
  const cardCount = items.length;
  const previousCardCount = useRef(cardCount);
  useLayoutEffect(() => {
    const was = previousCardCount.current;
    previousCardCount.current = cardCount;
    if (cardCount >= was) return; // only a shrink can strand the ring
    if (cardCount === 0) {
      // The toggle went with the last card, so (0, 0) is the way home: the empty state's
      // own focus target. Removing this branch fails NO test — the hook's own fallback
      // reaches the same cell — and it stays for two reasons that are not coverage: it
      // says the target outright instead of inheriting a fallback, and it keeps the
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

  const hint = removing
    ? 'Press a title to remove it from My List. Press Done when you have finished.'
    : items.length > 0
      ? `${items.length} ${items.length === 1 ? 'title' : 'titles'}. Press one to open it.`
      : '';

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
          {note ?? hint}
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

  if (!redirecting && load.phase === 'noProfile') return <NoProfile />;
  if (!redirecting && load.phase === 'ready') {
    return (
      <ListGrid key={load.loadId} rows={load.rows} userId={load.userId} onLocked={sentToPicker} />
    );
  }
  return <LoadStatus noun="list" failed={load.phase === 'failed' && !redirecting} onRetry={retry} />;
}
