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

// Adapted from shadcn/ui New York v4 Button, MIT; see THIRD_PARTY_NOTICES.

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "./cn";

/**
 * Shared button visual variants adapted to the Fieldnotes palette.
 */
export const buttonVariants = cva(
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[#173d32] text-white hover:bg-[#245944]",
        outline: "border border-[#c9d3cb] bg-white text-[#173d32] hover:bg-[#edf4ed]",
        ghost: "text-[#173d32] hover:bg-[#edf4ed]",
        destructive: "bg-[#a13828] text-white hover:bg-[#862b20]",
      },
      size: { default: "px-4", icon: "size-10 p-0", sm: "min-h-9 px-3" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

/**
 * Renders a focus-visible button or Radix Slot child.
 *
 * @param className Additional visual classes.
 * @param variant Selected button palette.
 * @param size Selected button size.
 * @param asChild Whether a Radix Slot supplies the element.
 * @param props Native button attributes.
 * @returns Accessible interactive control.
 */
export function Button({ className, variant = "default", size = "default", asChild = false,
  ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & {
    readonly asChild?: boolean;
  }): React.JSX.Element {
  const Component = asChild ? Slot.Root : "button";
  return <Component data-slot="button" data-variant={variant} data-size={size}
    className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
