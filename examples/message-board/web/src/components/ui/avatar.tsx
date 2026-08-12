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
