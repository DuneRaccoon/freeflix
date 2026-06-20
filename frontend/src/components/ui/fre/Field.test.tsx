import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input, Select, Toggle, Field } from './Field';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
describe('Input', () => {
  it('renders with a given value', () => {
    render(<Input readOnly value="hello world" data-testid="inp" />);
    const el = screen.getByTestId('inp') as HTMLInputElement;
    expect(el.value).toBe('hello world');
  });

  it('forwards onChange', async () => {
    const onChange = vi.fn();
    render(<Input data-testid="inp" onChange={onChange} />);
    await userEvent.type(screen.getByTestId('inp'), 'x');
    expect(onChange).toHaveBeenCalled();
  });

  it('accepts type=number', () => {
    render(<Input type="number" data-testid="inp" />);
    expect(screen.getByTestId('inp')).toHaveAttribute('type', 'number');
  });
});

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------
describe('Select', () => {
  const options = [
    { value: '720p', label: '720p HD' },
    { value: '1080p', label: '1080p Full HD' },
    { value: '2160p', label: '4K UHD' },
  ];

  it('renders all options', () => {
    render(<Select options={options} data-testid="sel" defaultValue="720p" />);
    const sel = screen.getByTestId('sel') as HTMLSelectElement;
    expect(sel.options).toHaveLength(3);
    expect(sel.options[0].value).toBe('720p');
    expect(sel.options[1].value).toBe('1080p');
    expect(sel.options[2].value).toBe('2160p');
  });

  it('fires onChange when selection changes', async () => {
    const onChange = vi.fn();
    render(
      <Select options={options} data-testid="sel" defaultValue="720p" onChange={onChange} />,
    );
    await userEvent.selectOptions(screen.getByTestId('sel'), '1080p');
    expect(onChange).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Toggle
// ---------------------------------------------------------------------------
describe('Toggle', () => {
  it('reflects the checked prop', () => {
    const { rerender } = render(
      <Toggle checked={false} onChange={vi.fn()} label="Enable" />,
    );
    // The hidden checkbox carries the state
    const checkbox = screen.getByRole('switch') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    rerender(<Toggle checked={true} onChange={vi.fn()} label="Enable" />);
    expect(checkbox.checked).toBe(true);
  });

  it('calls onChange with toggled value', async () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Enable" />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('renders the label text', () => {
    render(<Toggle checked={false} onChange={vi.fn()} label="My label" />);
    expect(screen.getByText('My label')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------
describe('Field', () => {
  it('renders the label text', () => {
    render(
      <Field label="Email">
        <Input data-testid="inp" />
      </Field>,
    );
    expect(screen.getByText('Email')).toBeDefined();
  });

  it('renders children', () => {
    render(
      <Field label="Name">
        <Input data-testid="child-input" />
      </Field>,
    );
    expect(screen.getByTestId('child-input')).toBeDefined();
  });

  it('shows the error message when provided', () => {
    render(
      <Field label="Password" error="Too short">
        <Input type="password" />
      </Field>,
    );
    const err = screen.getByRole('alert');
    expect(err.textContent).toBe('Too short');
  });

  it('shows the hint when no error', () => {
    render(
      <Field label="Path" hint="Use an absolute path">
        <Input />
      </Field>,
    );
    expect(screen.getByText('Use an absolute path')).toBeDefined();
  });

  it('hides the hint when an error is present', () => {
    render(
      <Field label="Path" hint="Use an absolute path" error="Required">
        <Input />
      </Field>,
    );
    expect(screen.queryByText('Use an absolute path')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe('Required');
  });
});
