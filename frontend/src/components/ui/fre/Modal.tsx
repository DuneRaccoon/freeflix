'use client';
import React from 'react';
import { cn } from '@/lib/cn';

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
  className?: string;
}

const Modal: React.FC<ModalProps> = ({ open, onClose, label, children, className }) => {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);

  // Escape key handler
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Focus management: capture, move focus in, trap Tab, restore on close
  React.useEffect(() => {
    if (!open) return;

    // Capture the element that was focused before the modal opened
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Move focus into the dialog (first focusable child, or the container itself)
    const dialog = dialogRef.current;
    if (dialog) {
      const first = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTORS);
      (first ?? dialog).focus();
    }

    // Tab / Shift+Tab trap
    const trapFocus = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const container = dialogRef.current;
      if (!container) return;

      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS));
      if (focusable.length === 0) { e.preventDefault(); return; }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };

    document.addEventListener('keydown', trapFocus);

    return () => {
      document.removeEventListener('keydown', trapFocus);
      // Restore focus to the previously-focused element
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label={label}
      className="fixed inset-0 z-[1000] flex items-center justify-center p-6">
      <button aria-label="Close" onClick={onClose}
        className="absolute inset-0 bg-ink/70 backdrop-blur-sm" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={cn(
          'relative z-[1] w-full max-w-md rounded-2xl border border-hairline',
          'bg-surface/95 p-7 shadow-[0_30px_80px_rgba(0,0,0,0.6)]',
          'focus:outline-none',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
};

export default Modal;
