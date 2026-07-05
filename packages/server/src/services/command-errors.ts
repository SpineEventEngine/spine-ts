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
