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

import { describe, expect, it } from "vitest";
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
    await owner.close();
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
    await Promise.all([
      owner.cancel(definition("with"), new AbortController().signal),
      owner.cancel(definition("with"), new AbortController().signal),
    ]);
    expect(disposals).toBe(1);
    await owner.close();
  });
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
