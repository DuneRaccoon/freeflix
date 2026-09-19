/**
 * Small shared helpers for the four public auth screens (/claim, /signin,
 * /invite, /auth/verify).
 */

/** The HTTP status behind a rejected service call, in whichever axios shape it arrives. */
export function statusOf(err: unknown): number | undefined {
  const e = err as { response?: { status?: number }; status?: number } | null | undefined;
  return e?.response?.status ?? e?.status;
}

// A magic link is opened from a mail client, usually in a fresh tab, so the
// pending destination has to outlive the tab that asked for the link —
// sessionStorage would not survive that hop.
const NEXT_KEY = 'ff_auth_next';

/**
 * Same-origin absolute paths only. `//evil.host` and `/\evil.host` are
 * protocol-relative to a browser, so they are dropped along with absolute URLs.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null;
  return raw;
}

export function rememberNextPath(raw: string | null | undefined): void {
  const next = safeNextPath(raw);
  try {
    if (next) window.localStorage.setItem(NEXT_KEY, next);
    else window.localStorage.removeItem(NEXT_KEY);
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); the sign-in
    // still works, the viewer just lands on the default destination.
  }
}

/** Reads and clears the remembered destination — a `next` is honoured once. */
export function takeNextPath(): string | null {
  try {
    const stored = window.localStorage.getItem(NEXT_KEY);
    window.localStorage.removeItem(NEXT_KEY);
    return safeNextPath(stored);
  } catch {
    return null;
  }
}
