import { describe, it, expect } from 'vitest';
import { vacuumLine } from './vacuumLine';
import type { VacuumStatus } from '@/types';

const NOW = Date.parse('2026-11-07T10:00:00Z');
const at = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const s = (status: VacuumStatus, h: number | null) => ({
  status,
  deletes_at: h === null ? null : at(h),
});

describe('vacuumLine', () => {
  it('is null when off or absent', () => {
    expect(vacuumLine(s('off', null), NOW)).toBeNull();
    expect(vacuumLine(undefined, NOW)).toBeNull();
    expect(vacuumLine(null, NOW)).toBeNull();
  });
  it('says why a download is kept', () => {
    expect(vacuumLine(s('kept_watching', null), NOW)).toBe('Kept: not everyone has finished it');
  });
  it('says tonight within one run', () => {
    expect(vacuumLine(s('scheduled', 18), NOW)).toBe('Deletes tonight');
    expect(vacuumLine(s('scheduled', 24), NOW)).toBe('Deletes tonight');
    expect(vacuumLine(s('scheduled', -2), NOW)).toBe('Deletes tonight');
  });
  it('counts nightly runs left', () => {
    expect(vacuumLine(s('scheduled', 24 + 1 / 60), NOW)).toBe('Deletes in 2 days');
    expect(vacuumLine(s('scheduled', 288), NOW)).toBe('Deletes in 12 days');
  });
  it('renders active like scheduled', () => {
    expect(vacuumLine(s('active', 306), NOW)).toBe('Deletes in 13 days');
  });
  it('is null without a deletes_at', () => {
    expect(vacuumLine(s('scheduled', null), NOW)).toBeNull();
    expect(vacuumLine(s('active', null), NOW)).toBeNull();
    expect(vacuumLine({ status: 'scheduled' }, NOW)).toBeNull();
  });
});
