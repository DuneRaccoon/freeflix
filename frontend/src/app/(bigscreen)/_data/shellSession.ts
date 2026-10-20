/**
 * Whether this document is running inside the webOS app, and how it knows.
 *
 * THE SHELL CANNOT TELL THE APP ANYTHING EXCEPT THROUGH THE URL. `webos/index.html` leaves by
 * `location.replace(server + '/bigscreen?from=app')`, which escapes its `file://` opaque origin
 * — and with it every other channel. There is no shared storage (different origin), no cookie
 * (`file://` cannot set one), no injected global (the shell is gone, not a parent frame). A
 * query parameter on the first document is the whole contract.
 *
 * WHICH IS WHY IT HAS TO BE CAPTURED, NOT READ. `?from=app` exists on the first document and
 * vanishes at the first `router.push` — and this surface navigates constantly. A screen that
 * asked `location.search` would find the flag on home, lose it on the way to a title, and find
 * it again only if the viewer happened to return by a full reload.
 *
 * SESSION STORAGE, NOT LOCAL. The address of the box is a property of the DEVICE and must
 * survive a cold start, so the shell keeps it in `localStorage`. Shell-ness is a property of
 * THIS TAB: `location.replace` keeps the tab, so a flag written on the first document survives
 * every in-app navigation and dies with the session. In `localStorage` it would outlive the app
 * and a desktop browser opened later at the same address would believe it could call
 * `window.close()` — which, on a tab the script did not open, does nothing at all and leaves
 * Back at the root silently dead. That is the exact state `bigscreen/page.tsx` refuses.
 *
 * Both functions take the Storage, so they are testable without reaching for a global, and both
 * tolerate it being null or throwing: Safari's private mode and a webOS app with site data
 * blocked both make `sessionStorage` throw on ACCESS, not on use.
 */

/** The key. Namespaced like the rest of this surface's storage. */
export const SHELL_FLAG = 'bs:shell';

/** The parameter the shell appends, and the only value that counts. */
export const SHELL_PARAM = 'from';
export const SHELL_VALUE = 'app';

/**
 * Remember `?from=app` for the rest of this tab's life. Idempotent, and it never CLEARS the
 * flag: a later navigation legitimately has no parameter, and treating that as "not the app"
 * would turn the flag off one push after it was set.
 */
export function captureShell(search: string, store: Storage | null): void {
  if (!store) return;
  let from: string | null = null;
  try {
    from = new URLSearchParams(search).get(SHELL_PARAM);
  } catch {
    return;
  }
  if (from !== SHELL_VALUE) return;
  try {
    store.setItem(SHELL_FLAG, '1');
  } catch {
    // Storage blocked. The app still works; Back at the root behaves as it does in a browser.
  }
}

/** Whether this tab was entered from the webOS shell. */
export function isInShell(store: Storage | null): boolean {
  if (!store) return false;
  try {
    return store.getItem(SHELL_FLAG) === '1';
  } catch {
    return false;
  }
}

/** `sessionStorage`, or null where it does not exist or throws on access. */
export function tabStore(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
