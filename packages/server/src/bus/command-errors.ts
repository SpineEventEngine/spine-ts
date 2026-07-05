import { create } from "@bufbuild/protobuf";
import { createValidationError } from "@spine-ts/core";
import {
  ConstraintViolationSchema,
  TemplateStringSchema,
  type ValidationError,
} from "@spine-ts/proto";

/** Error raised when a command envelope payload fails command-bus validation. */
export class CommandValidationError extends Error {
  /** Structured payload validation details from the command-bus boundary. */
  readonly validationError: ValidationError;

  /** Create a command-bus validation error with structured details. */
  constructor(validationError: ValidationError) {
    super("Command payload validation failed.");
    this.name = "CommandValidationError";
    this.validationError = validationError;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Create a validation error for payloads that cannot be unpacked as the registered type. */
  static invalidPayload(): CommandValidationError {
    return new CommandValidationError(
      createValidationError([
        create(ConstraintViolationSchema, {
          message: create(TemplateStringSchema, {
            withPlaceholders: "Command payload could not be decoded as the registered type.",
          }),
        }),
      ]),
    );
  }
}
