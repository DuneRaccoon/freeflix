/**
 * `_data/nextEpisode.ts` — the television half: the cell's words, the end prompt, the
 * prefetch and the press. The catalog half (`findNextEpisode`, `episodeScaleSeconds`,
 * `pastAutoNextPoint`) and its `@/services/tv` driving live in `src/lib/nextEpisode.test.ts`.
 *
 * `_data/title` IS MOCKED HERE: the prefetch's and the press's rules are about which of
 * `titleStateFor`'s eight answers may start a download and which may be navigated to, so the
 * thing to drive is the ANSWER. Those eight answers have their own suite (`title.test.ts`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextEpisodeAnswer } from '@/lib/nextEpisode';
import { requestTitle, resumeTitle, titleStateFor, type TitleAction } from './title';
import {
  END_PROMPT_S,
  NEXT_CELL_STATES,
  episodeTag,
  nearTheEnd,
  nextCellView,
  prefetchEpisode,
  whereToWatchEpisode,
} from './nextEpisode';

vi.mock('./title', () => ({
  titleStateFor: vi.fn(),
  requestTitle: vi.fn(),
  resumeTitle: vi.fn(),
}));

const title = vi.mocked({ titleStateFor, requestTitle, resumeTitle });

const state = (action: TitleAction, locked = false) => ({ action, locked });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('episodeTag', () => {
  it('pads both numbers, so a season reads the same at 2 and at 12', () => {
    expect(episodeTag({ season: 2, episode: 4 })).toBe('S02 · E04');
    expect(episodeTag({ season: 12, episode: 104 })).toBe('S12 · E104');
  });
});

describe('nextCellView', () => {
  const ready: NextEpisodeAnswer = {
    verdict: { k: 'ready', next: { season: 2, episode: 3, name: 'Three' } },
    runtimeS: null,
  };

  it('says the episode’s own number once it knows one', () => {
    expect(nextCellView(ready, false)).toEqual({ stateId: 'ready', note: 'S02 · E03' });
  });

  it('has a word for every state, and the state is the attribute', () => {
    const seen = new Set<string>();
    const views = [
      nextCellView(null, false),
      nextCellView(ready, false),
      nextCellView(ready, true),
      nextCellView({ verdict: { k: 'none' }, runtimeS: null }, false),
      nextCellView({ verdict: { k: 'unknown' }, runtimeS: null }, false),
    ];
    for (const v of views) {
      expect(v.note.length, v.stateId).toBeGreaterThan(2);
      seen.add(v.stateId);
    }
    // Every declared state is reachable, and nothing reachable is undeclared: the union is
    // derived from NEXT_CELL_STATES, so this is the row that keeps the array honest.
    expect([...seen].sort()).toEqual([...NEXT_CELL_STATES].sort());
  });

  it('lets a press in flight outrank everything, including a lookup that has not answered', () => {
    // A press that appears to do nothing is the defect this surface refuses everywhere, and
    // the press can take tens of seconds (it may run a provider search).
    expect(nextCellView(null, true).stateId).toBe('starting');
    expect(nextCellView(ready, true).stateId).toBe('starting');
    expect(nextCellView({ verdict: { k: 'none' }, runtimeS: null }, true).stateId).toBe('starting');
  });

  it('never says "the series has ended"', () => {
    // TMDB listing nothing after this episode is also what an unannounced next season looks
    // like, so the words have to be about the catalog and not about the programme.
    const note = nextCellView({ verdict: { k: 'none' }, runtimeS: null }, false).note;
    expect(note).not.toMatch(/end|final|last/i);
  });
});

// =====================================================================================
// The scale, and the two thresholds built on it
// =====================================================================================

describe('nearTheEnd', () => {
  it('is the last END_PROMPT_S seconds, in both directions', () => {
    const total = 1000;
    expect(nearTheEnd(total - END_PROMPT_S - 1, total)).toBe(false);
    expect(nearTheEnd(total - END_PROMPT_S, total)).toBe(true);
    expect(nearTheEnd(total, total)).toBe(true);
  });

  it('says nothing when nothing can say how long the episode is', () => {
    // Which is the honest answer rather than a limitation: with no scale there is no "end"
    // to be near, and a guess would put a 480px band over the picture at the wrong moment.
    expect(nearTheEnd(900, null)).toBe(false);
    expect(nearTheEnd(0, 1000)).toBe(false);
  });

  it('is shorter than the window the prefetch opens, even at the HIGHEST threshold the owner can pick', () => {
    // The slider's top stop is 95% (spec §5.1; Part D's OwnerSettingsUpdate.auto_next_pct
    // accepts at most 95). At 95% a 20-minute episode leaves 60 s — the prompt must not
    // precede the download it invites the viewer to use.
    // Whole percents: `1200 * (1 - 0.95)` is 60.00000000000005 in floating point, which would
    // let END_PROMPT_S = 60 slip past a strict `>`.
    const WORST_PCT = 95;
    const shortest = 20 * 60;
    expect((shortest * (100 - WORST_PCT)) / 100).toBeGreaterThan(END_PROMPT_S); // 60 > 45
  });
});

// =====================================================================================
// prefetchEpisode — the one function here that can start a download
// =====================================================================================

describe('prefetchEpisode', () => {
  const ARGS = { tmdbId: 7, season: 2, episode: 3, userId: 'p1' };

  it('starts a download only when NOTHING on the box covers the episode', async () => {
    title.titleStateFor.mockResolvedValue(state({ kind: 'play' }));
    title.requestTitle.mockResolvedValue({ ok: true, torrentId: 't9' });
    await expect(prefetchEpisode(ARGS)).resolves.toBe(true);
    expect(title.requestTitle).toHaveBeenCalledWith({ mediaType: 'tv', tmdbId: 7, season: 2, episode: 3 });
  });

  it('starts NOTHING for every other answer, which is the season-pack case', async () => {
    // THE ONE THAT MATTERS. The episode on screen usually came from a season pack, and
    // `covers()` matches that pack for the next episode too — so the answer is `open` or
    // `preparing` and there is nothing to download. `POST /download` mints a fresh uuid with
    // no dedupe, so a second call here is a second multi-gigabyte copy of a season the box
    // already has, on a machine that allows two downloads.
    const others: TitleAction[] = [
      { kind: 'open', href: '/bigscreen/watch/t1?file=3' },
      { kind: 'resume', href: '/bigscreen/watch/t1?file=3', atSeconds: 60 },
      { kind: 'preparing', torrentId: 't1', progress: 10 },
      { kind: 'paused', torrentId: 't1' },
      { kind: 'unresolvedEpisode', href: '/bigscreen/watch/t1' },
      { kind: 'blocked', reason: 'no' },
    ];
    for (const action of others) {
      vi.clearAllMocks();
      title.titleStateFor.mockResolvedValue(state(action));
      await expect(prefetchEpisode(ARGS), action.kind).resolves.toBe(true);
      expect(title.requestTitle, action.kind).not.toHaveBeenCalled();
    }
  });

  it('never downloads for a locked profile', async () => {
    // `titleStateFor` answers `blocked` with `locked: true` and never `play`, so this is the
    // same arm as any other refusal — asserted because "the lock is what stops it" is the
    // kind of claim that is true by accident until somebody adds an arm.
    title.titleStateFor.mockResolvedValue(state({ kind: 'blocked', reason: 'locked' }, true));
    await expect(prefetchEpisode(ARGS)).resolves.toBe(true);
    expect(title.requestTitle).not.toHaveBeenCalled();
  });

  it('reports a refusal, which is the only thing the band says about this', async () => {
    title.titleStateFor.mockResolvedValue(state({ kind: 'play' }));
    title.requestTitle.mockResolvedValue({ ok: false, reason: 'busy', maybeCreated: false });
    await expect(prefetchEpisode(ARGS)).resolves.toBe(false);
  });

  it('is TOTAL: a throw is `false`, not an unhandled rejection in a television', async () => {
    // The caller fires this from an effect with `void`. Both awaits inside are documented as
    // resolving rather than rejecting, so this is unreachable today — the guard is at the
    // source precisely because the call site cannot see it.
    title.titleStateFor.mockRejectedValue(new Error('boom'));
    await expect(prefetchEpisode(ARGS)).resolves.toBe(false);
  });
});

// =====================================================================================
// whereToWatchEpisode — the press
// =====================================================================================

describe('whereToWatchEpisode', () => {
  const ARGS = { tmdbId: 7, season: 2, episode: 3, userId: 'p1' };

  it('goes straight to a torrent that is here', async () => {
    title.titleStateFor.mockResolvedValue(state({ kind: 'open', href: '/bigscreen/watch/t1?file=3' }));
    await expect(whereToWatchEpisode(ARGS)).resolves.toEqual({ ok: true, href: '/bigscreen/watch/t1?file=3' });
  });

  it('resumes where the viewer was, if they had started this episode before', async () => {
    title.titleStateFor.mockResolvedValue(
      state({ kind: 'resume', href: '/bigscreen/watch/t1?file=3', atSeconds: 120 }),
    );
    await expect(whereToWatchEpisode(ARGS)).resolves.toEqual({ ok: true, href: '/bigscreen/watch/t1?file=3' });
  });

  it('goes to an episode that is still downloading, with its file index', async () => {
    title.titleStateFor.mockResolvedValue(state({ kind: 'preparing', torrentId: 't1', progress: 12, fileIndex: 7 }));
    await expect(whereToWatchEpisode(ARGS)).resolves.toEqual({ ok: true, href: '/bigscreen/watch/t1?file=7' });
  });

  it('REFUSES a pack whose file it cannot name, rather than playing the wrong episode', async () => {
    // THE REASON THIS FUNCTION EXISTS INSTEAD OF REUSING THE SHOW SCREEN'S `placeToWatch`.
    // There it is offered behind a disclosure the viewer reads first; there is nowhere on a
    // transport cell to print one, and a bare URL plays the pack's DEFAULT file, i.e.
    // episode 1. Pressing "Next episode" and getting some other episode with no word about
    // it is exactly the defect `unresolvedEpisode` was invented to prevent.
    for (const action of [
      { kind: 'unresolvedEpisode', href: '/bigscreen/watch/t1' } as TitleAction,
      { kind: 'preparing', torrentId: 't1', progress: 12, fileUnknown: true } as TitleAction,
      { kind: 'paused', torrentId: 't1', fileUnknown: true } as TitleAction,
    ]) {
      vi.clearAllMocks();
      title.titleStateFor.mockResolvedValue(state(action));
      const answer = await whereToWatchEpisode(ARGS);
      expect(answer.ok, action.kind).toBe(false);
      expect(answer.ok === false && answer.reason.length, action.kind).toBeGreaterThan(10);
      expect(title.requestTitle, action.kind).not.toHaveBeenCalled();
    }
  });

  it('resumes a paused download rather than leaving the press dead', async () => {
    title.titleStateFor.mockResolvedValue(state({ kind: 'paused', torrentId: 't1', fileIndex: 2 }));
    title.resumeTitle.mockResolvedValue({ ok: true });
    await expect(whereToWatchEpisode(ARGS)).resolves.toEqual({ ok: true, href: '/bigscreen/watch/t1?file=2' });
    expect(title.resumeTitle).toHaveBeenCalledWith('t1');
  });

  it('says why when a paused download cannot be resumed', async () => {
    title.titleStateFor.mockResolvedValue(state({ kind: 'paused', torrentId: 't1', fileIndex: 2 }));
    title.resumeTitle.mockResolvedValue({ ok: false, reason: 'It may have been removed.' });
    await expect(whereToWatchEpisode(ARGS)).resolves.toEqual({ ok: false, reason: 'It may have been removed.' });
  });

  it('starts the download when nothing has, because the prefetch is a setting', async () => {
    title.titleStateFor.mockResolvedValue(state({ kind: 'play' }));
    title.requestTitle.mockResolvedValue({ ok: true, torrentId: 't9', fileIndex: 1 });
    await expect(whereToWatchEpisode(ARGS)).resolves.toEqual({ ok: true, href: '/bigscreen/watch/t9?file=1' });
  });

  it('refuses when the box answers a pack it cannot resolve the file in', async () => {
    title.titleStateFor.mockResolvedValue(state({ kind: 'play' }));
    title.requestTitle.mockResolvedValue({ ok: true, torrentId: 't9', unresolved: true });
    const answer = await whereToWatchEpisode(ARGS);
    expect(answer.ok).toBe(false);
    // ...and it says the download DID start, because it did: a viewer told only "no" would
    // press again and mint a second copy.
    expect(answer.ok === false && answer.reason).toMatch(/started/i);
  });

  it('passes the box’s own refusal through, word for word', async () => {
    title.titleStateFor.mockResolvedValue(state({ kind: 'play' }));
    title.requestTitle.mockResolvedValue({
      ok: false,
      reason: 'The box is busy with other downloads. Try again in a few minutes.',
      maybeCreated: false,
    });
    await expect(whereToWatchEpisode(ARGS)).resolves.toEqual({
      ok: false,
      reason: 'The box is busy with other downloads. Try again in a few minutes.',
    });
  });

  it('passes a blocked title’s reason through', async () => {
    title.titleStateFor.mockResolvedValue(state({ kind: 'blocked', reason: 'Nothing this television can play.' }));
    await expect(whereToWatchEpisode(ARGS)).resolves.toEqual({
      ok: false,
      reason: 'Nothing this television can play.',
    });
  });

  it('answers rather than throwing when the box cannot be reached', async () => {
    // A throw inside the player is a film that stops.
    title.titleStateFor.mockRejectedValue(new Error('offline'));
    const answer = await whereToWatchEpisode(ARGS);
    expect(answer.ok).toBe(false);
    expect(answer.ok === false && answer.reason).toMatch(/reach the box/i);
  });
});
