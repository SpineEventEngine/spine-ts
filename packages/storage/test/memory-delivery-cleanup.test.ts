import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import { DeliveryCleanupStorageFactories } from "../src/internal/delivery-cleanup.js";
import { InMemoryStorageFactory } from "../src/memory/in-memory-storage-factory.js";
import { RecordSpec } from "../src/record/record-spec.js";

const spec = new RecordSpec({ sourceType: StringValueSchema, recordType: StringValueSchema, idKind: "string", extractId: (record) => record.value });

describe("Memory delivery cleanup source graph", () => {
  it("rejects an unregistered factory", () => {
    expect(() => DeliveryCleanupStorageFactories.create({} as never)).toThrow("does not provide");
  });
  it("removes only an exact inbox snapshot while the exact session remains current", async () => {
    const factory = new InMemoryStorageFactory();
    const context = { name: "memory-cleanup", multitenant: false } as const;
    const inbox = factory.createRecordStorage(context, spec);
    const sessions = factory.createRecordStorage(context, spec);
    const current = create(StringValueSchema, { value: "session" });
    const delivered = create(StringValueSchema, { value: "delivered" });
    await sessions.write(current);
    await inbox.write(delivered);
    const cleanup = DeliveryCleanupStorageFactories.create(factory);
    await expect(cleanup.remove({ context, inbox: { spec, id: "delivered", expected: delivered }, session: { spec, id: "session", expected: current, isCurrent: (value) => value.value === "session" } })).resolves.toBe(true);
    await expect(inbox.read("delivered")).resolves.toBeUndefined();
    await expect(cleanup.remove({ context, inbox: { spec, id: "delivered", expected: delivered }, session: { spec, id: "session", expected: current, isCurrent: () => false } })).resolves.toBe(false);
    await sessions.compareAndSet("session", current, create(StringValueSchema, { value: "changed" }));
    await expect(cleanup.remove({ context, inbox: { spec, id: "delivered", expected: delivered }, session: { spec, id: "session", expected: current, isCurrent: () => true } })).resolves.toBe(false);
    cleanup.close();
    await expect(cleanup.remove({ context, inbox: { spec, id: "delivered", expected: delivered }, session: { spec, id: "session", expected: current, isCurrent: () => true } })).rejects.toThrow("closed");
    inbox.close(); sessions.close();
  });
});
