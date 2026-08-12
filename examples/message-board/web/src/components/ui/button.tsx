/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

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
