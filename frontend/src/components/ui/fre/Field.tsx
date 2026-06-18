'use client';
import React from 'react';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Shared gold focus ring (applied to all interactive form controls)
// ---------------------------------------------------------------------------
const FOCUS_RING =
  'focus:outline-none focus-visible:outline-none ' +
  'focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]';

const CONTROL_BASE =
  'w-full rounded-lg border border-hairline bg-surface-2 text-text ' +
  'font-ui text-sm placeholder:text-muted/60 ' +
  'transition-[border-color,box-shadow] duration-150 ' +
  'disabled:opacity-50 disabled:pointer-events-none ' +
  FOCUS_RING;

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Extra class names forwarded to the <input> element */
  className?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(CONTROL_BASE, 'h-10 px-3', className)}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------
export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
  className?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ options, className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        CONTROL_BASE,
        'h-10 px-3 pr-8',
        // native arrow tweak on dark bg
        'appearance-none bg-[image:url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23888%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E")] bg-no-repeat bg-[right_0.625rem_center]',
        className,
      )}
      {...props}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  ),
);
Select.displayName = 'Select';

// ---------------------------------------------------------------------------
// Toggle (gold switch)
// ---------------------------------------------------------------------------
export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  label,
  disabled = false,
  id,
  className,
}) => {
  const uid = id ?? React.useId();

  return (
    <label
      htmlFor={uid}
      className={cn(
        'inline-flex items-center gap-3 cursor-pointer select-none',
        disabled && 'opacity-50 pointer-events-none',
        className,
      )}
    >
      {/* visually-hidden checkbox for a11y */}
      <input
        type="checkbox"
        id={uid}
        role="switch"
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      {/* track */}
      <span
        aria-hidden="true"
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border ' +
          'transition-colors duration-200',
          checked
            ? 'border-gold/60 bg-gold/20'
            : 'border-hairline bg-surface-2',
          // focus ring on the track (keyboard focus on hidden checkbox)
          'peer-focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
        )}
      >
        {/* thumb */}
        <span
          className={cn(
            'absolute left-0.5 h-5 w-5 rounded-full transition-transform duration-200',
            checked
              ? 'translate-x-5 bg-gold'
              : 'translate-x-0 bg-muted/60',
          )}
        />
      </span>
      {label && (
        <span className="font-ui text-sm text-text">{label}</span>
      )}
    </label>
  );
};

// ---------------------------------------------------------------------------
// Field (labeled wrapper)
// ---------------------------------------------------------------------------
export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
  /** Forwarded to the wrapping <div> for layout overrides */
  htmlFor?: string;
}

export const Field: React.FC<FieldProps> = ({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}) => (
  <div className={cn('flex flex-col gap-1.5', className)}>
    <label
      htmlFor={htmlFor}
      className="font-ui text-sm font-medium text-text/80"
    >
      {label}
    </label>
    {children}
    {hint && !error && (
      <p className="font-ui text-xs text-muted">{hint}</p>
    )}
    {error && (
      <p role="alert" className="font-ui text-xs text-danger">
        {error}
      </p>
    )}
  </div>
);
