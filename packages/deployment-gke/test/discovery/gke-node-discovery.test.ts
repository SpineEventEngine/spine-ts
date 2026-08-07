/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */

import { describe, expect, it } from "vitest";
import { DynamicUnaryForwarder, type DynamicUnaryClient } from "@spine-event-engine/auth";
import { ApplicationNode } from "@spine-event-engine/deployment";

import { GkeNodeDiscovery } from "../../src/index.js";

describe("GkeNodeDiscovery", () => {
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
    const snapshots: readonly (readonly {
      readonly id: string;
      readonly endpoint: string;
      readonly tlsServerName?: string;
    }[])[] = [];

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

    expect(scheduler.delays).toEqual([0, 3_000]);
    await stop();
  });

  it("uses the configured interval for zero TTL and immediate empty answers", async () => {
    const scheduler = new Scheduler();
    const answers = [[{ address: "10.0.0.1", ttl: 0 }], []] as const;
    const discovery = new GkeNodeDiscovery({
      serviceName: "api.default.svc.cluster.local",
      port: 8080,
      resolver: { resolve: async () => answers.shift() ?? [] },
      scheduler,
    });
    const snapshots: readonly unknown[][] = [];
    const stop = discovery.watch((nodes) => {
      snapshots.push([...nodes]);
    });

    await scheduler.tick();
    await scheduler.tick();

    expect(scheduler.delays).toEqual([0, 10_000, 10_000]);
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
    const snapshots: readonly unknown[][] = [];
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
    expect(scheduler.delays).toEqual([0, 2_000, 5_000, 5_000]);
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

  it("publishes every address above the operational expected count", async () => {
    const scheduler = new Scheduler();
    const addresses = Array.from({ length: 40 }, (_, index) => ({
      address: `10.0.0.${(index + 1).toString()}`,
      ttl: 30,
    }));
    const discovery = new GkeNodeDiscovery({
      serviceName: "api.default.svc.cluster.local",
      port: 8080,
      resolver: { resolve: async () => addresses },
      scheduler,
    });
    const snapshots: readonly unknown[][] = [];
    const stop = discovery.watch((nodes) => {
      snapshots.push([...nodes]);
    });

    await scheduler.tick();

    expect(snapshots[0]).toHaveLength(40);
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
    const snapshots: readonly ApplicationNode[][] = [];
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

  schedule(delayMs: number, onTick: () => void): () => void {
    this.delays.push(delayMs);
    this.#ticks.push(onTick);
    return () => undefined;
  }

  async tick(): Promise<void> {
    const tick = this.#ticks.shift();
    if (tick === undefined) throw new Error("No scheduled tick.");
    tick();
    await Promise.resolve();
    await Promise.resolve();
  }
}
