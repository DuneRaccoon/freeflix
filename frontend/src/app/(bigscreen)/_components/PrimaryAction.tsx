'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { requestTitle, resumeTitle, type TitleAction } from '../_data/title';
import { watchHref } from '../_data/watchHref';
import type { FocusProps } from '../_focus/useFocusGrid';

/**
 * The primary control of a detail screen, drawn from what `titleStateFor` said the title
 * is. Shared by the movie and show screens.
 *
 * ONE KIND, ONE CONTROL, ONE LABEL. Every kind is handled by an exhaustive switch with no
 * default (`assertNever`), so adding a kind to `TitleAction` fails the TYPE CHECK here
 * instead of falling through to a control that does the wrong thing.
 *
 * - `play` is the only kind that may start a download.
 * - `unresolvedEpisode` plays the pack's default file, which may not be the episode that
 *   was asked for. It says so, in words, beside the control: playing something other than
 *   what was asked for without a word is the defect that kind exists to prevent.
 * - `blocked` is still a focus stop ("Check again") with the reason on screen. A refusal
 *   with no control would leave a remote with nothing to press.
 *
 * A PRESS IS NEVER SILENTLY REFUSED. While a request is in flight the control stays mounted
 * and focusable (an unmounted focused control drops focus to <body>) and its label says what
 * it is doing; a second press is ignored by a synchronous ref, which the label has already
 * explained. A failure prints its reason beside the control and leaves it usable. There is
 * no toaster on this surface, so nothing here may route an error to one.
 */

function assertNever(x: never): never {
  throw new Error(`Unhandled title action: ${JSON.stringify(x)}`);
}

export function formatResumeTime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export type Busy = 'starting' | 'resuming' | 'checking' | null;

/** What the control looks like. `href` set means a link; otherwise a button. */
export interface ActionView {
  label: string;
  href?: string;
  /** Prose that must sit beside the control (not an error). */
  note?: string;
}

export const UNRESOLVED_NOTE =
  'Couldn’t tell which file holds this episode. This plays a file from the season, which may be a different episode.';

export function describeAction(action: TitleAction, busy: Busy = null): ActionView {
  switch (action.kind) {
    case 'play':
      return { label: busy === 'starting' ? 'Starting…' : busy === 'checking' ? 'Checking…' : 'Play' };
    case 'resume':
      return { label: `Resume from ${formatResumeTime(action.atSeconds)}`, href: action.href };
    case 'open':
      return { label: 'Open', href: action.href };
    case 'preparing':
      return {
        label: `Preparing… ${Math.round(Number(action.progress) || 0)}%`,
        // A pack plays its default file without `?file=`, i.e. episode 1.
        href: watchHref(action.torrentId, action.fileIndex),
      };
    case 'paused':
      return { label: busy === 'resuming' ? 'Resuming…' : 'Resume download' };
    case 'unresolvedEpisode':
      return {
        label: action.atSeconds != null ? `Resume from ${formatResumeTime(action.atSeconds)} anyway` : 'Play anyway',
        href: action.href,
        note: UNRESOLVED_NOTE,
      };
    case 'blocked':
      return { label: busy === 'checking' ? 'Checking…' : 'Check again' };
    default:
      return assertNever(action);
  }
}

export function PrimaryAction({
  action,
  request,
  focusProps,
  onRecheck,
}: {
  action: TitleAction;
  /** What `requestTitle` is asked for on a `play` press. */
  request: { mediaType: 'movie' | 'tv'; tmdbId: number; season?: number; episode?: number };
  focusProps: FocusProps;
  /** Re-ask what the title is, in place. Used by `blocked`; resolves when the answer is in. */
  onRecheck: () => Promise<void>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);
  // The failure is remembered with the kind it happened under, and shown only while the
  // screen is still on that kind: a recheck that finds the title `preparing` must not leave
  // "Couldn't reach the box" printed beside a control that is now doing something else.
  const [failure, setFailure] = useState<{ kind: TitleAction['kind']; reason: string } | null>(null);
  const busyRef = useRef(false);
  // Set in the effect so StrictMode's second mount revives it (same shape as the picker).
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const view = describeAction(action, busy);

  const run = async (
    kind: Exclude<Busy, null>,
    work: () => Promise<
      | { ok: true; torrentId: string; fileIndex?: number; unresolved?: boolean }
      | { ok: false; reason: string; maybeCreated?: boolean }
    >,
  ) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    setFailure(null);
    const result = await work();
    // Back was pressed while the request was out (the POST runs a provider search, which can
    // take tens of seconds): the viewer has left, so do not pull them to the player later.
    if (!alive.current) return;
    if (result.ok) {
      if (result.unresolved) {
        // The torrent exists but it is a season pack and which file is this episode could not
        // be read. Navigating would play its default file (episode 1) without a word, so
        // re-ask instead: the answer is `unresolvedEpisode` (disclosed) or, now that metadata
        // may have landed, a resolved file.
        await recheckThenRearm();
        return;
      }
      // Stay "busy" through the navigation: the label keeps saying what is happening.
      router.push(watchHref(result.torrentId, result.fileIndex));
      return;
    }
    setFailure({ kind: action.kind, reason: result.reason });
    if (result.maybeCreated) {
      // AMBIGUOUS FAILURE. The backend adds the torrent and THEN looks its status up, so a
      // 5xx or a dropped connection can arrive after the download exists. A 404/409 is a
      // refusal before anything was added, so those may re-arm Play at once; this may not.
      // Re-ask what the title is first. If it is now `preparing` the screen shows that; if it
      // is still `play`, the control is re-armed below. Pressing Play blind here is how a
      // second multi-GB download gets minted on a box that allows two.
      await recheckThenRearm();
      return;
    }
    busyRef.current = false;
    setBusy(null);
  };

  /** Re-ask what the title is, then re-arm the control (unless the screen is gone). */
  const recheckThenRearm = async () => {
    setBusy('checking');
    try {
      await onRecheck();
    } catch {
      /* the recheck reports its own failure as `blocked`; fall through and re-arm */
    }
    if (!alive.current) return;
    busyRef.current = false;
    setBusy(null);
  };

  const press = () => {
    switch (action.kind) {
      case 'play':
        return run('starting', () => requestTitle(request));
      case 'paused': {
        const { torrentId: id, fileIndex, fileUnknown } = action;
        return run('resuming', async () => {
          const r = await resumeTitle(id);
          return r.ok ? { ok: true as const, torrentId: id, fileIndex, unresolved: !!fileUnknown } : r;
        });
      }
      case 'blocked': {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy('checking');
        return onRecheck().finally(() => {
          busyRef.current = false;
          setBusy(null);
        });
      }
      case 'resume':
      case 'open':
      case 'preparing':
      case 'unresolvedEpisode':
        // A BUTTON that navigates, not an <a>. The blocked kind is a button, and a recheck
        // can turn it into one of these; swapping the element type would unmount the focused
        // control and drop DOM focus to <body> with no ring until the next arrow press.
        if (view.href) router.push(view.href);
        return;
      default:
        return assertNever(action);
    }
  };

  const message = action.kind === 'blocked' ? action.reason : failure?.kind === action.kind ? failure.reason : null;

  return (
    <div className="bs-title__action">
      <button type="button" className="bs-btn" aria-busy={busy !== null} {...focusProps} onClick={press}>
        {view.label}
      </button>
      {view.note && (
        <p role="note" className="bs-title__note">
          {view.note}
        </p>
      )}
      {message && (
        <p role="alert" className="bs-title__alert">
          {message}
        </p>
      )}
    </div>
  );
}
