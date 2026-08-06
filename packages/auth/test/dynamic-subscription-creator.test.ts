import { describe, expect, it } from "vitest";
import { create, toBinary } from "@bufbuild/protobuf";
import { ApplicationNode } from "@spine-event-engine/deployment";
import { SubscriptionSchema, TopicSchema } from "@spine-event-engine/proto/client";

import {
  type DynamicUnaryClient,
  DynamicSubscriptionCreator,
  DynamicUnaryForwarder,
} from "../src/index.js";

describe("DynamicSubscriptionCreator", () => {
  it("keeps native children inactive until the public activation request", async () => {
    const starts: string[] = [];
    const owner = new DynamicUnaryForwarder({
      create: (node) => Promise.resolve(client(node.id, starts)),
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const node = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });
    const wire = subscription();

    await owner.reconcile([node]);
    await creator.subscribe(wire, new AbortController().signal);

    expect(starts).toEqual([]);
    const controller = new AbortController();
    const activation = creator.activate({ wire, updates: noUpdates }, controller.signal);
    await Promise.resolve();
    expect(starts).toEqual(["a"]);
    controller.abort();
    await activation;
  });

  it("keeps activation open and relays updates until its downstream signal aborts", async () => {
    const entered = deferred();
    const delivered = deferred();
    const controller = new AbortController();
    const owner = new DynamicUnaryForwarder({
      create: (node) =>
        Promise.resolve({
          ...client(node.id, []),
          activate: async (request, signal) => {
            entered.resolve(undefined);
            await request.updates({ kind: "subscription-update", bytes: new Uint8Array([1]) });
            await new Promise<void>((resolve) => {
              signal.addEventListener(
                "abort",
                () => {
                  resolve();
                },
                { once: true },
              );
            });
          },
        }),
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const wire = subscription();

    await owner.reconcile([new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" })]);
    await creator.subscribe(wire, new AbortController().signal, 100);
    const activation = creator.activate(
      {
        wire,
        updates: () => {
          delivered.resolve(undefined);
          return Promise.resolve();
        },
      },
      controller.signal,
    );
    await Promise.all([entered.promise, delivered.promise]);
    let settled = false;
    void activation.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    controller.abort();
    await activation;
  });

  it("does not activate a child until its concurrent add has installed it", async () => {
    const entered = deferred();
    const release = deferred<{
      readonly kind: "backend-subscription-envelope";
      readonly bytes: Uint8Array;
    }>();
    const starts: string[] = [];
    const owner = new DynamicUnaryForwarder({
      create: (node) =>
        Promise.resolve({
          ...client(node.id, starts),
          subscribe: async (_request, signal) => {
            entered.resolve(undefined);
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
    const controller = new AbortController();
    const activating = creator.activate({ wire, updates: noUpdates }, controller.signal);
    release.resolve({ kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) });

    await creating;
    expect(starts).toEqual(["a"]);
    controller.abort();
    await activating;
  });

  it("retains an active definition while no nodes exist and resumes it after recovery", async () => {
    const starts: string[] = [];
    const owner = new DynamicUnaryForwarder({
      create: (node) => Promise.resolve(client(node.id, starts)),
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const node = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });
    const wire = subscription();

    await owner.reconcile([node]);
    await creator.subscribe(wire, new AbortController().signal);
    const controller = new AbortController();
    const activation = creator.activate({ wire, updates: noUpdates }, controller.signal);
    await Promise.resolve();
    await owner.reconcile([]);
    await owner.reconcile([node]);

    expect(starts).toEqual(["a", "a"]);
    controller.abort();
    await activation;
  });

  it("replaces a child after an unexpected activation completion", async () => {
    const firstActivation = deferred();
    const firstFinished = deferred();
    const starts: string[] = [];
    let activations = 0;
    const owner = new DynamicUnaryForwarder({
      create: (node) =>
        Promise.resolve({
          ...client(node.id, starts),
          activate: async (_request, signal) => {
            activations++;
            if (activations === 1) {
              await firstActivation.promise;
              firstFinished.resolve(undefined);
              return;
            }
            await new Promise<void>((resolve) => {
              signal.addEventListener(
                "abort",
                () => {
                  resolve();
                },
                { once: true },
              );
            });
          },
        }),
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const node = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });
    const wire = subscription();

    await owner.reconcile([node]);
    await creator.subscribe(wire, new AbortController().signal);
    const controller = new AbortController();
    const activation = creator.activate({ wire, updates: noUpdates }, controller.signal);
    await Promise.resolve();
    expect(activations).toBe(1);

    firstActivation.resolve(undefined);
    await firstFinished.promise;
    await Promise.resolve();
    await owner.reconcile([node]);

    expect(activations).toBe(2);
    await owner.reconcile([node]);
    expect(activations).toBe(2);
    controller.abort();
    await activation;
  });

  it("rejects a new native subscription while membership is empty", async () => {
    const owner = new DynamicUnaryForwarder({
      create: (node) => Promise.resolve(client(node.id, [])),
    });
    const creator = new DynamicSubscriptionCreator(owner);

    await expect(creator.subscribe(subscription(), new AbortController().signal)).rejects.toThrow(
      "Gateway backend is absent.",
    );
  });

  it("rejects and compensates an oversized native child envelope", async () => {
    let disposals = 0;
    const owner = new DynamicUnaryForwarder({
      create: (node) =>
        Promise.resolve({
          ...client(node.id, []),
          subscribe: () =>
            Promise.resolve({
              kind: "backend-subscription-envelope" as const,
              bytes: new Uint8Array([1, 2]),
            }),
          dispose: () => {
            disposals++;
            return Promise.resolve();
          },
        }),
    });
    const creator = new DynamicSubscriptionCreator(owner);

    await owner.reconcile([new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" })]);
    await expect(
      creator.subscribe(subscription(), new AbortController().signal, 1),
    ).rejects.toThrow("backend-envelope-too-large");
    expect(disposals).toBe(1);
  });

  it("uses the owner's default native envelope limit for direct creation", async () => {
    const owner = new DynamicUnaryForwarder({
      maxBackendEnvelopeBytes: 1,
      create: (node) =>
        Promise.resolve({
          ...client(node.id, []),
          subscribe: () =>
            Promise.resolve({
              kind: "backend-subscription-envelope" as const,
              bytes: new Uint8Array([1, 2]),
            }),
        }),
    });
    const creator = new DynamicSubscriptionCreator(owner);

    await owner.reconcile([new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" })]);
    await expect(creator.subscribe(subscription(), new AbortController().signal)).rejects.toThrow(
      "backend-envelope-too-large",
    );
  });

  it("accepts a custom owner native envelope limit", async () => {
    const owner = new DynamicUnaryForwarder({
      maxBackendEnvelopeBytes: 2,
      create: (node) =>
        Promise.resolve({
          ...client(node.id, []),
          subscribe: () =>
            Promise.resolve({
              kind: "backend-subscription-envelope" as const,
              bytes: new Uint8Array([1, 2]),
            }),
        }),
    });
    const creator = new DynamicSubscriptionCreator(owner);

    await owner.reconcile([new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" })]);
    await expect(
      creator.subscribe(subscription(), new AbortController().signal),
    ).resolves.toBeUndefined();
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid owner native envelope limit of %s",
    (maxBackendEnvelopeBytes) => {
      expect(
        () =>
          new DynamicUnaryForwarder({
            maxBackendEnvelopeBytes,
            create: (node) => Promise.resolve(client(node.id, [])),
          }),
      ).toThrow("maxBackendEnvelopeBytes must be a positive safe integer.");
    },
  );

  it("compensates every installed child when one current node rejects creation", async () => {
    const disposals: string[] = [];
    const owner = new DynamicUnaryForwarder({
      create: (node) =>
        Promise.resolve({
          ...client(node.id, []),
          subscribe: () => {
            if (node.id === "b") return Promise.reject(new Error("native creation failed"));
            return Promise.resolve({
              kind: "backend-subscription-envelope" as const,
              bytes: new Uint8Array([1]),
            });
          },
          dispose: () => {
            disposals.push(node.id);
            return Promise.resolve();
          },
        }),
    });
    const creator = new DynamicSubscriptionCreator(owner);

    await owner.reconcile([
      new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" }),
      new ApplicationNode({ id: "b", endpoint: "http://10.0.0.2" }),
    ]);

    await expect(
      creator.subscribe(subscription(), new AbortController().signal, 100),
    ).rejects.toThrow("native creation failed");
    expect(disposals).toEqual(["a"]);
  });

  it("rejects creation after an empty desired membership snapshot before stale clients close", async () => {
    const owner = new DynamicUnaryForwarder({
      create: (node) => Promise.resolve(client(node.id, [])),
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const node = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });

    await owner.reconcile([node]);
    const leaving = owner.reconcile([]);
    await expect(
      creator.subscribe(subscription(), new AbortController().signal, 100),
    ).rejects.toThrow("Gateway backend is absent.");
    await leaving;
  });

  it("aborts a delayed start when cancellation removes its definition", async () => {
    let aborted = false;
    const owner = new DynamicUnaryForwarder({
      create: (node) =>
        Promise.resolve({
          ...client(node.id, []),
          subscribe: (_request, signal) =>
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
      create: (node) =>
        Promise.resolve({
          ...client(node.id, []),
          subscribe: (_request, signal) =>
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
      create: (node) => Promise.resolve(client(node.id, starts)),
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const a = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });
    const b = new ApplicationNode({ id: "b", endpoint: "http://10.0.0.2" });

    const wire = subscription();
    await owner.reconcile([a]);
    await creator.subscribe(wire, new AbortController().signal);
    const controller = new AbortController();
    const activation = creator.activate({ wire, updates: noUpdates }, controller.signal);
    await Promise.resolve();
    await owner.reconcile([a, b]);
    await owner.reconcile([b]);

    expect(starts).toEqual(["a", "b"]);
    controller.abort();
    await activation;
  });

  it("keeps one child per node through reordered replayed snapshots", async () => {
    const starts: string[] = [];
    const owner = new DynamicUnaryForwarder({
      create: (node) => Promise.resolve(client(node.id, starts)),
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const a = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });
    const b = new ApplicationNode({ id: "b", endpoint: "http://10.0.0.2" });
    const wire = subscription();

    await owner.reconcile([a, b]);
    await creator.subscribe(wire, new AbortController().signal);
    const controller = new AbortController();
    const activation = creator.activate({ wire, updates: noUpdates }, controller.signal);
    await Promise.resolve();
    await owner.reconcile([b, a]);
    await owner.reconcile([a, b]);

    expect(starts.sort()).toEqual(["a", "b"]);
    controller.abort();
    await activation;
  });

  it("starts one child on every discovered node without a 32-node cap", async () => {
    const starts: string[] = [];
    const owner = new DynamicUnaryForwarder({
      create: (node) => Promise.resolve(client(node.id, starts)),
      maxConcurrentStarts: 4,
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const nodes = Array.from(
      { length: 40 },
      (_, index) =>
        new ApplicationNode({
          id: `node-${String(index)}`,
          endpoint: `http://10.0.0.${String(index)}`,
        }),
    );

    const wire = subscription();
    await owner.reconcile(nodes);
    await creator.subscribe(wire, new AbortController().signal);
    const controller = new AbortController();
    const activation = creator.activate({ wire, updates: noUpdates }, controller.signal);
    await Promise.resolve();

    expect(starts).toHaveLength(40);
    expect(new Set(starts)).toEqual(new Set(nodes.map((node) => node.id)));
    controller.abort();
    await activation;
  });

  it("bounds forty native child starts by the configured concurrency", async () => {
    let active = 0;
    let peak = 0;
    const owner = new DynamicUnaryForwarder({
      maxConcurrentStarts: 3,
      create: (node) =>
        Promise.resolve({
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
        new ApplicationNode({
          id: `node-${String(index)}`,
          endpoint: `http://10.0.0.${String(index)}`,
        }),
    );

    await owner.reconcile(nodes);
    await creator.subscribe(subscription(), new AbortController().signal);

    expect(peak).toBeLessThanOrEqual(3);
  });

  it("aborts and disposes a removed node child before closing its client", async () => {
    let activationAborted = false;
    let disposals = 0;
    const owner = new DynamicUnaryForwarder({
      create: (node) =>
        Promise.resolve({
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
          dispose: () => {
            disposals++;
            return Promise.resolve();
          },
        }),
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const node = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });

    const wire = subscription();
    await owner.reconcile([node]);
    await creator.subscribe(wire, new AbortController().signal);
    const controller = new AbortController();
    const activation = creator.activate({ wire, updates: noUpdates }, controller.signal);
    await Promise.resolve();
    await owner.reconcile([]);

    expect(activationAborted).toBe(true);
    expect(disposals).toBe(1);
    controller.abort();
    await activation;
  });

  it("retries failed cleanup on the next membership reconciliation", async () => {
    let attempts = 0;
    const owner = new DynamicUnaryForwarder({
      create: (node) =>
        Promise.resolve({
          ...client(node.id, []),
          dispose: () => {
            attempts++;
            if (attempts === 1) throw new Error("temporary cleanup failure");
            return Promise.resolve();
          },
        }),
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const node = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });

    const wire = subscription();
    await owner.reconcile([node]);
    await creator.subscribe(wire, new AbortController().signal);
    const controller = new AbortController();
    const activation = creator.activate({ wire, updates: noUpdates }, controller.signal);
    await Promise.resolve();
    await owner.reconcile([]);
    await owner.reconcile([]);

    expect(attempts).toBe(2);
    controller.abort();
    await activation;
  });

  it("cancels every active native child before logical activation ends", async () => {
    let disposed = 0;
    const entered = deferred();
    const owner = new DynamicUnaryForwarder({
      create: (node) =>
        Promise.resolve({
          ...client(node.id, []),
          activate: async (_request, signal) => {
            entered.resolve(undefined);
            await new Promise<void>((resolve) => {
              signal.addEventListener(
                "abort",
                () => {
                  resolve();
                },
                { once: true },
              );
            });
          },
          dispose: () => {
            disposed++;
            return Promise.resolve();
          },
        }),
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const wire = subscription();
    const controller = new AbortController();

    await owner.reconcile([new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" })]);
    await creator.subscribe(wire, new AbortController().signal, 100);
    const activation = creator.activate({ wire, updates: noUpdates }, controller.signal);
    await entered.promise;
    await creator.cancel({ wire }, new AbortController().signal);

    expect(disposed).toBe(1);
    controller.abort();
    await activation;
  });

  it("disposes a cancelled child before a concurrent node removal closes its client", async () => {
    const entered = deferred();
    const release = deferred();
    const order: string[] = [];
    const owner = new DynamicUnaryForwarder({
      create: (node) =>
        Promise.resolve({
          ...client(node.id, []),
          dispose: async () => {
            order.push("dispose");
            entered.resolve(undefined);
            await release.promise;
          },
          close: () => {
            order.push("close");
            return Promise.resolve();
          },
        }),
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const node = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });
    const wire = subscription();

    await owner.reconcile([node]);
    await creator.subscribe(wire, new AbortController().signal);
    const cancelling = creator.cancel({ wire }, new AbortController().signal);
    await entered.promise;
    const removing = owner.reconcile([]);
    await Promise.resolve();
    expect(order).toEqual(["dispose"]);
    release.resolve(undefined);
    await Promise.all([cancelling, removing]);
    expect(order).toEqual(["dispose", "close"]);
  });

  it("disposes a failed creation child before concurrent node removal closes its client", async () => {
    const entered = deferred();
    const release = deferred();
    const order: string[] = [];
    const owner = new DynamicUnaryForwarder({
      create: (node) =>
        Promise.resolve({
          ...client(node.id, []),
          subscribe: () => {
            if (node.id === "b") return Promise.reject(new Error("native creation failed"));
            return Promise.resolve({
              kind: "backend-subscription-envelope" as const,
              bytes: new Uint8Array([1]),
            });
          },
          dispose: async () => {
            order.push("dispose");
            entered.resolve(undefined);
            await release.promise;
          },
          close: () => {
            order.push("close");
            return Promise.resolve();
          },
        }),
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const a = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });
    const b = new ApplicationNode({ id: "b", endpoint: "http://10.0.0.2" });

    await owner.reconcile([a, b]);
    const creating = creator.subscribe(subscription(), new AbortController().signal);
    await entered.promise;
    const removing = owner.reconcile([]);
    await Promise.resolve();
    expect(order).toEqual(["dispose"]);
    release.resolve(undefined);
    await expect(creating).rejects.toThrow("native creation failed");
    await removing;
    expect(order).toEqual(["dispose", "close", "close"]);
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

/**
 * Completes an update sink that deliberately ignores native updates.
 */
function noUpdates(): Promise<void> {
  return Promise.resolve();
}

/**
 * Builds a native client fixture with inert operations unrelated to each test.
 */
function client(id: string, starts: string[]): DynamicUnaryClient {
  return {
    forward: () => Promise.resolve(new Uint8Array()),
    close: () => Promise.resolve(),
    subscribe: () =>
      Promise.resolve({
        kind: "backend-subscription-envelope" as const,
        bytes: new Uint8Array([1]),
      }),
    activate: async (_request, signal) => {
      starts.push(id);
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            resolve();
          },
          { once: true },
        );
      });
    },
    cancel: () => Promise.resolve(),
    dispose: () => Promise.resolve(),
  };
}

function deferred<T = undefined>() {
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
    signal.addEventListener(
      "abort",
      () => {
        reject(new Error("cancelled"));
      },
      { once: true },
    );
    promise.then(resolve, reject);
  });
}
