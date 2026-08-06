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

  it("does not activate a child until its concurrent add has installed it", async () => {
    const entered = deferred<void>();
    const release = deferred<{
      readonly kind: "backend-subscription-envelope";
      readonly bytes: Uint8Array;
    }>();
    const starts: string[] = [];
    const owner = new DynamicUnaryForwarder({
      create: async (node) => ({
        ...client(node.id, starts),
        subscribe: async (_request, signal) => {
          entered.resolve();
          return awaitAbortable(release.promise, signal);
        },
      }),
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const node = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });
    const wire = subscription();

    await owner.reconcile([node]);
    const creating = creator.subscribe(wire, new AbortController().signal);
    await entered.promise;
    const activating = creator.activate(
      { wire, updates: async () => {} },
      new AbortController().signal,
    );
    release.resolve({ kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) });

    await Promise.all([creating, activating]);
    expect(starts).toEqual(["a"]);
  });

  it("retains an active definition while no nodes exist and resumes it after recovery", async () => {
    const starts: string[] = [];
    const owner = new DynamicUnaryForwarder({ create: async (node) => client(node.id, starts) });
    const creator = new DynamicSubscriptionCreator(owner);
    const node = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });
    const wire = subscription();

    await owner.reconcile([node]);
    await creator.subscribe(wire, new AbortController().signal);
    await creator.activate({ wire, updates: async () => {} }, new AbortController().signal);
    await owner.reconcile([]);
    await owner.reconcile([node]);

    expect(starts).toEqual(["a", "a"]);
  });

  it("replaces a child after an unexpected activation completion", async () => {
    const firstActivation = deferred<void>();
    const firstFinished = deferred<void>();
    const starts: string[] = [];
    let activations = 0;
    const owner = new DynamicUnaryForwarder({
      create: async (node) => ({
        ...client(node.id, starts),
        activate: async (_request, signal) => {
          activations++;
          if (activations === 1) {
            await firstActivation.promise;
            firstFinished.resolve();
            return;
          }
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", resolve, { once: true });
          });
        },
      }),
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const node = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });
    const wire = subscription();

    await owner.reconcile([node]);
    await creator.subscribe(wire, new AbortController().signal);
    await creator.activate({ wire, updates: async () => {} }, new AbortController().signal);
    expect(activations).toBe(1);

    firstActivation.resolve();
    await firstFinished.promise;
    await Promise.resolve();
    await owner.reconcile([node]);

    expect(activations).toBe(2);
    await owner.reconcile([node]);
    expect(activations).toBe(2);
  });

  it("rejects a new native subscription while membership is empty", async () => {
    const owner = new DynamicUnaryForwarder({ create: async (node) => client(node.id, []) });
    const creator = new DynamicSubscriptionCreator(owner);

    await expect(creator.subscribe(subscription(), new AbortController().signal)).rejects.toThrow(
      "Gateway backend is absent.",
    );
  });

  it("aborts a delayed start when cancellation removes its definition", async () => {
    let aborted = false;
    const owner = new DynamicUnaryForwarder({
      create: async (node) => ({
        ...client(node.id, []),
        subscribe: async (_request, signal) =>
          new Promise((_, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(new Error("cancelled"));
              },
              { once: true },
            );
          }),
      }),
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const node = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });
    const wire = subscription();

    await owner.reconcile([node]);
    const creating = creator.subscribe(wire, new AbortController().signal);
    await Promise.resolve();
    await creator.cancel({ wire }, new AbortController().signal);

    await expect(creating).rejects.toThrow("subscription creation was cancelled");
    expect(aborted).toBe(true);
  });

  it("aborts and joins a delayed start during close", async () => {
    let aborted = false;
    const owner = new DynamicUnaryForwarder({
      create: async (node) => ({
        ...client(node.id, []),
        subscribe: async (_request, signal) =>
          new Promise((_, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(new Error("closed"));
              },
              { once: true },
            );
          }),
      }),
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const node = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });

    await owner.reconcile([node]);
    const creating = creator.subscribe(subscription(), new AbortController().signal);
    await Promise.resolve();
    await owner.close();

    await expect(creating).rejects.toThrow("subscription creation was cancelled");
    expect(aborted).toBe(true);
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

  it("keeps one child per node through reordered replayed snapshots", async () => {
    const starts: string[] = [];
    const owner = new DynamicUnaryForwarder({ create: async (node) => client(node.id, starts) });
    const creator = new DynamicSubscriptionCreator(owner);
    const a = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });
    const b = new ApplicationNode({ id: "b", endpoint: "http://10.0.0.2" });
    const wire = subscription();

    await owner.reconcile([a, b]);
    await creator.subscribe(wire, new AbortController().signal);
    await creator.activate({ wire, updates: async () => {} }, new AbortController().signal);
    await owner.reconcile([b, a]);
    await owner.reconcile([a, b]);

    expect(starts.sort()).toEqual(["a", "b"]);
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

  it("bounds forty native child starts by the configured concurrency", async () => {
    let active = 0;
    let peak = 0;
    const owner = new DynamicUnaryForwarder({
      maxConcurrentStarts: 3,
      create: async (node) => ({
        ...client(node.id, []),
        subscribe: async () => {
          active++;
          peak = Math.max(peak, active);
          await Promise.resolve();
          active--;
          return { kind: "backend-subscription-envelope" as const, bytes: new Uint8Array([1]) };
        },
      }),
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const nodes = Array.from(
      { length: 40 },
      (_, index) =>
        new ApplicationNode({ id: `node-${index.toString()}`, endpoint: `http://10.0.0.${index}` }),
    );

    await owner.reconcile(nodes);
    await creator.subscribe(subscription(), new AbortController().signal);

    expect(peak).toBeLessThanOrEqual(3);
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function awaitAbortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    promise.then(resolve, reject);
  });
}
