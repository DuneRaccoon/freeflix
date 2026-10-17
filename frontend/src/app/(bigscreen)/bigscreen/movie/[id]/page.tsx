'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { MovieDetail } from '@/types';
import { moviesService } from '@/services/movies';
import { watchlistService } from '@/services/watchlist';
import { buildContentId } from '@/lib/contentId';
import { atSize } from '../../../_components/Hero';
import { PrimaryAction } from '../../../_components/PrimaryAction';
import { LoadStatus } from '../../../_components/LoadStatus';
import { LockedRedirect } from '../../../_components/LockedRedirect';
import { TitleScreen } from '../../../_components/TitleScreen';
import { statusOf } from '../../../_data/httpStatus';
import { titleStateFor, type TitleAction, type TitleState } from '../../../_data/title';
import { useTvProfile, type TvProfile } from '../../../_data/useTvProfile';
import { useFocusGrid } from '../../../_focus/useFocusGrid';
import { useBackKey } from '../../../_focus/useBackKey';

/**
 * /bigscreen/movie/[id] — the movie detail screen.
 *
 * TWO CALLS, ONE LOAD. The detail comes from `getDetail(id, { withQualities: false })` and
 * the title's state from `titleStateFor`. The cheap form matters: the web's equivalent
 * screen runs three identical server-side torrent searches per load, each up to ~35s cold,
 * and this surface needs none of them: it builds no quality picker, and the per-title 4K
 * opt-in below chooses between two FIXED asks (1080p, 2160p) rather than listing what exists.
 * Consequence: `available_qualities` is `[]` here, so nothing below reads it — which is also
 * why the 4K cell is worded as a REQUEST ("Ask for 4K") and never as a result. This screen
 * cannot know whether a 2160p release exists for this title; answering that would cost the
 * cold search this paragraph exists to avoid, and the answer would be health-blind anyway.
 *
 * A FAILED PLAY IS VISIBLE. This surface mounts no toaster, so the web's toast-and-swallow
 * start helper would fail silently on a television. `PrimaryAction` prints the reason beside
 * the control instead.
 *
 * ONE FOCUS GRID AT A TIME, one component per mutually exclusive state: `LoadStatus` (not
 * loaded yet, or failed) and `Loaded` each own theirs and the page renders exactly one.
 * Every state has a focus target, because a remote has no Tab key and no pointer, and a
 * ringless screen cannot be recovered from. BACK is installed once, here.
 */

const HOME = '/bigscreen';
const PROFILES = '/bigscreen/profiles';

type Load =
  | { phase: 'loading' }
  | { phase: 'failed' }
  | { phase: 'ready'; detail: MovieDetail; state: TitleState };

function eyebrowOf(d: MovieDetail): string | null {
  const parts: string[] = [];
  if (d.year) parts.push(String(d.year));
  if (d.runtime && d.runtime > 0) {
    const h = Math.floor(d.runtime / 60);
    const m = d.runtime % 60;
    parts.push(h > 0 ? `${h}h ${m}m` : `${m}m`);
  }
  return parts.length ? parts.join(' · ') : null;
}

type ListLabel = 'Add to My List' | '✓ In My List' | 'Saving…' | 'Removing…';

