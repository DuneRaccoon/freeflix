import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Episode } from '@/types';
import type { EpisodeTrace } from '../_data/showProgress';
import { EpisodeList, airDateLabel, episodeRowCount, seasonTally } from './EpisodeList';
import type { FocusProps } from '../_focus/useFocusGrid';

const ep = (n: number, over: Partial<Episode> = {}): Episode => ({
  episode_number: n, name: `Name ${n}`, overview: null, runtime: null, still_url: null, air_date: null, vote_average: 0, ...over,
});
const fp = (): ((row: number, col: number) => FocusProps) => () => ({ tabIndex: -1, ref: () => {}, onFocus: () => {} });

const css = readFileSync(join(process.cwd(), 'public/bigscreen.css'), 'utf8');
const hasRule = (selector: string): boolean =>
  new RegExp(`(?:^|[\\n,])\\s*${selector.replace(/[.\-]/g, '\\$&')}\\s*[,{:]`).test(css);

/** A trace map written the short way. `remainingS` is opt-in: most rows do not care. */
const traces = (
  ...pairs: Array<[number, EpisodeTrace['mark']] | [number, EpisodeTrace['mark'], Partial<EpisodeTrace>]>
): Map<number, EpisodeTrace> =>
  new Map(
    pairs.map(([n, mark, over]) => [
      n,
      { mark, percentage: mark === 'watched' ? 100 : 50, remainingS: null, ...(over ?? {}) },
    ]),
  );

