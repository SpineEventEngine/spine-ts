import type { ComponentProps, ReactElement } from "react";

import { cn } from "../../lib/utils.js";

/**
 * Renders a Shadcn text input.
 *
 * @param props The native input attributes.
 * @returns The styled input element.
 */
export function Input({
  className,
  type = "text",
  ...props
}: ComponentProps<"input">): ReactElement {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        "h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base shadow-sm outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}
