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

// Adapted from shadcn/ui New York v4 Input, MIT; see THIRD_PARTY_NOTICES.

import * as React from "react";
import { cn } from "./cn";

/**
 * Renders the shadcn-derived input with Fieldnotes focus and border colors.
 *
 * @param className Additional visual classes.
 * @param type Native input type.
 * @param props Native input attributes.
 * @returns Labeled form input supplied by its caller.
 */
export function Input({ className, type, ...props }: React.ComponentProps<"input">): React.JSX.Element {
  return <input type={type} data-slot="input" className={cn(
    "min-h-10 w-full rounded-lg border border-[#ccd5cb] bg-white px-3 text-sm text-[#26352f] shadow-sm outline-none placeholder:text-[#829087] focus-visible:border-[#173d32] focus-visible:ring-2 focus-visible:ring-[#df9d3f] disabled:opacity-50",
    className,
  )} {...props} />;
}
