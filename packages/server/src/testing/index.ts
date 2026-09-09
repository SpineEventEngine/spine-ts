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

import { ServerEnvironmentLifecycle } from "../server/server-environment.js";
import { boundedContextAccess, type BoundedContext } from "../context/bounded-context.js";
import type { Command, Event } from "@spine-event-engine/proto";

export {
  unpackExternalEvent,
  wrapBoundedContextOnline,
  wrapExternalEvent,
  wrapExternalEventsWanted,
} from "../integration/external-messages.js";

/**
 * Provides deterministic server-environment cleanup for package tests.
 */
export const ServerTests: { readonly resetEnvironment: () => Promise<void> } = Object.freeze({
  // prettier-ignore

  /**
   * Resets shared server facilities before the next test creates a server.
   */
  resetEnvironment(): Promise<void> {
    return ServerEnvironmentLifecycle.resetForTest();
  },
});

/**
 * Resets shared server facilities before the next test creates a server.
 */
const serverTestReset: () => Promise<void> = ServerTests.resetEnvironment;

export { serverTestReset as resetServerEnvironmentForTest };

/**
 * Posts a locally constructed Event through the bounded context's external intake path.
 *
 * @param context Receives the external Event.
 * @param event Event envelope whose external origin is preserved.
 * @returns Completion after external dispatch admission.
 */
export function postExternalEvent(context: BoundedContext, event: Event): Promise<void> {
  return boundedContextAccess.postExternalEvent(context, event);
}

/**
 * Observes produced signals admitted by one bounded context.
 *
 * @param context Produces the observed signals.
 * @param observer Receives cloned admitted Command and Event envelopes.
 * @returns A handle that stops observation.
 */
export function observeProducedSignals(
  context: BoundedContext,
  observer: {
    readonly onCommand?: (command: Readonly<Command>) => void;
    readonly onEvent?: (event: Readonly<Event>) => void;
  },
): { readonly close: () => void } {
  return boundedContextAccess.observeProducedSignals(context, observer);
}
