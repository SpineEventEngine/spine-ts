import type { ComponentProps, ReactElement } from "react";

import { cn } from "../../lib/utils.js";

/**
 * Renders a Shadcn card container.
 *
 * @param props The native element attributes.
 * @returns The card element.
 */
export function Card({ className, ...props }: ComponentProps<"section">): ReactElement {
  return (
    <section
      data-slot="card"
      className={cn(
        "rounded-3xl border border-border/70 bg-card text-card-foreground shadow-xl",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Renders the heading area of a card.
 *
 * @param props The native element attributes.
 * @returns The card header element.
 */
export function CardHeader({ className, ...props }: ComponentProps<"header">): ReactElement {
  return <header data-slot="card-header" className={cn("space-y-1.5 p-6", className)} {...props} />;
}

/**
 * Renders the main content area of a card.
 *
 * @param props The native element attributes.
 * @returns The card content element.
 */
export function CardContent({ className, ...props }: ComponentProps<"div">): ReactElement {
  return <div data-slot="card-content" className={cn("px-6 pb-6", className)} {...props} />;
}
