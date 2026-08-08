import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { DeliveryBuilder, DeliveryMonitor, ShardIndex } from "../../src/index.js";

describe("DeliveryMonitor delivery", () => {
  it("is instantiable and permits direct or promised hook results", async () => {
    const monitor = new DeliveryMonitor();
    expect(await monitor.shouldContinueAfter("DELIVERY")).toBe(true);
    await monitor.onDeliveryStarted(ShardIndex.single());
  });

  it("allocates an opaque distinct WorkerId for each delivery lifetime", () => {
    const first = build().withNode("node-a").build();
    const second = build().withNode("node-a").build();
    expect(first.worker.nodeId?.value).toBe("node-a");
    expect(first.worker.value).not.toBe("node-a");
    expect(second.worker.value).not.toBe(first.worker.value);
  });

  it("accepts an explicit complete WorkerId", () => {
    const worker = { nodeId: { value: "node-a" }, value: "restart-a" };
    expect(build().withWorker(worker).build().worker).toEqual(worker);
  });

  it("contains failed acknowledgement and continues an independent target", async () => {
    const shard = ShardIndex.single();
    const messages = [message("first", "same", shard), message("blocked", "same", shard), message("other", "other", shard)];
    let reads = 0;
    const seen: string[] = [];
    await build()
      .withInbox({
        sessionKind: "LEASED",
        receive: async () => { throw new Error("not used"); },
        read: async () => (reads++ === 0 ? messages : []),
        readMessage: async () => undefined,
        begin: async (value) => ({
          message: value,
          synchronize: async () => undefined,
          complete: async () => {
            if (value.signalId === "first") throw new Error("acknowledgement failed");
            return true;
          },
          abandon: async () => undefined,
        }),
      })
      .withWorkRegistry(registry(shard))
      .build()
      .run({ onMessage: (value) => { seen.push(value.signalId); if (value.signalId === "first") throw new Error("dispatch failed"); } });
    expect(seen).toEqual(["first", "other"]);
  });

  it("fences callback before dispatch after renewal loss", async () => {
    const shard = ShardIndex.single();
    let dispatched = 0;
    await build()
      .withInbox({
        sessionKind: "LEASED",
        receive: async () => { throw new Error("not used"); },
        read: async () => [message("pending", "target", shard)],
        readMessage: async () => undefined,
        begin: async () => { throw new Error("must not begin"); },
      })
      .withWorkRegistry({ ...registry(shard), renew: async () => undefined })
      .build()
      .run({ onMessage: () => { dispatched += 1; } });
    expect(dispatched).toBe(0);
  });
});

function build(): DeliveryBuilder {
  return new DeliveryBuilder().withStorageFactory(new InMemoryStorageFactory());
}
function message(signalId: string, targetId: string, shard: ShardIndex) {
  return { id: { value: signalId, shard }, inboxId: { targetId, targetTypeUrl: "type" }, signalId, label: "UPDATE_SUBSCRIBER" as const, status: "TO_DELIVER" as const, shard, whenReceived: new Date(), version: 1n };
}
function registry(shard: ShardIndex) {
  return { sessionKind: "LEASED" as const, pickUp: async () => ({ kind: "LEASED" as const, shard }), release: async () => true };
}
