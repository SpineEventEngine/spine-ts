import { create } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import { writeDedupClaim, writeInboxMessage } from "../../src/delivery/inbox-records.js";
import { InboxMessageError } from "../../src/index.js";
import { createMessage, oversizedText } from "./inbox-test-support.js";

describe("Inbox record limits", () => {
  it("rejects composed inbox keys that overflow the durable read cap after escaping", () => {
    const escaped = oversizedText(16 * 1024, "\\");

    expect(() =>
      writeInboxMessage({
        ...createMessage("message-1", "signal-1", 1n),
        inboxId: {
          targetId: escaped,
          targetTypeUrl: escaped,
        },
      }),
    ).toThrow(InboxMessageError);
    expect(() =>
      writeInboxMessage({
        ...createMessage("message-1", "signal-1", 1n),
        inboxId: {
          targetId: escaped,
          targetTypeUrl: escaped,
        },
      }),
    ).toThrow(/inbox key/i);
  });

  it("rejects composed dedup keys that overflow the durable read cap after escaping", () => {
    const escapedInbox = oversizedText(16_000, "\\");
    const signalId = oversizedText(2_048);

    expect(() =>
      writeDedupClaim({
        ...createMessage("message-1", signalId, 1n),
        inboxId: {
          targetId: escapedInbox,
          targetTypeUrl: escapedInbox,
        },
      }),
    ).toThrow(InboxMessageError);
    expect(() =>
      writeDedupClaim({
        ...createMessage("message-1", signalId, 1n),
        inboxId: {
          targetId: escapedInbox,
          targetTypeUrl: escapedInbox,
        },
      }),
    ).toThrow(/dedup key/i);
  });

  it("rejects pending dedup claims whose combined valid inputs overflow the aggregate budget", () => {
    const escaped = oversizedText(16 * 1024, "\\");
    const target = oversizedText(12 * 1024);

    expect(() =>
      writeDedupClaim({
        ...createMessage(escaped, escaped, 1n),
        inboxId: {
          targetId: target,
          targetTypeUrl: target,
        },
        signal: create(AnySchema, {
          typeUrl: "type.example.dev/tasks.Payload",
          value: new Uint8Array(256 * 1024),
        }),
      }),
    ).toThrow(InboxMessageError);
    expect(() =>
      writeDedupClaim({
        ...createMessage(escaped, escaped, 1n),
        inboxId: {
          targetId: target,
          targetTypeUrl: target,
        },
        signal: create(AnySchema, {
          typeUrl: "type.example.dev/tasks.Payload",
          value: new Uint8Array(256 * 1024),
        }),
      }),
    ).toThrow(/aggregate budget/i);
  });
});
