import type { ComponentProps, ReactElement } from "react";

import { cn } from "../../lib/utils.js";

/**
 * Renders an accessible Shadcn form label.
 *
 * @param props The native label attributes.
 * @returns The styled label element.
 */
export const Label = (props: ComponentProps<"label">): ReactElement => {
  const { className, ...nativeProps } = props;
  return (
    <label
      data-slot="label"
      className={cn("text-sm font-medium leading-none text-foreground", className)}
      {...nativeProps}
    />
  );
};
