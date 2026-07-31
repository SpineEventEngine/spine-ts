import type { ComponentProps, ReactElement } from "react";

import { cn } from "../../lib/utils.js";

/**
 * Renders a Shadcn notice for status and error messages.
 *
 * @param props The native element attributes.
 * @returns The styled notice element.
 */
export const Alert = (props: ComponentProps<"div">): ReactElement => {
  const { className, ...nativeProps } = props;
  return (
    <div
      data-slot="alert"
      className={cn("rounded-xl border border-border bg-muted/55 px-4 py-3 text-sm", className)}
      {...nativeProps}
    />
  );
};
