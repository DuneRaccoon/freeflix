'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CatalogItem } from '@/types';
import { Hero } from '../_components/Hero';
import { Rail, railCellCount, type RailModel } from '../_components/Rail';
import { readStored, useFocusGrid, type FocusProps } from '../_focus/useFocusGrid';
import { useBackKey } from '../_focus/useBackKey';
import { TV_RAILS, fetchRail, type CatalogRail, type TvRailSpec } from '../_data/rails';
import { fetchContinueWatching, fetchMyList, type ProfileRail } from '../_data/continueWatching';
import { useTvProfile } from '../_data/useTvProfile';

/**
 * /bigscreen — the home screen.
 *
 * THE LOADING STRATEGY IS THE POINT. The web fires 16 catalog calls in two sequential waves
 * and shows a skeleton until both settle; there is no progressive paint to inherit. Here:
 *   1. On mount, ONLY the first rail (`trending`) is fetched. The hero and that rail paint
 *      the moment it resolves: two requests, not sixteen.
 *   2. Every other rail is a skeleton that holds its place, fetched the first time it comes
 *      within `LOOKAHEAD` of the scroller, and never again. No `IntersectionObserver` means
 *      no laziness (everything is fetched at once), not a crash.
 *   3. Continue Watching and My List are fetched only when a profile is chosen.
 *   4. Nothing polls. The web's 15s activity count is deliberately not here (spec §9), and
 *      this file starts no timer and no interval.
 *
 * EVERY RAIL RESOLVES ON ITS OWN. `apiClient` sets no timeout, so a `Promise.all` of the
 * rails would hold the whole screen as skeletons, with nothing to focus, for as long as the
 * slowest one took. Each fetch writes its own slot when it lands.
 *
 * A RESULT REPLACES ITS PLACEHOLDER; it is never spread over it. `{ ...placeholder, ...rail }`
 * would keep `loading: true` and `railCellCount` would report no focusable cells for a full
 * rail. And nothing here sets `loading` back to true on a rail that has items: `Rail` lets
 * loading win over items, so a refetch would blank the rail and teleport focus.
 *
 * THE GRID. Row 0 is the recovery row, row 1 the hero, rows 2.. the rails in lineup order.
 * Every count comes from `railCellCount`, never `items.length`. Continue Watching and My
 * List own fixed slots straight after trending whether or not they have anything, so a row
 * index means the same rail on every visit and the saved `home` position cannot slide onto a
 * neighbour when a watch history appears.
 *
 * NOTHING MAY BE LEFT WITHOUT A FOCUS STOP, AND FOCUS STARTS AT THE TOP. There is no Tab key
 * and no pointer on this device, so a screen with nothing focusable cannot be recovered
 * from. Until the first rail has answered, and for as long as no rail has a card (first
 * paint, everything failed), the hero's slot shows a status panel whose controls are row 0.
 * Row 0 is populated for exactly that long, which also pins focus to the top of the screen:
 * the grid puts focus on the first populated row, so a rail that beats the first rail to the
 * screen (a profile rail, or one inside the lookahead) would otherwise take focus and scroll
 * the page down to itself before the hero had been drawn. When the first rail answers, row 0
 * empties; the panel's focused control unmounts in that same commit, so DOM focus is on
 * `<body>`, and the grid's reconciliation moves it to the first populated row. A viewer who
 * has already pressed Down is on a populated row, and stays there.
 *
 * A LOCKED PROFILE. `useTvProfile` trusts a stored profile id without checking it. The first
 * profile-scoped call that comes back 423 means the passcode was never entered on this
 * session, so the stored choice is forgotten and the viewer sent to pick again. The fetchers
 * resolve empty on a refusal, so they report the lock as `locked`; an empty rail is NOT read
 * as one, because a profile with no history looks exactly the same.
 */

const PROFILES = '/bigscreen/profiles';

/**
 * BACK on home does nothing, on purpose. Home is the root of this surface; leaving the app is
 * the shell's job in a later stage, and a `window.close()` from a browser tab does nothing
 * useful. The hook is still installed, so the press is claimed rather than handed to the
 * browser, which can walk history to wherever this page was entered from (the picker
 * replaces itself with home, so that is often another copy of this screen). Walking out of
 * (bigscreen) into the web app is unrecoverable on this device: a remote cannot type a URL.
 *
 * STAGE 10 OWES THIS A REAL ANSWER. Inside the webOS shell, Back at the root is how a viewer
 * expects to leave an app, and swallowing it means they cannot. The shell is the only place
 * that can exit cleanly, so it should replace `stayOnHome` with its own handler.
 */
const stayOnHome = () => {};

/** Fetch a rail this far before it scrolls into view: a screenful and a bit at 1080p. */
const LOOKAHEAD = '600px 0px';

