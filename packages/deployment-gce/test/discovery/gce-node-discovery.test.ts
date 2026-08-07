import { type LeasedNodeRegistry } from "@spine-event-engine/deployment";
import { describe, expect, it } from "vitest";

import { GceNodeDiscovery } from "../../src/index.js";

describe("GceNodeDiscovery", () => {
  it("stops scheduled discovery before closing its owned registry", async () => {
    const events: string[] = [];
    const discovery = new GceNodeDiscovery({
      registry: registry({
        read: () => Promise.resolve([]),
        close: () => {
          events.push("registry");
          return Promise.resolve();
        },
      }),
      scheduler: {
        schedule: (delay, tick) => {
          void delay;
          void tick;
          return () => {
            events.push("stop");
          };
        },
      },
    });

    const stop = discovery.watch(() => undefined);
    await stop();

    expect(events).toEqual(["stop", "registry"]);
  });

  it("closes its registry when scheduled discovery cancellation fails", async () => {
    let registryClosed = false;
    const discovery = new GceNodeDiscovery({
      registry: registry({
        read: () => Promise.resolve([]),
        close: () => {
          registryClosed = true;
          return Promise.resolve();
        },
      }),
      scheduler: {
        schedule: (delay, tick) => {
          void delay;
          void tick;
          return () => {
            throw new Error("scheduled discovery cancel failed");
          };
        },
      },
    });

    discovery.watch(() => undefined);

    await expect(discovery.close()).rejects.toThrow("scheduled discovery cancel failed");
    expect(registryClosed).toBe(true);
  });

  it("retains both close failures after closing its registry", async () => {
    const discoveryFailure = new Error("scheduled discovery cancel failed");
    const registryFailure = new Error("registry close failed");
    let registryClosed = false;
    const discovery = new GceNodeDiscovery({
      registry: registry({
        read: () => Promise.resolve([]),
        close: () => {
          registryClosed = true;
          return Promise.reject(registryFailure);
        },
      }),
      scheduler: {
        schedule: (delay, tick) => {
          void delay;
          void tick;
          return () => {
            throw discoveryFailure;
          };
        },
      },
    });

    discovery.watch(() => undefined);

    const error = await discovery.close().catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([discoveryFailure, registryFailure]);
    expect(registryClosed).toBe(true);
  });

  it("shares one close attempt and closes the registry once", async () => {
    let closes = 0;
    const discovery = new GceNodeDiscovery({
      registry: registry({
        read: () => Promise.resolve([]),
        close: () => {
          closes++;
          return Promise.resolve();
        },
      }),
    });

    const first = discovery.close();
    const second = discovery.close();
    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(closes).toBe(1);
  });

  it("preserves an owned-registry close failure", async () => {
    const discovery = new GceNodeDiscovery({
      registry: registry({
        read: () => Promise.resolve([]),
        close: () => Promise.reject(new Error("registry close failed")),
      }),
    });

    await expect(discovery.close()).rejects.toThrow("registry close failed");
  });
});

function registry(value: Pick<LeasedNodeRegistry, "close" | "read">): LeasedNodeRegistry {
  return value as LeasedNodeRegistry;
}
