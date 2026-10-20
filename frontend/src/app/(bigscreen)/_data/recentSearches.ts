/**
 * The last few searches that found something, so a viewer does not type them twice.
 *
 * WHY IT IS WORTH STORING AT ALL: entering "The Lighthouse Keeper" on a D-pad is about
 * fifty presses. A household searches for the same handful of shows, and the second time
 * should be one press. This is the only text on the surface worth remembering beyond the
 * session, which is why it is the one thing here that uses `localStorage` rather than
 * `sessionStorage` — the search screen's in-progress query and results are per-visit and
 * stay where they were.
 *
 * ONLY SEARCHES THAT FOUND SOMETHING GO IN. A typo that returned nothing is not a shortcut
 * anybody wants offered back to them, and a list of a viewer's mistakes is worse than no
 * list. The caller decides; this module only stores what it is given.
 *
 * EVERY TOUCH IS WRAPPED, like every other storage read on this surface: it throws on access
 * on a television in a restricted mode, comes back empty in a private window, and losing the
 * list is harmless. A screen that will not render is not.
 *
 * WHAT COMES BACK OUT IS NOT TRUSTED. Another build may have written it and a browser may
 * hand back something truncated, so the rows are re-validated on read with the same rules
 * that applied on the way in — the posture `readSaved` in the search screen already takes.
 */

/** Not namespaced per profile: this is a household's television, and the box is shared. */
const KEY = 'bs-search:recent';

/**
 * How many to keep. Enough to cover what a household is watching this month, few enough to
 * sit in one non-wrapping row beside the safe inset — the focus model counts one row per
 * container, so a list that wrapped would draw one focus row on two visual lines.
 */
export const MAX_RECENT = 6;

/** The longest a stored entry may be, matching the screen's own query cap. */
const MAX_LENGTH = 60;

const clean = (q: unknown): string | null => {
  if (typeof q !== 'string') return null;
  const trimmed = q.trim().slice(0, MAX_LENGTH);
  return trimmed === '' ? null : trimmed;
};

export function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const row of parsed) {
      const q = clean(row);
      // Deduplicated on the way out as well as in: a list written by an older build (or by
      // a half-finished write) may hold a repeat, and the same query twice in one row is
      // two focus stops that do the same thing.
      if (q && !out.some((seen) => seen.toLowerCase() === q.toLowerCase())) out.push(q);
      if (out.length >= MAX_RECENT) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Put `query` at the front, deduplicated case-insensitively, and drop the oldest.
 *
 * CASE-INSENSITIVE, because the keyboard is upper case and a query restored from a recent
 * entry is not: "BATMAN" and "Batman" are one search to a viewer, and two rows of it is the
 * list eating itself. The NEWEST spelling wins, so pressing a stored entry and searching
 * again does not rewrite it into something the viewer did not type.
 *
 * Returns the new list, so the caller can render it without a second read.
 */
export function rememberSearch(query: string): string[] {
  const q = clean(query);
  if (!q) return readRecent();
  const next = [q, ...readRecent().filter((seen) => seen.toLowerCase() !== q.toLowerCase())].slice(
    0,
    MAX_RECENT,
  );
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* nothing to do: losing the list is harmless, and `next` is still what to draw now */
  }
  return next;
}
