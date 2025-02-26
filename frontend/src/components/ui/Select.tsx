import React, { forwardRef } from 'react';
import { twMerge } from 'tailwind-merge';
import { SelectProps } from '@/types';

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, options, error, ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-gray-200 mb-1">
            {label}
          </label>
        )}
        <select
          className={twMerge(
            'w-full px-3 py-2 bg-gray-800 border rounded-md shadow-sm appearance-none',
            'text-gray-200',
            'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
            error ? 'border-red-500' : 'border-gray-700',
            className
          )}
          ref={ref}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {error && (
          <p className="mt-1 text-sm text-red-500">{error}</p>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';

export default Select;