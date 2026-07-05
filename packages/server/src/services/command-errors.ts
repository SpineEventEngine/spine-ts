import type { ValidationError } from "@spine-ts/proto";

/** Error a command handler may throw to immediately refuse a command. */
export class CommandRefusalError extends Error {
  /** Stable client-visible error type returned in `Ack.status.error.type`. */
  readonly type: string;

  /** Stable client-visible error message returned in `Ack.status.error.message`. */
  readonly clientMessage: string;

  /** Create an immediate command refusal with stable Ack error information. */
  constructor(type: string, clientMessage: string) {
    super(clientMessage);
    this.name = "CommandRefusalError";
    this.type = type;
    this.clientMessage = clientMessage;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Error raised when aggregate command execution rejects a state transition. */
export class TransitionValidationError extends Error {
  /** Stable client-visible error type returned in `Ack.status.error.type`. */
  readonly type = "COMMAND_STATE_TRANSITION_VALIDATION_FAILED";

  /** Stable client-visible error message returned in `Ack.status.error.message`. */
  readonly clientMessage = "Command state transition validation failed.";

  /** Structured transition validation details from the entity transaction boundary. */
  readonly validationError: ValidationError;

  /** Create a stable command error from transaction validation details. */
  constructor(validationError: ValidationError) {
    super("Command state transition validation failed.");
    this.name = "TransitionValidationError";
    this.validationError = validationError;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
