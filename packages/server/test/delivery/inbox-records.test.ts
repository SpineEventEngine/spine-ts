import { create } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import {
  readInboxMessage,
  readDedupGuard,
  readPendingMessage,
  writeDedupClaim,
  writeDedupRecord,
  writeInboxMessage,
} from "../../src/delivery/inbox-records.js";
import { DeliveryStorageCorruptionError, InboxMessageError } from "../../src/index.js";
import { createMessage, oversizedText } from "./inbox-message-fixture.js";
import {
  finalDedupRecord,
  storedInboxJson,
  storedInboxRecord,
  testDedupKey,
  testInboxKey,
} from "./inbox-record-fixture.js";

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

  it("captures one signal payload before validation and serialization", () => {
    let reads = 0;
    const smallSignal = create(AnySchema, {
      typeUrl: "type.example.dev/tasks.Payload",
      value: new Uint8Array(1),
    });
    const oversizedSignal = create(AnySchema, {
      typeUrl: "type.example.dev/tasks.Payload",
      value: new Uint8Array(256 * 1024 + 1),
    });
    const message = {
      ...createMessage("message-1", "signal-1", 1n),
      get signal() {
        reads += 1;
        return reads < 5 ? smallSignal : oversizedSignal;
      },
    };

    const inboxMessage = readInboxMessage(writeInboxMessage(message));

    expect(inboxMessage.signal?.value.byteLength).toBe(1);
    reads = 0;

    const pendingMessage = readPendingMessage(writeDedupClaim(message));

    expect(pendingMessage?.signal?.value.byteLength).toBe(1);
  });

  it("classifies corrupt stored inbox Any envelopes as storage corruption", () => {
    const record = {
      typeUrl: "type.spine-ts.dev/internal/InboxMessageRecord",
      value: undefined,
    } as unknown as Any;

    expect(() => readInboxMessage(record)).toThrow(DeliveryStorageCorruptionError);
  });

  it("classifies stored inbox type URL accessor failures as storage corruption", () => {
    const record = {
      get typeUrl() {
        throw new Error("type URL getter failed");
      },
      value: Buffer.from(
        JSON.stringify(
          storedInboxJson({
            signalId: "signal-1",
            valueBase64: Buffer.from("payload", "utf8").toString("base64"),
          }),
        ),
        "utf8",
      ),
    } as unknown as Any;

    expect(() => readInboxMessage(record)).toThrow(DeliveryStorageCorruptionError);
    expect(() => readInboxMessage(record)).toThrow(/type url/i);
  });

  it("classifies corrupt stored inbox shard coordinates as storage corruption", () => {
    const record = storedInboxRecord({
      signalId: "signal-1",
      valueBase64: Buffer.from("payload", "utf8").toString("base64"),
    });
    record.value = Buffer.from(
      JSON.stringify({
        ...storedInboxJson({
          signalId: "signal-1",
          valueBase64: Buffer.from("payload", "utf8").toString("base64"),
        }),
        key: "-1/1:message-1",
        shard: "-1/1",
        shardIndex: -1,
      }),
      "utf8",
    );

    expect(() => readInboxMessage(record)).toThrow(DeliveryStorageCorruptionError);
  });

  it("classifies corrupt stored dedup Any envelopes as storage corruption", () => {
    const record = {
      typeUrl: "type.spine-ts.dev/internal/InboxDedupRecord",
      value: undefined,
    } as unknown as Any;

    expect(() => readDedupGuard(record, testDedupKey("signal-1"))).toThrow(
      DeliveryStorageCorruptionError,
    );
  });

  it("classifies stored dedup type URL accessor failures as storage corruption", () => {
    const record = {
      get typeUrl() {
        throw new Error("type URL getter failed");
      },
      value: Buffer.from(
        JSON.stringify({
          key: testDedupKey("signal-1"),
          inbox: testInboxKey,
          signalId: "signal-1",
          inboxMessageId: "message-1",
          shardIndex: 0,
          shardTotal: 1,
          state: "FINAL",
          status: "TO_DELIVER",
        }),
        "utf8",
      ),
    } as unknown as Any;

    expect(() => readDedupGuard(record, testDedupKey("signal-1"))).toThrow(
      DeliveryStorageCorruptionError,
    );
    expect(() => readDedupGuard(record, testDedupKey("signal-1"))).toThrow(/type url/i);
  });

  it("classifies corrupt stored dedup shard coordinates as storage corruption", () => {
    const record = finalDedupRecord({
      key: testDedupKey("signal-1"),
      inbox: testInboxKey,
      signalId: "signal-1",
      inboxMessageId: "message-1",
    });
    record.value = Buffer.from(
      JSON.stringify({
        key: testDedupKey("signal-1"),
        inbox: testInboxKey,
        signalId: "signal-1",
        inboxMessageId: "message-1",
        shardIndex: 1,
        shardTotal: 1,
        state: "FINAL",
        status: "TO_DELIVER",
      }),
      "utf8",
    );

    expect(() => readDedupGuard(record, testDedupKey("signal-1"))).toThrow(
      DeliveryStorageCorruptionError,
    );
  });
});