/** `useFocusGrid`'s key, and the one `savedCatalogSpec` asks it about. */
const STORAGE_KEY = 'home';

const RECOVERY_ROW = 0;
/** How long the panel waits before offering a retry it cannot yet justify. `apiClient`
 *  sets no timeout, so without this a hung first rail reads "Loading…" forever. */
const LOAD_PATIENCE_MS = 10_000;
const HERO_ROW = 1;
const FIRST_RAIL_ROW = 2;

const CONTINUE_ID = 'continue-watching';
const LIST_ID = 'my-list';

/** A profile rail slot with nothing in it. `Rail` draws nothing for it and it has no cells. */
const absent = (id: string): RailModel => ({ key: id, title: '', shape: 'poster', items: [], loading: false });

/** A catalog rail's skeleton: it holds its place and contributes no focusable cells. */
const skeleton = (spec: TvRailSpec): RailModel => ({
  key: spec.key,
  title: spec.title,
  eyebrow: spec.eyebrow,
  shape: spec.shape,
  items: [],
  loading: true,
});

/** What a rail becomes if its fetch rejects, which the data layer promises it never does. */
const failed = (spec: TvRailSpec): CatalogRail => ({ ...skeleton(spec), loading: false, lead: null });

interface Slot {
  /** The rail's key; also the `data-rail` the observer finds its wrapper by. */
  id: string;
  /** Null for the two profile slots, which are fetched by the profile effect. */
  spec: TvRailSpec | null;
  placeholder: RailModel;
}

const LEAD = TV_RAILS[0];
const REST = TV_RAILS.slice(1);

/** Trending, then the two profile slots, then everything else. */
const LINEUP: readonly Slot[] = [
  { id: LEAD.key, spec: LEAD, placeholder: skeleton(LEAD) },
  { id: CONTINUE_ID, spec: null, placeholder: absent(CONTINUE_ID) },
  { id: LIST_ID, spec: null, placeholder: absent(LIST_ID) },
  ...REST.map((spec): Slot => ({ id: spec.key, spec, placeholder: skeleton(spec) })),
];

const SPEC_BY_KEY = new Map(TV_RAILS.map((spec) => [spec.key, spec]));

type Settled = Readonly<Record<string, RailModel>>;

/** `settled` without the given keys, or the same object when none of them is in it. */
function without(settled: Settled, keys: readonly string[]): Settled {
  if (!keys.some((k) => k in settled)) return settled;
  const next = { ...settled };
  for (const k of keys) delete next[k];
  return next;
}

/** The catalog rail the viewer last stood on, when the saved position is on one. */
function savedCatalogSpec(): TvRailSpec | null {
  const saved = readStored(STORAGE_KEY);
  return saved ? (LINEUP[saved.row - FIRST_RAIL_ROW]?.spec ?? null) : null;
}

/**
 * Shown in the hero's place until a rail has something to show. It exists so that the
 * screen is never without a focus stop; see the file comment.
 */
