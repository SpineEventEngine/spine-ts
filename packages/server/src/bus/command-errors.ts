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

import { create, equals } from "@bufbuild/protobuf";
import type { Any } from "@bufbuild/protobuf/wkt";
import { ValidationException, Validate } from "@spine-event-engine/core";
import {
  CommandContextSchema,
  CommandSchema,
  ConstraintViolationSchema,
  FieldPathSchema,
  TemplateStringSchema,
  type ValidationError,
  type Command,
} from "@spine-event-engine/proto";

/**
 * Error raised when a command envelope or payload fails command-bus validation.
 */
export class CommandValidationError extends Error {
  // prettier-ignore

  /**
   * Structured validation details from the command-bus boundary.
   */
  readonly validationError: ValidationError;

  /**
   * Creates a command-bus validation error with structured details.
   *
   * @param validationError Structured Command envelope or payload validation details.
   */
  constructor(validationError: ValidationError) {
    super("Command validation failed.");
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

  /**
   * Creates a field-addressed validation error for an incomplete Command envelope.
   * @param path Proto field path from the Command envelope.
   * @param message Developer-readable validation message.
   * @returns The invalid-envelope error.
   */
  static invalidEnvelope(path: string[], message: string): CommandValidationError {
    return new CommandValidationError(
      Validate.createError([
        create(ConstraintViolationSchema, {
          typeName: "spine.core.Command",
          fieldPath: create(FieldPathSchema, { fieldName: path }),
          message: create(TemplateStringSchema, { withPlaceholders: message }),
        }),
      ]),
    );
  }

  /**
   * Rejects absent/default Command envelope fields and declared constraints.
   * @param command Command to inspect before route admission or dispatch.
   * @throws CommandValidationError for invalid input, or Error for validator failure.
   */
  static checkEnvelope(command: Command): asserts command is Command & { message: Any } {
    if (!command.id?.uuid) {
      throw CommandValidationError.invalidEnvelope(["id", "uuid"], "Command ID cannot be empty.");
    }
    if (!command.message?.typeUrl) {
      throw CommandValidationError.invalidEnvelope(
        ["message"],
        "CommandBus requires command.message.typeUrl.",
      );
    }
    if (
      command.context === undefined ||
      equals(CommandContextSchema, command.context, create(CommandContextSchema))
    ) {
      throw CommandValidationError.invalidEnvelope(
        ["context"],
        "Non-default command context must be set.",
      );
    }
    try {
      Validate.check(CommandSchema, command);
    } catch (error) {
      if (error instanceof ValidationException) throw new CommandValidationError(error.asMessage());
      throw error;
    }
  }
}
