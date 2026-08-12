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
import type { ValidationError } from "@spine-event-engine/proto";

/**
 * Error raised when aggregate command execution rejects a state transition.
 */
export class TransitionValidationError extends Error {
  // prettier-ignore

  /**
   * Stable client-visible error type returned in `Ack.status.error.type`.
   */
  readonly type = "COMMAND_STATE_TRANSITION_VALIDATION_FAILED";

  /**
   * Stable client-visible error message returned in `Ack.status.error.message`.
   */
  readonly clientMessage = "Command state transition validation failed.";

  /**
   * Structured transition validation details from the entity transaction boundary.
   */
  readonly validationError: ValidationError;

  /**
   * Creates an aggregate transition validation error.
   *
   * @param validationError Structured details explaining the rejected transition.
   */
  constructor(validationError: ValidationError) {
    super("Command state transition validation failed.");
    this.name = "TransitionValidationError";
    this.validationError = validationError;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
