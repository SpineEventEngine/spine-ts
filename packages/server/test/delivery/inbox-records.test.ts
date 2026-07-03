import { create } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import {
  writeDedupClaim,
  writeDedupRecord,
  writeInboxMessage,
} from "../../src/delivery/inbox-records.js";
import { InboxMessageError } from "../../src/index.js";
import { createMessage, oversizedText } from "./inbox-message-fixture.js";

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

  it("rejects fake shard-shaped caller input before serializing inbox and dedup records", () => {
    const fakeShard = Object.freeze({
      index: 1,
      ofTotal: 1,
      key: () => "1/1",
    });
    const message = {
      ...createMessage("message-1", "signal-1", 1n),
      id: {
        value: "message-1",
        shard: fakeShard,
      },
      shard: fakeShard,
    };

    expect(() => writeInboxMessage(message)).toThrow(InboxMessageError);
    expect(() => writeInboxMessage(message)).toThrow(/shard/i);
    expect(() => writeDedupClaim(message)).toThrow(InboxMessageError);
    expect(() => writeDedupRecord(message)).toThrow(InboxMessageError);
  });

  it("rejects non-Uint8Array signal payloads before serializing inbox and dedup records", () => {
    const message = {
      ...createMessage("message-1", "signal-1", 1n),
      signal: {
        typeUrl: "type.example.dev/tasks.Payload",
        value: "payload" as unknown as Uint8Array,
      } as Any,
    };

    expect(() => writeInboxMessage(message)).toThrow(InboxMessageError);
    expect(() => writeInboxMessage(message)).toThrow(/payload/i);
    expect(() => writeDedupClaim(message)).toThrow(InboxMessageError);
    expect(() => writeDedupRecord(message)).toThrow(InboxMessageError);
  });
});
