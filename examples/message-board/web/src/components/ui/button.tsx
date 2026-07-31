import { cva } from "class-variance-authority";
import type { ComponentProps, ReactElement } from "react";

import { cn } from "../../lib/utils.js";

/**
 * Selects the visual style and size of a MessageBoard button.
 */
interface ButtonVariants {
  readonly variant?: "default" | "outline" | null;
  readonly size?: "default" | "icon" | null;
}

const buttonVariants: (props?: ButtonVariants) => string = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary px-5 text-primary-foreground shadow-sm hover:bg-primary/90",
        outline:
          "border border-border bg-background px-5 hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-11",
        icon: "size-11 px-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

/**
 * Renders a Shadcn-styled button for MessageBoard actions.
 *
 * @param props The native button attributes and visual variants.
 * @returns The styled button element.
 */
export const Button = (props: ComponentProps<"button"> & ButtonVariants): ReactElement => {
  const { className, variant, size, ...nativeProps } = props;
  return (
    <button
      data-slot="button"
      className={cn(
        buttonVariants({
          ...(variant === undefined ? {} : { variant }),
          ...(size === undefined ? {} : { size }),
        }),
        className,
      )}
      {...nativeProps}
    />
  );
};
