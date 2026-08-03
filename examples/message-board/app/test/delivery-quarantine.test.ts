import { create } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { RecordSpec } from "@spine-event-engine/storage";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { DeliveryQuarantine } from "../src/delivery-quarantine.js";

const context = { name: "spine.message-board.delivery-quarantine", multitenant: false };
const storageKey = "spine.examples.messageboard.DeliveryQuarantine:v1";
const recordKey = "records";

describe("DeliveryQuarantine", () => {
  it("persists, replaces, and removes a recovery record", async () => {
    const quarantine = new DeliveryQuarantine(new InMemoryStorageFactory());

    await quarantine.put(record("message", "ADMITTED"));
    await quarantine.put(record("message", "REMOVING"));

    await expect(quarantine.get("message")).resolves.toEqual(record("message", "REMOVING"));
    await quarantine.delete("message");
    await expect(quarantine.get("message")).resolves.toBeUndefined();
  });

  it("retains concurrent records written through independently opened handles", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const left = new DeliveryQuarantine(storageFactory);
    const right = new DeliveryQuarantine(storageFactory);

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        (index % 2 === 0 ? left : right).put(record(`message-${String(index)}`, "ADMITTED")),
      ),
    );

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        expect(left.get(`message-${String(index)}`)).resolves.toEqual(
          record(`message-${String(index)}`, "ADMITTED"),
        ),
      ),
    );
  });

  it("rejects corrupt state and bounded overflow", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const quarantine = new DeliveryQuarantine(storageFactory);
    const storage = storageFactory.createRecordStorage(
      context,
      new RecordSpec({
        schema: AnySchema,
        storageKey,
        idKind: "string",
        extractId: () => recordKey,
      }),
    );
    await storage.write(create(AnySchema, { typeUrl: "invalid", value: new Uint8Array() }));
    await expect(quarantine.get("message")).rejects.toThrow("quarantine is invalid");
    storage.close();

    const full = new DeliveryQuarantine(new InMemoryStorageFactory());
    for (let index = 0; index < 100; index += 1) {
      await full.put(record(`message-${String(index)}`, "ADMITTED"));
    }
    await expect(full.put(record("one-more", "ADMITTED"))).rejects.toThrow("quarantine is full");
  });

  it("rejects later access after close without closing the factory", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const quarantine = new DeliveryQuarantine(storageFactory);

    quarantine.close();

    expect(storageFactory.isOpen()).toBe(true);
    await expect(quarantine.get("message")).rejects.toThrow("closed");
  });
});

function record(id: string, phase: "ADMITTED" | "REMOVING") {
  return Object.freeze({
    id,
    phase,
    fingerprint: "a".repeat(64),
  });
}
