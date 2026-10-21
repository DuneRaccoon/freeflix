/**
 * When a typed query is worth asking the box about, and the three numbers that decide it.
 *
 * WHY IT IS NOT IN THE SCREEN. Next validates a page module's exports and rejects anything
 * but its own known fields, so a page cannot hand a constant to its test — and a test that
 * re-types `500` beside the page's own `500` is two numbers to keep in step, which is the
 * drift this surface keeps finding. Putting the rule here makes it one number and gives the
 * predicate a suite of its own.
 */

/**
 * How long after the last keystroke the search goes out.
 *
 * THE RULE THIS REPLACED, and the part of it that survived: there is still no search PER
 * KEYSTROKE — nine requests for a nine-letter title is what a television's network cannot
 * afford. What changed is that the trip to the Search button was the worst thing about the
 * screen: typing a title is about thirty D-pad presses and then six more Downs to reach a
 * control that does what the viewer has already said they want. A pause is the same intent,
 * expressed by stopping.
 *
 * 500ms: long enough that walking the ring from G to H does not spend a request, short
 * enough that the screen feels like it is keeping up.
 */
export const TYPING_PAUSE_MS = 500;

/**
 * Below this nothing is searched automatically. Two characters match a large fraction of
 * the catalog and the answer is useless; a viewer who really wants `UP` presses Search,
 * which is what that control is for now.
 */
export const MIN_AUTO_QUERY = 3;

/**
 * Far beyond any real title, and bounded only so a stuck key cannot grow the query without
 * limit. The press that hits it says so rather than being silently ignored.
 */
export const MAX_QUERY = 60;

/**
 * The query a typing pause should search for, or null for "not yet".
 *
 * `alreadyAsked` IS THE QUERY THAT HAS BEEN ASKED, WHATEVER THE ANSWER WAS, and it is the
 * whole reason this is a function rather than a length check. A FAILED search leaves the
 * query on screen unchanged, so the condition that armed the timer is still true — without
 * this, the screen re-asks a dead box every pause, for ever. "Asked" and "answered" are
 * different facts, and only the first one stops the loop.
 *
 * Trimmed, because the screen's Space key is a character like any other and a trailing one
 * must not make `BAT ` a different question from `BAT`.
 */
export function autoSearchQuery(query: string, alreadyAsked: string): string | null {
  const q = query.trim();
  if (q.length < MIN_AUTO_QUERY) return null;
  if (q === alreadyAsked) return null;
  return q;
}
