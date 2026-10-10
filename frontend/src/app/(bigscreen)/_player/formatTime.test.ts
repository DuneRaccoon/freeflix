/**
 * The ten-foot time readout.
 *
 * THE ROW THAT MATTERS is the pair one: two times drawn from the same duration must have
 * the same field count. The extracted original returned `m:ss` below an hour whatever it
 * was shown beside, so a scrub readout would print `4:12` next to `1:32:00` — two field
 * counts in one readout, three metres away, which reads as a different unit rather than a
 * different time.
 *
 * The first six rows are `PrimaryAction.test.tsx`'s own table, copied deliberately: they
 * are the behaviour the extraction must not change, and that suite still runs them
 * unedited against the re-export.
 */
import { describe, it, expect } from 'vitest';
import { formatTime } from './formatTime';

describe('formatTime', () => {
  it.each([
    [0, '0:00'],
    [59.9, '0:59'],
    [90, '1:30'],
    [3725, '1:02:05'],
    [-5, '0:00'],
    [Number.NaN, '0:00'],
  ])('%s alone -> %s (unchanged from formatResumeTime)', (s, out) => {
    expect(formatTime(s)).toBe(out);
  });

  it('pads against the total, so a scrub readout has one field count', () => {
    // 4:12 of a 1:32:00 film.
    expect(formatTime(252, 5520)).toBe('0:04:12');
    expect(formatTime(5520, 5520)).toBe('1:32:00');
  });

  it('every time drawn from one duration has the same field count', () => {
    // The defect, stated as an invariant rather than as two string literals: whatever the
    // duration, the elapsed readout and the total readout must agree on how many fields
    // they have. Padding against the value's OWN magnitude satisfies the two literals
    // above only by coincidence at 252s; this fails for every crossing value.
    for (const total of [59, 300, 3599, 3600, 5520, 7325]) {
      const fields = formatTime(total, total).split(':').length;
      for (const at of [0, 1, 59, 60, 252, 3599, 3600, total]) {
        if (at > total) continue;
        expect(formatTime(at, total).split(':').length, `${at} of ${total}`).toBe(fields);
      }
    }
  });

  it('does not widen below an hour', () => {
    // The padding is against the total, not unconditional: a 5-minute clip reads `4:12`,
    // not `0:04:12`. A readout that always showed three fields would spend a field on a
    // zero for every short item on the surface.
    expect(formatTime(252, 300)).toBe('4:12');
    expect(formatTime(12, 300)).toBe('0:12');
  });

  it('renders the value in full when the total is smaller than it', () => {
    // The bytes->seconds conversion elsewhere on this surface is CBR arithmetic over a VBR
    // file, so a position can legitimately exceed the duration it was measured against.
    // Truncating the value to the total's field count would print `32:00` for 1:32:00.
    expect(formatTime(5520, 10)).toBe('1:32:00');
  });

  it('ignores a total that is not a usable number', () => {
    // `seekLimitSeconds` answers Number.POSITIVE_INFINITY for an unbounded ceiling and a
    // <video> reports NaN for `duration` before metadata. Neither may reach the string.
    expect(formatTime(252, Number.POSITIVE_INFINITY)).toBe('4:12');
    expect(formatTime(252, Number.NaN)).toBe('4:12');
    expect(formatTime(252, 0)).toBe('4:12');
    expect(formatTime(252, -1)).toBe('4:12');
  });

  it('never emits NaN, Infinity or a minus sign', () => {
    const odd = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -5, -0.4];
    for (const v of odd) {
      for (const total of [undefined, Number.NaN, Number.POSITIVE_INFINITY, 5520]) {
        const out = formatTime(v, total);
        expect(out, `${v} of ${total}`).toMatch(/^\d+(:\d\d){1,2}$/);
      }
    }
  });
});
