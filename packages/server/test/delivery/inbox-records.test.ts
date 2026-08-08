import { describe, expect, it } from "vitest";

import { InboxRecords } from "../../src/delivery/inbox-records.js";
import { InboxMessageError, ShardIndex } from "../../src/index.js";
import { createMessage } from "./inbox-message-fixture.js";

describe("InboxRecords", () => {
  it("round-trips one generated direct Inbox record without sharing caller snapshots", () => {
    const source = createMessage("message", "signal", 1n);
    const restored = InboxRecords.read(InboxRecords.write(source));
    expect(restored).toEqual(source);
    expect(restored).not.toBe(source);
    expect(restored.id).not.toBe(source.id);
  });

  it("rejects an invalid shard before serialization", () => {
    const fakeShard = { index: 0, ofTotal: 1, key: () => "0/1" };
    expect(() =>
      InboxRecords.write({
        ...createMessage("message", "signal", 1n),
        id: { value: "message", shard: fakeShard as never },
        shard: fakeShard as never,
      }),
    ).toThrow(InboxMessageError);
  });

  it("rejects a malformed signal payload", () => {
    expect(() =>
      InboxRecords.write({
        ...createMessage("message", "signal", 1n),
        signal: { typeUrl: "type", value: "not-bytes" as never },
      }),
    ).toThrow(InboxMessageError);
  });

  it("preserves generated shard coordinates", () => {
    const shard = new ShardIndex(1, 2);
    const source = {
      ...createMessage("message", "signal", 1n),
      id: { value: "message", shard },
      shard,
    };
    expect(InboxRecords.read(InboxRecords.write(source)).shard).toEqual(shard);
  });
});
