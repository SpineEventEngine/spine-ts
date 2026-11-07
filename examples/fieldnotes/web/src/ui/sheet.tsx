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

"use client";

// Adapted from shadcn/ui New York v4 Sheet, MIT; see THIRD_PARTY_NOTICES.
import * as React from "react";
import { X } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { cn } from "./cn";

/**
 * Renders the Radix-backed shadcn Sheet root.
 *
 * @param props Controlled dialog attributes.
 * @returns Sheet state boundary.
 */
export function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>): React.JSX.Element {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

/**
 * Renders the shadcn Sheet trigger around a caller's button.
 *
 * @param props Radix trigger attributes.
 * @returns Accessible Sheet trigger.
 */
export function SheetTrigger(props: React.ComponentProps<typeof SheetPrimitive.Trigger>): React.JSX.Element {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

/**
 * Renders the titled mobile Sheet overlay and focus-trapped content.
 *
 * @param children Visible panel content.
 * @param className Additional panel classes.
 * @param props Radix content attributes.
 * @returns Portal-mounted responsive content.
 */
export function SheetContent({ children, className, ...props }:
  React.ComponentProps<typeof SheetPrimitive.Content>): React.JSX.Element {
  return <SheetPrimitive.Portal>
    <SheetPrimitive.Overlay className="sheet-overlay" />
    <SheetPrimitive.Content data-slot="sheet-content" className={cn("mobile-sheet", className)} {...props}>
      {children}
      <SheetPrimitive.Close className="sheet-close" aria-label="Close panel"><X size={18} /></SheetPrimitive.Close>
    </SheetPrimitive.Content>
  </SheetPrimitive.Portal>;
}

/**
 * Renders the accessible Sheet title required by its focus trap.
 *
 * @param props Radix title attributes.
 * @returns Visible panel heading.
 */
export function SheetTitle(props: React.ComponentProps<typeof SheetPrimitive.Title>): React.JSX.Element {
  return <SheetPrimitive.Title data-slot="sheet-title" {...props} />;
}

/**
 * Renders a screen-reader Sheet description for its selected content.
 *
 * @param props Radix description attributes.
 * @returns Accessible Sheet description.
 */
export function SheetDescription(props: React.ComponentProps<typeof SheetPrimitive.Description>): React.JSX.Element {
  return <SheetPrimitive.Description data-slot="sheet-description" {...props} />;
}
