import type { ComponentProps, ReactElement } from "react";

import { cn } from "../../lib/utils.js";

/**
 * Renders a compact username avatar.
 *
 * @param props The native element attributes.
 * @returns The styled avatar element.
 */
export const Avatar = (props: ComponentProps<"span">): ReactElement => {
  const { className, ...nativeProps } = props;
  return (
    <span
      data-slot="avatar"
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary",
        className,
      )}
      aria-hidden="true"
      {...nativeProps}
    />
  );
};
