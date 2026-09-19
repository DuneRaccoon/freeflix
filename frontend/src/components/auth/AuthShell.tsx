'use client';
import React from 'react';
import { Wordmark } from '@/components/ui/Wordmark';
import CinematicAtmosphere from '@/components/fx/CinematicAtmosphere';
import { cn } from '@/lib/cn';

export interface AuthShellProps {
  /** Small gold label above the headline — one per screen. */
  eyebrow?: string;
  /** Headline. Wrap the accent word in <em> for the gold italic motif. */
  title: React.ReactNode;
  /** One or two sentences under the headline. */
  intro?: React.ReactNode;
  children?: React.ReactNode;
  /** Secondary links under the content, above the tagline. */
  footer?: React.ReactNode;
  className?: string;
}

/**
 * The frame every public auth screen shares: full-bleed ink, the cinematic
 * overlays, the wordmark, and the editorial headline stack. Modelled on
 * ProfileGate so the first screen anyone sees already reads as FRÈ.
 */
const AuthShell: React.FC<AuthShellProps> = ({
  eyebrow, title, intro, children, footer, className,
}) => (
  <main className={cn(
    'relative flex min-h-screen flex-col items-center justify-center overflow-hidden',
    'bg-ink px-6 py-16 text-text',
    className,
  )}>
    <CinematicAtmosphere />

    <div className="relative z-[2] flex w-full max-w-[540px] flex-col items-center gap-10">
      <Wordmark className="text-3xl" />

      <header className="flex flex-col items-center gap-4 text-center">
        {eyebrow && (
          <p className="font-ui text-[11px] font-semibold uppercase tracking-[0.35em] text-gold">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-[clamp(2.25rem,6vw,3.5rem)] leading-[1.04] tracking-tight [&_em]:italic [&_em]:text-gold-lite">
          {title}
        </h1>
        {intro && (
          <p className="max-w-[44ch] font-ui text-[15px] leading-relaxed text-muted">
            {intro}
          </p>
        )}
      </header>

      {children && <div className="w-full">{children}</div>}

      {footer && (
        <div className="flex flex-col items-center gap-2 text-center font-ui text-sm text-muted">
          {footer}
        </div>
      )}

      <p className="font-display text-[13px] italic text-muted/80">Cinema, kept close.</p>
    </div>
  </main>
);

export default AuthShell;
