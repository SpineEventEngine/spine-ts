import { describe, expect, it } from "vitest";
import { ApplicationNode } from "@spine-event-engine/deployment";

import { DynamicSubscriptionCreator, DynamicUnaryForwarder } from "../src/index.js";

describe("DynamicSubscriptionCreator", () => {
  it("uses the shared dynamic owner to reconcile added and removed native streams", async () => {
    const starts: string[] = [];
    const owner = new DynamicUnaryForwarder({
      create: async (node) => client(node.id, starts),
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const a = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });
    const b = new ApplicationNode({ id: "b", endpoint: "http://10.0.0.2" });

    await owner.reconcile([a]);
    await creator.subscribe({ kind: "subscription-topic", bytes: new Uint8Array([7]) }, new AbortController().signal);
    await owner.reconcile([a, b]);
    await owner.reconcile([b]);

    expect(starts).toEqual(["a", "b"]);
  });
});

function client(id: string, starts: string[]) {
  return {
    forward: async () => new Uint8Array(),
    close: async () => {},
    subscribe: async () => ({ kind: "backend-subscription-envelope" as const, bytes: new Uint8Array([1]) }),
    activate: async () => {
      starts.push(id);
    },
    cancel: async () => {},
    dispose: async () => {},
  };
}
