import { type LeasedNodeRegistry } from "@spine-event-engine/deployment";
import { describe, expect, it } from "vitest";

import { GceNodeDiscovery } from "../../src/index.js";

describe("GceNodeDiscovery", () => {
  it("stops scheduled discovery before closing its owned registry", async () => {
    const events: string[] = [];
    const discovery = new GceNodeDiscovery({
      registry: registry({
        read: async () => [],
        close: async () => {
          events.push("registry");
        },
      }),
      scheduler: {
        schedule: (_delay, _tick) => () => {
          events.push("stop");
        },
      },
    });

    const stop = discovery.watch(() => undefined);
    await stop();

    expect(events).toEqual(["stop", "registry"]);
  });

  it("shares one close attempt and closes the registry once", async () => {
    let closes = 0;
    const discovery = new GceNodeDiscovery({
      registry: registry({
        read: async () => [],
        close: async () => {
          closes++;
        },
      }),
    });

    const first = discovery.close();
    const second = discovery.close();
    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(closes).toBe(1);
  });

  it("closes its registry after a discovery-stop failure", async () => {
    let registryClosed = false;
    const discovery = new GceNodeDiscovery({
      registry: registry({
        read: async () => [],
        close: async () => {
          registryClosed = true;
        },
      }),
      discovery: {
        watch: () => () => Promise.resolve(),
        close: async () => {
          throw new Error("stop failed");
        },
      },
    });

    await expect(discovery.close()).rejects.toThrow("stop failed");
    expect(registryClosed).toBe(true);
  });
});

function registry(value: Pick<LeasedNodeRegistry, "close" | "read">): LeasedNodeRegistry {
  return value as LeasedNodeRegistry;
}
