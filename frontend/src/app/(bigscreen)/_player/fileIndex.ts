/**
 * The arrival's `?file=`, and the stream URL built from it.
 *
 * THE HAZARD IS A SILENT WRONG EPISODE. `watchHref` is THE ONLY builder of a watch URL on
 * this surface and it uses `!= null`, not truthiness, because **file 0 is the first file of
 * a season pack** (`_data/watchHref.ts`, pinned at `watchHref.test.ts:13`). The reader has
 * to mirror it exactly: null check -> `Number()` -> integer -> non-negative, normalised to
 * `number | undefined` and **never `null`**.
 *
 * ONE `null` ESCAPING PRODUCES TWO DIFFERENT SILENT FAILURES, and the quiet one is worse:
 *
 *   - `getStreamingUrl` gates on `!== undefined`, so `null` emits the literal
 *     `?file_index=null` -> FastAPI answers **422 with a JSON body**, which a raw
 *     `<video src>` hands to its decoder and reports as corrupt media.
 *   - `getStreamingInfo` passes it to axios, which **drops a null param**. So `/info`
 *     silently resolves `max(files, key=size)` and returns THAT file's `content_id`,
 *     `season` and `episode` — which the progress heartbeat then writes. Nothing fails and
 *     nothing is logged; the viewer's history simply gains an episode they did not watch.
 *
 * `?file=` with nothing after it is therefore **undefined, not 0**: `Number('') === 0` (and
 * `Number('   ') === 0` too), and the web page maps its equivalent to 0, which is why a
 * truncated URL there plays the first file. `Number.isSafeInteger` rather than
 * `Number.isInteger`, because `Number.isInteger(1e21)` is true while `String(1e21)` is
 * `'1e+21'` — not a decimal integer, so it reaches the backend as the 422 above. Every
 * value this can answer therefore stringifies to digits.
 *
 * NEVER `/info`'s `stream_url`. It appends `?file_index=` only when the **caller** passed
 * one, while the sibling `file_index` field reports the **resolved** index — so the two
 * disagree on exactly the one arrival allowed to be bare, and trusting `stream_url` there
 * plays one file while the heartbeat records another.
 */

/**
 * The file index an arrival asked for, or `undefined` for "no file chosen".
 *
 * Takes the raw query value — `useSearchParams().get('file')` answers `string | null` — so
 * the null check is the reader's job and not the caller's.
 */
export function fileIndex(raw: string | null | undefined): number | undefined {
  if (raw == null) return undefined;
  // Before Number(), because Number('') and Number('   ') are both 0.
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) return undefined;
  if (n < 0) return undefined;
  return n;
}

/**
 * The `<video src>` for a torrent, with `?file_index=` when a file was chosen.
 *
 * NO `quality`. `/video` accepts the parameter and never reads it, so passing it changes
 * the URL — and therefore the browser's cache key and the `src` the recovery ladder
 * reloads — for nothing.
 *
 * A COPY OF `getStreamingUrl`, PINNED RATHER THAN DELEGATED. Nothing under `_player/` may
 * import `@/services/streaming` (`engineContract.test.ts`): `apiClient`'s rejection
 * interceptor hard-navigates to `/bigscreen/pair` from inside its own handler, so the
 * player engine must not pull that module into its graph. `fileIndex.test.ts` therefore
 * value-imports the real `getStreamingUrl` and asserts this answers the same string for
 * every id and every index `fileIndex` can produce — the shape `_data/railsDrift.test.ts`
 * and the TV token pin already use for a deliberate copy.
 *
 * `null` for no torrent, mirroring `getStreamingUrl`: a URL with an empty id
 * (`/api/v1/streaming//video`) is a request that cannot succeed, and the type makes the
 * caller say what it shows instead.
 */
export function streamSrc(
  torrentId: string | null | undefined,
  index?: number,
): string | null {
  if (!torrentId) return null;
  const base = `/api/v1/streaming/${torrentId}/video`;
  // `!== undefined`, so index 0 carries. Every value `fileIndex` answers is a non-negative
  // safe integer, so `${index}` is decimal digits and needs no escaping.
  return index !== undefined ? `${base}?file_index=${index}` : base;
}
