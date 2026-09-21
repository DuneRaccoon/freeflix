import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AvatarPicker from './AvatarPicker';

const cacheTmdbStill = vi.fn();
vi.mock('@/services/avatars', () => ({
  avatarsService: { cacheTmdbStill: (...a: unknown[]) => cacheTmdbStill(...a) },
}));

describe('AvatarPicker', () => {
  it('opens on the house set and exposes each piece as a radio named for the piece', async () => {
    render(<AvatarPicker value={null} onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Film reel' })).toBeInTheDocument();
  });

  it('emits the house id when a piece is chosen', async () => {
    const onChange = vi.fn();
    render(<AvatarPicker value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Clapperboard' }));
    expect(onChange).toHaveBeenCalledWith('house:clapper');
  });

  it('switches collections and shows that collection instead', async () => {
    render(<AvatarPicker value={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'After Dark' }));
    expect(screen.getByRole('radio', { name: 'Moth' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Film reel' })).toBeNull();
  });

  it('always offers a no-avatar tile that emits null', async () => {
    const onChange = vi.fn();
    render(<AvatarPicker value="house:reel" onChange={onChange} initials="BH" />);
    await userEvent.click(screen.getByRole('radio', { name: 'No avatar' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('keeps the no-avatar tile reachable from any collection', async () => {
    render(<AvatarPicker value={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'The Frontier' }));
    expect(screen.getByRole('radio', { name: 'No avatar' })).toBeInTheDocument();
  });

  it('mints a cached id when a library still is chosen', async () => {
    cacheTmdbStill.mockResolvedValue('cached:8f3a91c2');
    const onChange = vi.fn();
    render(
      <AvatarPicker
        value={null}
        onChange={onChange}
        libraryStills={[{
          label: 'Ripley',
          profilePath: '/abc123def456ghi789jkl.jpg',
          previewUrl: 'https://image.tmdb.org/t/p/w185/abc123def456ghi789jkl.jpg',
        }]}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'From your library' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Ripley' }));

    await waitFor(() => expect(cacheTmdbStill).toHaveBeenCalledWith('/abc123def456ghi789jkl.jpg'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('cached:8f3a91c2'));
  });
});
