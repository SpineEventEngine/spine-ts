import type { ValidationError } from "@spine-ts/proto";

/** Error raised when aggregate command execution rejects a state transition. */
export class TransitionValidationError extends Error {
  /** Structured transition validation details from the entity transaction boundary. */
  readonly validationError: ValidationError;

  /** Create an aggregate transition validation error. */
  constructor(validationError: ValidationError) {
    super("Command state transition validation failed.");
    this.name = "TransitionValidationError";
    this.validationError = validationError;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
