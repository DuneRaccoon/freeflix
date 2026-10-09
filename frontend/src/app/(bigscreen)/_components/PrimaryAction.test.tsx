import { describe, it, expect } from 'vitest';
import type { TitleAction } from '../_data/title';
import { describeAction, formatResumeTime, UNRESOLVED_NOTE } from './PrimaryAction';

describe('formatResumeTime', () => {
  it.each([
    [0, '0:00'],
    [59.9, '0:59'],
    [90, '1:30'],
    [3725, '1:02:05'],
    [-5, '0:00'],
    [Number.NaN, '0:00'],
  ])('%s -> %s', (s, out) => expect(formatResumeTime(s)).toBe(out));
});

describe('describeAction', () => {
  const cases: Array<[TitleAction, string, boolean]> = [
    [{ kind: 'play' }, 'Play', false],
    [{ kind: 'resume', href: '/w/1', atSeconds: 60 }, 'Resume from 1:00', true],
    [{ kind: 'open', href: '/w/1' }, 'Open', true],
    [{ kind: 'preparing', torrentId: 't', progress: 9.4 }, 'Preparing… 9%', true],
    [{ kind: 'paused', torrentId: 't' }, 'Resume download', false],
    [{ kind: 'unresolvedEpisode', href: '/w/1' }, 'Play anyway', true],
    [{ kind: 'blocked', reason: 'no' }, 'Check again', false],
  ];
  it.each(cases)('%j', (action, label, isLink) => {
    const v = describeAction(action);
    expect(v.label).toBe(label);
    expect(Boolean(v.href)).toBe(isLink);
  });

  it('a pack preparing carries its file into the href (file 0 included); without one it has none', () => {
    expect(describeAction({ kind: 'preparing', torrentId: 't', progress: 1, fileIndex: 4 }).href).toBe('/bigscreen/watch/t?file=4');
    expect(describeAction({ kind: 'preparing', torrentId: 't', progress: 1, fileIndex: 0 }).href).toBe('/bigscreen/watch/t?file=0');
    expect(describeAction({ kind: 'preparing', torrentId: 't', progress: 1 }).href).toBe('/bigscreen/watch/t');
  });

  it('only unresolvedEpisode carries the disclosure', () => {
    for (const [action] of cases) {
      expect(describeAction(action).note).toBe(action.kind === 'unresolvedEpisode' ? UNRESOLVED_NOTE : undefined);
    }
  });

  it('relabels while busy', () => {
    expect(describeAction({ kind: 'play' }, 'starting').label).toBe('Starting…');
    expect(describeAction({ kind: 'paused', torrentId: 't' }, 'resuming').label).toBe('Resuming…');
    expect(describeAction({ kind: 'blocked', reason: 'x' }, 'checking').label).toBe('Checking…');
  });
});
