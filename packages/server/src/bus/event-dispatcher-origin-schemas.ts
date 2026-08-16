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

import type { MessageSchema } from "@spine-event-engine/core";

import type { EventDispatcher } from "./event-dispatcher.js";

interface OriginSchemas {
  readonly domestic: readonly MessageSchema[];
  readonly external: readonly MessageSchema[];
}

const values = new WeakMap<EventDispatcher, OriginSchemas>();

/**
 * Associates a repository dispatcher with its otherwise unrepresentable
 * mixed-origin schema sets without widening the application-facing dispatcher API.
 * @internal
 */
export const EventDispatcherOriginSchemas: {
  readonly define: (
    dispatcher: EventDispatcher,
    domestic: readonly MessageSchema[],
    external: readonly MessageSchema[],
  ) => EventDispatcher;
  readonly get: (dispatcher: EventDispatcher) => OriginSchemas | undefined;
} = Object.freeze({
  define(
    dispatcher: EventDispatcher,
    domestic: readonly MessageSchema[],
    external: readonly MessageSchema[],
  ): EventDispatcher {
    values.set(
      dispatcher,
      Object.freeze({
        domestic: Object.freeze([...domestic]),
        external: Object.freeze([...external]),
      }),
    );
    return dispatcher;
  },
  get(dispatcher: EventDispatcher): OriginSchemas | undefined {
    return values.get(dispatcher);
  },
});
