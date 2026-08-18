import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class names, resolving Tailwind class conflicts in favor of the later class. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
