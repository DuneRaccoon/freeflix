'use client';
import React from 'react';
import { cn } from '@/lib/cn';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
  className?: string;
}

const Modal: React.FC<ModalProps> = ({ open, onClose, label, children, className }) => {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label={label}
      className="fixed inset-0 z-[1000] flex items-center justify-center p-6">
      <button aria-label="Close" onClick={onClose}
        className="absolute inset-0 bg-ink/70 backdrop-blur-sm" />
      <div className={cn(
        'relative z-[1] w-full max-w-md rounded-2xl border border-hairline',
        'bg-surface/95 p-7 shadow-[0_30px_80px_rgba(0,0,0,0.6)]',
        className,
      )}>
        {children}
      </div>
    </div>
  );
};

export default Modal;
