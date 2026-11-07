import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Numpad from './Numpad';

const press = (k: string) => userEvent.click(screen.getByRole('button', { name: k }));

describe('Numpad', () => {
  it('fixed: completes once at length, digits in the order pressed', async () => {
    const onComplete = vi.fn();
    const { container } = render(<Numpad label="Enter your passcode" length={4} onComplete={onComplete} />);
    for (const d of '123') await press(d);
    expect(onComplete).not.toHaveBeenCalled();
    expect(container.querySelectorAll('[data-dot]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-filled]')).toHaveLength(3);
    await press('4');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('1234');
    await press('5');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByText('4 of 4 digits entered')).toBeInTheDocument();
  });

  it('fixed: physical digits and Backspace', async () => {
    const onComplete = vi.fn();
    render(<Numpad label="x" length={4} onComplete={onComplete} />);
    await userEvent.keyboard('12{Backspace}345');
    expect(onComplete).toHaveBeenCalledWith('1345');
  });

  it('does not capture keys typed into a field outside it', async () => {
    const onComplete = vi.fn();
    render(<><input aria-label="other" /><Numpad label="x" length={4} onComplete={onComplete} /></>);
    await userEvent.click(screen.getByLabelText('other'));
    await userEvent.keyboard('1234');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('variable: OK is disabled below minLength, never auto-submits, caps at maxLength', async () => {
    const onSubmit = vi.fn();
    const { container } = render(<Numpad label="Choose" minLength={4} maxLength={6} onSubmit={onSubmit} />);
    expect(container.querySelectorAll('[data-dot]')).toHaveLength(6);
    for (const d of '123') await press(d);
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
    for (const d of '4567') await press(d);
    expect(onSubmit).not.toHaveBeenCalled();
    await press('OK');
    expect(onSubmit).toHaveBeenCalledWith('123456');
  });

  it('variable: Enter on a focused digit submits and does not add that digit', async () => {
    const onSubmit = vi.fn();
    render(<Numpad label="Choose" minLength={4} maxLength={6} onSubmit={onSubmit} />);
    for (const d of '1234') await press(d);
    screen.getByRole('button', { name: '5' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('1234');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByText('4 digits entered')).toBeInTheDocument();
  });

  it('variable: Enter below minLength does nothing', async () => {
    const onSubmit = vi.fn();
    render(<Numpad label="Choose" minLength={4} maxLength={6} onSubmit={onSubmit} />);
    await userEvent.keyboard('123{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disabled ignores presses and disables every key', async () => {
    const onComplete = vi.fn();
    render(<Numpad label="x" length={4} onComplete={onComplete} disabled />);
    screen.getAllByRole('button').forEach((b) => expect(b).toBeDisabled());
    await userEvent.keyboard('1234');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('shows the error as an alert and the label as text', () => {
    render(<Numpad label="Enter your passcode" length={4} onComplete={() => {}} error="Incorrect passcode" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Incorrect passcode');
    expect(screen.getByRole('group', { name: 'Enter your passcode' })).toBeInTheDocument();
    expect(screen.getByText('Enter your passcode', { selector: 'p' })).toBeInTheDocument();
  });

  it('hides the error once the next code is started', async () => {
    render(<Numpad label="x" length={4} onComplete={() => {}} error="Incorrect passcode" />);
    await press('1');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
