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

import { generateHandlerRegistry } from "@spine-event-engine/server/internal/handler-codegen";

/**
 * Generates application handler registries.
 */
export const HandlerGeneration: Readonly<{ generate(applicationRoot: string): void }> =
  Object.freeze({
    // prettier-ignore

    /**
     * Generates an application's conventional handler registry from its TypeScript project.
     *
     * @param applicationRoot The application package root.
     * @returns Nothing.
     */
    generate(applicationRoot: string): void {
      generateHandlerRegistry({ appRoot: applicationRoot });
    },
  });
