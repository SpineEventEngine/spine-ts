import type { ComponentProps, ReactElement } from "react";

import { cn } from "../../lib/utils.js";

/**
 * Renders a Shadcn card container.
 *
 * @param props The native element attributes.
 * @returns The card element.
 */
export const Card = (props: ComponentProps<"section">): ReactElement => {
  const { className, ...nativeProps } = props;
  return (
    <section
      data-slot="card"
      className={cn(
        "rounded-3xl border border-border/70 bg-card text-card-foreground shadow-xl",
        className,
      )}
      {...nativeProps}
    />
  );
};

/**
 * Renders the heading area of a card.
 *
 * @param props The native element attributes.
 * @returns The card header element.
 */
export const CardHeader = (props: ComponentProps<"header">): ReactElement => {
  const { className, ...nativeProps } = props;
  return (
    <header data-slot="card-header" className={cn("space-y-1.5 p-6", className)} {...nativeProps} />
  );
};

/**
 * Renders the main content area of a card.
 *
 * @param props The native element attributes.
 * @returns The card content element.
 */
export const CardContent = (props: ComponentProps<"div">): ReactElement => {
  const { className, ...nativeProps } = props;
  return <div data-slot="card-content" className={cn("px-6 pb-6", className)} {...nativeProps} />;
};
