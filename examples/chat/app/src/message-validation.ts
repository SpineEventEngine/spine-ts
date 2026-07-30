/** Maximum UTF-8 byte length accepted for client-provided Chat identifiers. */
export const maximumChatIdentifierBytes = 128;
/** Maximum UTF-8 byte length accepted for one Chat message body. */
export const maximumChatTextBytes = 4_096;

const earliestTimestampSeconds = -62_135_596_800n;
const latestTimestampSeconds = 253_402_300_799n;
const utf8 = new TextEncoder();

/** Validates Chat command input before Aggregate state or event publication. */
export class ChatMessageValidation {
  /** Rejects invalid message fields before they can become state or events.
   *
   * @param input - Fields submitted with a Chat `PostMessage` command.
   */
  validate(input: ChatMessageInput): void {
    this.assertIdentifier("message ID", input.id);
    this.assertIdentifier("room ID", input.room);
    this.assertIdentifier("author ID", input.author);
    this.assertText(input.text);
    this.assertTimestamp(input.postedAt);
  }

  private assertIdentifier(name: string, value: string | undefined): void {
    if (value === undefined || value.trim().length === 0) {
      throw new RangeError(`${name} must be a non-blank string.`);
    }
    if (utf8.encode(value).byteLength > maximumChatIdentifierBytes) {
      throw new RangeError(
        `${name} must not exceed ${String(maximumChatIdentifierBytes)} UTF-8 bytes.`,
      );
    }
  }

  private assertText(value: string): void {
    if (value.trim().length === 0 || utf8.encode(value).byteLength > maximumChatTextBytes) {
      throw new RangeError(
        `message text must not exceed ${String(maximumChatTextBytes)} UTF-8 bytes.`,
      );
    }
  }

  private assertTimestamp(value: ChatTimestamp | undefined): void {
    if (
      value === undefined ||
      value.seconds < earliestTimestampSeconds ||
      value.seconds > latestTimestampSeconds ||
      !Number.isInteger(value.nanos) ||
      value.nanos < 0 ||
      value.nanos > 999_999_999
    ) {
      throw new RangeError("posted_at must be a valid protobuf Timestamp.");
    }
  }
}

interface ChatMessageInput {
  readonly id: string | undefined;
  readonly room: string | undefined;
  readonly author: string | undefined;
  readonly text: string;
  readonly postedAt: ChatTimestamp | undefined;
}

interface ChatTimestamp {
  readonly seconds: bigint;
  readonly nanos: number;
}
