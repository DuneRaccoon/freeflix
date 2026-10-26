'use client';
import { useSyncExternalStore } from 'react';

/**
 * The browser's deferred install prompt, held at module scope.
 *
 * `beforeinstallprompt` fires once, early — usually before the Settings page that offers the
 * button has mounted. `ServiceWorkerRegistrar` (mounted in the web layout) calls
 * `listenForInstallPrompt()` on load so the event is captured whichever page the visit
 * starts on; `useInstall()` reads it from here.
 */

/** Chromium-only; not in lib.dom. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallState =
  /** Already running as an installed app. */
  | 'installed'
  /** The browser handed us a prompt; `install()` will show it. */
  | 'promptable'
  /** iOS/iPadOS Safari: no prompt API, only Share → Add to Home Screen. */
  | 'ios'
  /** Plain http on a LAN address — no browser will install from an insecure origin. */
  | 'insecure'
  /** Anything else: the browser's own menu, or not supported. */
  | 'manual';

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
let listening = false;
const subscribers = new Set<() => void>();

function notify() {
  subscribers.forEach((fn) => fn());
}

export function listenForInstallPrompt(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    // Keep the browser's mini-infobar from firing on its own; we offer it in Settings.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac; touch support gives it away.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function getInstallState(): InstallState {
  if (installed || isStandalone()) return 'installed';
  if (deferred) return 'promptable';
  if (!window.isSecureContext) return 'insecure';
  if (isIOS()) return 'ios';
  return 'manual';
}

/** Show the browser's install dialog. Resolves true if the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  // A prompt can only be shown once; drop it whatever the answer.
  deferred = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  notify();
  return outcome === 'accepted';
}

function subscribe(fn: () => void) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function useInstall(): { state: InstallState | null; install: () => Promise<boolean> } {
  // null on the server, where none of this can be known.
  const state = useSyncExternalStore(subscribe, getInstallState, () => null);
  return { state, install: promptInstall };
}

/** Test-only: forget everything captured so far. */
export function __resetInstallForTests(): void {
  deferred = null;
  installed = false;
  listening = false;
  subscribers.clear();
}
