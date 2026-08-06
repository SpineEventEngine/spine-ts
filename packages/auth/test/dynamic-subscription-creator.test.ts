import { describe, expect, it } from "vitest";
import { create, toBinary } from "@bufbuild/protobuf";
import { ApplicationNode } from "@spine-event-engine/deployment";
import { SubscriptionSchema, TopicSchema } from "@spine-event-engine/proto/client";

import { DynamicSubscriptionCreator, DynamicUnaryForwarder } from "../src/index.js";

describe("DynamicSubscriptionCreator", () => {
  it("keeps native children inactive until the public activation request", async () => {
    const starts: string[] = [];
    const owner = new DynamicUnaryForwarder({ create: async (node) => client(node.id, starts) });
    const creator = new DynamicSubscriptionCreator(owner);
    const node = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });
    const wire = subscription();

    await owner.reconcile([node]);
    await creator.subscribe(wire, new AbortController().signal);

    expect(starts).toEqual([]);
    await creator.activate({ wire, updates: async () => {} }, new AbortController().signal);
    expect(starts).toEqual(["a"]);
  });

  it("uses the shared dynamic owner to reconcile added and removed native streams", async () => {
    const starts: string[] = [];
    const owner = new DynamicUnaryForwarder({
      create: async (node) => client(node.id, starts),
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const a = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });
    const b = new ApplicationNode({ id: "b", endpoint: "http://10.0.0.2" });

    const wire = subscription();
    await owner.reconcile([a]);
    await creator.subscribe(wire, new AbortController().signal);
    await creator.activate({ wire, updates: async () => {} }, new AbortController().signal);
    await owner.reconcile([a, b]);
    await owner.reconcile([b]);

    expect(starts).toEqual(["a", "b"]);
  });

  it("starts one child on every discovered node without a 32-node cap", async () => {
    const starts: string[] = [];
    const owner = new DynamicUnaryForwarder({
      create: async (node) => client(node.id, starts),
      maxConcurrentStarts: 4,
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const nodes = Array.from(
      { length: 40 },
      (_, index) =>
        new ApplicationNode({ id: `node-${index.toString()}`, endpoint: `http://10.0.0.${index}` }),
    );

    const wire = subscription();
    await owner.reconcile(nodes);
    await creator.subscribe(wire, new AbortController().signal);
    await creator.activate({ wire, updates: async () => {} }, new AbortController().signal);

    expect(starts).toHaveLength(40);
    expect(new Set(starts)).toEqual(new Set(nodes.map((node) => node.id)));
  });

  it("aborts and disposes a removed node child before closing its client", async () => {
    let activationAborted = false;
    let disposals = 0;
    const owner = new DynamicUnaryForwarder({
      create: async (node) => ({
        ...client(node.id, []),
        activate: async (_request, signal) => {
          await new Promise<void>((resolve) => {
            signal.addEventListener(
              "abort",
              () => {
                activationAborted = true;
                resolve();
              },
              { once: true },
            );
          });
        },
        dispose: async () => {
          disposals++;
        },
      }),
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const node = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });

    const wire = subscription();
    await owner.reconcile([node]);
    await creator.subscribe(wire, new AbortController().signal);
    await creator.activate({ wire, updates: async () => {} }, new AbortController().signal);
    await owner.reconcile([]);

    expect(activationAborted).toBe(true);
    expect(disposals).toBe(1);
  });

  it("retries failed cleanup on the next membership reconciliation", async () => {
    let attempts = 0;
    const owner = new DynamicUnaryForwarder({
      create: async (node) => ({
        ...client(node.id, []),
        dispose: async () => {
          attempts++;
          if (attempts === 1) throw new Error("temporary cleanup failure");
        },
      }),
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const node = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });

    const wire = subscription();
    await owner.reconcile([node]);
    await creator.subscribe(wire, new AbortController().signal);
    await creator.activate({ wire, updates: async () => {} }, new AbortController().signal);
    await owner.reconcile([]);
    await owner.reconcile([]);

    expect(attempts).toBe(2);
  });
});

function subscription() {
  return {
    kind: "public-subscription" as const,
    bytes: toBinary(
      SubscriptionSchema,
      create(SubscriptionSchema, { id: { value: "board" }, topic: create(TopicSchema) }),
    ),
  };
}

function client(id: string, starts: string[]) {
  return {
    forward: async () => new Uint8Array(),
    close: async () => {},
    subscribe: async () => ({
      kind: "backend-subscription-envelope" as const,
      bytes: new Uint8Array([1]),
    }),
    activate: async (_request, signal) => {
      starts.push(id);
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", resolve, { once: true });
      });
    },
    cancel: async () => {},
    dispose: async () => {},
  };
}
