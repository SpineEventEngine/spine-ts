import type { ValidationError } from "@spine-event-engine/proto";

/** Error raised when aggregate command execution rejects a state transition. */
export class TransitionValidationError extends Error {
  /** Stable client-visible error type returned in `Ack.status.error.type`. */
  readonly type = "COMMAND_STATE_TRANSITION_VALIDATION_FAILED";

  /** Stable client-visible error message returned in `Ack.status.error.message`. */
  readonly clientMessage = "Command state transition validation failed.";

  /** Structured transition validation details from the entity transaction boundary. */
  readonly validationError: ValidationError;

  /** Creates an aggregate transition validation error.
   *
   * @param validationError - Structured details explaining the rejected transition.
   */
  constructor(validationError: ValidationError) {
    super("Command state transition validation failed.");
    this.name = "TransitionValidationError";
    this.validationError = validationError;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
