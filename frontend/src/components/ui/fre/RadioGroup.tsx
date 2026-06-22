'use client';
import React from 'react';
import { cn } from '@/lib/cn';

export interface RadioOption {
  value: string;
  label: string;
  hint?: string;
}

export interface RadioGroupProps {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: RadioOption[];
  className?: string;
}

export const RadioGroup: React.FC<RadioGroupProps> = ({ name, value, onChange, options, className }) => (
  <div role="radiogroup" className={cn('flex flex-col gap-2', className)}>
    {options.map((opt) => {
      const selected = opt.value === value;
      const id = `${name}-${opt.value}`;
      return (
        <label
          key={opt.value}
          htmlFor={id}
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
            selected
              ? 'border-gold/60 bg-gold/10'
              : 'border-hairline bg-surface-2/60 hover:border-gold/40',
          )}
        >
          <input
            type="radio"
            id={id}
            name={name}
            value={opt.value}
            checked={selected}
            onChange={() => onChange(opt.value)}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className={cn(
              'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border',
              'peer-focus-visible:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-gold)]',
              selected ? 'border-gold' : 'border-hairline',
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', selected ? 'bg-gold' : 'bg-transparent')} />
          </span>
          <span className="flex flex-col">
            <span className="font-ui text-sm text-text">{opt.label}</span>
            {opt.hint && <span className="font-ui text-xs text-muted">{opt.hint}</span>}
          </span>
        </label>
      );
    })}
  </div>
);

export default RadioGroup;
