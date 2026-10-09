import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Episode } from '@/types';
import { EpisodeList, episodeRowCount } from './EpisodeList';
import type { FocusProps } from '../_focus/useFocusGrid';

const ep = (n: number, over: Partial<Episode> = {}): Episode => ({
  episode_number: n, name: `Name ${n}`, overview: null, runtime: null, still_url: null, air_date: null, vote_average: 0, ...over,
});
const fp = (): ((row: number, col: number) => FocusProps) => () => ({ tabIndex: -1, ref: () => {}, onFocus: () => {} });

describe('EpisodeList', () => {
  it('renders one button per episode with number, title and runtime', () => {
    render(<EpisodeList episodes={[ep(1, { runtime: 42 }), ep(2)]} marks={new Map()} loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /1.*Name 1.*42m/ })).toBeInTheDocument();
  });
  it('draws no runtime (and no bare "m") when TMDB has none', () => {
    render(<EpisodeList episodes={[ep(1, { runtime: null }), ep(2, { runtime: 0 })]} marks={new Map()} loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null} />);
    for (const b of screen.getAllByRole('button')) expect(b.textContent).not.toMatch(/m$/);
    expect(document.querySelector('.bs-ep__meta')).toBeNull();
  });
  it('falls back to "Episode N" when TMDB has no title', () => {
    render(<EpisodeList episodes={[ep(4, { name: '' })]} marks={new Map()} loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null} />);
    expect(screen.getByRole('button', { name: /Episode 4/ })).toBeInTheDocument();
  });
  it('shows watched and in-progress markers from the data it is given', () => {
    render(<EpisodeList episodes={[ep(1), ep(2), ep(3)]} marks={new Map([[1, 'watched'], [2, 'started']])} loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null} />);
    expect(screen.getByRole('button', { name: /Name 1.*Watched/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Name 2.*In progress/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Name 3/ })).not.toHaveTextContent(/Watched|In progress/);
  });
  it('has zero focusable cells while loading, and says it is loading', () => {
    render(<EpisodeList episodes={[ep(1)]} marks={new Map()} loading firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent(/loading episodes/i);
    expect(episodeRowCount([ep(1)], true)).toBe(0);
  });
  it('counts exactly the rows it renders', () => {
    const eps = [ep(1), ep(2), ep(3)];
    const { container } = render(<EpisodeList episodes={eps} marks={new Map()} loading={false} firstRow={2} focusProps={fp()} onPress={() => {}} busyEpisode={null} />);
    expect(container.querySelectorAll('button')).toHaveLength(episodeRowCount(eps, false));
  });
  it('gives each episode its own grid row, starting at firstRow', () => {
    const calls: Array<[number, number]> = [];
    render(<EpisodeList episodes={[ep(1), ep(2)]} marks={new Map()} loading={false} firstRow={5} focusProps={(r, c) => { calls.push([r, c]); return { tabIndex: -1, ref: () => {}, onFocus: () => {} }; }} onPress={() => {}} busyEpisode={null} />);
    expect(calls).toEqual([[5, 0], [6, 0]]);
  });
  it('presses with the episode, and labels the busy one', () => {
    const onPress = vi.fn();
    render(<EpisodeList episodes={[ep(1), ep(2)]} marks={new Map()} loading={false} firstRow={2} focusProps={fp()} onPress={onPress} busyEpisode={2} />);
    fireEvent.click(screen.getByRole('button', { name: /Name 1/ }));
    expect(onPress).toHaveBeenLastCalledWith(expect.objectContaining({ episode_number: 1 }));
    fireEvent.click(screen.getByRole('button', { name: /Name 2/ }));
    expect(onPress).toHaveBeenLastCalledWith(expect.objectContaining({ episode_number: 2 }));
    expect(screen.getByRole('button', { name: /Name 2.*Checking/ })).toHaveAttribute('aria-busy', 'true');
  });
});
