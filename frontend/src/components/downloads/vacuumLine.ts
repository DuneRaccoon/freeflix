import type { VacuumInfo } from '@/types';

export const KEPT_LINE = 'Kept: not everyone has finished it';

const DAY_MS = 86_400_000;

/**
 * The autovacuum line under a download row, or null for nothing to say.
 * `n` counts the nightly 04:00 runs left; the next run is never more than 24 h
 * away, so "1 day" cannot occur and 1 reads as tonight.
 */
export function vacuumLine(info: VacuumInfo | null | undefined, nowMs: number): string | null {
  if (!info || info.status === 'off') return null;
  if (info.status === 'kept_watching') return KEPT_LINE;
  if (info.deletes_at == null) return null;
  const n = Math.ceil((Date.parse(info.deletes_at) - nowMs) / DAY_MS);
  return n <= 1 ? 'Deletes tonight' : `Deletes in ${n} days`;
}
