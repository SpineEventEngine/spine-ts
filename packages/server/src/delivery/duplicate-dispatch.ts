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

import { CommandValidationError, EventValidationError } from "@spine-event-engine/proto";

/**
 * Signals a terminal duplicate dispatch to the Inbox worker without invoking failure policy.
 * @internal
 */
export class DuplicateDispatch extends Error {
  /**
   * Identifies the matching validation outcome for the original signal.
   */
  readonly code:
    typeof CommandValidationError.DUPLICATE_COMMAND | typeof EventValidationError.DUPLICATE_EVENT;

  /**
   * Selects the validation enum family.
   */
  readonly kind: "command" | "event";

  /**
   * Creates a terminal duplicate outcome.
   *
   * @param kind Selects the Command or Event validation outcome.
   */
  constructor(kind: "command" | "event") {
    super(kind === "command" ? "DUPLICATE_COMMAND" : "DUPLICATE_EVENT");
    this.name = "DuplicateDispatch";
    this.kind = kind;
    this.code =
      kind === "command"
        ? CommandValidationError.DUPLICATE_COMMAND
        : EventValidationError.DUPLICATE_EVENT;
  }
}
