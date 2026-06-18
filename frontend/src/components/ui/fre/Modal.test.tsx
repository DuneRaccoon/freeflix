import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Modal from './Modal';

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(<Modal open={false} onClose={() => {}} label="Passcode">hi</Modal>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the dialog with children when open', () => {
    render(<Modal open onClose={() => {}} label="Passcode"><p>Enter passcode</p></Modal>);
    expect(screen.getByRole('dialog', { name: 'Passcode' })).toBeInTheDocument();
    expect(screen.getByText('Enter passcode')).toBeInTheDocument();
  });

  it('calls onClose on backdrop click and Escape', async () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} label="Passcode">x</Modal>);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