function StatusPanel({
  nothingToShow,
  showRetry,
  retrying,
  autoFocusRetry,
  onRetry,
  focusPropsFor,
}: {
  /** Every rail has answered and none had a card. */
  nothingToShow: boolean;
  showRetry: boolean;
  /** A retry is in flight; the label says so rather than inviting another press. */
  retrying: boolean;
  /** Take DOM focus on mount. Only true when focus is already on this row. */
  autoFocusRetry: boolean;
  onRetry: () => void;
  focusPropsFor: (row: number, col: number) => FocusProps;
}) {
  return (
    <div className="bs-hero">
      <div className="bs-hero__body">
        {nothingToShow ? (
          <>
            <h2 className="bs-hero__title">Nothing to show right now</h2>
            <p role="alert" className="bs-hero__overview">
              Freeflix could not load any titles. Check that the server is reachable, then try again.
            </p>
          </>
        ) : (
          <p role="status" className="bs-hero__meta">
            Loading…
          </p>
        )}
        <div className="bs-controls">
          {showRetry && (
            // autoFocus, because this arrives while focus is on the link beside it: the link
            // slides from column 0 to 1 as this takes column 0, and the grid's target (0, 0)
            // has not changed, so nothing else would move DOM focus onto the new cell 0.
            // A press while a retry is in flight does nothing rather than unmounting the
            // button: an unmounted focused control drops DOM focus to <body>.
            <button
              type="button"
              className="bs-btn"
              autoFocus={autoFocusRetry}
              {...focusPropsFor(RECOVERY_ROW, 0)}
              onClick={onRetry}
            >
              {retrying ? 'Trying again…' : 'Try again'}
            </button>
          )}
          <Link
            href={PROFILES}
            className="bs-btn bs-btn--ghost"
            draggable={false}
            {...focusPropsFor(RECOVERY_ROW, showRetry ? 1 : 0)}
          >
            Who’s watching?
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { profile, loading: profileLoading, clear } = useTvProfile();
  const profileId = profile?.id ?? null;
  useBackKey(stayOnHome);

  // One entry per rail that has answered, keyed by slot id. A missing key is a placeholder.
  const [settled, setSettled] = useState<Settled>({});
  // The catalog row behind the first rail's first card: what the hero draws.
  const [lead, setLead] = useState<CatalogItem | null>(null);
  // How many times the viewer has pressed Try again; only its being non-zero is read.
  const [attempts, setAttempts] = useState(0);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const observer = useRef<IntersectionObserver | null>(null);
  /** Rails whose fetch has been issued. A rail is fetched once. */
  const started = useRef(new Set<string>());
  // Set in the effect rather than at declaration, so StrictMode's second mount revives it.
  const alive = useRef(true);

  const begin = useCallback((spec: TvRailSpec) => {
    if (started.current.has(spec.key)) return;
    started.current.add(spec.key);
    const wrapper = scrollerRef.current?.querySelector(`[data-rail="${spec.key}"]`);
    if (wrapper) observer.current?.unobserve(wrapper);

    const land = (rail: CatalogRail) => {
      if (!alive.current) return;
      // Replaced wholesale. `lead` rides along inside the rail and is read out separately.
      setSettled((prev) => ({ ...prev, [spec.key]: rail }));
      if (spec.key === LEAD.key) setLead(rail.lead);
    };
    fetchRail(spec).then(land, () => land(failed(spec)));
  }, []);

  /** Fetch these rails when they near the viewport, or now when nothing can watch for that. */
  const watch = useCallback(
    (specs: readonly TvRailSpec[]) => {
      for (const spec of specs) {
        if (started.current.has(spec.key)) continue;
        const wrapper = scrollerRef.current?.querySelector(`[data-rail="${spec.key}"]`);
        if (observer.current && wrapper) observer.current.observe(wrapper);
        else begin(spec);
      }
    },
    [begin],
  );

  useEffect(() => {
    alive.current = true;

    if (typeof IntersectionObserver !== 'undefined') {
      try {
        observer.current = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              const spec = SPEC_BY_KEY.get(entry.target.getAttribute('data-rail') ?? '');
              if (spec) begin(spec);
            }
          },
          { root: scrollerRef.current, rootMargin: LOOKAHEAD },
        );
      } catch {
        // An engine that has the name but not the options: eager is the safe fallback.
        observer.current = null;
      }
    }

    begin(LEAD);
    // The row the viewer last stood on is usually far below the lookahead, and the grid
    // holds a saved position until its row has cards. Fetch that one rail up front or the
    // restore never completes. (The rails between stay skeletons until scrolled to.)
    const saved = savedCatalogSpec();
    if (saved) begin(saved);
    watch(REST);

    return () => {
      alive.current = false;
      observer.current?.disconnect();
      observer.current = null;
    };
  }, [begin, watch]);

  // Latest router and clear, so the effect below depends on the profile alone. Neither is
  // guaranteed stable, and an effect that re-ran per render would cancel its own fetches.
  const leaveRef = useRef<() => void>(() => {});
  useEffect(() => {
    leaveRef.current = () => {
      clear();
      router.replace(PROFILES);
    };
  });

  // The profile's own rails. Each lands in its own slot as soon as it can.
  useEffect(() => {
    if (profileLoading) return;
    // A different (or no) profile: the previous one's rails must not sit under it.
    setSettled((prev) => without(prev, [CONTINUE_ID, LIST_ID]));
    if (!profileId) return;

    let cancelled = false;
    let leaving = false;
    const fetchInto = (id: string, call: (deps: { userId: string }) => Promise<ProfileRail>) => {
      const land = (rail: ProfileRail | null) => {
        if (cancelled || leaving) return;
        if (rail?.locked) {
          leaving = true;
          leaveRef.current();
          return;
        }
        setSettled((prev) => ({ ...prev, [id]: rail ?? absent(id) }));
      };
      call({ userId: profileId }).then(land, () => land(null));
    };
    fetchInto(CONTINUE_ID, fetchContinueWatching);
    fetchInto(LIST_ID, fetchMyList);
    return () => {
      cancelled = true;
    };
  }, [profileLoading, profileId]);

  const rails = useMemo(() => LINEUP.map((slot) => settled[slot.id] ?? slot.placeholder), [settled]);

  // A skeleton is shorter than the rail that replaces it (its label and subtitle are not
  // reserved), so a rail that fills in ABOVE the focused card pushes the card down, and
  // nothing scrolls it back: the focus hook scrolls when focus moves, not when layout does.
  // It shows after a restore, which jumps far down the page and then loads the rails around
  // the target. Only an element that has actually left the scrollport is scrolled, so the
  // common case (a rail landing below the viewer) does nothing at all.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const el = document.activeElement;
    if (!scroller || !(el instanceof HTMLElement) || !scroller.contains(el)) return;
    const [box, view] = [el.getBoundingClientRect(), scroller.getBoundingClientRect()];
    if (box.bottom > view.bottom || box.top < view.top) {
      el.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }, [settled]);

  // The hero is a cell only while its rail has cards, so what is drawn and what is counted
  // cannot disagree.
  const heroItem = lead && railCellCount(rails[0]) > 0 ? lead : null;
  const noCards = rails.every((rail) => railCellCount(rail) === 0);
  const leadPending = !(LEAD.key in settled);
  const catalogSettled = TV_RAILS.every((spec) => spec.key in settled);
  // Every catalog rail has answered and none had a card. Profile rails are not waited for:
  // a hung watchlist must not keep "try again" off a screen that has nothing else.
  const nothingToShow = noCards && catalogSettled;
  const [impatient, setImpatient] = useState(false);
  // ...or the first rail has simply taken too long. `catalogSettled` can never become true
  // while a request hangs, so waiting for it would leave the panel reading "Loading…" with
  // no way to act. The retry is offered on patience as well as on proof.
  const showRetry = nothingToShow || attempts > 0 || impatient;
  useEffect(() => {
    if (!leadPending) {
      setImpatient(false);
      return;
    }
    const timer = setTimeout(() => setImpatient(true), LOAD_PATIENCE_MS);
    return () => clearTimeout(timer);
  }, [leadPending, attempts]);
  // The panel holds the hero's place until there is a hero, or a reason there will not be.
  const showPanel = leadPending || noCards;
  const recoveryCount = showPanel ? (showRetry ? 2 : 1) : 0;

  const grid = useFocusGrid({
    rowCounts: [recoveryCount, heroItem ? 1 : 0, ...rails.map(railCellCount)],
    storageKey: STORAGE_KEY,
  });

  const retry = () => {
    // Ignore a second press while a retry is already in flight. NOT `!nothingToShow`:
    // `nothingToShow` requires every catalog rail to have ANSWERED, which can never happen
    // while one hangs — i.e. exactly the state the patience button exists for, where that
    // guard swallowed every press. The hung request is not aborted, so a retry can leave
    // two in flight for the same rail; both call `land` and the last writer wins, which is
    // harmless because they carry the same payload.
    if (attempts > 0 && leadPending) return;
    // Only rails with no cards are reset, and here that is all of them. A rail that has
    // items is never put back to loading: that would blank it and drop its focus.
    const empties = TV_RAILS.filter((spec) => railCellCount(settled[spec.key] ?? skeleton(spec)) === 0);
    for (const spec of empties) started.current.delete(spec.key);
    setSettled((prev) => without(prev, empties.map((spec) => spec.key)));
    setLead(null);
    setAttempts((n) => n + 1);
    if (empties.includes(LEAD)) begin(LEAD);
    watch(empties.filter((spec) => spec !== LEAD));
  };

  let top: React.ReactNode = null;
  if (heroItem) {
    top = <Hero item={heroItem} focusProps={grid.focusProps(HERO_ROW, 0)} href={rails[0].items[0]?.href} />;
  } else if (showPanel) {
    // The same height as the hero it holds the place of, so rails that have already landed
    // do not jump down when the hero arrives.
    top = (
      <StatusPanel
        nothingToShow={nothingToShow}
        showRetry={showRetry}
        retrying={attempts > 0 && leadPending}
        // Only claim focus if the viewer is already on this row. On the patience path other
        // rails have usually landed and the viewer may be in one of them; stealing focus
        // there would jump the page to the top, cancel a pending restore, and overwrite the
        // saved position with the recovery row.
        autoFocusRetry={grid.focused.row === RECOVERY_ROW}
        onRetry={retry}
        focusPropsFor={grid.focusProps}
      />
    );
  }

  return (
    // .bs-shell, not .bs-page: html and body cannot scroll, so the scroller is its own box.
    <main className="bs-shell">
      <header className="bs-shell__head">
        <h1>Freeflix</h1>
      </header>
      <div className="bs-shell__scroll" ref={scrollerRef}>
        {top}
        {LINEUP.map((slot, i) => (
          // The observer watches this wrapper, not the rail: `Rail` renders nothing at all
          // for an empty rail, and an element with no box has no position to approach.
          <div key={slot.id} data-rail={slot.id}>
            <Rail rail={rails[i]} row={FIRST_RAIL_ROW + i} focusPropsFor={grid.focusProps} />
          </div>
        ))}
      </div>
    </main>
  );
}
