'use client';

// The owner's global next-episode setting (`GET /instance/playback`), read once per mount.
// Shared by the TV watch page and the web player.
import { useEffect, useState } from 'react';
import { instanceService } from '@/services/instance';

export interface PlaybackSettingsState {
  /** True only when the read ANSWERED and said on. False while in flight and after a failure. */
  enabled: boolean;
  /** auto_next_pct / 100 once the read answered; null until then and after a failure. */
  threshold: number | null;
}

const NOTHING: PlaybackSettingsState = { enabled: false, threshold: null };

export function usePlaybackSettings(): PlaybackSettingsState {
  const [state, setState] = useState<PlaybackSettingsState>(NOTHING);

  useEffect(() => {
    // Ignores the answer after unmount. No test pins this: React 18+ drops a state update on an
    // unmounted component without a warning, so nothing observable changes when it is missing.
    let cancelled = false;
    void (async () => {
      try {
        const s = await instanceService.getPlayback();
        if (cancelled) return;
        setState({ enabled: s.auto_next_enabled === true, threshold: s.auto_next_pct / 100 });
      } catch {
        // A failed read is OFF, never the product default: a download on a Pi is not a guess.
        if (!cancelled) setState(NOTHING);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
