/**
 * A clock time for the ten-foot readout, padded against the duration it is shown beside.
 *
 * Extracted verbatim from `_components/PrimaryAction.tsx`'s `formatResumeTime`, for the
 * reason `watchHref.ts` gives for existing: a screen test that mocks one thing should not
 * take the formatter away with it. The transport bar, the scrub readout and the detail
 * screen's "Resume from …" label all draw a time, and a second copy of this arithmetic is
 * how two of them end up disagreeing. `PrimaryAction` now re-exports this under the old
 * name, so its own table still runs unedited.
 *
 * PADDED AGAINST THE TOTAL, which is the whole reason for the second argument. The
 * original answered `m:ss` below an hour and `h:mm:ss` above it, decided by its own value
 * — so a scrub cell would print `4:12` next to `1:32:00`. Two field counts in one readout,
 * read from three metres away, is a change of unit rather than a change of time. The field
 * count is therefore decided by the LARGER of the value and the total, so every time drawn
 * from one duration has the same shape, and a value that overshoots its total (the
 * bytes-to-seconds conversion on this surface is CBR arithmetic over a VBR file, so it
 * legitimately can) still renders in full rather than being truncated into the total's
 * shape.
 *
 * A total that is not a usable positive number is ignored rather than trusted:
 * `seekLimitSeconds` answers `Number.POSITIVE_INFINITY` for an unbounded ceiling and a
 * `<video>` reports `NaN` for `duration` until metadata lands, and `Infinity:NaN:NaN` on a
 * television is worse than an unpadded time.
 */
export function formatTime(seconds: number, totalSeconds?: number): string {
  const s = clean(seconds);
  // Math.max, not the total alone: a value past the end still renders in full.
  const widest = Math.max(s, clean(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return widest >= 3600 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/**
 * Whole seconds, never negative, never NaN or Infinity. `Number(x) || 0` alone (the
 * original) already answered 0 for NaN; `Number.isFinite` is what keeps an infinite
 * ceiling from becoming an infinite loop of digits.
 */
function clean(value: number | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}
