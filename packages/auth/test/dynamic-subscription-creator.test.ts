/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { describe, expect, it } from "vitest";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { ApplicationNode } from "@spine-event-engine/deployment";
import {
  ActorContextSchema,
  EventIdSchema,
  EventSchema,
  TenantIdSchema,
} from "@spine-event-engine/proto";
import {
  SubscriptionSchema,
  SubscriptionUpdateSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";

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

  it("activates every node with its private native subscription envelope", async () => {
    const received = new Map<string, { readonly kind: string; readonly bytes: Uint8Array }>();
    const delivered = deferred();
    const owner = new DynamicUnaryForwarder({
      create: (node) =>
        Promise.resolve({
          ...client(node.id, []),
          subscribe: () =>
            Promise.resolve({
              kind: "backend-subscription-envelope" as const,
              bytes: new Uint8Array([node.id === "a" ? 1 : 2]),
            }),
          activate: async (request, signal) => {
            received.set(node.id, { kind: request.wire.kind, bytes: request.wire.bytes.slice() });
            if (node.id === "a") {
              await request.updates({ kind: "subscription-update", bytes: new Uint8Array([7]) });
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
    const wire = subscription();
    await owner.reconcile([
      new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" }),
      new ApplicationNode({ id: "b", endpoint: "http://10.0.0.2" }),
    ]);
    await creator.subscribe(wire, new AbortController().signal);
    const controller = new AbortController();
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
    await delivered.promise;

    expect(received).toEqual(
      new Map([
        ["a", { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) }],
        ["b", { kind: "backend-subscription-envelope", bytes: new Uint8Array([2]) }],
      ]),
    );
    expect(received.get("a")?.bytes).not.toEqual(wire.bytes);
    controller.abort();
    await activation;
  });

  it("rehydrates through the adapter before a native node is discovered", async () => {
    let subscriptions = 0;
    const owner = new DynamicUnaryForwarder({
      create: (node) =>
        Promise.resolve({
          ...client(node.id, []),
          subscribe: () => {
            subscriptions++;
            return Promise.resolve({
              kind: "backend-subscription-envelope" as const,
              bytes: new Uint8Array([1]),
            });
          },
        }),
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const wire = subscription();

    await creator.rehydrate(wire);
    await owner.reconcile([new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" })]);

    expect(subscriptions).toBe(1);
    await creator.cancel({ wire }, new AbortController().signal);
    await owner.close();
  });

  it("does not forward an already aborted activation through the adapter", async () => {
    const starts: string[] = [];
    const owner = new DynamicUnaryForwarder({
      create: (node) => Promise.resolve(client(node.id, starts)),
    });
    const creator = new DynamicSubscriptionCreator(owner);
    const wire = subscription();
    await owner.reconcile([new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" })]);
    await creator.subscribe(wire, new AbortController().signal);
    const aborted = new AbortController();
    aborted.abort();

    await creator.activate({ wire, updates: noUpdates }, aborted.signal);

    expect(starts).toEqual([]);
    await creator.cancel({ wire }, new AbortController().signal);
    await owner.close();
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

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid concurrent-start limit of %s",
    (maxConcurrentStarts) => {
      expect(
        () =>
          new DynamicUnaryForwarder({
            maxConcurrentStarts,
            create: (node) => Promise.resolve(client(node.id, [])),
          }),
      ).toThrow("maxConcurrentStarts must be a positive safe integer.");
    },
  );

  it("rejects invalid durable rehydration inputs before native creation", async () => {
    const owner = new DynamicUnaryForwarder({
      create: (node) => Promise.resolve(client(node.id, [])),
    });
    const missingId = {
      kind: "public-subscription" as const,
      bytes: toBinary(
        SubscriptionSchema,
        create(SubscriptionSchema, { topic: create(TopicSchema) }),
      ),
    };

    await expect(owner.rehydrateDefinition(subscription(), 0)).rejects.toThrow(
      "maxBackendEnvelopeBytes must be a positive safe integer.",
    );
    await expect(owner.rehydrateDefinition(missingId)).rejects.toThrow(
      "subscription ID is required",
    );
  });

  it("keeps missing logical definitions inert during activation and cancellation", async () => {
    const owner = new DynamicUnaryForwarder({
      create: (node) => Promise.resolve(client(node.id, [])),
    });
    const wire = subscription();
    const aborted = new AbortController();
    aborted.abort();

    await expect(
      owner.cancelDefinition(wire, new AbortController().signal),
    ).resolves.toBeUndefined();
    await expect(
      owner.activateDefinition(wire, noUpdates, aborted.signal),
    ).resolves.toBeUndefined();
  });

  it("rejects forwarding while no dynamic backend is available", async () => {
    const owner = new DynamicUnaryForwarder({
      create: (node) => Promise.resolve(client(node.id, [])),
    });

    await expect(
      owner.forward({
        service: "spine.client.QueryService",
        method: "Read",
        value: new Uint8Array(),
      }),
    ).rejects.toThrow("Gateway backend is absent.");
  });

  it("rejects aborted and closed logical creation before it reaches a native client", async () => {
    let subscriptions = 0;
    const owner = new DynamicUnaryForwarder({
      create: (node) =>
        Promise.resolve({
          ...client(node.id, []),
          subscribe: () => {
            subscriptions++;
            return Promise.resolve({
              kind: "backend-subscription-envelope" as const,
              bytes: new Uint8Array([1]),
            });
          },
        }),
    });
    await owner.reconcile([new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" })]);
    const aborted = new AbortController();
    aborted.abort();

    await expect(owner.subscribeDefinition(subscription(), aborted.signal)).rejects.toThrow(
      "Gateway backend is absent.",
    );
    expect(subscriptions).toBe(0);
    await owner.close();
    await expect(
      owner.subscribeDefinition(subscription(), new AbortController().signal),
    ).rejects.toThrow("Gateway backend is absent.");
  });

  it("rejects a conflicting endpoint for one application node identity", async () => {
    const owner = new DynamicUnaryForwarder({
      create: (node) => Promise.resolve(client(node.id, [])),
    });

    await expect(
      owner.reconcile([
        new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" }),
        new ApplicationNode({ id: "a", endpoint: "http://10.0.0.2" }),
      ]),
    ).resolves.toBeUndefined();
    await expect(
      owner.forward({ service: "s", method: "m", value: new Uint8Array() }),
    ).rejects.toThrow("Gateway backend is absent.");
  });

  it("fails durable rehydration when its native child exceeds the configured bound", async () => {
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
    await owner.reconcile([new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" })]);

    await expect(owner.rehydrateDefinition(subscription())).rejects.toThrow(
      "backend-envelope-too-large",
    );
    await owner.close();
    await expect(owner.rehydrateDefinition(subscription())).rejects.toThrow("owner is closed");
  });

  it("reuses an installed logical definition across repeated creation and rehydration", async () => {
    let subscriptions = 0;
    const owner = new DynamicUnaryForwarder({
      create: (node) =>
        Promise.resolve({
          ...client(node.id, []),
          subscribe: () => {
            subscriptions++;
            return Promise.resolve({
              kind: "backend-subscription-envelope" as const,
              bytes: new Uint8Array([1]),
            });
          },
        }),
    });
    const node = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });
    const wire = subscription();

    await owner.reconcile([node]);
    await owner.subscribeDefinition(wire, new AbortController().signal);
    await owner.subscribeDefinition(wire, new AbortController().signal);
    await owner.rehydrateDefinition(wire);

    expect(subscriptions).toBe(1);
    await owner.cancelDefinition(wire, new AbortController().signal);
    await owner.close();
  });

  it("keeps an immediately aborted activation from starting installed native children", async () => {
    const starts: string[] = [];
    const owner = new DynamicUnaryForwarder({
      create: (node) => Promise.resolve(client(node.id, starts)),
    });
    const wire = subscription();
    await owner.reconcile([new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" })]);
    await owner.subscribeDefinition(wire, new AbortController().signal);
    const aborted = new AbortController();
    aborted.abort();

    await owner.activateDefinition(wire, noUpdates, aborted.signal);

    expect(starts).toEqual([]);
    await owner.cancelDefinition(wire, new AbortController().signal);
    await owner.close();
  });

  it("rehydrates a durable definition before membership and installs it when a node arrives", async () => {
    let subscriptions = 0;
    const owner = new DynamicUnaryForwarder({
      create: (node) =>
        Promise.resolve({
          ...client(node.id, []),
          subscribe: () => {
            subscriptions++;
            return Promise.resolve({
              kind: "backend-subscription-envelope" as const,
              bytes: new Uint8Array([1]),
            });
          },
        }),
    });
    const wire = subscription();

    await owner.rehydrateDefinition(wire);
    expect(subscriptions).toBe(0);
    await owner.reconcile([new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" })]);

    expect(subscriptions).toBe(1);
    await owner.cancelDefinition(wire, new AbortController().signal);
    await owner.close();
  });

  it("replaces a child when a stable node identity moves to a new endpoint", async () => {
    const disposals: string[] = [];
    const owner = new DynamicUnaryForwarder({
      create: (node) =>
        Promise.resolve({
          ...client(node.id, []),
          dispose: () => {
            disposals.push(node.endpoint);
            return Promise.resolve();
          },
        }),
    });
    const wire = subscription();

    await owner.reconcile([new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" })]);
    await owner.subscribeDefinition(wire, new AbortController().signal);
    await owner.reconcile([new ApplicationNode({ id: "a", endpoint: "http://10.0.0.2" })]);

    expect(disposals).toEqual(["http://10.0.0.1"]);
    await owner.cancelDefinition(wire, new AbortController().signal);
    await owner.close();
  });

  it("retries a failed client close during later membership reconciliation", async () => {
    let closes = 0;
    const owner = new DynamicUnaryForwarder({
      create: (node) =>
        Promise.resolve({
          ...client(node.id, []),
          close: () => {
            closes++;
            if (closes === 1) return Promise.reject(new Error("temporary close failure"));
            return Promise.resolve();
          },
        }),
    });
    const node = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });

    await owner.reconcile([node]);
    await owner.reconcile([]);
    await owner.reconcile([]);

    expect(closes).toBe(2);
    await owner.close();
  });

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

  it("rewrites only each immediate recursive child ID while preserving protobuf identity and updates", async () => {
    const firstLayer: Uint8Array[] = [];
    const secondLayer: Uint8Array[] = [];
    const relayed: Uint8Array[] = [];
    const update = toBinary(
      SubscriptionUpdateSchema,
      create(SubscriptionUpdateSchema, {
        subscription: create(SubscriptionSchema, { id: { value: "logical" } }),
        update: {
          case: "eventUpdates",
          value: {
            event: [
              create(EventSchema, {
                id: create(EventIdSchema, { value: "event-1" }),
                message: { typeUrl: "type.example/Event", value: new Uint8Array([7, 8]) },
              }),
            ],
          },
        },
      }),
    );
    const inner = new DynamicUnaryForwarder({
      create: () =>
        Promise.resolve({
          forward: () => Promise.resolve(new Uint8Array()),
          close: () => Promise.resolve(),
          subscribe: (wire) => {
            secondLayer.push(wire.bytes.slice());
            return Promise.resolve({
              kind: "backend-subscription-envelope" as const,
              bytes: wire.bytes.slice(),
            });
          },
          activate: (request) =>
            request.updates({ kind: "subscription-update", bytes: update.slice() }),
          cancel: () => Promise.resolve(),
          dispose: () => Promise.resolve(),
        }),
    });
    await inner.reconcile([new ApplicationNode({ id: "b", endpoint: "http://10.0.0.2" })]);
    const outer = new DynamicUnaryForwarder({
      create: () =>
        Promise.resolve({
          forward: () => Promise.resolve(new Uint8Array()),
          close: () => Promise.resolve(),
          subscribe: async (wire, signal) => {
            firstLayer.push(wire.bytes.slice());
            await inner.subscribeDefinition(wire, signal);
            return { kind: "backend-subscription-envelope", bytes: wire.bytes.slice() };
          },
          activate: (request, signal) =>
            inner.activateDefinition(
              { kind: "public-subscription", bytes: request.wire.bytes.slice() },
              request.updates,
              signal,
            ),
          cancel: () => Promise.resolve(),
          dispose: (request, signal) =>
            inner.cancelDefinition(
              { kind: "public-subscription", bytes: request.bytes.slice() },
              signal,
            ),
        }),
    });
    const publicDefinition = toBinary(
      SubscriptionSchema,
      create(SubscriptionSchema, {
        id: { value: "logical" },
        topic: create(TopicSchema, {
          context: create(ActorContextSchema, {
            actor: { value: "actor-1" },
            tenantId: create(TenantIdSchema, { kind: { case: "value", value: "tenant-1" } }),
          }),
        }),
      }),
    );
    await outer.reconcile([new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" })]);
    await outer.subscribeDefinition(
      { kind: "public-subscription", bytes: publicDefinition },
      new AbortController().signal,
    );
    const controller = new AbortController();
    const activation = outer.activateDefinition(
      { kind: "public-subscription", bytes: publicDefinition },
      (wire) => {
        relayed.push(wire.bytes.slice());
        return Promise.resolve();
      },
      controller.signal,
    );
    await Promise.resolve();
    controller.abort();
    await activation;

    const firstChild = firstLayer[0];
    const secondChild = secondLayer[0];
    if (firstChild === undefined || secondChild === undefined)
      throw new Error("expected both recursive child definitions");
    expect(fromBinary(SubscriptionSchema, firstChild)).toMatchObject({
      id: { value: "logical/a" },
      topic: fromBinary(SubscriptionSchema, publicDefinition).topic,
    });
    expect(fromBinary(SubscriptionSchema, secondChild)).toMatchObject({
      id: { value: "logical/a/b" },
      topic: fromBinary(SubscriptionSchema, publicDefinition).topic,
    });
    expect(relayed).toEqual([update]);
    await outer.close();
    await inner.close();
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
