import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RadioGroup } from './RadioGroup';

const opts = [
  { value: 'keep', label: 'Keep files' },
  { value: 'all', label: 'Delete everything' },
];

describe('RadioGroup', () => {
  it('renders all options and reflects the selected value', () => {
    render(<RadioGroup name="mode" value="keep" onChange={() => {}} options={opts} />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    const keep = screen.getByRole('radio', { name: 'Keep files' }) as HTMLInputElement;
    const all = screen.getByRole('radio', { name: 'Delete everything' }) as HTMLInputElement;
    expect(keep.checked).toBe(true);
    expect(all.checked).toBe(false);
  });

  it('calls onChange with the option value when clicked', async () => {
    const onChange = vi.fn();
    render(<RadioGroup name="mode" value="keep" onChange={onChange} options={opts} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Delete everything' }));
    expect(onChange).toHaveBeenCalledWith('all');
  });
});
