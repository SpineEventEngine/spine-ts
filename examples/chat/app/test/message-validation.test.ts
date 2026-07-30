import { describe, expect, it } from "vitest";

import {
  maximumChatIdentifierBytes,
  maximumChatTextBytes,
  ChatMessageValidation,
} from "../src/message-validation.js";

describe("Chat message validation", () => {
  const validation = new ChatMessageValidation();

  it("accepts bounded identifiers, text, and a valid timestamp", () => {
    expect(() => {
      validation.validate(validInput());
    }).not.toThrow();
    expect(maximumChatIdentifierBytes).toBe(128);
    expect(maximumChatTextBytes).toBe(4_096);
  });

  it("measures multibyte identifiers and text in UTF-8 bytes", () => {
    expect(() => {
      validation.validate({
        ...validInput(),
        id: "é".repeat(64),
        text: "é".repeat(2_048),
      });
    }).not.toThrow();
    expect(() => {
      validation.validate({ ...validInput(), id: "é".repeat(65) });
    }).toThrow(RangeError);
    expect(() => {
      validation.validate({ ...validInput(), text: "é".repeat(2_049) });
    }).toThrow(RangeError);
  });

  it.each([
    ["missing message ID", { id: undefined }],
    ["blank room", { room: " " }],
    ["overlong author", { author: "x".repeat(129) }],
    ["blank text", { text: "\t" }],
    ["overlong text", { text: "x".repeat(4_097) }],
    ["missing timestamp", { postedAt: undefined }],
    ["early timestamp", { postedAt: { seconds: -62_135_596_801n, nanos: 0 } }],
    ["late timestamp", { postedAt: { seconds: 253_402_300_800n, nanos: 0 } }],
    ["negative nanos", { postedAt: { seconds: 1n, nanos: -1 } }],
    ["large nanos", { postedAt: { seconds: 1n, nanos: 1_000_000_000 } }],
  ] as const)("rejects %s", (_label, invalid) => {
    expect(() => {
      validation.validate({ ...validInput(), ...invalid });
    }).toThrow(RangeError);
  });
});

function validInput() {
  return {
    id: "message-1",
    room: "room-1",
    author: "ada",
    text: "hello",
    postedAt: { seconds: 1n, nanos: 0 },
  };
}
