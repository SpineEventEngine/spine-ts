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

/* eslint-disable @typescript-eslint/no-confusing-void-expression */
/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/require-await */

import { describe, expect, it, vi } from "vitest";
import {
  type BackendMemberClient,
  BackendMembershipKernel,
} from "../src/internal/backend-membership-kernel.js";

interface Member {
  readonly id: string;
  readonly endpoint?: string;
}
interface Child {
  readonly id: string;
  readonly bytes: Uint8Array;
}
type Client = BackendMemberClient<string, Child, string>;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const definition = (id: string): Uint8Array => encoder.encode(id);

describe("BackendMembershipKernel", () => {
  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])(
    "rejects invalid maxConcurrentStarts %p",
    (maxConcurrentStarts) => {
      expect(() => kernel({ maxConcurrentStarts })).toThrow("maxConcurrentStarts");
    },
  );
  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])(
    "rejects invalid maxChildBytes %p",
    (maxChildBytes) => {
      expect(() => kernel({ maxChildBytes })).toThrow("maxChildBytes");
    },
  );
  it("rewrites only the immediate child definition for each member", async () => {
    const received: string[] = [];
    const owner = kernel({
      create: async (member) =>
        client(member, {
          subscribe: async (wire) => {
            received.push(decoder.decode(wire));
            return child(member.id, wire);
          },
        }),
    });
    await owner.reconcile([{ id: "a" }, { id: "b" }]);
    await owner.subscribe(definition("logical"), new AbortController().signal);
    await owner.subscribe(definition("logical"), new AbortController().signal);
    expect(received).toEqual(["logical/a", "logical/b"]);
    await owner.close();
  });
  it("keeps a joining member out of unary selection until retained children synchronize", async () => {
    const childStarted = deferred();
    const owner = kernel({
      create: async (member) =>
        client(member, {
          subscribe: async (wire) => {
            if (member.id === "joining") await childStarted.promise;
            return child(member.id, wire);
          },
        }),
    });
    await owner.reconcile([{ id: "current" }]);
    await owner.subscribe(definition("logical"), new AbortController().signal);

    const joining = owner.reconcile([{ id: "current" }, { id: "joining" }]);
    await Promise.resolve();

    expect(decoder.decode(await owner.forward("first"))).toBe("current");
    expect(decoder.decode(await owner.forward("second"))).toBe("current");

    childStarted.resolve(undefined);
    await joining;
    expect([
      decoder.decode(await owner.forward("after-sync-first")),
      decoder.decode(await owner.forward("after-sync-second")),
    ]).toEqual(["current", "joining"]);
    await owner.close();
  });
  it("keeps a joining member out of unary selection when retained child creation fails", async () => {
    const owner = kernel({
      create: async (member) =>
        client(member, {
          subscribe: async (wire) => {
            if (member.id === "failing") throw new Error("child creation failed");
            return child(member.id, wire);
          },
        }),
    });
    await owner.reconcile([{ id: "current" }]);
    await owner.subscribe(definition("logical"), new AbortController().signal);

    await owner.reconcile([{ id: "current" }, { id: "failing" }]);

    expect(decoder.decode(await owner.forward("first"))).toBe("current");
    expect(decoder.decode(await owner.forward("second"))).toBe("current");
    await owner.close();
  });
  it("rejects missing IDs, absent members, invalid bounds, and aborted creation", async () => {
    const missing = kernel({ definitionKey: () => undefined });
    await expect(missing.subscribe(definition("x"), new AbortController().signal)).rejects.toThrow(
      "subscription ID",
    );
    const owner = kernel();
    await expect(owner.subscribe(definition("x"), new AbortController().signal)).rejects.toThrow(
      "membership is unavailable",
    );
    await owner.reconcile([{ id: "a" }]);
    await expect(owner.subscribe(definition("x"), new AbortController().signal, 0)).rejects.toThrow(
      "maxChildBytes",
    );
    const aborted = new AbortController();
    aborted.abort();
    await expect(owner.subscribe(definition("x"), aborted.signal)).rejects.toThrow(
      "membership is unavailable",
    );
    await owner.close();
  });
  it("aborts a delayed subscription when its definition is cancelled", async () => {
    let aborted = false;
    const owner = kernel({
      create: async (member) =>
        client(member, {
          subscribe: (_wire, signal) =>
            new Promise((_, reject) => {
              signal.addEventListener("abort", () => {
                aborted = true;
                reject(new Error("cancelled"));
              });
            }),
        }),
    });
    await owner.reconcile([{ id: "a" }]);
    const creating = owner.subscribe(definition("x"), new AbortController().signal);
    await Promise.resolve();
    await owner.cancel(definition("x"), new AbortController().signal);
    await expect(creating).rejects.toThrow("cancelled");
    expect(aborted).toBe(true);
    await owner.close();
  });
  it("rehydrates before membership and installs when a member arrives", async () => {
    let starts = 0;
    const owner = kernel({
      create: async (member) =>
        client(member, { subscribe: async (wire) => (starts++, child(member.id, wire)) }),
    });
    await owner.rehydrate(definition("x"));
    expect(starts).toBe(0);
    await owner.rehydrate(definition("x"));
    await owner.reconcile([{ id: "a" }]);
    expect(starts).toBe(1);
    await owner.close();
  });
  it("rejects invalid, missing, closed, and failed rehydration", async () => {
    const invalid = kernel({ definitionKey: () => "" });
    await expect(invalid.rehydrate(definition("x"))).rejects.toThrow("subscription ID");
    await expect(invalid.rehydrate(definition("x"), 0)).rejects.toThrow("maxChildBytes");
    const failing = kernel({
      create: async (member) =>
        client(member, { subscribe: async () => Promise.reject(new Error("child")) }),
    });
    await failing.reconcile([{ id: "a" }]);
    await expect(failing.rehydrate(definition("x"))).rejects.toThrow("child");
    await failing.close();
    await expect(failing.rehydrate(definition("x"))).rejects.toThrow("closed");
  });
  it("ignores activation for unknown definitions and pre-aborted signals", async () => {
    let activations = 0;
    const owner = kernel({
      create: async (member) =>
        client(member, {
          activate: async () => {
            activations++;
          },
        }),
    });
    await owner.reconcile([{ id: "a" }]);
    await owner.activate(definition("unknown"), async () => {}, new AbortController().signal);
    await kernel({ definitionKey: () => undefined }).activate(
      definition("unknown"),
      async () => {},
      new AbortController().signal,
    );
    await owner.subscribe(definition("x"), new AbortController().signal);
    const aborted = new AbortController();
    aborted.abort();
    await owner.activate(definition("x"), async () => {}, aborted.signal);
    expect(activations).toBe(0);
    const normal = new AbortController();
    const resumed = owner.activate(definition("x"), async () => {}, normal.signal);
    await vi.waitFor(() => expect(activations).toBe(1));
    normal.abort();
    await resumed;
    await owner.close();
  });
  it("ignores cancellation whose definition cannot be identified", async () => {
    const owner = kernel({ definitionKey: () => undefined });
    await expect(
      owner.cancel(definition("unknown"), new AbortController().signal),
    ).resolves.toBeUndefined();
    await owner.close();
  });
  it("tracks concurrent cleanup for separate definitions on one member", async () => {
    const entered = deferred<number>();
    const release = deferred();
    let disposals = 0;
    const owner = kernel({
      create: async (member) =>
        client(member, {
          dispose: async () => {
            disposals++;
            if (disposals === 2) entered.resolve(disposals);
            await release.promise;
          },
        }),
    });
    try {
      await owner.reconcile([{ id: "a" }]);
      await owner.subscribe(definition("x"), new AbortController().signal);
      await owner.subscribe(definition("y"), new AbortController().signal);
      const cancelled = Promise.all([
        owner.cancel(definition("x"), new AbortController().signal),
        owner.cancel(definition("y"), new AbortController().signal),
      ]);
      await entered.promise;
      release.resolve(undefined);
      await cancelled;
    } finally {
      await owner.close().catch(() => undefined);
    }
  });
  it("relays updates until activation cancellation", async () => {
    const delivered: string[] = [];
    let entered: (() => void) | undefined;
    const owner = kernel({
      create: async (member) =>
        client(member, {
          activate: async (_child, updates, signal) => {
            await updates(member.id);
            entered?.();
            await waitForAbort(signal);
          },
        }),
    });
    await owner.reconcile([{ id: "a" }]);
    await owner.subscribe(definition("x"), new AbortController().signal);
    const activated = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const controller = new AbortController();
    const activation = owner.activate(
      definition("x"),
      async (update) => {
        delivered.push(update);
      },
      controller.signal,
    );
    await activated;
    controller.abort();
    await activation;
    expect(delivered).toEqual(["a"]);
    await owner.close();
  });
  it("bounds cancellation when a native activation ignores abort", async () => {
    vi.useFakeTimers();
    const owner = kernel({
      create: async (member) =>
        client(member, { activate: async () => new Promise<void>(() => undefined) }),
    });
    try {
      await owner.reconcile([{ id: "a" }]);
      await owner.subscribe(definition("x"), new AbortController().signal);
      const active = owner.activate(definition("x"), async () => {}, new AbortController().signal);
      await Promise.resolve();
      const cancelled = owner.cancel(definition("x"), new AbortController().signal);
      const complete = expect(cancelled).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(1_000);
      await complete;
      await active;
    } finally {
      vi.useRealTimers();
    }
  }, 2_000);
  it("bounds member removal when a native activation ignores abort", async () => {
    vi.useFakeTimers();
    const owner = kernel({
      create: async (member) =>
        client(member, { activate: async () => new Promise<void>(() => undefined) }),
    });
    try {
      await owner.reconcile([{ id: "a" }]);
      await owner.subscribe(definition("x"), new AbortController().signal);
      void owner.activate(definition("x"), async () => {}, new AbortController().signal);
      await Promise.resolve();

      const removed = owner.reconcile([]);
      const complete = expect(removed).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(1_000);
      await complete;
      await owner.close();
    } finally {
      vi.useRealTimers();
    }
  }, 2_000);
  it("rejects a concurrent activation and cancellation terminates its owner", async () => {
    const owner = kernel({
      create: async (member) =>
        client(member, { activate: async (_child, _updates, signal) => waitForAbort(signal) }),
    });
    await owner.reconcile([{ id: "a" }]);
    await owner.subscribe(definition("x"), new AbortController().signal);
    const first = owner.activate(definition("x"), async () => {}, new AbortController().signal);
    const aborted = new AbortController();
    aborted.abort();

    await expect(owner.activate(definition("x"), async () => {}, aborted.signal)).rejects.toThrow(
      "already active",
    );
    await owner.cancel(definition("x"), new AbortController().signal);
    await expect(first).resolves.toBeUndefined();
    await owner.close();
  });
  it("reactivates retained children after the prior caller aborts", async () => {
    const delivered: string[] = [];
    let activations = 0;
    const owner = kernel({
      create: async (member) =>
        client(member, {
          activate: async (_child, updates, signal) => {
            activations++;
            await updates(`${member.id}-${String(activations)}`);
            await waitForAbort(signal);
          },
        }),
    });
    try {
      await owner.reconcile([{ id: "a" }]);
      await owner.subscribe(definition("x"), new AbortController().signal);
      const firstController = new AbortController();
      const first = owner.activate(
        definition("x"),
        async (update) => {
          delivered.push(update);
        },
        firstController.signal,
      );
      await vi.waitFor(() => expect(delivered).toEqual(["a-1"]));
      firstController.abort();
      await first;

      const secondController = new AbortController();
      const second = owner.activate(
        definition("x"),
        async (update) => {
          delivered.push(update);
        },
        secondController.signal,
      );
      await vi.waitFor(() => expect(delivered).toEqual(["a-1", "a-2"]));
      secondController.abort();
      await second;
      expect(activations).toBe(2);
    } finally {
      await owner.close().catch(() => undefined);
    }
  });
  it("restarts a held aborted child for an immediate replacement activation", async () => {
    const release = deferred();
    const delivered: string[] = [];
    let calls = 0;
    const owner = kernel({
      create: async (member) =>
        client(member, {
          activate: async (_child, updates) => {
            calls++;
            if (calls === 1) await release.promise;
            await updates(`${member.id}-${String(calls)}`);
          },
        }),
    });
    try {
      await owner.reconcile([{ id: "a" }]);
      await owner.subscribe(definition("x"), new AbortController().signal);
      const firstController = new AbortController();
      const first = owner.activate(definition("x"), async () => {}, firstController.signal);
      await vi.waitFor(() => expect(calls).toBe(1));
      firstController.abort();
      await first;
      const secondController = new AbortController();
      const second = owner.activate(
        definition("x"),
        async (update) => {
          delivered.push(update);
        },
        secondController.signal,
      );
      release.resolve(undefined);
      await vi.waitFor(() => expect(delivered).toEqual(["a-2"]));
      secondController.abort();
      await second;
    } finally {
      await owner.close().catch(() => undefined);
    }
  });
  it("activates a late synchronized member without a concurrent second owner", async () => {
    const activated: string[] = [];
    const owner = kernel({
      create: async (member) =>
        client(member, {
          activate: async (_child, updates, signal) => {
            activated.push(member.id);
            await updates(member.id);
            await waitForAbort(signal);
          },
        }),
    });
    try {
      await owner.reconcile([{ id: "current" }]);
      await owner.subscribe(definition("x"), new AbortController().signal);
      const controller = new AbortController();
      const activation = owner.activate(definition("x"), async () => {}, controller.signal);
      await vi.waitFor(() => expect(activated).toEqual(["current"]));

      await expect(
        owner.activate(definition("x"), async () => {}, new AbortController().signal),
      ).rejects.toThrow("already active");
      await owner.reconcile([{ id: "current" }, { id: "late" }]);
      await vi.waitFor(() => expect(activated).toEqual(["current", "late"]));

      controller.abort();
      await activation;
    } finally {
      await owner.close().catch(() => undefined);
    }
  });
  it("forwards no request without members and selects members round robin", async () => {
    const owner = kernel({
      create: async (member) => client(member, { forward: async () => encoder.encode(member.id) }),
    });
    await expect(owner.forward("request")).rejects.toThrow("membership is unavailable");
    await owner.reconcile([{ id: "a" }, { id: "b" }]);
    expect(decoder.decode(await owner.forward("request"))).toBe("a");
    expect(decoder.decode(await owner.forward("request"))).toBe("b");
    expect(decoder.decode(await owner.forward("request"))).toBe("a");
    await owner.close();
  });
  it("contains conflicting duplicates and replaces a removed or stale member", async () => {
    const closed: string[] = [];
    const owner = kernel({
      create: async (member) =>
        client(member, {
          forward: async () => encoder.encode(member.endpoint ?? member.id),
          close: async () => {
            closed.push(member.endpoint ?? member.id);
          },
        }),
    });
    await owner.reconcile([{ id: "saved", endpoint: "saved" }]);
    await owner.reconcile([
      { id: "a", endpoint: "one" },
      { id: "a", endpoint: "two" },
    ]);
    expect(decoder.decode(await owner.forward("request"))).toBe("saved");
    await owner.reconcile([{ id: "saved", endpoint: "next" }]);
    expect(closed).toEqual(["saved"]);
    expect(decoder.decode(await owner.forward("request"))).toBe("next");
    await owner.close();
  });
  it("keeps a latest retained member open when an older removal is blocked", async () => {
    const closed: string[] = [];
    const release = deferred();
    const owner = kernel({
      create: async (member) =>
        client(member, {
          close: async () => {
            closed.push(member.id);
            if (member.id === "a") await release.promise;
          },
        }),
    });
    await owner.reconcile([{ id: "a" }, { id: "b" }]);

    const removing = owner.reconcile([]);
    await Promise.resolve();
    const retaining = owner.reconcile([{ id: "b" }]);
    release.resolve(undefined);
    await Promise.all([removing, retaining]);

    expect(closed).toEqual(["a"]);
    expect(decoder.decode(await owner.forward("request"))).toBe("b");
    await owner.close();
  });
  it("retries failed member close and child disposal on later reconciliation", async () => {
    let closes = 0;
    let disposals = 0;
    const owner = kernel({
      create: async (member) =>
        client(member, {
          close: async () => {
            closes++;
            if (closes === 1) throw new Error("close");
          },
          dispose: async () => {
            disposals++;
            if (disposals === 1) throw new Error("dispose");
          },
        }),
    });
    await owner.reconcile([{ id: "a" }]);
    await owner.subscribe(definition("x"), new AbortController().signal);
    await owner.reconcile([]);
    await owner.reconcile([]);
    expect(closes).toBe(2);
    expect(disposals).toBe(2);
    await owner.close();
  });
  it("compensates oversized and stale children", async () => {
    const disposed: string[] = [];
    let release: (() => void) | undefined;
    const owner = kernel({
      create: async (member) =>
        client(member, {
          subscribe: (wire) =>
            member.id === "slow"
              ? new Promise((resolve) => {
                  release = () => resolve(child(member.id, wire));
                })
              : Promise.resolve({ id: member.id, bytes: new Uint8Array([1, 2]) }),
          dispose: async (value) => {
            disposed.push(value.id);
          },
        }),
    });
    await owner.reconcile([{ id: "big" }]);
    await expect(
      owner.subscribe(definition("big"), new AbortController().signal, 1),
    ).rejects.toThrow("too-large");
    await owner.reconcile([{ id: "slow" }]);
    const starting = owner.subscribe(definition("slow"), new AbortController().signal);
    await Promise.resolve();
    const changed = owner.reconcile([{ id: "next" }]);
    release?.();
    await Promise.all([starting.catch(() => undefined), changed]);
    expect(disposed).toContain("big");
    expect(disposed).toContain("slow");
    await owner.close();
  });
  it("retries a failed oversized-child compensation on later reconciliation", async () => {
    let disposals = 0;
    const owner = kernel({
      create: async (member) =>
        client(member, {
          subscribe: async () => ({ id: member.id, bytes: new Uint8Array([1, 2]) }),
          dispose: async () => {
            disposals++;
            if (disposals === 1) throw new Error("dispose");
          },
        }),
    });
    await owner.reconcile([{ id: "a" }]);

    await expect(owner.subscribe(definition("x"), new AbortController().signal, 1)).rejects.toThrow(
      "too-large",
    );
    await owner.reconcile([{ id: "a" }]);

    expect(disposals).toBe(2);
    await owner.close();
  });
  it("lets the latest snapshot supersede a blocked failed-child cleanup retry", async () => {
    const retryEntered = deferred();
    const releaseRetry = deferred();
    let disposals = 0;
    const owner = kernel({
      create: async (member) =>
        client(member, {
          subscribe: async () => ({ id: member.id, bytes: new Uint8Array([1, 2]) }),
          dispose: async () => {
            disposals++;
            if (disposals === 1) throw new Error("dispose");
            retryEntered.resolve(undefined);
            await releaseRetry.promise;
          },
        }),
    });
    await owner.reconcile([{ id: "a" }]);
    await expect(owner.subscribe(definition("x"), new AbortController().signal, 1)).rejects.toThrow(
      "too-large",
    );

    const retrying = owner.reconcile([{ id: "a" }]);
    await retryEntered.promise;
    const latest = owner.reconcile([{ id: "a" }]);
    releaseRetry.resolve(undefined);
    await Promise.all([retrying, latest]);

    expect(decoder.decode(await owner.forward("request"))).toBe("a");
    await owner.close();
  });
  it("lets the latest snapshot supersede a blocked failed-member cleanup retry", async () => {
    const retryEntered = deferred();
    const releaseRetry = deferred();
    let closes = 0;
    const owner = kernel({
      create: async (member) =>
        client(member, {
          close: async () => {
            if (member.id !== "a") return;
            closes++;
            if (closes === 1) throw new Error("close");
            retryEntered.resolve(undefined);
            await releaseRetry.promise;
          },
        }),
    });
    await owner.reconcile([{ id: "a" }]);
    await owner.reconcile([]);

    const retrying = owner.reconcile([]);
    await retryEntered.promise;
    const latest = owner.reconcile([{ id: "b" }]);
    releaseRetry.resolve(undefined);
    await Promise.all([retrying, latest]);

    expect(decoder.decode(await owner.forward("request"))).toBe("b");
    await owner.close();
  });
  it("disposes a stale connecting member before the latest snapshot starts", async () => {
    const connected = deferred<Client>();
    const closed: string[] = [];
    const owner = kernel({
      create: async (member) =>
        member.id === "a"
          ? connected.promise
          : client(member, {
              close: async () => {
                closed.push(member.id);
              },
            }),
    });

    const stale = owner.reconcile([{ id: "a" }]);
    await Promise.resolve();
    const latest = owner.reconcile([{ id: "b" }]);
    connected.resolve(
      client(
        { id: "a" },
        {
          close: async () => {
            closed.push("a");
          },
        },
      ),
    );
    await Promise.all([stale, latest]);

    expect(closed).toEqual(["a"]);
    expect(decoder.decode(await owner.forward("request"))).toBe("b");
    await owner.close();
  });
  it("retries a failed stale-child compensation on later reconciliation", async () => {
    const created = deferred<Child>();
    let disposals = 0;
    const owner = kernel({
      create: async (member) =>
        client(member, {
          subscribe: (wire) =>
            member.id === "a" ? created.promise : Promise.resolve(child(member.id, wire)),
          dispose: async () => {
            disposals++;
            if (disposals === 1) throw new Error("dispose");
          },
        }),
    });
    await owner.reconcile([{ id: "a" }]);

    const subscribing = owner.subscribe(definition("x"), new AbortController().signal);
    await Promise.resolve();
    const replacing = owner.reconcile([]);
    created.resolve(child("a", definition("x/a")));
    await Promise.all([subscribing.catch(() => undefined), replacing]);
    await owner.reconcile([]);

    expect(disposals).toBe(2);
    await owner.close();
  });
  it("activates a stored child once, replaces completed children, and contains update failures", async () => {
    let activates = 0;
    let subscriptions = 0;
    const owner = kernel({
      create: async (member) =>
        client(member, {
          subscribe: async (wire) => (subscriptions++, child(member.id, wire)),
          activate: async (_child, updates) => {
            activates++;
            await updates("update");
          },
        }),
    });
    await owner.reconcile([{ id: "a" }]);
    await owner.subscribe(definition("x"), new AbortController().signal);
    const controller = new AbortController();
    const activation = owner.activate(
      definition("x"),
      async () => {
        throw new Error("consumer");
      },
      controller.signal,
    );
    await Promise.resolve();
    await owner.reconcile([{ id: "a" }]);
    controller.abort();
    await activation;
    expect(activates).toBe(2);
    expect(subscriptions).toBe(2);
    await owner.close();
  });
  it("cancels definitions with and without a client and coalesces repeated removal", async () => {
    let disposals = 0;
    const owner = kernel({
      create: async (member) =>
        client(member, {
          dispose: async () => {
            disposals++;
          },
        }),
    });
    await owner.rehydrate(definition("without"));
    await owner.cancel(definition("without"), new AbortController().signal);
    await owner.reconcile([{ id: "a" }]);
    await owner.subscribe(definition("with"), new AbortController().signal);
    const removals = await Promise.allSettled([
      owner.cancel(definition("with"), new AbortController().signal),
      owner.cancel(definition("with"), new AbortController().signal),
    ]);
    expect(removals.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(disposals).toBe(1);
    await owner.close();
  });
  it("rejects incomplete child disposal and retries it on later reconciliation", async () => {
    let attempts = 0;
    const owner = kernel({
      create: async (member) =>
        client(member, {
          dispose: async () => {
            attempts++;
            if (attempts === 1) throw new Error("transient dispose");
          },
        }),
    });
    await owner.reconcile([{ id: "a" }]);
    await owner.subscribe(definition("x"), new AbortController().signal);
    await expect(owner.cancel(definition("x"), new AbortController().signal)).rejects.toThrow(
      "cleanup remains incomplete",
    );
    await owner.reconcile([{ id: "a" }]);
    expect(attempts).toBe(2);
    await owner.close();
  });
  it("normalizes a non-Error native child creation rejection", async () => {
    const owner = kernel({
      create: async (member) =>
        // The native boundary must normalize non-Error rejections.
        client(member, {
          subscribe: async () => {
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
            return Promise.reject({ reason: "broken" });
          },
        }),
    });
    try {
      await owner.reconcile([{ id: "a" }]);
      await expect(owner.subscribe(definition("x"), new AbortController().signal)).rejects.toThrow(
        "native subscription creation failed",
      );
    } finally {
      await owner.close().catch(() => undefined);
    }
  });
  it("retains one ignored-abort disposal until its underlying attempt settles", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const settled = deferred();
    const underlyingSettled = deferred();
    const owner = kernel({
      create: async (member) =>
        client(member, {
          dispose: async () => {
            attempts++;
            if (attempts === 1) {
              await settled.promise;
              underlyingSettled.resolve(undefined);
            }
          },
        }),
    });
    try {
      await owner.reconcile([{ id: "a" }]);
      await owner.subscribe(definition("x"), new AbortController().signal);
      const cancelled = owner.cancel(definition("x"), new AbortController().signal);
      const rejected = expect(cancelled).rejects.toThrow("cleanup remains incomplete");
      await vi.advanceTimersByTimeAsync(1_000);
      await rejected;
      await owner.reconcile([{ id: "a" }]);
      await expect(owner.cancel(definition("x"), new AbortController().signal)).rejects.toThrow(
        "cleanup remains incomplete",
      );
      expect(attempts).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
      settled.resolve(undefined);
      await underlyingSettled.promise;
      await Promise.resolve();
      await Promise.resolve();
      await expect(
        owner.cancel(definition("x"), new AbortController().signal),
      ).resolves.toBeUndefined();
      expect(attempts).toBe(2);
      await owner.close();
    } finally {
      vi.useRealTimers();
    }
  });
  it("retries a rejected underlying cleanup attempt after it settles", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const rejected = deferred();
    const underlyingSettled = deferred();
    const owner = kernel({
      create: async (member) =>
        client(member, {
          dispose: async () => {
            attempts++;
            if (attempts === 1)
              try {
                await rejected.promise;
              } finally {
                underlyingSettled.resolve(undefined);
              }
          },
        }),
    });
    await owner.reconcile([{ id: "a" }]);
    await owner.subscribe(definition("x"), new AbortController().signal);
    const cancelled = owner.cancel(definition("x"), new AbortController().signal);
    const cancellation = expect(cancelled).rejects.toThrow("cleanup remains incomplete");
    await vi.advanceTimersByTimeAsync(1_000);
    await cancellation;
    expect(attempts).toBe(1);
    rejected.reject(new Error("late rejection"));
    await underlyingSettled.promise;
    await Promise.resolve();
    await Promise.resolve();
    await expect(
      owner.cancel(definition("x"), new AbortController().signal),
    ).resolves.toBeUndefined();
    expect(attempts).toBe(2);
    await owner.close();
    vi.useRealTimers();
  }, 5_000);
  it("aborts pending starts during close and retries an incomplete terminal cleanup", async () => {
    let startAborted = false;
    let closes = 0;
    const owner = kernel({
      create: (_member, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            startAborted = true;
            reject(new Error("aborted"));
          });
        }),
    });
    void owner.reconcile([{ id: "a" }]);
    await Promise.resolve();
    await owner.close();
    expect(startAborted).toBe(true);
    const retry = kernel({
      create: async (member) =>
        client(member, {
          close: async () => {
            closes++;
            if (closes < 3) throw new Error("close");
          },
        }),
    });
    await retry.reconcile([{ id: "a" }]);
    await expect(retry.close()).rejects.toThrow("cleanup remains incomplete");
    await expect(retry.close()).resolves.toBeUndefined();
    expect(closes).toBe(3);
  });
  it("waits for both future and already-aborted signals", async () => {
    const future = new AbortController();
    const waiting = BackendMembershipKernel.waitForAbort(future.signal);
    future.abort();
    await waiting;
    const past = new AbortController();
    past.abort();
    await expect(BackendMembershipKernel.waitForAbort(past.signal)).resolves.toBeUndefined();
  });
});

function kernel(
  overrides: Partial<
    ConstructorParameters<typeof BackendMembershipKernel<Member, string, Child, string>>[0]
  > = {},
): BackendMembershipKernel<Member, string, Child, string> {
  return new BackendMembershipKernel({
    create: async (member) => client(member),
    memberKey: (member) => member.id,
    sameMember: (left, right) => left.endpoint === right.endpoint,
    definitionKey: (wire) => decoder.decode(wire),
    childDefinition: (wire, member) => encoder.encode(`${decoder.decode(wire)}/${member.id}`),
    childSize: (value) => value.bytes.byteLength,
    ...overrides,
  });
}
function client(member: Member, overrides: Partial<Client> = {}): Client {
  return {
    forward: async () => encoder.encode(member.id),
    subscribe: async (wire) => child(member.id, wire),
    activate: async () => {},
    dispose: async () => {},
    close: async () => {},
    ...overrides,
  };
}
function child(id: string, bytes: Uint8Array): Child {
  return { id, bytes };
}
function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}

function deferred<Value = undefined>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
