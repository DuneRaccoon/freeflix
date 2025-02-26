import React from 'react';
import { twMerge } from 'tailwind-merge';

interface ProgressProps {
  value: number;
  max: number;
  className?: string;
  barClassName?: string;
  showValue?: boolean;
  formatValue?: (value: number, max: number) => string;
  variant?: 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger';
}

const Progress: React.FC<ProgressProps> = ({
  value,
  max,
  className,
  barClassName,
  showValue = false,
  formatValue,
  variant = 'primary',
  ...props
}) => {
  // Calculate percentage
  const percentage = max > 0 ? Math.min(Math.max(0, value), max) / max * 100 : 0;
  
  // Format value
  const formattedValue = formatValue 
    ? formatValue(value, max)
    : showValue 
      ? `${Math.round(percentage)}%` 
      : '';
  
  // Variant styles
  const variantStyles = {
    default: 'bg-gray-600',
    primary: 'bg-primary-600',
    secondary: 'bg-secondary-600',
    success: 'bg-green-600',
    warning: 'bg-yellow-500',
    danger: 'bg-red-600',
  };
  
  return (
    <div className="relative">
      <div
        className={twMerge(
          'w-full h-2.5 bg-gray-800 rounded-full overflow-hidden',
          className
        )}
        {...props}
      >
        <div
          className={twMerge(
            'h-full transition-all duration-300 ease-in-out',
            variantStyles[variant],
            barClassName
          )}
          style={{ width: `${percentage}%` }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={max}
        />
      </div>
      {formattedValue && (
        <div className="mt-1 text-xs text-gray-400 text-right">
          {formattedValue}
        </div>
      )}
    </div>
  );
};

export default Progress;