import { create } from "@bufbuild/protobuf";
import { SubscriptionSchema } from "@spine-event-engine/proto/client";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import {
  InMemorySubscriptionRegistry,
  StorageSubscriptionRegistry,
  StandCapacityError,
} from "../../src/stand/subscription-registry.js";
import { StandSubscriptionRecords } from "../../src/stand/subscription-records.js";
import { BoundedContext } from "../../src/index.js";

describe("InMemorySubscriptionRegistry", () => {
  it("creates a pending definition, activates it, and physically deletes it", async () => {
    const registry = new InMemorySubscriptionRegistry();
    const subscription = create(SubscriptionSchema, {
      id: { value: "sub-1" },
      topic: { type: "topic" },
    });

    const created = await registry.create(subscription);
    expect(created.entry.phase).toBe("PENDING");
    expect((await registry.activate("sub-1")).entry?.phase).toBe("ACTIVE");
    expect((await registry.delete("sub-1")).deleted).toBe(true);
    expect(await registry.get("sub-1")).toBeUndefined();
  });

  it("refuses the 101st definition", async () => {
    const registry = new InMemorySubscriptionRegistry();
    for (let value = 0; value < 100; value += 1) {
      await registry.create(
        create(SubscriptionSchema, {
          id: { value: `sub-${String(value)}` },
          topic: { type: "topic" },
        }),
      );
    }

    await expect(
      registry.create(
        create(SubscriptionSchema, { id: { value: "full" }, topic: { type: "topic" } }),
      ),
    ).rejects.toBeInstanceOf(StandCapacityError);
  });

  it("rejects a stored record without a creation time", () => {
    expect(() =>
      StandSubscriptionRecords.read(create(StandSubscriptionRecords.schema, {}), "sub-1"),
    ).toThrow("Stand subscription record is invalid.");
  });

  it("transfers a custom registry to its built context", async () => {
    const registry = new InMemorySubscriptionRegistry(1);
    const context = BoundedContext.singleTenant("registry-test")
      .withSubscriptionRegistry(registry)
      .build();
    await context.close();
    await expect(
      registry.create(create(SubscriptionSchema, { id: { value: "after-close" } })),
    ).rejects.toThrow("closed");
  });
});

describe("StorageSubscriptionRegistry", () => {
  it("shares one durable capacity control across independently opened handles", async () => {
    const factory = new InMemoryStorageFactory();
    const context = { name: "registry-test", multitenant: false };
    const first = new StorageSubscriptionRegistry(context, factory, 1);
    const second = new StorageSubscriptionRegistry(context, factory, 1);

    const [one, two] = await Promise.allSettled([
      first.create(create(SubscriptionSchema, { id: { value: "one" }, topic: { type: "topic" } })),
      second.create(create(SubscriptionSchema, { id: { value: "two" }, topic: { type: "topic" } })),
    ]);

    expect([one, two].filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await first.snapshot()).toHaveLength(1);
    await first.close();
    await second.close();
  });

  it("releases durable capacity after physical deletion", async () => {
    const factory = new InMemoryStorageFactory();
    const context = { name: "registry-delete-test", multitenant: false };
    const registry = new StorageSubscriptionRegistry(context, factory, 1);
    const first = create(SubscriptionSchema, { id: { value: "one" }, topic: { type: "topic" } });
    const second = create(SubscriptionSchema, { id: { value: "two" }, topic: { type: "topic" } });

    await registry.create(first);
    await expect(registry.create(second)).rejects.toBeInstanceOf(StandCapacityError);
    expect(await registry.delete("one")).toEqual({ deleted: true });
    await expect(registry.create(second)).resolves.toMatchObject({ created: true });
    await registry.close();
  });
});
