import React from 'react';
import { twMerge } from 'tailwind-merge';
import { CardProps } from '@/types';

const Card: React.FC<CardProps> = ({ 
  children, 
  className 
}) => {
  return (
    <div 
      className={twMerge(
        'bg-card rounded-lg shadow-md overflow-hidden border border-gray-800 animate-fade-in',
        className
      )}
    >
      {children}
    </div>
  );
};

const CardHeader: React.FC<CardProps> = ({ 
  children, 
  className 
}) => {
  return (
    <div 
      className={twMerge(
        'p-4 border-b border-gray-800',
        className
      )}
    >
      {children}
    </div>
  );
};

const CardTitle: React.FC<CardProps> = ({ 
  children, 
  className 
}) => {
  return (
    <h3 
      className={twMerge(
        'text-lg font-semibold text-foreground',
        className
      )}
    >
      {children}
    </h3>
  );
};

const CardContent: React.FC<CardProps> = ({ 
  children, 
  className 
}) => {
  return (
    <div 
      className={twMerge(
        'p-4',
        className
      )}
    >
      {children}
    </div>
  );
};

const CardFooter: React.FC<CardProps> = ({ 
  children, 
  className 
}) => {
  return (
    <div 
      className={twMerge(
        'p-4 border-t border-gray-800 bg-gray-800/30',
        className
      )}
    >
      {children}
    </div>
  );
};

export { Card, CardHeader, CardTitle, CardContent, CardFooter };