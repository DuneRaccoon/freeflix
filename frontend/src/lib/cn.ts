import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge v3 ships only Tailwind's DEFAULT theme utilities, so custom
 * @theme tokens defined in globals.css are unknown to it and won't de-conflict.
 * We register the project's custom border-radius token here so that, e.g.,
 * `cn('rounded-full', 'rounded-card')` correctly resolves to `'rounded-card'`.
 *
 * Add any future custom @theme class groups here (same classGroup key as the
 * built-in group they belong to).
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      // Custom radius token: --radius-card → utility `rounded-card`
      rounded: ['rounded-card'],
    },
  },
});

/** Merge class names, de-conflicting Tailwind utilities (last one wins). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
