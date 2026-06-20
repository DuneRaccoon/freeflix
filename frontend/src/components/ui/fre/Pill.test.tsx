import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Pill from './Pill';

describe('Pill', () => {
  it('reflects unselected state via aria-pressed', () => {
    render(<Pill>1080p</Pill>);
    expect(screen.getByRole('button', { name: '1080p' })).toHaveAttribute('aria-pressed', 'false');
  });
  it('reflects selected state and fires onClick', async () => {
    const onClick = vi.fn();
    render(<Pill selected onClick={onClick}>Auto</Pill>);
    const pill = screen.getByRole('button', { name: 'Auto' });
    expect(pill).toHaveAttribute('aria-pressed', 'true');
    expect(pill.dataset.selected).toBe('true');
    await userEvent.click(pill);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
