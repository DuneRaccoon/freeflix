import React, { forwardRef } from 'react';
import { twMerge } from 'tailwind-merge';
import { InputProps } from '@/types';

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-gray-200 mb-1">
            {label}
          </label>
        )}
        <input
          className={twMerge(
            'w-full px-3 py-2 bg-gray-800 border rounded-md shadow-sm',
            'text-gray-200 placeholder-gray-400',
            'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
            error ? 'border-red-500' : 'border-gray-700',
            className
          )}
          ref={ref}
          {...props}
        />
        {error && (
          <p className="mt-1 text-sm text-red-500">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export default Input;