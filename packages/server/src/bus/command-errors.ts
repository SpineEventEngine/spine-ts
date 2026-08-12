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
import { create } from "@bufbuild/protobuf";
import { Validate } from "@spine-event-engine/core";
import {
  ConstraintViolationSchema,
  TemplateStringSchema,
  type ValidationError,
} from "@spine-event-engine/proto";

/**
 * Error raised when a command envelope payload fails command-bus validation.
 */
export class CommandValidationError extends Error {
  // prettier-ignore

  /**
   * Structured payload validation details from the command-bus boundary.
   */
  readonly validationError: ValidationError;

  /**
   * Creates a command-bus validation error with structured details.
   *
   * @param validationError the structured payload validation details.
   */
  constructor(validationError: ValidationError) {
    super("Command payload validation failed.");
    this.name = "CommandValidationError";
    this.validationError = validationError;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Creates a validation error for payloads that cannot be unpacked as the registered type.
   *
   * @returns the invalid-payload error.
   */
  static invalidPayload(): CommandValidationError {
    return new CommandValidationError(
      Validate.createError([
        create(ConstraintViolationSchema, {
          message: create(TemplateStringSchema, {
            withPlaceholders: "Command payload could not be decoded as the registered type.",
          }),
        }),
      ]),
    );
  }
}
