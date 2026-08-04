import { create } from "@bufbuild/protobuf";
import { SubscriptionSchema } from "@spine-event-engine/proto/client";
import { describe, expect, it } from "vitest";

import {
  InMemorySubscriptionRegistry,
  StandCapacityError,
} from "../../src/stand/subscription-registry.js";
import { StandSubscriptionRecords } from "../../src/stand/subscription-records.js";

describe("InMemorySubscriptionRegistry", () => {
  it("creates a pending definition, activates it, and physically deletes it", async () => {
    const registry = new InMemorySubscriptionRegistry();
    const subscription = create(SubscriptionSchema, { id: { value: "sub-1" }, topic: { type: "topic" } });

    const created = await registry.create(subscription);
    expect(created.entry.phase).toBe("PENDING");
    expect((await registry.activate("sub-1")).entry?.phase).toBe("ACTIVE");
    expect((await registry.delete("sub-1")).deleted).toBe(true);
    expect(await registry.get("sub-1")).toBeUndefined();
  });

  it("refuses the 101st definition", async () => {
    const registry = new InMemorySubscriptionRegistry();
    for (let value = 0; value < 100; value += 1) {
      await registry.create(create(SubscriptionSchema, { id: { value: `sub-${value}` }, topic: { type: "topic" } }));
    }

    await expect(
      registry.create(create(SubscriptionSchema, { id: { value: "full" }, topic: { type: "topic" } })),
    ).rejects.toBeInstanceOf(StandCapacityError);
  });

  it("rejects a stored record without a creation time", () => {
    expect(() => StandSubscriptionRecords.read(create(StandSubscriptionRecords.schema, {}), "sub-1")).toThrow(
      "Malformed Stand subscription record.",
    );
  });
});
