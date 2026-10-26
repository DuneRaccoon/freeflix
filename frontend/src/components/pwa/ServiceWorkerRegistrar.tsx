'use client';
import { useEffect } from 'react';
import { listenForInstallPrompt } from '@/lib/pwa/install';

/**
 * Registers /sw.js in production builds, and starts listening for the install prompt.
 *
 * In development it does the opposite: it unregisters any worker left over from a production
 * run on the same origin, because a cache-first worker under `next dev` serves stale chunks
 * and fights hot reload.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    listenForInstallPrompt();
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations()
        .then((regs) => regs.forEach((r) => r.unregister()))
        .catch(() => undefined);
      return;
    }

    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
      console.warn('[pwa] service worker registration failed', err);
    });
  }, []);

  return null;
}
