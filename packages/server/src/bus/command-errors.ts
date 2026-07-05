import type { ValidationError } from "@spine-ts/proto";

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
}
