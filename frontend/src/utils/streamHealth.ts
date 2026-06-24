// frontend/src/utils/streamHealth.ts
//
// deriveStreamHealth — the SINGLE source of truth that maps a polled TorrentStatus
// to a StreamHealthState (stream_phase + swarm health). W2 owns this; W6 imports it.
// There is NO separate deriveStreamPhase: phase is computed here.

import { TorrentStatus, StreamHealthState, StreamPhase, SwarmHealth, TorrentState } from '@/types';

const READY_PROGRESS = 2; // % buffered before the player may start (matches isStreamingReady)
const HEALTHY_PEERS = 5;  // mirrors backend healthy_seeds default

function deriveHealth(numPeers: number): SwarmHealth {
  if (numPeers === 0) return 'dead';
  if (numPeers < HEALTHY_PEERS) return 'low';
  return 'healthy';
}

function derivePhase(status: TorrentStatus, numPeers: number): StreamPhase {
  const { state, progress } = status;

  if (
    state === TorrentState.FINISHED ||
    state === TorrentState.SEEDING ||
    (state === TorrentState.DOWNLOADING && progress >= READY_PROGRESS)
  ) {
    return 'ready';
  }

  if (
    state === TorrentState.DOWNLOADING_METADATA ||
    state === TorrentState.CHECKING ||
    state === TorrentState.CHECKING_FASTRESUME ||
    state === TorrentState.ALLOCATING
  ) {
    return 'metadata';
  }

  if (numPeers === 0) return 'searching';

  if (state === TorrentState.DOWNLOADING && progress < READY_PROGRESS) {
    return 'connecting';
  }

  return 'buffering';
}

export function deriveStreamHealth(status: TorrentStatus): StreamHealthState {
  const num_peers = status.num_peers ?? 0;
  const num_seeds = status.num_seeds ?? num_peers;
  const download_rate = status.download_rate ?? 0;
  const health: SwarmHealth = status.health ?? deriveHealth(num_peers);
  const stream_phase: StreamPhase = status.stream_phase ?? derivePhase(status, num_peers);
  return { stream_phase, num_seeds, num_peers, download_rate, health };
}
