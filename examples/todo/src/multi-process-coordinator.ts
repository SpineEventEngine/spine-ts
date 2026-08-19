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

/**
 * Coordinates terminal shutdown and ready reporting for the multi-process parent.
 */

import type { ManagedServerApplicationHandle } from "@spine-event-engine/server";

import type { TodoMultiProcessSettings } from "./multi-process-settings.js";

/**
 * Connects the Coordinator parent to the terminal that started it.
 *
 * @param handle Controls the managed parent and all of its child replicas.
 * @param settings Supplies the public Coordinator address for the ready message.
 */
export function runTodoCoordinator(
  handle: ManagedServerApplicationHandle,
  settings: TodoMultiProcessSettings,
): void {
  let closing: Promise<void> | undefined;
  const onCoordinatorSignal = () => {
    closing ??= handle.close().then(
      () => {
        process.exitCode = 0;
      },
      () => {
        process.exitCode = 1;
      },
    );
  };
  process.once("SIGINT", onCoordinatorSignal);
  process.once("SIGTERM", onCoordinatorSignal);
  console.log(
    `To-Do multi-process Coordinator ready at ${settings.host}:${settings.port.toString()}`,
  );
}
