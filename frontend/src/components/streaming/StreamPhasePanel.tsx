'use client';

/**
 * StreamPhasePanel — the warm-up panel shown in the streaming page's player area
 * before there's enough buffered to play. Renders a staged label derived from
 * StreamHealthState.stream_phase and surfaces 0-peer / dead-swarm messaging via
 * the health prop. W2 owns this; the page renders it and owns onForceStart.
 */

import React from 'react';
import { StreamHealthState, StreamPhase } from '@/types';
import { cn } from '@/lib/cn';

export interface StreamPhasePanelProps {
  health: StreamHealthState;
  progress: number;
  onForceStart?: () => void;
  showForceStart?: boolean;
}

const PHASE_LABEL: Record<StreamPhase, string> = {
  searching: 'Finding sources…',
  connecting: 'Connecting to peers…',
  metadata: 'Fetching metadata…',
  buffering: 'Buffering…',
  ready: 'Almost ready…',
};

const StreamPhasePanel: React.FC<StreamPhasePanelProps> = ({
  health,
  progress,
  onForceStart,
  showForceStart = false,
}) => {
  const { stream_phase, num_peers, health: swarm } = health;
  const isDead = swarm === 'dead';

  const headline =
    stream_phase === 'buffering'
      ? `Buffering ${Math.round(progress)}%…`
      : PHASE_LABEL[stream_phase];

  // Sub-line distinguishes a dead swarm (0 peers) from a slow one (N peers).
  const subline = isDead
    ? 'Waiting for peers — no seeders connected yet'
    : num_peers > 0
    ? `${Math.round(progress)}% downloaded · ${num_peers} peer${num_peers === 1 ? '' : 's'}`
    : `${Math.round(progress)}% downloaded`;

  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-ink px-6 text-center"
      data-testid="stream-phase-panel"
      data-phase={stream_phase}
      data-health={swarm}
    >
      <div
        className={cn(
          'w-12 h-12 rounded-full border-2 animate-spin',
          'border-hairline border-t-gold',
        )}
        aria-label={headline}
      />
      <div>
        <p className="font-display text-xl text-text tracking-tight" data-testid="stream-phase-headline">
          {headline}
        </p>
        <p className="mt-1.5 text-sm text-muted" data-testid="stream-phase-subline">
          {subline}
        </p>
      </div>
      {showForceStart && onForceStart && (
        <button
          onClick={onForceStart}
          className="text-xs text-muted underline-offset-4 transition-colors hover:text-gold hover:underline"
        >
          Start anyway
        </button>
      )}
    </div>
  );
};

export default StreamPhasePanel;
