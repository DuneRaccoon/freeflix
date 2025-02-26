import React from 'react';
import { twMerge } from 'tailwind-merge';

interface BadgeProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md' | 'lg';
}

const Badge: React.FC<BadgeProps> = ({
  children,
  className,
  variant = 'default',
  size = 'md',
  ...props
}) => {
  // Base styles
  const baseStyles = 'inline-flex items-center font-medium rounded-full';
  
  // Variant styles
  const variantStyles = {
    default: 'bg-gray-700 text-gray-200',
    primary: 'bg-primary-600 text-white',
    secondary: 'bg-secondary-600 text-white',
    success: 'bg-green-600 text-white',
    warning: 'bg-yellow-500 text-white',
    danger: 'bg-red-600 text-white',
    info: 'bg-blue-500 text-white',
  };
  
  // Size styles
  const sizeStyles = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-0.5 text-sm',
    lg: 'px-3 py-1 text-base',
  };
  
  return (
    <span
      className={twMerge(
        baseStyles,
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
};

export default Badge;