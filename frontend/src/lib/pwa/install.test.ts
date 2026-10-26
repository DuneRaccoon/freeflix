import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { __resetInstallForTests, listenForInstallPrompt, useInstall } from './install';

function fakePrompt(outcome: 'accepted' | 'dismissed') {
  const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  };
  e.prompt = vi.fn().mockResolvedValue(undefined);
  e.userChoice = Promise.resolve({ outcome });
  return e;
}

describe('useInstall', () => {
  beforeEach(() => {
    __resetInstallForTests();
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  });

  it('becomes promptable when the browser offers a prompt, and suppresses its own infobar', () => {
    listenForInstallPrompt();
    const { result } = renderHook(() => useInstall());
    expect(result.current.state).toBe('manual');

    const e = fakePrompt('accepted');
    act(() => { window.dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(true);
    expect(result.current.state).toBe('promptable');
  });

  it('shows the prompt once, then is no longer promptable', async () => {
    listenForInstallPrompt();
    const { result } = renderHook(() => useInstall());
    const e = fakePrompt('dismissed');
    act(() => { window.dispatchEvent(e); });

    let accepted: boolean | undefined;
    await act(async () => { accepted = await result.current.install(); });
    expect(e.prompt).toHaveBeenCalledTimes(1);
    expect(accepted).toBe(false);
    expect(result.current.state).toBe('manual');
  });

  it('reports installed after appinstalled', () => {
    listenForInstallPrompt();
    const { result } = renderHook(() => useInstall());
    act(() => { window.dispatchEvent(new Event('appinstalled')); });
    expect(result.current.state).toBe('installed');
  });

  it('says why it cannot install over plain http', () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    const { result } = renderHook(() => useInstall());
    expect(result.current.state).toBe('insecure');
  });
});
