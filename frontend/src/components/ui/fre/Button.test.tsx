import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Button from './Button';

describe('Button', () => {
  it('renders children with default primary/md variant', () => {
    render(<Button>Play</Button>);
    const btn = screen.getByRole('button', { name: 'Play' });
    expect(btn.dataset.variant).toBe('primary');
    expect(btn.dataset.size).toBe('md');
  });

  it('honors variant and size props', () => {
    render(<Button variant="glass" size="lg">More Info</Button>);
    const btn = screen.getByRole('button', { name: 'More Info' });
    expect(btn.dataset.variant).toBe('glass');
    expect(btn.dataset.size).toBe('lg');
  });

  it('is disabled and aria-busy while loading, and does not fire onClick', async () => {
    const onClick = vi.fn();
    render(<Button isLoading onClick={onClick}>Save</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});
