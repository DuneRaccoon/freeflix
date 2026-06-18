'use client';
/**
 * UpNextCard — FRÈ "Up Next" card for multi-file season packs.
 *
 * Shown near the end of an episode when there is a next file. Displays:
 *   - "UP NEXT" eyebrow label
 *   - Next episode label (e.g. "S1·E4")
 *   - Optional thumbnail
 *   - Countdown ring (FRÈ Ring) + remaining seconds number
 *   - Play-next button + Dismiss (×) button
 *
 * Props are purely presentational; wiring (what to do on play/dismiss) is the
 * caller's responsibility. This component never touches playback or progress.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Ring } from '@/components/ui/fre';
import { cn } from '@/lib/cn';

export interface UpNextCardProps {
  /** Label for the next episode, e.g. "S01·E04" */
  nextLabel: string;
  /** Optional thumbnail URL (16:9) */
  thumbnailUrl?: string | null;
  /** Called when the user clicks Play Next */
  onPlayNext: () => void;
  /** Called when the user clicks Dismiss (×) */
  onDismiss: () => void;
  /**
   * Total countdown in seconds before auto-advancing.
   * When this reaches 0 the card calls onPlayNext automatically.
   * If undefined, no countdown is shown and there is no auto-advance.
   */
  countdownSeconds?: number;
  className?: string;
}

const UpNextCard: React.FC<UpNextCardProps> = ({
  nextLabel,
  thumbnailUrl,
  onPlayNext,
  onDismiss,
  countdownSeconds,
  className,
}) => {
  // Remaining seconds for the countdown ring.
  const [remaining, setRemaining] = useState<number>(countdownSeconds ?? 0);
  const hasCountdown = countdownSeconds !== undefined && countdownSeconds > 0;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onPlayNextRef = useRef(onPlayNext);

  // Keep ref current so the interval closure doesn't capture a stale callback.
  useEffect(() => {
    onPlayNextRef.current = onPlayNext;
  }, [onPlayNext]);

  // Reset remaining when countdownSeconds prop changes (e.g. card remounts for a
  // new episode).
  useEffect(() => {
    setRemaining(countdownSeconds ?? 0);
  }, [countdownSeconds]);

  // Tick down + auto-advance.
  useEffect(() => {
    if (!hasCountdown) return;

    intervalRef.current = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!);
          // Defer so we don't call setState during render
          setTimeout(() => onPlayNextRef.current(), 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [hasCountdown]);

  // Ring value: 0 = full ring (beginning), 100 = empty ring (end).
  const ringValue = hasCountdown && countdownSeconds
    ? ((countdownSeconds - remaining) / countdownSeconds) * 100
    : 0;

  return (
    <div
      data-testid="upnext-card"
      className={cn(
        'w-[298px] rounded-[13px] overflow-hidden border border-hairline',
        'bg-surface/70 backdrop-blur-[18px]',
        'shadow-[0_24px_60px_-20px_rgba(0,0,0,.8)]',
        'transition-colors duration-200 hover:border-gold/40',
        'text-left select-none',
        className,
      )}
    >
      {/* ---- Head row: "UP NEXT" label + dismiss button ---- */}
      <div className="flex items-center justify-between px-3.5 pt-2.5 pb-2">
        <span
          className="text-[9.5px] uppercase tracking-[.26em] text-muted font-medium"
        >
          Up Next
        </span>
        <button
          data-testid="upnext-dismiss"
          onClick={e => { e.stopPropagation(); onDismiss(); }}
          aria-label="Dismiss up-next card"
          className="w-[22px] h-[22px] rounded-full border border-hairline flex items-center justify-center text-muted hover:text-text hover:border-muted transition-colors focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]"
        >
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-[11px] h-[11px]">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>
      </div>

      {/* ---- Body: thumbnail + meta + ring ---- */}
      <div className="flex items-center gap-3 px-3.5 pb-3.5">
        {/* Thumbnail */}
        {thumbnailUrl ? (
          <div
            className="relative flex-shrink-0 w-24 rounded-lg overflow-hidden bg-ink"
            style={{ aspectRatio: '16/9' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbnailUrl}
              alt={`Thumbnail for ${nextLabel}`}
              className="w-full h-full object-cover"
            />
            {/* subtle gradient at bottom of thumb */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'linear-gradient(transparent, rgba(0,0,0,.4))' }}
              aria-hidden="true"
            />
          </div>
        ) : (
          /* Placeholder thumbnail if no image */
          <div
            className="relative flex-shrink-0 w-24 rounded-lg bg-surface-2 flex items-center justify-center"
            style={{ aspectRatio: '16/9' }}
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-muted">
              <rect x="3" y="4" width="18" height="14" rx="2.5"/>
              <path d="M10 8.5l5 3.5-5 3.5V8.5z" fill="currentColor" stroke="none"/>
            </svg>
          </div>
        )}

        {/* Meta */}
        <div className="min-w-0 flex-1">
          <p
            data-testid="upnext-label"
            className="text-[10px] uppercase tracking-[.14em] text-gold-lite font-semibold mb-1"
          >
            {nextLabel}
          </p>
          <p className="text-xs text-muted leading-tight">Next episode</p>
        </div>

        {/* Countdown ring (only when a countdown is active) */}
        {hasCountdown && (
          <div
            className="relative flex-shrink-0 flex items-center justify-center w-10 h-10"
            data-testid="upnext-ring"
            role="timer"
            aria-label={`${remaining} seconds until next episode`}
          >
            <Ring
              value={ringValue}
              size={40}
            />
            <span
              className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-text"
              aria-hidden="true"
            >
              {remaining}
            </span>
          </div>
        )}
      </div>

      {/* ---- Play-next CTA ---- */}
      <button
        data-testid="upnext-play"
        onClick={e => { e.stopPropagation(); onPlayNext(); }}
        aria-label={`Play next: ${nextLabel}`}
        className={cn(
          'w-full flex items-center justify-center gap-2',
          'py-2.5 border-t border-hairline',
          'text-xs font-semibold tracking-[.04em]',
          'text-text hover:text-gold-lite',
          'transition-colors duration-150',
          'bg-transparent hover:bg-surface-2/40',
          'focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
        )}
      >
        {/* Play icon */}
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 flex-shrink-0 ml-[2px]">
          <path d="M5 3.5v9l8-4.5-8-4.5z"/>
        </svg>
        Play Next
      </button>
    </div>
  );
};

export default UpNextCard;
