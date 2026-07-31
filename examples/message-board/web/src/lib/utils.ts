import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges conditional class names while resolving Tailwind conflicts.
 *
 * @param inputs The class-name values supplied by a component.
 * @returns One normalized class-name string.
 */
export const cn = (...inputs: ClassValue[]): string => {
  return twMerge(clsx(inputs));
};
