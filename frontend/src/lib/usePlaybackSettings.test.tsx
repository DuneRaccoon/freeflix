import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/services/instance', () => ({ instanceService: { getPlayback: vi.fn() } }));

import { instanceService, type PlaybackSettings } from '@/services/instance';
import { usePlaybackSettings } from './usePlaybackSettings';

const svc = vi.mocked(instanceService);

beforeEach(() => vi.resetAllMocks());

const answer = (over: Partial<PlaybackSettings> = {}): PlaybackSettings => ({ auto_next_enabled: true, auto_next_pct: 80, ...over });
const flush = async () => { for (let i = 0; i < 3; i++) await act(async () => {}); };

describe('usePlaybackSettings', () => {
  it('acts on nothing until the box answers', async () => {
    let settle: (v: PlaybackSettings) => void = () => {};
    svc.getPlayback.mockReturnValue(new Promise((r) => { settle = r; }));
    const { result } = renderHook(() => usePlaybackSettings());
    await flush();
    expect(result.current, 'still in flight').toEqual({ enabled: false, threshold: null });
    await act(async () => settle(answer()));
    await flush();
    expect(result.current).toEqual({ enabled: true, threshold: 0.8 });
  });
  it('is the owner’s number, as a fraction', async () => {
    svc.getPlayback.mockResolvedValue(answer({ auto_next_pct: 65 }));
    const { result } = renderHook(() => usePlaybackSettings());
    await flush();
    expect(result.current.threshold).toBe(0.65);
  });
  it('off is off', async () => {
    svc.getPlayback.mockResolvedValue(answer({ auto_next_enabled: false }));
    const { result } = renderHook(() => usePlaybackSettings());
    await flush();
    expect(result.current.enabled).toBe(false);
  });
  it('a failed read is OFF, never the product default (which is on)', async () => {
    svc.getPlayback.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => usePlaybackSettings());
    await flush();
    expect.soft(svc.getPlayback).toHaveBeenCalledTimes(1);
    expect.soft(result.current).toEqual({ enabled: false, threshold: null });
  });
  it('reads once per mount, not once per render', async () => {
    svc.getPlayback.mockResolvedValue(answer());
    const { rerender } = renderHook(() => usePlaybackSettings());
    rerender(); rerender();
    await flush();
    expect(svc.getPlayback).toHaveBeenCalledTimes(1);
  });
});
