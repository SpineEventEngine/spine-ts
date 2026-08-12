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

import type { ComponentProps, ReactElement } from "react";

import { cn } from "../../lib/utils.js";

/**
 * Renders a Shadcn text input.
 *
 * @param props The native input attributes.
 * @returns The styled input element.
 */
export const Input = (props: ComponentProps<"input">): ReactElement => {
  const { className, type = "text", ...nativeProps } = props;
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        "h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base shadow-sm outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm",
        className,
      )}
      {...nativeProps}
    />
  );
};