/** My List for one movie. Optimistic: the label flips at once and reverts if the call fails. */
function useMyList(profileId: string | null, detail: MovieDetail) {
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const pendingRef = useRef(false);
  const touched = useRef(false);
  const contentId = buildContentId({ kind: 'movie', tmdbId: detail.tmdb_id });

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    watchlistService
      .list(profileId)
      .then((rows) => {
        // A press that beat the list to the screen is newer than it.
        if (!cancelled && !touched.current) setSaved(rows.some((r) => r.content_id === contentId));
      })
      .catch(() => {
        /* unknown stays "not saved"; adding an existing item answers 409, which counts as saved */
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, contentId]);

  const toggle = async () => {
    if (!profileId || pendingRef.current) return;
    pendingRef.current = true;
    touched.current = true;
    const next = !saved;
    setSaved(next);
    setPending(true);
    setFailed(false);
    try {
      if (next) {
        await watchlistService.add(profileId, {
          content_id: contentId,
          tmdb_id: String(detail.tmdb_id),
          media_type: 'movie',
          title: detail.title,
          poster_url: detail.poster_url,
          year: detail.year,
          vote_average: detail.vote_average,
        });
      } else {
        await watchlistService.remove(profileId, contentId);
      }
    } catch (err) {
      const status = statusOf(err);
      // Already saved / already gone: the list is what the viewer asked for.
      if (!((next && status === 409) || (!next && status === 404))) {
        setSaved(!next);
        setFailed(true);
      }
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const label: ListLabel = pending ? (saved ? 'Saving…' : 'Removing…') : saved ? '✓ In My List' : 'Add to My List';
  return { label, failed, toggle };
}

/** The cells of the actions row. One id per control, and the ids are what the row maps over. */
type ActionCell = 'primary' | 'list' | 'fourk';

/**
 * The actions row, DERIVED so its declared count cannot drift from what it renders.
 *
 * Same shape as `actionCellsFor` in `bigscreen/list/page.tsx`, for the same reason: the
 * count handed to `useFocusGrid` and the elements rendered come from this one array. A
 * declared count one too high parks the ring on a cell no element claims, which on a remote
 * looks identical to nothing being focused — and a conditionally rendered cell beside a
 * hard-coded count is exactly how that happens.
 *
 * - `list` needs a profile; without one the row has one cell, and says so by having one.
 * - `fourk` is present only on `play`, the one kind that may start a download
 *   (`PrimaryAction`'s header). On every other kind the control could not act, and a focus
 *   stop whose press does nothing is what this surface's rules forbid — so it is ABSENT,
 *   not disabled.
 * - APPENDED LAST, never inserted. `useFocusGrid` calls `go` only when the clamped target
 *   CHANGES, so growth at the end never refocuses; a cell inserted at or before the focused
 *   column would leave DOM focus on the element that just became column+1 while the model
 *   still pointed at the old column, and the next press would appear to do nothing. The
 *   rule is written down twice already — `_player/TransportBar.tsx` ("the retry cell is
 *   appended last, never inserted") and `_components/LoadStatus.tsx`, which puts its late
 *   retry at column 0 and MOVES Back to 1 precisely because that cell arrives with
 *   `autoFocus`.
 */
function actionCellsFor(hasProfile: boolean, kind: TitleAction['kind']): ActionCell[] {
  return [
    'primary',
    ...(hasProfile ? (['list'] as const) : []),
    ...(kind === 'play' ? (['fourk'] as const) : []),
  ];
}

/**
 * The 4K control's label, and it is load-bearing in a SECOND FILE: the `withheld`-only 404
 * copy in `_data/title.ts` tells the viewer to "Press Ask for 4K to try one", so rewording
 * either one alone sends them to a control that no longer answers to that name.
 *
 * NOT exported, and not for want of trying. A Next.js App Router `page.tsx` may only export
 * `default` and the framework's own names; adding one gives
 * `TS2344 … Property 'FOURK_LABEL' is incompatible with index signature … not assignable to
 * type 'never'` from the generated route types. So the pair is pinned the way this surface
 * already pins cross-file facts — `page.test.tsx` reads BOTH sources as text and re-derives
 * the label from this line, so changing it here fails until `title.ts` names the new wording.
 */
const FOURK_LABEL = 'Ask for 4K';
/**
 * The only pre-press truth this screen has, and it is about DECODE RISK, not availability:
 * no reading has ever been taken on this television's 2160p decode (stage 8's readings 16,
 * 18 and 23 are all untaken), and the profile only COSTS the releases it dislikes at 4K —
 * it refuses two of them. So a 4K press can land a penalised release this panel may not
 * play, and the cell says so rather than implying a promise.
 */
const FOURK_NOTE = 'Not tested on this television. 4K may not play.';

function Loaded({
  detail,
  state,
  profile,
  onRecheck,
}: {
  detail: MovieDetail;
  state: TitleState;
  profile: TvProfile | null;
  onRecheck: () => Promise<void>;
}) {
  /**
   * The 4K opt-in, per press and per title: component state, and NOTHING is stored.
   *
   * `covers()` compares identity fields only (`_data/title.ts`), so for a movie any covering
   * row makes `play` unreachable — the cell is correctly absent on the next visit, and a
   * remembered "4K: on" would then sit beside a control that cannot honour it. Making
   * `covers()` quality-aware would instead mint a second multi-gigabyte download per press
   * on a box that allows two. `users.default_quality` is deliberately not reused either: the
   * column exists, both Pydantic shapes carry it and it is editable on the web settings
   * screen, but NO download path honours it, so wiring it here would retroactively change
   * behaviour for anyone who set 2160p months ago. Spec §7.3 says per title.
   *
   * It survives a failed Play (the kind stays `play` and the control re-arms), which is the
   * point: the viewer's ask has not been answered yet. Leaving the screen unmounts it.
   */
  const [fourK, setFourK] = useState(false);
  const cells = actionCellsFor(!!profile, state.action.kind);
  const { focused, focusProps, setFocus } = useFocusGrid({ rowCounts: [cells.length] });
  const list = useMyList(profile?.id ?? null, detail);

  /**
   * Put the ring somewhere real when the row shrinks under it.
   *
   * `TitleScreen`'s contract is that nothing passed as `actions` may unmount while it holds
   * focus: an unmounted focused element drops DOM focus to `<body>`, and on a remote there
   * is no Tab key and no pointer to recover with. The 4K cell is the first control on this
   * screen that breaks that contract by design — a press that turns `play` into `preparing`
   * unmounts it — so the screen takes the duty instead.
   *
   * CLAMPED TO THE LAST EXISTING CELL, not to `{row: 0, col: 0}`: hard-coding column 0 would
   * park the ring on Play even though the viewer was at the right-hand end of the row.
   *
   * MEASURED, not reasoned: deleting this effect fails no test, because `useFocusGrid`'s own
   * reconcile effect re-runs when the row count changes and `clampTarget` clamps the column
   * to the row's last item — the same cell this names. It stays for the reason
   * `bigscreen/list/page.tsx` keeps its own redundant `setFocus`: it says the target outright
   * instead of inheriting a fallback, and the fallback is one shared hook's behaviour away
   * from changing under this screen. A LAYOUT effect declared after `useFocusGrid` so the
   * hook's layout effect has already refreshed its counts and `setFocus` is clamped against
   * the NEW shape; the hook's reconciliation (passive) then finds focus valid and leaves it.
   *
   * GATED ON A SHRINK, and that gate is load-bearing — also measured. Written as a plain
   * "pull an out-of-range column back", it repairs a DIFFERENT bug too: a declared row count
   * larger than the cells rendered, which it would silently correct on the next arrow press.
   * That made the count-drift mutation unfalsifiable (63/63 green). A rescue must fix only
   * what it is for, or it stands in for a test of something else.
   */
  const count = cells.length;
  const previousCount = useRef(count);
  useLayoutEffect(() => {
    const was = previousCount.current;
    previousCount.current = count;
    if (count >= was) return; // only a SHRINK can strand the ring
    if (focused.row !== 0 || focused.col < count) return; // the ring is on a cell that survived
    setFocus({ row: 0, col: count - 1 });
  }, [count, focused, setFocus]);

  /**
   * What a `play` press asks for. `PrimaryAction` hands this object STRAIGHT to
   * `requestTitle`, which turns the flag into `quality: '2160p'` (pinned in
   * `_data/title.test.ts`); this screen's own test pins that the flag arrives.
   *
   * `PrimaryAction`'s `request` prop now DECLARES `fourK`, so this is an ordinary typed
   * hand-off. It did not at first: the prop listed only `mediaType`, `tmdbId`, `season` and
   * `episode`, and the call compiled anyway because a *named* value is accepted structurally
   * while only a fresh inline literal is refused (`error TS2353: Object literal may only
   * specify known properties`). The field was therefore travelling through a contract that
   * denied its existence, and a refactor in that component which reassembled the argument
   * would have dropped the 4K ask **silently** while this control still showed as pressed.
   * Widening the prop was the one-line fix; it is done, and this note stays so nobody
   * narrows it again.
   */
  const request = { mediaType: 'movie' as const, tmdbId: detail.tmdb_id, fourK };

  return (
    <TitleScreen
      art={atSize(detail.backdrop_url, 'w1920')}
      eyebrow={eyebrowOf(detail)}
      title={detail.title}
      overview={detail.overview || null}
      actions={cells.map((cell, c) =>
        cell === 'primary' ? (
          <PrimaryAction
            key={cell}
            action={state.action}
            request={request}
            focusProps={focusProps(0, c)}
            onRecheck={onRecheck}
          />
        ) : cell === 'list' ? (
          <div key={cell} className="bs-title__action">
            <button type="button" className="bs-btn bs-btn--ghost" {...focusProps(0, c)} onClick={list.toggle}>
              {list.label}
            </button>
            {list.failed && (
              <p role="alert" className="bs-title__alert">
                Couldn’t update My List. Try again.
              </p>
            )}
          </div>
        ) : (
          // The pressed state is an ATTRIBUTE selector on the control (aria-pressed), which
          // the toggle needs anyway in order to be honest about being one — not a modifier
          // class, and not a .bs-btn--* of its own: four blocks of bigscreen.css forbid
          // adding a modifier to .bs-btn, and the pressed colours are shared with My List's
          // toggle by grouping the selectors rather than by copying the declarations.
          //
          // GHOST, not the filled .bs-btn My List's toggle wears. Play is the action on this
          // row; this cell only MODIFIES it. A second gold fill beside Play reads as a second
          // primary at ten feet, on a surface where OK is the only confirm key and the ring
          // starts on Play. Rendered and looked at, not reasoned about.
          <div key={cell} className="bs-title__action bs-title__action--ask">
            <button
              type="button"
              className="bs-btn bs-btn--ghost bs-title__toggle"
              aria-pressed={fourK}
              {...focusProps(0, c)}
              onClick={() => setFourK((on) => !on)}
            >
              {FOURK_LABEL}
            </button>
            {fourK && (
              <p role="note" className="bs-title__note">
                {FOURK_NOTE}
              </p>
            )}
          </div>
        ),
      )}
    />
  );
}

export default function MovieDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const { profile, loading: profileLoading, clear } = useTvProfile();
  const profileId = profile?.id ?? null;
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // Latched once a lock sends the viewer to the picker. `clear()` changes `profileId`, which
  // would re-run the load as "nobody" and could paint a live Play control before the
  // replace lands; a locked profile never gets one.
  const [redirecting, setRedirecting] = useState(false);

  useBackKey(useCallback(() => router.push(HOME), [router]));

  /** A 423 means the profile is passcode-locked: forget it and send the viewer to pick again. */
  const sentToPicker = useCallback(
    (state: TitleState): boolean => {
      if (!state.locked) return false;
      setRedirecting(true);
      clear();
      router.replace(PROFILES);
      return true;
    },
    [clear, router],
  );

  useEffect(() => {
    // The stored profile is read asynchronously; asking before it lands would ask as nobody.
    if (profileLoading || redirecting) return;
    if (!Number.isInteger(id) || id <= 0) {
      setLoad({ phase: 'failed' });
      return;
    }
    let cancelled = false;
    Promise.all([
      moviesService.getDetail(id, { withQualities: false }),
      titleStateFor({ mediaType: 'movie', tmdbId: id, userId: profileId }),
    ])
      .then(([detail, state]) => {
        if (cancelled || sentToPicker(state)) return;
        setLoad({ phase: 'ready', detail, state });
      })
      .catch(() => {
        if (!cancelled) setLoad({ phase: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [id, profileId, profileLoading, redirecting, attempt, sentToPicker]);

  // Set in an effect, not at declaration: StrictMode runs the cleanup once on mount, and a
  // ref initialised to true would then stay false for the real mount.
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const retry = () => {
    setLoad({ phase: 'loading' });
    setAttempt((a) => a + 1);
  };

  // Ask again without leaving the screen: the control the viewer is on must not unmount.
  const recheck = async () => {
    if (load.phase !== 'ready') return;
    const detail = load.detail;
    let state: TitleState;
    try {
      state = await titleStateFor({ mediaType: 'movie', tmdbId: id, userId: profileId });
    } catch {
      state = { action: { kind: 'blocked', reason: 'Couldn’t reach the box. Check that it is on.' }, locked: false };
    }
    // The viewer may have pressed Back while this was out — apiClient has no timeout, so the
    // window can be long. Acting now would pull them off whatever screen they went to AND,
    // on a locked answer, clear the profile they had selected. Worse than a stray
    // navigation, because it silently forgets something.
    if (!alive.current) return;
    if (!sentToPicker(state)) setLoad({ phase: 'ready', detail, state });
  };

  // `redirecting` first and on its own: it must not borrow the loading state (see LockedRedirect).
  if (redirecting) return <LockedRedirect />;
  if (load.phase === 'ready') {
    return <Loaded detail={load.detail} state={load.state} profile={profile} onRecheck={recheck} />;
  }
  return <LoadStatus noun="movie" failed={load.phase === 'failed'} onRetry={retry} />;
}
