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

/* eslint-disable @typescript-eslint/require-await -- Structural registry and Gateway fixtures expose
 * asynchronous contract methods without awaiting. */

import { ApplicationNode } from "@spine-event-engine/deployment";
import { describe, expect, it, vi } from "vitest";

import { GceRegistrar } from "../../src/index.js";

describe("GceRegistrar lifecycle", () => {
  it("requires either an explicit node or a metadata port", () => {
    // @ts-expect-error Registrar construction requires node or metadata port.
    expect(() => new GceRegistrar({ registry: {} })).toThrow("node or a metadata port");
  });

  it("registers after start, renews at twenty seconds, and removes on close", async () => {
    const calls: string[] = [];
    let tick: (() => void) | undefined;
    const registry = {
      lookup: async () => undefined,
      register: async () => (calls.push("register"), true),
      renew: async () => (calls.push("renew"), true),
      cleanup: async () => (calls.push("cleanup"), 0),
      remove: async () => (calls.push("remove"), true),
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      identity: "process",
      now: () => 0,
      scheduler: {
        schedule: (delay, onTick) => (
          expect(delay).toBe(20_000),
          (tick = onTick),
          () => calls.push("cancel")
        ),
      },
    });
    await registrar.start();
    tick?.();
    await Promise.resolve();
    await registrar.close();
    expect(calls).toEqual(["register", "cancel", "renew", "cleanup", "remove"]);
  });

  it("uses exact twenty-second renewal and sixty-second lease-expiry timing", async () => {
    const ticks: (() => void)[] = [];
    const delays: number[] = [];
    const expiries: number[] = [];
    let now = 100;
    let secondSchedule: (() => void) | undefined;
    const renewed = new Promise<void>((resolve) => (secondSchedule = resolve));
    const registrar = new GceRegistrar({
      registry: {
        register: async (lease: { expiresAt: number }) => (expiries.push(lease.expiresAt), true),
        renew: async (_nodeId: string, _identity: string, expiresAt: number) => (
          expiries.push(expiresAt),
          true
        ),
        cleanup: async () => 0,
        remove: async () => true,
      } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      now: () => now,
      scheduler: {
        schedule: (delay, onTick) => (
          delays.push(delay),
          ticks.push(onTick),
          delays.length === 2 && secondSchedule?.(),
          () => undefined
        ),
      },
    });
    await registrar.start();
    now = 20_100;
    ticks.shift()?.();
    await renewed;
    await registrar.close();
    expect(delays).toEqual([20_000, 20_000]);
    expect(expiries).toEqual([60_100, 80_100]);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid registrar operation timeout of %s",
    (operationTimeoutMs) => {
      expect(
        () =>
          new GceRegistrar({
            registry: {} as import("@spine-event-engine/deployment").LeasedNodeRegistry,
            node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
            operationTimeoutMs,
          }),
      ).toThrow("operation timeout");
    },
  );

  it("derives metadata-backed registration from only a registry and port", async () => {
    const original = globalThis.fetch;
    const registrations: string[] = [];
    globalThis.fetch = async (input) => {
      const path = requestUrl(input).split("/").slice(-2).join("/");
      const body =
        new Map([
          ["project/project-id", "project"],
          ["instance/zone", "projects/1/zones/zone-a"],
          ["instance/id", "42"],
          ["0/ip", "10.0.0.1"],
        ]).get(path) ?? "";
      return new Response(body, { status: 200 });
    };
    const registrar = new GceRegistrar({
      registry: {
        register: async (lease: { node: ApplicationNode }) => (
          registrations.push(lease.node.id),
          true
        ),
        remove: async () => true,
      } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry,
      port: 8080,
      scheduler: { schedule: () => () => undefined },
    });
    try {
      await registrar.start();
      expect(registrations).toEqual(["gce/project/zone-a/42"]);
    } finally {
      await registrar.close();
      globalThis.fetch = original;
    }
  });

  it("adapts registration to the listener lifecycle contract", async () => {
    const calls: string[] = [];
    const registry = {
      register: async () => (calls.push("start"), true),
      remove: async () => (calls.push("close"), true),
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      identity: "process",
      now: () => 0,
      scheduler: { schedule: () => () => undefined },
    });
    const lifecycle = registrar.lifecycle();
    await lifecycle.start();
    await lifecycle.close();
    expect(calls).toEqual(["start", "close"]);
  });

  it("aborts and joins stalled metadata before removing its lease", async () => {
    let resolve: (() => void) | undefined;
    let aborted = false;
    const metadata = {
      read: (signal: AbortSignal) =>
        new Promise<import("../../src/index.js").GceMetadata>((done) => {
          signal.addEventListener("abort", () => (aborted = true));
          resolve = () => {
            done({ projectId: "p", zone: "z", instanceId: "1", privateAddress: "10.0.0.1" });
          };
        }),
    };
    const calls: string[] = [];
    const registry = {
      register: async () => (calls.push("register"), true),
      remove: async () => (calls.push("remove"), true),
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({ registry, metadata, port: 8080 });
    const starting = registrar.start();
    await Promise.resolve();
    await Promise.resolve();
    const closing = registrar.close();
    expect(aborted).toBe(true);
    expect(calls).toEqual([]);
    resolve?.();
    await starting;
    await closing;
    expect(calls).toEqual(["register", "remove"]);
  });

  it("joins a stalled initial registration before removal", async () => {
    let resolve: (() => void) | undefined;
    let admitted: (() => void) | undefined;
    const admittedPromise = new Promise<void>((done) => (admitted = done));
    const calls: string[] = [];
    const registry = {
      register: () =>
        new Promise<boolean>((done) => {
          admitted?.();
          resolve = () => {
            calls.push("register");
            done(true);
          };
        }),
      remove: async () => (calls.push("remove"), true),
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
    });
    const starting = registrar.start();
    await admittedPromise;
    const closing = registrar.close();
    expect(calls).toEqual([]);
    resolve?.();
    await starting;
    await closing;
    expect(calls).toEqual(["register", "remove"]);
  });

  it("does not schedule renewal after close fences a stalled initial registration", async () => {
    let resolveRegistration: ((registered: boolean) => void) | undefined;
    let admitted: (() => void) | undefined;
    const admittedRegistration = new Promise<void>((resolve) => (admitted = resolve));
    let schedules = 0;
    const registrar = new GceRegistrar({
      registry: {
        register: () =>
          new Promise<boolean>((resolve) => {
            resolveRegistration = resolve;
            admitted?.();
          }),
        remove: async () => true,
      } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      scheduler: { schedule: () => ((schedules += 1), () => undefined) },
    });
    const starting = registrar.start();
    await admittedRegistration;
    const closing = registrar.close();
    resolveRegistration?.(true);
    await starting;
    await closing;
    expect(schedules).toBe(0);
  });

  it("joins a stalled renewal and cleanup before removal", async () => {
    let tick: (() => void) | undefined;
    let resolveRenew: (() => void) | undefined;
    let admitted: (() => void) | undefined;
    const admittedPromise = new Promise<void>((done) => (admitted = done));
    const calls: string[] = [];
    const registry = {
      register: async () => true,
      renew: () =>
        new Promise<boolean>((done) => {
          admitted?.();
          resolveRenew = () => {
            calls.push("renew");
            done(true);
          };
        }),
      cleanup: async () => (calls.push("cleanup"), 0),
      remove: async () => (calls.push("remove"), true),
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      scheduler: { schedule: (_delay, onTick) => ((tick = onTick), () => calls.push("cancel")) },
    });
    await registrar.start();
    tick?.();
    await admittedPromise;
    const closing = registrar.close();
    expect(calls).toEqual(["cancel"]);
    resolveRenew?.();
    await closing;
    expect(calls).toEqual(["cancel", "renew", "cleanup", "remove"]);
  });

  it("does not warn when close fences an entered renewal that later rejects", async () => {
    let tick: (() => void) | undefined;
    let rejectRenew: ((error: Error) => void) | undefined;
    let entered: (() => void) | undefined;
    const enteredRenewal = new Promise<void>((resolve) => (entered = resolve));
    const warn = vi.fn();
    const calls: string[] = [];
    const registrar = new GceRegistrar({
      registry: {
        register: async () => true,
        renew: () =>
          new Promise((_, reject) => {
            entered?.();
            rejectRenew = reject;
          }),
        cleanup: async () => (calls.push("cleanup"), 0),
        remove: async () => (calls.push("remove"), true),
      } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      logger: { withMetadata: vi.fn(() => ({ warn })) } as never,
      scheduler: {
        schedule: (_delay, scheduled) => ((tick = scheduled), () => calls.push("cancel")),
      },
    });
    await registrar.start();
    tick?.();
    await enteredRenewal;
    const closing = registrar.close();
    rejectRenew?.(new Error("token password cookie authorization signing session CSRF OIDC"));
    await closing;
    expect(warn).not.toHaveBeenCalled();
    expect(calls).toEqual(["cancel", "remove"]);
  });

  it("aborts metadata at its deadline and closes the deadline handle", async () => {
    let abort: (() => void) | undefined;
    let closed = false;
    const metadata = {
      read: (signal: AbortSignal) =>
        new Promise<import("../../src/index.js").GceMetadata>((_done, reject) => {
          signal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    };
    const registrar = new GceRegistrar({
      registry: {
        remove: async () => true,
      } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry,
      metadata,
      port: 8080,
      deadlines: {
        create: () => {
          const controller = new AbortController();
          abort = () => {
            controller.abort();
          };
          return { signal: controller.signal, close: () => (closed = true) };
        },
      },
    });
    const starting = registrar.start();
    await Promise.resolve();
    abort?.();
    await starting;
    await registrar.close();
    expect(closed).toBe(true);
  });

  it("bounds an unconfirmed ownership lookup with its own operation deadline", async () => {
    const ticks: (() => void)[] = [];
    const controllers: AbortController[] = [];
    let schedules = 0;
    let retryScheduled: (() => void) | undefined;
    const retried = new Promise<void>((resolve) => (retryScheduled = resolve));
    let lookupStarted: (() => void) | undefined;
    const lookup = new Promise<void>((resolve) => (lookupStarted = resolve));
    let lookupSignal: AbortSignal | undefined;
    const registry = {
      register: async () => {
        throw new Error("lost response");
      },
      lookup: (nodeId: string, now: number, signal: AbortSignal) =>
        new Promise<undefined>((_resolve, reject) => {
          expect(nodeId).toBe("node");
          expect(now).toBe(0);
          lookupSignal = signal;
          lookupStarted?.();
          signal.addEventListener(
            "abort",
            () => {
              reject(new Error("lookup deadline"));
            },
            {
              once: true,
            },
          );
        }),
      cleanup: async () => 0,
      remove: async () => true,
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      now: () => 0,
      scheduler: {
        schedule: (_delay, onTick) => (
          ticks.push(onTick),
          (schedules += 1) === 2 && retryScheduled?.(),
          () => undefined
        ),
      },
      deadlines: {
        create: () => {
          const controller = new AbortController();
          controllers.push(controller);
          return { signal: controller.signal, close: () => undefined };
        },
      },
    });
    await registrar.start();
    expect(ticks).toHaveLength(1);
    ticks.shift()?.();
    await lookup;
    try {
      controllers.at(-1)?.abort();
      expect(lookupSignal?.aborted).toBe(true);
      await retried;
    } finally {
      await registrar.close();
    }
  });

  it("closes each deadline after admitted registry work", async () => {
    let created = 0;
    let closed = 0;
    let tick: (() => void) | undefined;
    const registry = {
      register: async () => true,
      renew: async () => true,
      cleanup: async () => 0,
      remove: async () => true,
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      scheduler: { schedule: (_delay, onTick) => ((tick = onTick), () => undefined) },
      deadlines: {
        create: () => {
          created += 1;
          return { signal: new AbortController().signal, close: () => (closed += 1) };
        },
      },
    });
    await registrar.start();
    tick?.();
    await Promise.resolve();
    await registrar.close();
    expect(created).toBe(closed);
    expect(created).toBeGreaterThanOrEqual(4);
  });

  it("unrefs default registrar schedules and operation deadlines", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let unrefs = 0;
    globalThis.setTimeout = (() =>
      ({
        unref: () => {
          unrefs += 1;
        },
      }) as unknown as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout;
    globalThis.clearTimeout = () => undefined;
    const registrar = new GceRegistrar({
      registry: {
        register: async () => true,
        remove: async () => true,
      } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
    });
    try {
      await registrar.start();
      expect(unrefs).toBe(2);
    } finally {
      await registrar.close();
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}
