import type { ValidationError } from "@spine-ts/proto";

/** Error raised when stored aggregate history cannot be replayed safely. */
export class ReplayError extends Error {
  /** Structured transition validation details from replay. */
  readonly validationError: ValidationError;

  /** Create an aggregate history replay error. */
  constructor(validationError: ValidationError) {
    super("Aggregate history replay failed.");
    this.name = "ReplayError";
    this.validationError = validationError;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
