/* eslint-disable @typescript-eslint/require-await */

import { describe, expect, it, vi } from "vitest";
import { DynamicUnaryForwarder, type DynamicUnaryClient } from "@spine-event-engine/auth";
import { ApplicationNode } from "@spine-event-engine/deployment";
import { create, toBinary } from "@bufbuild/protobuf";
import { SubscriptionSchema, TopicSchema } from "@spine-event-engine/proto/client";

import { GkeNodeDiscovery, NodeDnsResolver } from "../../src/index.js";

describe("GkeNodeDiscovery", () => {
  it("cancels a Node resolver immediately when its signal is already aborted", async () => {
    let cancelled = 0;
    let lookups = 0;
    const resolver = new NodeDnsResolver(() => ({
      resolve4: async () => {
        lookups += 1;
        return [];
      },
      resolve6: async () => {
        lookups += 1;
        return [];
      },
      cancel: () => {
        cancelled += 1;
      },
    }));
    const controller = new AbortController();
    controller.abort();

    await expect(
      resolver.resolve("api.default.svc.cluster.local", controller.signal),
    ).rejects.toMatchObject({
      name: "AbortError",
    });

    expect(cancelled).toBe(1);
    expect(lookups).toBe(0);
  });

  it("cancels a Node resolver while an address-family lookup is in flight", async () => {
    let cancelled = 0;
    let release: (() => void) | undefined;
    const resolver = new NodeDnsResolver(() => ({
      resolve4: async () =>
        await new Promise<readonly { readonly address: string; readonly ttl: number }[]>(
          (resolve) => {
            release = () => {
              resolve([]);
            };
          },
        ),
      resolve6: async () => [],
      cancel: () => {
        cancelled += 1;
        if (release !== undefined) release();
      },
    }));
    const controller = new AbortController();
    const result = resolver.resolve("api.default.svc.cluster.local", controller.signal);
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toBe(1);
  });

  it("propagates a non-name Node DNS failure", async () => {
    const failure = Object.assign(new Error("temporary DNS failure"), { code: "ESERVFAIL" });
    const resolver = new NodeDnsResolver(() => ({
      resolve4: async () => {
        throw failure;
      },
      resolve6: async () => [],
      cancel: () => undefined,
    }));

    await expect(
      resolver.resolve("api.default.svc.cluster.local", new AbortController().signal),
    ).rejects.toBe(failure);
  });

  it("cancels the sibling lookup when one address family fails fatally", async () => {
    let cancelled = 0;
    const failure = Object.assign(new Error("temporary DNS failure"), { code: "ESERVFAIL" });
    const resolver = new NodeDnsResolver(() => ({
      resolve4: async () => {
        throw failure;
      },
      resolve6: async () => await new Promise(() => undefined),
      cancel: () => {
        cancelled += 1;
      },
    }));

    await expect(
      resolver.resolve("api.default.svc.cluster.local", new AbortController().signal),
    ).rejects.toBe(failure);
    expect(cancelled).toBe(1);
  });

  it("maps Node A and AAAA TTL answers and treats name-not-found as empty", async () => {
    const resolver = new NodeDnsResolver(() => ({
      resolve4: async () => [{ address: "10.0.0.1", ttl: 12 }],
      resolve6: async () => [{ address: "2001:db8::1", ttl: 4 }],
      cancel: () => undefined,
    }));
    await expect(
      resolver.resolve("api.default.svc.cluster.local", new AbortController().signal),
    ).resolves.toEqual([
      { address: "10.0.0.1", ttl: 12 },
      { address: "2001:db8::1", ttl: 4 },
    ]);
    const missing = new NodeDnsResolver(() => ({
      resolve4: async () => {
        throw Object.assign(new Error("missing"), { code: "ENOTFOUND" });
      },
      resolve6: async () => {
        throw Object.assign(new Error("missing"), { code: "ENODATA" });
      },
      cancel: () => undefined,
    }));
    await expect(missing.resolve("missing", new AbortController().signal)).resolves.toEqual([]);
  });

  it.each([
    [{ serviceName: "not a service", port: 8080 }, undefined],
    [
      { serviceName: "api.default.svc.cluster.local", port: 0 },
      "GKE node port must be a valid TCP port.",
    ],
    [
      { serviceName: "api.default.svc.cluster.local", port: 8080, refreshIntervalMs: 0 },
      "GKE refresh interval must be a positive safe integer.",
    ],
  ])("rejects invalid discovery configuration", (options, message) => {
    expect(() => new GkeNodeDiscovery(options)).toThrow(message);
  });

  it("allows one watch and makes its close operation idempotent", async () => {
    const scheduler = new Scheduler();
    const discovery = new GkeNodeDiscovery({
      serviceName: "api.default.svc.cluster.local",
      port: 8080,
      resolver: { resolve: async () => [] },
      scheduler,
    });
    const stop = discovery.watch(() => undefined);

    expect(() => discovery.watch(() => undefined)).toThrow("one active watch");
    await stop();
    await stop();
    await expect(discovery.close()).resolves.toBeUndefined();
    expect(() => discovery.watch(() => undefined)).toThrow("is closed");
    expect(scheduler.cancelled).toBeGreaterThan(0);
    await expect(scheduler.tick()).rejects.toThrow("No scheduled tick.");
  });

  it("warns once for an active DNS refresh failure without logging cancellation", async () => {
    const scheduler = new Scheduler();
    const warn = vi.fn();
    const logger = { withMetadata: vi.fn(() => ({ warn })) };
    const discovery = new GkeNodeDiscovery({
      serviceName: "api.default.svc.cluster.local",
      port: 8080,
      logger: logger as never,
      resolver: { resolve: async () => Promise.reject(new Error("temporary DNS failure")) },
      scheduler,
    });

    discovery.watch(() => undefined);
    await scheduler.tick();

    expect(logger.withMetadata).toHaveBeenCalledWith({
      operation: "deployment.gke.discovery.refresh",
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith("deployment.gke.discovery.refresh_failed");
    await discovery.close();
  });

  it("coalesces concurrent close callers onto one shutdown promise", async () => {
    const scheduler = new Scheduler();
    let settle: (() => void) | undefined;
    const discovery = new GkeNodeDiscovery({
      serviceName: "api.default.svc.cluster.local",
      port: 8080,
      resolver: {
        resolve: async () =>
          await new Promise<readonly never[]>((resolve) => {
            settle = () => {
              resolve([]);
            };
          }),
      },
      scheduler,
    });
    discovery.watch(() => undefined);
    const refresh = scheduler.tick();
    const first = discovery.close();
    const second = discovery.close();

    expect(second).toBe(first);
    settle?.();
    await Promise.all([first, refresh]);
  });

  it("cancels its default scheduled refresh when closed before the first lookup", async () => {
    const discovery = new GkeNodeDiscovery({
      serviceName: "api.default.svc.cluster.local",
      port: 8080,
      resolver: { resolve: async () => [] },
    });
    const stop = discovery.watch(() => undefined);

    await stop();
  });

  it("publishes a deduplicated canonical IPv6 HTTPS snapshot with the Service TLS authority", async () => {
    const discovery = new GkeNodeDiscovery({
      serviceName: "api.default.svc.cluster.local",
      port: 8443,
      scheme: "https",
      resolver: {
        resolve: async () => [
          { address: "2001:db8::7", ttl: 30 },
          { address: "2001:db8::7", ttl: 30 },
        ],
      },
      scheduler: {
        schedule: (_delayMs, onTick) => {
          queueMicrotask(onTick);
          return () => undefined;
        },
      },
    });
    const snapshots: (readonly ApplicationNode[])[] = [];

    const stop = discovery.watch((nodes) => {
      snapshots.push(nodes);
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(snapshots).toEqual([
      [
        {
          id: "gke/https://[2001:db8::7]:8443/api.default.svc.cluster.local",
          endpoint: "https://[2001:db8::7]:8443",
          tlsServerName: "api.default.svc.cluster.local",
        },
      ],
    ]);
    await stop();
  });

  it("deduplicates equivalent IPv6 spellings after endpoint canonicalization", async () => {
    const scheduler = new Scheduler();
    const discovery = new GkeNodeDiscovery({
      serviceName: "api.default.svc.cluster.local",
      port: 8443,
      scheme: "https",
      resolver: {
        resolve: async () => [
          { address: "2001:0db8::7", ttl: 30 },
          { address: "2001:db8:0:0:0:0:0:7", ttl: 30 },
        ],
      },
      scheduler,
    });
    const snapshots: ApplicationNode[][] = [];
    const stop = discovery.watch((nodes) => snapshots.push([...nodes]));

    await scheduler.tick();

    expect(snapshots[0]).toHaveLength(1);
    expect(snapshots[0]?.[0]?.id).toBe(
      "gke/https://[2001:db8::7]:8443/api.default.svc.cluster.local",
    );
    await stop();
  });

  it("uses the smaller positive TTL before the configured refresh interval", async () => {
    const scheduler = new Scheduler();
    const discovery = new GkeNodeDiscovery({
      serviceName: "api.default.svc.cluster.local",
      port: 8080,
      refreshIntervalMs: 10_000,
      resolver: { resolve: async () => [{ address: "10.0.0.1", ttl: 3 }] },
      scheduler,
    });
    const stop = discovery.watch(() => undefined);

    await scheduler.tick();

    expect(scheduler.delays).toEqual([0, 3_000, 3_000]);
    await stop();
  });

  it("uses the configured interval for zero TTL and immediate empty answers", async () => {
    const scheduler = new Scheduler();
    const answers: (readonly { readonly address: string; readonly ttl: number }[])[] = [
      [{ address: "10.0.0.1", ttl: 0 }],
      [],
    ];
    const discovery = new GkeNodeDiscovery({
      serviceName: "api.default.svc.cluster.local",
      port: 8080,
      resolver: { resolve: async () => answers.shift() ?? [] },
      scheduler,
    });
    const snapshots: unknown[][] = [];
    const stop = discovery.watch((nodes) => {
      snapshots.push([...nodes]);
    });

    await scheduler.tick();
    await scheduler.tick();

    expect(scheduler.delays).toEqual([0, 10_000, 10_000, 10_000]);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toEqual([]);
    await stop();
  });

  it("retains a failed answer only through its TTL before publishing one empty snapshot", async () => {
    const scheduler = new Scheduler();
    let now = 0;
    let calls = 0;
    const discovery = new GkeNodeDiscovery({
      serviceName: "api.default.svc.cluster.local",
      port: 8080,
      refreshIntervalMs: 5_000,
      now: () => now,
      resolver: {
        resolve: async () => {
          calls += 1;
          if (calls === 1) return [{ address: "10.0.0.1", ttl: 2 }];
          throw new Error("temporary DNS failure");
        },
      },
      scheduler,
    });
    const snapshots: unknown[][] = [];
    const stop = discovery.watch((nodes) => {
      snapshots.push([...nodes]);
    });

    await scheduler.tick();
    now = 1_000;
    await scheduler.tick();
    now = 2_000;
    await scheduler.tick();

    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toEqual([]);
    expect(scheduler.delays).toEqual([0, 2_000, 2_000, 5_000, 5_000]);
    await stop();
  });

  it("publishes one empty snapshot after fallback validity expires despite repeated failures", async () => {
    const scheduler = new Scheduler();
    let now = 0;
    let calls = 0;
    const discovery = new GkeNodeDiscovery({
      serviceName: "api.default.svc.cluster.local",
      port: 8080,
      refreshIntervalMs: 5_000,
      now: () => now,
      resolver: {
        resolve: async () => {
          calls += 1;
          if (calls === 1) return [{ address: "10.0.0.1" }];
          throw new Error("temporary DNS failure");
        },
      },
      scheduler,
    });
    const snapshots: unknown[][] = [];
    const stop = discovery.watch((nodes) => {
      snapshots.push([...nodes]);
    });

    await scheduler.tick();
    now = 5_000;
    await scheduler.tick();
    now = 10_000;
    await scheduler.tick();

    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toEqual([]);
    await stop();
  });

  it("expires membership and schedules retries while the next lookup stalls", async () => {
    const scheduler = new Scheduler();
    let now = 0;
    let calls = 0;
    const discovery = new GkeNodeDiscovery({
      serviceName: "api.default.svc.cluster.local",
      port: 8080,
      refreshIntervalMs: 5_000,
      now: () => now,
      resolver: {
        resolve: async (_name, signal) => {
          calls += 1;
          if (calls === 1) return [{ address: "10.0.0.1", ttl: 2 }];
          return await new Promise<readonly never[]>((resolve) => {
            signal.addEventListener(
              "abort",
              () => {
                resolve([]);
              },
              { once: true },
            );
          });
        },
      },
      scheduler,
    });
    const snapshots: unknown[][] = [];
    const stop = discovery.watch((nodes) => snapshots.push([...nodes]));

    await scheduler.tick();
    now = 2_000;
    const stalled = scheduler.tick();
    await scheduler.tick();

    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toEqual([]);
    expect(scheduler.delays).toContain(5_000);
    void stalled;
    await stop();
  });

  it("retains one bounded retry timer while expired lookup attempts keep stalling", async () => {
    const scheduler = new Scheduler();
    let now = 0;
    let calls = 0;
    let aborted = 0;
    const discovery = new GkeNodeDiscovery({
      serviceName: "api.default.svc.cluster.local",
      port: 8080,
      refreshIntervalMs: 5_000,
      now: () => now,
      resolver: {
        resolve: async (_name, signal) => {
          calls += 1;
          if (calls === 1) return [{ address: "10.0.0.1", ttl: 2 }];
          return await new Promise<readonly never[]>((resolve) => {
            signal.addEventListener(
              "abort",
              () => {
                aborted += 1;
                resolve([]);
              },
              { once: true },
            );
          });
        },
      },
      scheduler,
    });
    const stop = discovery.watch(() => undefined);

    await scheduler.tick();
    now = 2_000;
    await scheduler.tick();
    await scheduler.tick();
    await scheduler.tick();
    await scheduler.tick();

    expect(calls).toBe(3);
    expect(scheduler.delays.slice(-1)).toEqual([5_000]);
    await stop();
    expect(aborted).toBe(2);
  });

  it("discards an older stalled answer after a newer retry publishes membership", async () => {
    const scheduler = new Scheduler();
    let now = 0;
    let calls = 0;
    let settleOlder:
      ((answer: readonly { readonly address: string; readonly ttl: number }[]) => void) | undefined;
    const discovery = new GkeNodeDiscovery({
      serviceName: "api.default.svc.cluster.local",
      port: 8080,
      refreshIntervalMs: 5_000,
      now: () => now,
      resolver: {
        resolve: async () => {
          calls += 1;
          if (calls === 1) return [{ address: "10.0.0.1", ttl: 2 }];
          if (calls === 2)
            return await new Promise((resolve) => {
              settleOlder = resolve;
            });
          return [{ address: "10.0.0.2", ttl: 30 }];
        },
      },
      scheduler,
    });
    const snapshots: ApplicationNode[][] = [];
    const stop = discovery.watch((nodes) => snapshots.push([...nodes]));

    await scheduler.tick();
    now = 2_000;
    await scheduler.tick();
    await scheduler.tick();
    await scheduler.tick();
    settleOlder?.([{ address: "10.0.0.3", ttl: 30 }]);
    await Promise.resolve();
    await Promise.resolve();

    expect(snapshots.map((nodes) => nodes[0]?.endpoint ?? "empty")).toEqual([
      "http://10.0.0.1:8080",
      "empty",
      "http://10.0.0.2:8080",
    ]);
    await stop();
  });

  it("discards an older rejection after a newer short-TTL answer succeeds", async () => {
    const scheduler = new Scheduler();
    let now = 0;
    let calls = 0;
    let rejectOlder: ((reason: Error) => void) | undefined;
    const discovery = new GkeNodeDiscovery({
      serviceName: "api.default.svc.cluster.local",
      port: 8080,
      refreshIntervalMs: 5_000,
      now: () => now,
      resolver: {
        resolve: async () => {
          calls += 1;
          if (calls === 1) return [{ address: "10.0.0.1", ttl: 2 }];
          if (calls === 2)
            return await new Promise<readonly never[]>((_resolve, reject) => {
              rejectOlder = reject;
            });
          return [{ address: "10.0.0.2", ttl: 1 }];
        },
      },
      scheduler,
    });
    const snapshots: ApplicationNode[][] = [];
    const stop = discovery.watch((nodes) => snapshots.push([...nodes]));

    await scheduler.tick();
    now = 2_000;
    await scheduler.tick();
    await scheduler.tick();
    await scheduler.tick();
    rejectOlder?.(new Error("late DNS failure"));
    await Promise.resolve();
    await Promise.resolve();

    expect(scheduler.delays.slice(-1)).toEqual([1_000]);
    expect(snapshots.map((nodes) => nodes[0]?.endpoint ?? "empty")).toEqual([
      "http://10.0.0.1:8080",
      "empty",
      "http://10.0.0.2:8080",
    ]);
    await stop();
  });

  it("does not repeat an empty snapshot when an empty answer is followed by failure", async () => {
    const scheduler = new Scheduler();
    let now = 0;
    let calls = 0;
    const discovery = new GkeNodeDiscovery({
      serviceName: "api.default.svc.cluster.local",
      port: 8080,
      now: () => now,
      resolver: {
        resolve: async () => {
          calls += 1;
          if (calls === 1) return [];
          throw new Error("temporary DNS failure");
        },
      },
      scheduler,
    });
    const snapshots: unknown[][] = [];
    const stop = discovery.watch((nodes) => snapshots.push([...nodes]));

    await scheduler.tick();
    now = 10_000;
    await scheduler.tick();

    expect(snapshots).toEqual([[]]);
    await stop();
  });

  it("cancels an admitted resolver request during shutdown", async () => {
    const scheduler = new Scheduler();
    let aborted = false;
    const discovery = new GkeNodeDiscovery({
      serviceName: "api.default.svc.cluster.local",
      port: 8080,
      resolver: {
        resolve: async (_name, signal) =>
          await new Promise<readonly never[]>((resolve) => {
            signal.addEventListener("abort", () => {
              aborted = true;
              resolve([]);
            });
          }),
      },
      scheduler,
    });
    const stop = discovery.watch(() => undefined);
    const pending = scheduler.tick();

    await stop();
    await pending;

    expect(aborted).toBe(true);
    expect(scheduler.delays).toEqual([0]);
  });

  it("does not publish a stalled resolver result after discovery closes", async () => {
    const scheduler = new Scheduler();
    let resolve:
      ((answer: readonly { readonly address: string; readonly ttl: number }[]) => void) | undefined;
    const discovery = new GkeNodeDiscovery({
      serviceName: "api.default.svc.cluster.local",
      port: 8080,
      resolver: {
        resolve: async () =>
          await new Promise((settle) => {
            resolve = settle;
          }),
      },
      scheduler,
    });
    const snapshots: unknown[][] = [];
    const stop = discovery.watch((nodes) => {
      snapshots.push([...nodes]);
    });
    const pending = scheduler.tick();

    const closed = stop();
    resolve?.([{ address: "10.0.0.1", ttl: 30 }]);
    await Promise.all([closed, pending]);

    expect(snapshots).toEqual([]);
    expect(scheduler.delays).toEqual([0]);
  });

  it("publishes every address above the operational expected count", async () => {
    const scheduler = new Scheduler();
    const expectedNodeCount = 32;
    const addresses = Array.from({ length: expectedNodeCount + 8 }, (_, index) => ({
      address: `10.0.0.${(index + 1).toString()}`,
      ttl: 30,
    }));
    const discovery = new GkeNodeDiscovery({
      serviceName: "api.default.svc.cluster.local",
      port: 8080,
      resolver: { resolve: async () => addresses },
      scheduler,
    });
    const snapshots: unknown[][] = [];
    const stop = discovery.watch((nodes) => {
      snapshots.push([...nodes]);
    });

    await scheduler.tick();

    expect(snapshots[0]).toHaveLength(expectedNodeCount + 8);
    await stop();
  });

  it("routes every discovered address through bounded Gateway client creation", async () => {
    const scheduler = new Scheduler();
    const addresses = Array.from({ length: 40 }, (_, index) => ({
      address: `10.0.1.${(index + 1).toString()}`,
      ttl: 30,
    }));
    let active = 0;
    let peak = 0;
    const forwarder = new DynamicUnaryForwarder({
      maxConcurrentStarts: 4,
      create: async (node) => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        return client(node.id);
      },
    });
    const discovery = new GkeNodeDiscovery({
      serviceName: "api.default.svc.cluster.local",
      port: 8080,
      resolver: { resolve: async () => addresses },
      scheduler,
    });
    const snapshots: ApplicationNode[][] = [];
    const stop = discovery.watch((nodes) => {
      snapshots.push([...nodes]);
    });

    await scheduler.tick();
    await forwarder.reconcile(snapshots[0] ?? []);
    const routed = await Promise.all(
      Array.from({ length: 40 }, async () => {
        const value = await forwarder.forward({
          service: "s",
          method: "m",
          value: new Uint8Array(),
        });
        return new TextDecoder().decode(value);
      }),
    );

    expect(peak).toBeLessThanOrEqual(4);
    expect(new Set(routed)).toHaveLength(40);
    await forwarder.close();
    await stop();
  });

  it("makes unary routing unavailable for an empty DNS answer and restores it on recovery", async () => {
    const scheduler = new Scheduler();
    const answers: (readonly { readonly address: string; readonly ttl: number }[])[] = [
      [{ address: "10.0.3.1", ttl: 30 }],
      [],
      [{ address: "10.0.3.2", ttl: 30 }],
    ];
    const forwarder = new DynamicUnaryForwarder({
      create: async (node) => client(node.endpoint),
    });
    const discovery = new GkeNodeDiscovery({
      serviceName: "api.default.svc.cluster.local",
      port: 8080,
      resolver: { resolve: async () => answers.shift() ?? [] },
      scheduler,
    });
    const pending: Promise<void>[] = [];
    const stop = discovery.watch((nodes) => {
      pending.push(forwarder.reconcile(nodes));
    });

    await scheduler.tick();
    await Promise.all(pending.splice(0));
    expect(
      new TextDecoder().decode(
        await forwarder.forward({ service: "s", method: "m", value: new Uint8Array() }),
      ),
    ).toBe("http://10.0.3.1:8080");
    await scheduler.tick();
    await Promise.all(pending.splice(0));
    await expect(
      forwarder.forward({ service: "s", method: "m", value: new Uint8Array() }),
    ).rejects.toThrow("absent");
    await scheduler.tick();
    await Promise.all(pending.splice(0));
    expect(
      new TextDecoder().decode(
        await forwarder.forward({ service: "s", method: "m", value: new Uint8Array() }),
      ),
    ).toBe("http://10.0.3.2:8080");
    await forwarder.close();
    await stop();
  });

  it("reconciles one durable native child per DNS node across removal and address reuse", async () => {
    const created: string[] = [];
    const disposed: string[] = [];
    const forwarder = new DynamicUnaryForwarder({
      create: async (node) => ({
        ...client(node.id),
        subscribe: async () => {
          created.push(node.id);
          return { kind: "backend-subscription-envelope" as const, bytes: new Uint8Array() };
        },
        dispose: async () => {
          disposed.push(node.id);
        },
      }),
    });
    const node = new ApplicationNode({
      id: "gke/http://10.0.4.1:8080/",
      endpoint: "http://10.0.4.1:8080",
    });
    const wire = {
      kind: "public-subscription" as const,
      bytes: toBinary(
        SubscriptionSchema,
        create(SubscriptionSchema, { id: { value: "board" }, topic: create(TopicSchema) }),
      ),
    };

    await forwarder.reconcile([node]);
    await forwarder.rehydrateDefinition(wire);
    await forwarder.reconcile([]);
    await forwarder.reconcile([node]);

    expect(created).toEqual([node.id, node.id]);
    expect(disposed).toEqual([node.id]);
    await forwarder.close();
  });
});

function client(id: string): DynamicUnaryClient {
  return {
    forward: async () => new TextEncoder().encode(id),
    close: async () => undefined,
    subscribe: async () => ({ kind: "backend-subscription-envelope", bytes: new Uint8Array() }),
    activate: async () => undefined,
    cancel: async () => undefined,
    dispose: async () => undefined,
  };
}

class Scheduler {
  readonly delays: number[] = [];
  #ticks: (() => void)[] = [];
  cancelled = 0;

  schedule(delayMs: number, onTick: () => void): () => void {
    this.delays.push(delayMs);
    this.#ticks.push(onTick);
    return () => {
      const index = this.#ticks.indexOf(onTick);
      if (index !== -1) this.#ticks.splice(index, 1);
      this.cancelled += 1;
    };
  }

  async tick(): Promise<void> {
    const tick = this.#ticks.shift();
    if (tick === undefined) throw new Error("No scheduled tick.");
    tick();
    await Promise.resolve();
    await Promise.resolve();
  }
}
