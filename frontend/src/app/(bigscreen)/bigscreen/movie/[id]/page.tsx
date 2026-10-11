'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
import { titleStateFor, type TitleState } from '../../../_data/title';
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
 * Consequence: `available_qualities` is `[]` here, so nothing below reads it.
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
  // My List needs a profile; without one the row has one cell, and says so by having one.
  const grid = useFocusGrid({ rowCounts: [profile ? 2 : 1] });
  const list = useMyList(profile?.id ?? null, detail);

  return (
    <TitleScreen
      art={atSize(detail.backdrop_url, 'w1920')}
      eyebrow={eyebrowOf(detail)}
      title={detail.title}
      overview={detail.overview || null}
      actions={
        <>
          <PrimaryAction
            action={state.action}
            request={{ mediaType: 'movie', tmdbId: detail.tmdb_id }}
            focusProps={grid.focusProps(0, 0)}
            onRecheck={onRecheck}
          />
          {profile && (
            <div className="bs-title__action">
              <button type="button" className="bs-btn bs-btn--ghost" {...grid.focusProps(0, 1)} onClick={list.toggle}>
                {list.label}
              </button>
              {list.failed && (
                <p role="alert" className="bs-title__alert">
                  Couldn’t update My List. Try again.
                </p>
              )}
            </div>
          )}
        </>
      }
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
