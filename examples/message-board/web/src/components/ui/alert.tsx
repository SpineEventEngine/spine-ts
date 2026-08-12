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
