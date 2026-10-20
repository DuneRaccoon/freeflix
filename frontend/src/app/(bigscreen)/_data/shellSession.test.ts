/**
 * The one channel the webOS shell has to the app, and the rule that it is a TAB fact.
 *
 * Every row here feeds a Storage in by hand rather than touching a global, because the two
 * stores this module distinguishes are the whole point: getting `localStorage` instead of
 * `sessionStorage` is the defect, and a test that used the ambient one could not tell them
 * apart.
 */
import { describe, it, expect } from 'vitest';
import { captureShell, isInShell, SHELL_FLAG, tabStore } from './shellSession';

/** A Storage that records, and optionally throws the way a blocked one does. */
function fakeStore(opts: { throwOnWrite?: boolean; throwOnRead?: boolean } = {}): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => {
      if (opts.throwOnRead) throw new DOMException('blocked');
      return map.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (opts.throwOnWrite) throw new DOMException('quota');
      map.set(k, v);
    },
    removeItem: (k: string) => { map.delete(k); },
  } as Storage;
}

describe('capturing the shell flag', () => {
  it('remembers ?from=app', () => {
    const s = fakeStore();
    captureShell('?from=app', s);
    expect.soft(s.getItem(SHELL_FLAG)).toBe('1');
    expect.soft(isInShell(s)).toBe(true);
  });

  it('ignores every other parameter and value', () => {
    for (const search of ['', '?', '?from=web', '?from=', '?other=app', '?from=App', '?fromapp']) {
      const s = fakeStore();
      captureShell(search, s);
      expect.soft(isInShell(s), search).toBe(false);
    }
  });

  it('survives the parameter going away, which it does on the first navigation', () => {
    // THE RULE THIS MODULE EXISTS FOR. `?from=app` is on the first document and gone after one
    // `router.push`. A capture that cleared the flag when the parameter was absent would turn
    // the app off one screen in — and the screen that reads it, home, is often reached by a
    // push from the profile picker.
    const s = fakeStore();
    captureShell('?from=app', s);
    captureShell('', s);
    captureShell('?q=anything', s);
    expect(isInShell(s)).toBe(true);
  });

  it('is idempotent', () => {
    const s = fakeStore();
    captureShell('?from=app', s);
    captureShell('?from=app', s);
    expect(s.length).toBe(1);
  });

  it('treats a null store, a blocked write and a blocked read as "not the app"', () => {
    // A webOS app with site data blocked, or Safari private mode, throws on ACCESS. The app
    // still has to run; Back at the root simply behaves as it does in a browser.
    captureShell('?from=app', null);
    expect.soft(isInShell(null)).toBe(false);
    const w = fakeStore({ throwOnWrite: true });
    expect.soft(() => captureShell('?from=app', w)).not.toThrow();
    expect.soft(isInShell(w)).toBe(false);
    const r = fakeStore({ throwOnRead: true });
    expect.soft(isInShell(r)).toBe(false);
  });

  it('reads a flag it did not write, and refuses a value it would not have written', () => {
    const s = fakeStore();
    s.setItem(SHELL_FLAG, '1');
    expect.soft(isInShell(s), 'a flag from an earlier screen in this tab').toBe(true);
    const poisoned = fakeStore();
    poisoned.setItem(SHELL_FLAG, 'true');
    expect.soft(isInShell(poisoned), 'only the exact value').toBe(false);
  });
});

describe('tabStore', () => {
  it('hands back the SESSION store, not the device one', () => {
    // The distinction is the decision. In `localStorage` the flag would outlive the app, and a
    // desktop browser opened later at the same address would believe it could `window.close()`
    // — which, on a tab the script did not open, does nothing and leaves Back silently dead.
    const store = tabStore();
    expect.soft(store).toBe(window.sessionStorage);
    expect.soft(store).not.toBe(window.localStorage);
  });

  it('is what the flag actually round-trips through', () => {
    window.sessionStorage.removeItem(SHELL_FLAG);
    captureShell('?from=app', tabStore());
    expect.soft(window.sessionStorage.getItem(SHELL_FLAG)).toBe('1');
    expect.soft(window.localStorage.getItem(SHELL_FLAG), 'and never the device store').toBeNull();
    window.sessionStorage.removeItem(SHELL_FLAG);
  });
});
