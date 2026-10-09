'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { requestTitle, resumeTitle, type TitleAction } from '../_data/title';
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

const WATCH = '/bigscreen/watch';

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
  'Couldn’t tell which file holds this episode. This plays the first file in the season, which may be a different episode.';

export function describeAction(action: TitleAction, busy: Busy = null): ActionView {
  switch (action.kind) {
    case 'play':
      return { label: busy === 'starting' ? 'Starting…' : 'Play' };
    case 'resume':
      return { label: `Resume from ${formatResumeTime(action.atSeconds)}`, href: action.href };
    case 'open':
      return { label: 'Open', href: action.href };
    case 'preparing':
      return {
        label: `Preparing… ${Math.round(Number(action.progress) || 0)}%`,
        href: `${WATCH}/${action.torrentId}`,
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
  const [failure, setFailure] = useState<string | null>(null);
  const busyRef = useRef(false);

  const view = describeAction(action, busy);

  const run = async (
    kind: Exclude<Busy, null>,
    work: () => Promise<{ ok: true; torrentId: string } | { ok: false; reason: string }>,
  ) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    setFailure(null);
    const result = await work();
    if (result.ok) {
      // Stay "busy" through the navigation: the label keeps saying what is happening.
      router.push(`${WATCH}/${result.torrentId}`);
      return;
    }
    busyRef.current = false;
    setBusy(null);
    setFailure(result.reason);
  };

  const press = () => {
    switch (action.kind) {
      case 'play':
        return run('starting', () => requestTitle(request));
      case 'paused': {
        const id = action.torrentId;
        return run('resuming', async () => {
          const r = await resumeTitle(id);
          return r.ok ? { ok: true as const, torrentId: id } : r;
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
        return; // links; the browser navigates
      default:
        return assertNever(action);
    }
  };

  const message = action.kind === 'blocked' ? action.reason : failure;

  return (
    <div className="bs-title__action">
      {view.href ? (
        <Link href={view.href} className="bs-btn" draggable={false} {...focusProps}>
          {view.label}
        </Link>
      ) : (
        <button type="button" className="bs-btn" aria-busy={busy !== null} {...focusProps} onClick={press}>
          {view.label}
        </button>
      )}
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