describe('EpisodeList', () => {
  it('renders one button per episode with number, title and runtime', () => {
    render(<EpisodeList episodes={[ep(1, { runtime: 42 }), ep(2)]} traces={new Map()} loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /1.*Name 1.*42m/ })).toBeInTheDocument();
  });
  it('draws no runtime (and no bare "m") when TMDB has none', () => {
    render(<EpisodeList episodes={[ep(1, { runtime: null }), ep(2, { runtime: 0 })]} traces={new Map()} loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null} />);
    for (const b of screen.getAllByRole('button')) expect(b.textContent).not.toMatch(/m$/);
    expect(document.querySelector('.bs-ep__meta')).toBeNull();
  });
  it('falls back to "Episode N" when TMDB has no title', () => {
    render(<EpisodeList episodes={[ep(4, { name: '' })]} traces={new Map()} loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null} />);
    expect(screen.getByRole('button', { name: /Episode 4/ })).toBeInTheDocument();
  });
  it('shows watched and in-progress markers from the data it is given', () => {
    render(<EpisodeList episodes={[ep(1), ep(2), ep(3)]} traces={traces([1, 'watched'], [2, 'started'])} loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null} />);
    expect(screen.getByRole('button', { name: /Name 1.*Watched/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Name 2.*In progress/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Name 3/ })).not.toHaveTextContent(/Watched|In progress/);
  });
  it('has zero focusable cells while loading, and says it is loading', () => {
    render(<EpisodeList episodes={[ep(1)]} traces={new Map()} loading firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent(/loading episodes/i);
    expect(episodeRowCount([ep(1)], true)).toBe(0);
  });
  it('counts exactly the rows it renders', () => {
    const eps = [ep(1), ep(2), ep(3)];
    const { container } = render(<EpisodeList episodes={eps} traces={new Map()} loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null} />);
    expect(container.querySelectorAll('button')).toHaveLength(episodeRowCount(eps, false));
  });
  it('gives each episode its own grid row, starting at firstRow', () => {
    const calls: Array<[number, number]> = [];
    render(<EpisodeList episodes={[ep(1), ep(2)]} traces={new Map()} loading={false} firstRow={5} focusProps={(r, c) => { calls.push([r, c]); return { tabIndex: -1, ref: () => {}, onFocus: () => {} }; }} onPress={() => {}} busyEpisode={null} />);
    expect(calls).toEqual([[5, 0], [6, 0]]);
  });
  it('presses with the episode, and labels the busy one', () => {
    const onPress = vi.fn();
    render(<EpisodeList episodes={[ep(1), ep(2)]} traces={new Map()} loading={false} firstRow={2} focusProps={fp()} onPress={onPress} busyEpisode={2} />);
    fireEvent.click(screen.getByRole('button', { name: /Name 1/ }));
    expect(onPress).toHaveBeenLastCalledWith(expect.objectContaining({ episode_number: 1 }));
    fireEvent.click(screen.getByRole('button', { name: /Name 2/ }));
    expect(onPress).toHaveBeenLastCalledWith(expect.objectContaining({ episode_number: 2 }));
    expect(screen.getByRole('button', { name: /Name 2.*Checking/ })).toHaveAttribute('aria-busy', 'true');
  });

  // =================================================================================
  // The trace: the still, the bar, the tick, the tally
  // =================================================================================

  it('draws TMDB’s still at the size this surface actually renders', () => {
    // `still_url` arrives as `w300` and the box is 256 CSS px — a 2x upscale on a 4K panel.
    render(
      <EpisodeList
        episodes={[ep(1, { still_url: 'https://image.tmdb.org/t/p/w300/abc.jpg' })]}
        traces={new Map()} loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null}
      />,
    );
    const img = document.querySelector('img.bs-ep__thumb') as HTMLImageElement | null;
    expect(img?.getAttribute('src')).toBe('https://image.tmdb.org/t/p/w500/abc.jpg');
    // Lazy, because a 24-episode season is 24 requests the viewer has not scrolled to yet,
    // and not draggable, because Magic Remote jitter during an OK press can start a drag and
    // a drag swallows the click (`Card` carries the same pair for the same reason).
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('draggable')).toBe('false');
  });

  it('draws the episode number in place of a still there is none of', () => {
    render(<EpisodeList episodes={[ep(7)]} traces={new Map()} loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null} />);
    expect(document.querySelector('img.bs-ep__thumb')).toBeNull();
    expect(document.querySelector('.bs-ep__thumb--blank')?.textContent).toBe('7');
  });

  it('puts a bar on a part-watched episode and a tick on a finished one, and neither on an untouched one', () => {
    const { container } = render(
      <EpisodeList
        episodes={[ep(1), ep(2), ep(3)]}
        traces={traces([1, 'watched'], [2, 'started', { percentage: 37 }])}
        loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null}
      />,
    );
    const rows = [...container.querySelectorAll('li')];
    expect(rows[0].querySelector('.bs-ep__tick')).not.toBeNull();
    expect(rows[0].querySelector('.bs-ep__bar')).toBeNull();
    const fill = rows[1].querySelector('.bs-ep__bar > span') as HTMLElement | null;
    expect(fill?.style.width).toBe('37%');
    expect(rows[1].querySelector('.bs-ep__tick')).toBeNull();
    expect(rows[2].querySelector('.bs-ep__bar')).toBeNull();
    expect(rows[2].querySelector('.bs-ep__tick')).toBeNull();
  });

  it('keeps the still, the tick and the bar out of the accessible name', () => {
    // They restate what the words beside them already say, so announcing them would make
    // every row read twice — and the blank-still fallback would put a bare number in front
    // of the number the row already starts with.
    render(
      <EpisodeList
        episodes={[ep(1)]}
        traces={traces([1, 'watched'])}
        loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null}
      />,
    );
    expect(document.querySelector('.bs-ep__still')?.getAttribute('aria-hidden')).toBe('true');
    // The NAME, not `textContent`: aria-hidden content is still in the DOM text (the tick and
    // the blank still's number are both in there — `1✓1Name 1Watched`), and it is the name
    // computation that is supposed to drop them. Asserting the text would have passed with
    // `aria-hidden` deleted.
    expect(screen.getByRole('button', { name: '1 Name 1 Watched' })).toBeInTheDocument();
  });

  it('says how much of a part-watched episode is left, when the row recorded a length', () => {
    render(
      <EpisodeList
        episodes={[ep(1), ep(2)]}
        traces={traces([1, 'started', { remainingS: 18 * 60 }], [2, 'started', { remainingS: null }])}
        loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null}
      />,
    );
    expect(screen.getByRole('button', { name: /Name 1.*In progress · 18 min left/ })).toBeInTheDocument();
    // And nothing invented for the row that has no length: `In progress` and no number.
    expect(screen.getByRole('button', { name: /Name 2/ }).textContent).toMatch(/In progress$/);
  });

  it('never says "0 min left" about an episode that has some left', () => {
    render(
      <EpisodeList
        episodes={[ep(1)]}
        traces={traces([1, 'started', { remainingS: 20 }])}
        loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null}
      />,
    );
    expect(screen.getByRole('button', { name: /1 min left/ })).toBeInTheDocument();
  });

  it('badges the episode the screen says is next, and only that one', () => {
    render(
      <EpisodeList
        episodes={[ep(1), ep(2)]}
        traces={traces([1, 'watched'])}
        loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null}
        nextEpisode={2}
      />,
    );
    expect(document.querySelectorAll('.bs-ep__badge')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Name 2.*Next up/ })).toBeInTheDocument();
  });

  it('badges nothing when the screen does not say', () => {
    // The badge is the SCREEN's answer (it builds row 0's control from the same one), never
    // this component's guess: two answers to "which episode is next" is the defect.
    render(<EpisodeList episodes={[ep(1), ep(2)]} traces={new Map()} loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null} />);
    expect(document.querySelectorAll('.bs-ep__badge')).toHaveLength(0);
  });

  it('renders the season tally above the list, and it is not a live region', () => {
    const { container } = render(
      <EpisodeList
        episodes={[ep(1), ep(2), ep(3)]}
        traces={traces([1, 'watched'])}
        loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null}
      />,
    );
    const tally = container.querySelector('.bs-eps__tally');
    expect(tally?.textContent).toBe('3 episodes · 1 watched');
    // No `role="status"`: a second live region here would have the television announce a
    // tally every time a season opens, over the status lines the screen already mounts.
    expect(tally?.getAttribute('role')).toBeNull();
    // And it is NOT a focus stop, so it is outside the count contract.
    expect(container.querySelectorAll('button')).toHaveLength(3);
  });

  it('the tally says all three of the things a season can be', () => {
    const eps = [ep(1), ep(2)];
    expect(seasonTally(eps, new Map())).toBe('2 episodes · none watched yet');
    expect(seasonTally(eps, traces([1, 'watched']))).toBe('2 episodes · 1 watched');
    expect(seasonTally(eps, traces([1, 'watched'], [2, 'watched']))).toBe('2 episodes · all watched');
    // An in-progress episode is not a watched one.
    expect(seasonTally(eps, traces([1, 'started']))).toBe('2 episodes · none watched yet');
    // Nothing listed, nothing to say — and the component renders no element for it.
    expect(seasonTally([], new Map())).toBe('');
  });

  it('shows the air date, and parses it without a Date', () => {
    render(<EpisodeList episodes={[ep(1, { air_date: '2026-11-02' })]} traces={new Map()} loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null} />);
    expect(document.querySelector('.bs-ep__air')?.textContent).toBe('2 Nov 2026');
  });

  it('the air-date reader refuses anything that is not a plain YYYY-MM-DD', () => {
    // `new Date('2026-11-02')` is UTC midnight formatted in local time, which prints the 1st
    // of November for anyone west of Greenwich — a date with no time in it must not be able
    // to move by a day. Hence the hand parse, and hence these.
    expect(airDateLabel('2026-01-09')).toBe('9 Jan 2026');
    expect(airDateLabel('2026-12-31')).toBe('31 Dec 2026');
    for (const bad of [null, undefined, '', '2026-11', '2026-13-02', 'next tuesday', '2026-11-02T10:00:00Z']) {
      expect(airDateLabel(bad), String(bad)).toBeNull();
    }
  });

  it('renders no air-date element when TMDB has no date', () => {
    render(<EpisodeList episodes={[ep(1)]} traces={new Map()} loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null} />);
    expect(document.querySelector('.bs-ep__air')).toBeNull();
  });

  it('shows the overview when there is one, and no element when there is not', () => {
    render(
      <EpisodeList
        episodes={[ep(1, { overview: 'A thing happens.' }), ep(2)]}
        traces={new Map()} loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null}
      />,
    );
    const overs = [...document.querySelectorAll('.bs-ep__over')];
    expect(overs).toHaveLength(1);
    expect(overs[0].textContent).toBe('A thing happens.');
  });

  it('puts the state AFTER what it is about', () => {
    // A button's accessible name is its contents in DOM order, so a state rendered first
    // would be a control announcing "Watched" before it says what is watched.
    render(
      <EpisodeList
        episodes={[ep(1, { runtime: 42, air_date: '2026-11-02', overview: 'A thing happens.' })]}
        traces={traces([1, 'watched'])}
        loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null}
      />,
    );
    expect(
      screen.getByRole('button', { name: '1 Name 1 42m 2 Nov 2026 A thing happens. Watched' }),
    ).toBeInTheDocument();
  });

  it('every bs- class it renders has a rule in the stylesheet', () => {
    // THE GAP THIS CLOSES, and it is the one `playerCss.test.tsx` exists for on the other
    // surface: `bigscreen.css` is `<link>`ed from the layout and **jsdom computes nothing
    // from a linked sheet**. A class typo'd here still renders, still focuses and still
    // clicks — every other row in this file passes — and on the television the element has
    // no geometry at all. This round rewrote the whole episode row, so every class below is
    // new and nothing else was watching them.
    const { container } = render(
      <EpisodeList
        episodes={[ep(1, { runtime: 42, air_date: '2026-11-02', overview: 'A thing.' }), ep(2), ep(3)]}
        traces={traces([1, 'watched'], [2, 'started', { percentage: 40 }])}
        loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null}
        nextEpisode={3}
      />,
    );
    const used = new Set<string>();
    for (const el of container.querySelectorAll('*')) {
      for (const name of el.classList) if (name.startsWith('bs-')) used.add(name);
    }
    // The fixture is built to reach every one of them: a watched row (the tick), a
    // part-watched row (the bar), a still-less row (the blank thumb), the badge, the tally,
    // and all four text tokens.
    expect.soft([...used].sort()).toEqual([
      'bs-ep',
      'bs-ep__air',
      'bs-ep__badge',
      'bs-ep__bar',
      'bs-ep__body',
      'bs-ep__head',
      'bs-ep__mark',
      'bs-ep__meta',
      'bs-ep__name',
      'bs-ep__num',
      'bs-ep__over',
      'bs-ep__still',
      'bs-ep__thumb',
      'bs-ep__thumb--blank',
      'bs-ep__tick',
      'bs-eps',
      'bs-eps__tally',
    ]);
    const missing = [...used].filter((name) => !hasRule(`.${name}`)).sort();
    expect(missing, `no rule for ${missing.join(', ')}`).toEqual([]);
  });

  it('the rule matcher is not vacuous', () => {
    // A matcher that answered true for everything would make the row above green forever.
    expect.soft(hasRule('.bs-ep')).toBe(true);
    expect.soft(hasRule('.bs-ep__thumb--blank')).toBe(true);
    expect.soft(hasRule('.bs-ep__typo-that-does-not-exist')).toBe(false);
  });

  it('the loading state’s class has a rule too, since it is a different render', () => {
    render(<EpisodeList episodes={[ep(1)]} traces={new Map()} loading firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null} />);
    expect(hasRule('.bs-show__status')).toBe(true);
  });

});
