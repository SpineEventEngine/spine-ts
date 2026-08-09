import { create } from "@bufbuild/protobuf";
import { EventIdSchema } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

import { Identifiers, StringifierRegistry, Stringifiers, type Stringifier } from "../src/index.js";

describe("JVM-compatible identifier and stringifier contracts", () => {
  it("packs and unpacks a message identifier through its generated schema", () => {
    const id = create(EventIdSchema, { value: "event-42" });

    const packed = Identifiers.pack(EventIdSchema, id);

    expect(Identifiers.unpack(EventIdSchema, packed)).toEqual(id);
  });

  it("round-trips a message as compact Proto JSON", () => {
    const id = create(EventIdSchema, { value: "event-42" });
    const stringifier = Stringifiers.forMessage(EventIdSchema);

    const stored = stringifier.toString(id);

    expect(stored).toBe('{"value":"event-42"}');
    expect(stringifier.fromString(stored)).toEqual(id);
  });

  it.each([
    ["string", "message-42"],
    ["int32", 42],
    ["int64", 42n],
  ] as const)("packs and unpacks a %s identifier", (type, id) => {
    const packed = Identifiers.pack(type, id);

    expect(Identifiers.unpack(type, packed)).toBe(id);
  });

  it("rejects primitive identifiers outside their declared type", () => {
    expect(() => Identifiers.pack("int32", 2 ** 31)).toThrow(
      "Identifier is outside the int32 range.",
    );
    expect(() => Identifiers.pack("int64", 1n << 63n)).toThrow(
      "Identifier is outside the int64 range.",
    );
  });

  it("uses an explicitly registered schema stringifier in both directions", () => {
    const registry = new StringifierRegistry();
    const custom: Stringifier<ReturnType<typeof createEventId>> = {
      toString: (id) => `event:${id.value}`,
      fromString: (value) => createEventId(value.replace(/^event:/u, "")),
    };
    registry.register(EventIdSchema, custom);

    const stringifier = registry.forMessage(EventIdSchema);

    expect(stringifier.toString(createEventId("42"))).toBe("event:42");
    expect(stringifier.fromString("event:42")).toEqual(createEventId("42"));
  });

  it("copies registrations without sharing later mutations", () => {
    const original = new StringifierRegistry();
    original.register(EventIdSchema, {
      toString: (id) => `first:${id.value}`,
      fromString: (value) => createEventId(value.slice(6)),
    });
    const snapshot = new StringifierRegistry(original);
    original.register(EventIdSchema, {
      toString: (id) => `second:${id.value}`,
      fromString: (value) => createEventId(value.slice(7)),
    });

    expect(snapshot.forMessage(EventIdSchema).toString(createEventId("42"))).toBe("first:42");
  });
});

function createEventId(value: string) {
  return create(EventIdSchema, { value });
}
